import { asProductVariantId } from "../domain/ids.js";
import { asBindingId, asCycleKey, asIsoTimestamp, asShipMonth } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement } from "../staging-runtime/d1.js";
import {
  asProfileQueueActorRef,
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
} from "./contracts.js";
import {
  asProfileQueueFotmScheduleAuditId,
  asProfileQueueFotmScheduleIdempotencyKey,
  asProfileQueueFotmScheduleMutationId,
  assertProfileQueueFotmScheduleInvariant,
  createPendingProfileQueueFotmProvisionCommand,
  createRecoveryException,
  validateProfileQueueFotmProvisioningResult,
  type ClaimProfileQueueFotmProvisionCommandInput,
  type CompleteProfileQueueFotmProvisionCommandInput,
  type MarkProfileQueueFotmProvisionCommandNeedsAttentionInput,
  type PersistProfileQueueFotmScheduleInput,
  type ProfileQueueFotmProvisionCommand,
  type ProfileQueueFotmProvisioningResult,
  type ProfileQueueFotmScheduleRecoveryException,
  type ProfileQueueFotmScheduleAuditRecord,
  type ProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleRepository,
  type RecordProfileQueueFotmScheduleRecoveryExceptionInput,
  validateProfileQueueFotmSchedulePersistInput,
} from "./fotm-schedule.js";

interface ScheduleRow {
  readonly cutoff_at: string;
  readonly merchant_timezone: string;
  readonly revision: number;
  readonly ship_month: string;
  readonly status: string;
  readonly updated_at: string;
  readonly variant_id: string;
}

interface ScheduleAuditRow {
  readonly action: string;
  readonly actor_ref: string;
  readonly audit_id: string;
  readonly cutoff_at: string;
  readonly expected_revision: number | null;
  readonly idempotency_key: string;
  readonly merchant_timezone: string;
  readonly mutation_id: string;
  readonly occurred_at: string;
  readonly resulting_revision: number;
  readonly ship_month: string;
  readonly variant_id: string;
}

interface ProvisionCommandRow {
  readonly actor_ref: string;
  readonly attention_at: string | null;
  readonly candidate_plan_json: string;
  readonly completed_at: string | null;
  readonly configured_count: number | null;
  readonly conflicted_count: number | null;
  readonly created_at: string;
  readonly expected_schedule_revision: number;
  readonly idempotency_key: string;
  readonly ship_month: string;
  readonly status: string;
}

interface RecoveryExceptionRow {
  readonly actor_ref: string;
  readonly expected_revision: number;
  readonly idempotency_key: string;
  readonly occurred_at: string;
  readonly reason: string;
  readonly ship_month: string;
}

const SELECT_SCHEDULE = `
  SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision, updated_at
  FROM profile_queue_fotm_schedules
  WHERE ship_month = ?`;

const SELECT_SCHEDULES = `
  SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision, updated_at
  FROM profile_queue_fotm_schedules
  ORDER BY ship_month ASC`;

const SELECT_AUDIT_BY_IDEMPOTENCY = `
  SELECT audit_id, mutation_id, idempotency_key, actor_ref, ship_month, action,
    expected_revision, resulting_revision, variant_id, cutoff_at,
    merchant_timezone, occurred_at
  FROM profile_queue_fotm_schedule_audit
  WHERE idempotency_key = ?`;

const SELECT_PROVISION_COMMAND_BY_IDEMPOTENCY = `
  SELECT idempotency_key, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, status, configured_count, conflicted_count,
    created_at, completed_at, attention_at
  FROM profile_queue_fotm_provision_commands
  WHERE idempotency_key = ?`;

const SELECT_PROVISION_COMMANDS = `
  SELECT idempotency_key, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, status, configured_count, conflicted_count,
    created_at, completed_at, attention_at
  FROM profile_queue_fotm_provision_commands
  ORDER BY created_at DESC, idempotency_key ASC
  LIMIT ?`;

const SELECT_PENDING_PROVISION_COMMANDS = `
  SELECT idempotency_key, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, status, configured_count, conflicted_count,
    created_at, completed_at, attention_at
  FROM profile_queue_fotm_provision_commands
  WHERE status = 'PENDING'
  ORDER BY ship_month ASC`;

const SELECT_RECOVERY_EXCEPTION_BY_IDEMPOTENCY = `
  SELECT idempotency_key, actor_ref, ship_month, expected_revision, reason, occurred_at
  FROM profile_queue_fotm_schedule_recovery_exceptions
  WHERE idempotency_key = ?`;

/**
 * D1-only schedule repository. It has no staff authentication, HTTP route,
 * Shopify/Appstle client, or production fallback; the boundary injecting it
 * must establish an authenticated opaque staff actor before calling persist.
 */
export class D1ProfileQueueFotmScheduleRepository implements ProfileQueueFotmScheduleRepository {
  constructor(private readonly database: D1DatabasePort) {}

  async findAuditByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleAuditRecord | null> {
    const row = await this.database
      .prepare(SELECT_AUDIT_BY_IDEMPOTENCY)
      .bind(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey))
      .first<ScheduleAuditRow>();
    return row ? mapAuditRow(row) : null;
  }

  async findProvisionCommandByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmProvisionCommand | null> {
    const row = await this.database
      .prepare(SELECT_PROVISION_COMMAND_BY_IDEMPOTENCY)
      .bind(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey))
      .first<ProvisionCommandRow>();
    return row ? mapProvisionCommandRow(row) : null;
  }

  async findRecoveryExceptionByIdempotency(
    idempotencyKey: string,
  ): Promise<ProfileQueueFotmScheduleRecoveryException | null> {
    const row = await this.database
      .prepare(SELECT_RECOVERY_EXCEPTION_BY_IDEMPOTENCY)
      .bind(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey))
      .first<RecoveryExceptionRow>();
    return row ? mapRecoveryExceptionRow(row) : null;
  }

  async findSchedule(shipMonth: string): Promise<ProfileQueueFotmSchedule | null> {
    const row = await this.database.prepare(SELECT_SCHEDULE).bind(asShipMonth(shipMonth)).first<ScheduleRow>();
    return row ? mapScheduleRow(row) : null;
  }

  async listProvisionCommands(limit: number): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    assertProvisionCommandListLimit(limit);
    const result = await this.database.prepare(SELECT_PROVISION_COMMANDS).bind(limit).all<ProvisionCommandRow>();
    return (result.results ?? []).map(mapProvisionCommandRow);
  }

  async listPendingProvisionCommands(): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    const result = await this.database.prepare(SELECT_PENDING_PROVISION_COMMANDS).all<ProvisionCommandRow>();
    return (result.results ?? []).map(mapProvisionCommandRow);
  }

  async listSchedules(): Promise<readonly ProfileQueueFotmSchedule[]> {
    const result = await this.database.prepare(SELECT_SCHEDULES).all<ScheduleRow>();
    return (result.results ?? []).map(mapScheduleRow);
  }

  async claimProvisionCommand(
    input: ClaimProfileQueueFotmProvisionCommandInput,
  ): Promise<ProfileQueueFotmProvisionCommand> {
    const command = createPendingProfileQueueFotmProvisionCommand(input);
    const result = await this.database.prepare(`
      INSERT INTO profile_queue_fotm_provision_commands (
        idempotency_key, actor_ref, ship_month, expected_schedule_revision,
        candidate_plan_json, status, configured_count, conflicted_count,
        created_at, completed_at, attention_at
      ) SELECT ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, NULL, NULL
      WHERE EXISTS (
        SELECT 1 FROM profile_queue_fotm_schedules schedule
        WHERE schedule.ship_month = ?
          AND schedule.status = 'PUBLISHED'
          AND schedule.revision = ?
      )`)
      .bind(
        command.idempotencyKey,
        command.actorRef,
        command.shipMonth,
        command.expectedScheduleRevision,
        stringifyProvisionPlan(command),
        command.createdAt,
        command.shipMonth,
        command.expectedScheduleRevision,
      )
      .run();
    if (result.meta?.changes !== 1) {
      throw new Error("The staging FOTM provision command changed; reload before provisioning.");
    }
    return command;
  }

  async completeProvisionCommand(
    input: CompleteProfileQueueFotmProvisionCommandInput,
  ): Promise<ProfileQueueFotmProvisionCommand> {
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const current = await this.findProvisionCommandByIdempotency(idempotencyKey);
    if (!current) throw new Error("The staging FOTM provision command was not found.");
    const result = validateProfileQueueFotmProvisioningResult(input.result, current.plan.length);
    if (current.status === "COMPLETED") {
      if (!sameProvisioningResult(current.result, result)) {
        throw new Error("The staging FOTM provision command already has a different result.");
      }
      return current;
    }
    if (current.status !== "PENDING") {
      throw new Error("A terminal staging FOTM provision command cannot be completed.");
    }
    const completedAt = asIsoTimestamp(input.completedAt);
    const update = await this.database.prepare(`
      UPDATE profile_queue_fotm_provision_commands
      SET status = 'COMPLETED', configured_count = ?, conflicted_count = ?, completed_at = ?
      WHERE idempotency_key = ? AND status = 'PENDING'`)
      .bind(result.configured, result.conflicted, completedAt, idempotencyKey)
      .run();
    if (update.meta?.changes !== 1) {
      const replay = await this.findProvisionCommandByIdempotency(idempotencyKey);
      if (replay?.status === "COMPLETED" && sameProvisioningResult(replay.result, result)) return replay;
      throw new Error("The staging FOTM provision command changed; reload before confirming it.");
    }
    return {
      ...current,
      completedAt,
      result,
      status: "COMPLETED",
    };
  }

  async markProvisionCommandNeedsAttention(
    input: MarkProfileQueueFotmProvisionCommandNeedsAttentionInput,
  ): Promise<ProfileQueueFotmProvisionCommand> {
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const current = await this.findProvisionCommandByIdempotency(idempotencyKey);
    if (!current) throw new Error("The staging FOTM provision command was not found.");
    if (current.status === "NEEDS_ATTENTION") return current;
    if (current.status !== "PENDING") {
      throw new Error("Only a pending staging FOTM provision command may be marked for attention.");
    }
    const actorRef = asProfileQueueActorRef(input.actorRef);
    const shipMonth = asShipMonth(input.shipMonth);
    const notBefore = asIsoTimestamp(input.notBefore);
    const attentionAt = asIsoTimestamp(input.attentionAt);
    const update = await this.database.prepare(`
      UPDATE profile_queue_fotm_provision_commands
      SET status = 'NEEDS_ATTENTION', attention_at = ?
      WHERE idempotency_key = ?
        AND status = 'PENDING'
        AND actor_ref = ?
        AND ship_month = ?
        AND expected_schedule_revision = ?
        AND julianday(created_at) <= julianday(?)`)
      .bind(
        attentionAt,
        idempotencyKey,
        actorRef,
        shipMonth,
        asRevision(input.expectedScheduleRevision),
        notBefore,
      )
      .run();
    if (update.meta?.changes !== 1) {
      const replay = await this.findProvisionCommandByIdempotency(idempotencyKey);
      if (
        replay?.status === "NEEDS_ATTENTION"
        && replay.actorRef === actorRef
        && replay.shipMonth === shipMonth
        && replay.expectedScheduleRevision === input.expectedScheduleRevision
      ) {
        return replay;
      }
      throw new Error("The staging FOTM provision command changed; reload before recording attention.");
    }
    return {
      ...current,
      attentionAt,
      status: "NEEDS_ATTENTION",
    };
  }

  async recordRecoveryException(
    input: RecordProfileQueueFotmScheduleRecoveryExceptionInput,
  ): Promise<ProfileQueueFotmScheduleRecoveryException> {
    const exception = createRecoveryException(input);
    const result = await this.database.prepare(`
      INSERT INTO profile_queue_fotm_schedule_recovery_exceptions (
        idempotency_key, actor_ref, ship_month, expected_revision, reason, occurred_at
      ) SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM profile_queue_fotm_schedules schedule
        WHERE schedule.ship_month = ?
          AND schedule.revision = ?
          AND schedule.status IN ('PUBLISHED', 'RETIRED')
      )
      AND EXISTS (
        SELECT 1 FROM profile_queue_cycles cycle
        WHERE cycle.ship_month = ?
          AND cycle.fotm_status IN ('PUBLISHED', 'RESOLVED')
      )`)
      .bind(
        exception.idempotencyKey,
        exception.actorRef,
        exception.shipMonth,
        exception.expectedRevision,
        exception.reason,
        exception.occurredAt,
        exception.shipMonth,
        exception.expectedRevision,
        exception.shipMonth,
      )
      .run();
    if (result.meta?.changes !== 1) {
      throw new Error("The FOTM recovery exception changed; reload before recording it.");
    }
    return exception;
  }

  async persist(input: PersistProfileQueueFotmScheduleInput): Promise<ProfileQueueFotmSchedule> {
    validateProfileQueueFotmSchedulePersistInput(input);
    const statements = input.expectedRevision === null
      ? createStatements(this.database, input)
      : updateStatements(this.database, input);
    const results = await this.database.batch(statements);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
      throw new Error("The FOTM schedule changed; reload before saving.");
    }
    return { ...input.schedule };
  }
}

function createStatements(
  database: D1DatabasePort,
  input: PersistProfileQueueFotmScheduleInput,
): readonly D1PreparedStatement[] {
  return [
    database.prepare(`
      INSERT INTO profile_queue_fotm_schedules (
        ship_month, variant_id, cutoff_at, merchant_timezone, status,
        revision, last_mutation_id, last_action, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.schedule.shipMonth,
        input.schedule.variantId,
        input.schedule.cutoffAt,
        input.schedule.merchantTimezone,
        input.schedule.status,
        input.schedule.revision,
        input.audit.mutationId,
        input.audit.action,
        input.schedule.updatedAt,
      ),
    bindAuditInsert(database, input),
  ];
}

function updateStatements(
  database: D1DatabasePort,
  input: PersistProfileQueueFotmScheduleInput,
): readonly D1PreparedStatement[] {
  const expectedRevision = input.expectedRevision;
  if (expectedRevision === null) throw new Error("FOTM schedule update requires a revision.");
  return [
    database.prepare(`
      UPDATE profile_queue_fotm_schedules
      SET variant_id = ?, cutoff_at = ?, merchant_timezone = ?, status = ?,
        revision = ?, last_mutation_id = ?, last_action = ?, updated_at = ?
      WHERE ship_month = ? AND revision = ?`)
      .bind(
        input.schedule.variantId,
        input.schedule.cutoffAt,
        input.schedule.merchantTimezone,
        input.schedule.status,
        input.schedule.revision,
        input.audit.mutationId,
        input.audit.action,
        input.schedule.updatedAt,
        input.schedule.shipMonth,
        expectedRevision,
      ),
    bindAuditInsert(database, input),
  ];
}

function bindAuditInsert(
  database: D1DatabasePort,
  input: PersistProfileQueueFotmScheduleInput,
): D1PreparedStatement {
  const { audit, schedule } = input;
  return database.prepare(`
    INSERT INTO profile_queue_fotm_schedule_audit (
      audit_id, mutation_id, idempotency_key, actor_ref, ship_month, action,
      expected_revision, resulting_revision, variant_id, cutoff_at,
      merchant_timezone, occurred_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM profile_queue_fotm_schedules
      WHERE ship_month = ? AND revision = ? AND last_mutation_id = ?
    )`)
    .bind(
      audit.auditId,
      audit.mutationId,
      audit.idempotencyKey,
      audit.actorRef,
      audit.shipMonth,
      audit.action,
      audit.expectedRevision,
      audit.resultingRevision,
      audit.variantId,
      audit.cutoffAt,
      audit.merchantTimezone,
      audit.occurredAt,
      schedule.shipMonth,
      schedule.revision,
      audit.mutationId,
    );
}

function mapScheduleRow(row: ScheduleRow): ProfileQueueFotmSchedule {
  const status = asScheduleStatus(row.status);
  const merchantTimezone = row.merchant_timezone === MEMBER_FRAGRANCE_CUTOFF_TIMEZONE
    ? MEMBER_FRAGRANCE_CUTOFF_TIMEZONE
    : (() => { throw new Error("FOTM schedule contains a non-Central cutoff timezone."); })();
  const schedule: ProfileQueueFotmSchedule = {
    cutoffAt: asIsoTimestamp(row.cutoff_at),
    merchantTimezone,
    revision: asRevision(row.revision),
    shipMonth: asShipMonth(row.ship_month),
    status,
    updatedAt: asIsoTimestamp(row.updated_at),
    variantId: asProductVariantId(row.variant_id),
  };
  assertProfileQueueFotmScheduleInvariant(schedule);
  return schedule;
}

function mapAuditRow(row: ScheduleAuditRow): ProfileQueueFotmScheduleAuditRecord {
  const action = row.action === "SCHEDULED" || row.action === "PUBLISHED" || row.action === "RETIRED" || row.action === "RECOVERED"
    ? row.action
    : (() => { throw new Error("FOTM schedule audit contains an unsupported action."); })();
  const merchantTimezone = row.merchant_timezone === MEMBER_FRAGRANCE_CUTOFF_TIMEZONE
    ? MEMBER_FRAGRANCE_CUTOFF_TIMEZONE
    : (() => { throw new Error("FOTM schedule audit contains a non-Central cutoff timezone."); })();
  return {
    action,
    actorRef: asProfileQueueActorRef(row.actor_ref),
    auditId: asProfileQueueFotmScheduleAuditId(row.audit_id),
    cutoffAt: asIsoTimestamp(row.cutoff_at),
    expectedRevision: row.expected_revision === null ? null : asRevision(row.expected_revision),
    idempotencyKey: asProfileQueueFotmScheduleIdempotencyKey(row.idempotency_key),
    merchantTimezone,
    mutationId: asProfileQueueFotmScheduleMutationId(row.mutation_id),
    occurredAt: asIsoTimestamp(row.occurred_at),
    resultingRevision: asRevision(row.resulting_revision),
    shipMonth: asShipMonth(row.ship_month),
    variantId: asProductVariantId(row.variant_id),
  };
}

function asScheduleStatus(value: string): ProfileQueueFotmSchedule["status"] {
  if (value === "DRAFT" || value === "PUBLISHED" || value === "RETIRED") return value;
  throw new Error("FOTM schedule contains an unsupported status.");
}

function mapProvisionCommandRow(row: ProvisionCommandRow): ProfileQueueFotmProvisionCommand {
  let parsedPlan: unknown;
  try {
    parsedPlan = JSON.parse(row.candidate_plan_json);
  } catch {
    throw new Error("FOTM provision command contains malformed plan evidence.");
  }
  if (!Array.isArray(parsedPlan)) throw new Error("FOTM provision command plan must be an array.");
  const command = createPendingProfileQueueFotmProvisionCommand({
    actorRef: asProfileQueueActorRef(row.actor_ref),
    createdAt: row.created_at,
    expectedScheduleRevision: asRevision(row.expected_schedule_revision),
    idempotencyKey: row.idempotency_key,
    plan: parsedPlan.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("FOTM provision command plan contains an invalid target.");
      }
      const record = entry as Record<string, unknown>;
      return {
        bindingId: asBindingId(asText(record.bindingId, "binding ID")),
        cycleKey: asCycleKey(asText(record.cycleKey, "cycle key")),
        expectedRevision: asRevision(record.expectedRevision),
      };
    }),
    shipMonth: row.ship_month,
  });
  if (row.status === "PENDING") {
    if (
      row.attention_at !== null
      || row.completed_at !== null
      || row.configured_count !== null
      || row.conflicted_count !== null
    ) {
      throw new Error("Pending FOTM provision command contains a result.");
    }
    return command;
  }
  if (row.status === "NEEDS_ATTENTION") {
    if (
      row.attention_at === null
      || row.completed_at !== null
      || row.configured_count !== null
      || row.conflicted_count !== null
    ) {
      throw new Error("Needs-attention FOTM provision command contains a result.");
    }
    return {
      ...command,
      attentionAt: asIsoTimestamp(row.attention_at),
      status: "NEEDS_ATTENTION",
    };
  }
  if (
    row.status !== "COMPLETED"
    || row.attention_at !== null
    || row.completed_at === null
    || row.configured_count === null
    || row.conflicted_count === null
  ) {
    throw new Error("FOTM provision command contains an unsupported status.");
  }
  const result = validateProfileQueueFotmProvisioningResult({
    configured: asRevision(row.configured_count),
    conflicted: asRevision(row.conflicted_count),
    mayHaveMore: command.plan.length === 5,
    scanned: command.plan.length,
  }, command.plan.length);
  return {
    ...command,
    completedAt: asIsoTimestamp(row.completed_at),
    result,
    status: "COMPLETED",
  };
}

function mapRecoveryExceptionRow(row: RecoveryExceptionRow): ProfileQueueFotmScheduleRecoveryException {
  if (row.reason !== "PROVISIONED_CYCLES") {
    throw new Error("FOTM recovery exception contains an unsupported reason.");
  }
  return createRecoveryException({
    actorRef: asProfileQueueActorRef(row.actor_ref),
    expectedRevision: asRevision(row.expected_revision),
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
    shipMonth: row.ship_month,
  });
}

function stringifyProvisionPlan(command: ProfileQueueFotmProvisionCommand): string {
  return JSON.stringify(command.plan.map((entry) => ({
    bindingId: entry.bindingId,
    cycleKey: entry.cycleKey,
    expectedRevision: entry.expectedRevision,
  })));
}

function asText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`FOTM provision command ${label} is invalid.`);
  return value;
}

function assertProvisionCommandListLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 24) {
    throw new Error("Staging FOTM provision command lists must be bounded between one and twenty-four.");
  }
}

function sameProvisioningResult(
  left: ProfileQueueFotmProvisioningResult | null,
  right: ProfileQueueFotmProvisioningResult,
): boolean {
  return left !== null
    && left.configured === right.configured
    && left.conflicted === right.conflicted
    && left.mayHaveMore === right.mayHaveMore
    && left.scanned === right.scanned;
}

function asRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("FOTM schedule has an invalid revision.");
  }
  return value;
}
