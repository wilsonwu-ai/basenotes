import {
  asProfileQueueActorRef,
  asProfileQueueAddOnId,
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  assertProfileQueueCycleInvariant,
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  type ProfileQueueAddOn,
  type ProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import {
  ProfileQueueRepositoryConflictError,
  type FindProfileQueueCyclesDueForCutoffInput,
  type FindProfileQueueCyclesForProvisioningInput,
  type PersistProfileQueueMutationInput,
  type ProfileQueuePersistedMutation,
  type ProfileQueueRepository,
  validatePersistInput,
} from "./repository.js";
import { cloneCycle } from "./service.js";
import {
  asBindingId,
  asCycleKey,
  asIsoTimestamp,
  asMerchantTimezone,
  asShipMonth,
  type QueueSlotState,
} from "../queue/types.js";
import { asProductVariantId } from "../domain/ids.js";
import type { D1DatabasePort, D1PreparedStatement } from "../staging-runtime/d1.js";

interface CycleRow {
  readonly binding_id: string;
  readonly cycle_key: string;
  readonly ship_month: string;
  readonly state: string;
  readonly revision: number;
  readonly fotm_variant_id: string | null;
  readonly fotm_status: string;
  readonly fotm_cutoff_at: string | null;
  readonly merchant_timezone: string | null;
  readonly member_choice_source: string;
  readonly member_choice_variant_id: string | null;
  readonly member_choice_selected_at: string | null;
  readonly updated_at: string;
}

interface AddOnRow {
  readonly add_on_id: string;
  readonly position: number;
  readonly variant_id: string;
  readonly unit_price_cents: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AuditRow {
  readonly actor_ref: string;
  readonly binding_id: string;
  readonly cycle_key: string;
  readonly expected_revision: number | null;
  readonly idempotency_key: string;
  readonly mutation_id: string;
  readonly mutation_kind: string;
  readonly occurred_at: string;
  readonly resulting_revision: number;
}

const SELECT_CYCLE = `
  SELECT binding_id, cycle_key, ship_month, state, revision,
    fotm_variant_id, fotm_status, fotm_cutoff_at, merchant_timezone,
    member_choice_source, member_choice_variant_id, member_choice_selected_at, updated_at
  FROM profile_queue_cycles
  WHERE binding_id = ? AND cycle_key = ?`;

const SELECT_DUE_CYCLES = `
  SELECT binding_id, cycle_key, ship_month, state, revision,
    fotm_variant_id, fotm_status, fotm_cutoff_at, merchant_timezone,
    member_choice_source, member_choice_variant_id, member_choice_selected_at, updated_at
  FROM profile_queue_cycles
  WHERE state = 'OPEN'
    AND fotm_status = 'PUBLISHED'
    AND merchant_timezone = ?
    AND fotm_cutoff_at IS NOT NULL
    AND julianday(fotm_cutoff_at) <= julianday(?)
  ORDER BY julianday(fotm_cutoff_at) ASC, binding_id ASC, cycle_key ASC
  LIMIT ?`;

const SELECT_UNPUBLISHED_CYCLES_FOR_PROVISIONING = `
  SELECT binding_id, cycle_key, ship_month, state, revision,
    fotm_variant_id, fotm_status, fotm_cutoff_at, merchant_timezone,
    member_choice_source, member_choice_variant_id, member_choice_selected_at, updated_at
  FROM profile_queue_cycles
  WHERE ship_month = ?
    AND state = 'OPEN'
    AND fotm_status = 'UNPUBLISHED'
  ORDER BY binding_id ASC, cycle_key ASC
  LIMIT ?`;

const SELECT_PROVISIONED_FOTM_FOR_SHIP_MONTH = `
  SELECT 1 AS present
  FROM profile_queue_cycles
  WHERE ship_month = ?
    AND fotm_status IN ('PUBLISHED', 'RESOLVED')
  LIMIT 1`;

const SELECT_ADD_ONS = `
  SELECT add_on_id, position, variant_id, unit_price_cents, created_at, updated_at
  FROM profile_queue_add_ons
  WHERE binding_id = ? AND cycle_key = ?
  ORDER BY position ASC`;

const SELECT_AUDIT_BY_IDEMPOTENCY = `
  SELECT actor_ref, binding_id, cycle_key, expected_revision, idempotency_key,
    mutation_id, mutation_kind, occurred_at, resulting_revision
  FROM profile_queue_mutation_audit
  WHERE idempotency_key = ?`;

/**
 * D1-shaped durable repository. It receives an injected binding only from a
 * future Worker entrypoint; this module itself has no binding, credentials,
 * Wrangler configuration, network call, or migration runner.
 */
export class D1ProfileQueueRepository implements ProfileQueueRepository {
  constructor(private readonly database: D1DatabasePort) {}

  async findCycle(bindingId: string, cycleKey: string): Promise<ProfileQueueCycle | null> {
    const normalizedBindingId = asBindingId(bindingId);
    const normalizedCycleKey = asCycleKey(cycleKey);
    const row = await this.database
      .prepare(SELECT_CYCLE)
      .bind(normalizedBindingId, normalizedCycleKey)
      .first<CycleRow>();
    if (!row) return null;

    const addOnResult = await this.database
      .prepare(SELECT_ADD_ONS)
      .bind(normalizedBindingId, normalizedCycleKey)
      .all<AddOnRow>();
    const cycle = mapCycleRow(row, addOnResult.results ?? []);
    assertProfileQueueCycleInvariant(cycle);
    return cloneCycle(cycle);
  }

  async findMutation(idempotencyKey: string): Promise<ProfileQueueMutationAuditRecord | null> {
    const key = asProfileQueueIdempotencyKey(idempotencyKey);
    const row = await this.database.prepare(SELECT_AUDIT_BY_IDEMPOTENCY).bind(key).first<AuditRow>();
    if (!row) return null;
    return mapAuditRow(row);
  }

  async findDueForCutoff(input: FindProfileQueueCyclesDueForCutoffInput): Promise<readonly ProfileQueueCycle[]> {
    const asOf = asIsoTimestamp(input.asOf);
    assertCutoffScanLimit(input.limit);
    const result = await this.database
      .prepare(SELECT_DUE_CYCLES)
      .bind(MEMBER_FRAGRANCE_CUTOFF_TIMEZONE, asOf, input.limit)
      .all<CycleRow>();
    const rows = result.results ?? [];
    const cycles: ProfileQueueCycle[] = [];
    for (const row of rows) {
      const addOnResult = await this.database
        .prepare(SELECT_ADD_ONS)
        .bind(row.binding_id, row.cycle_key)
        .all<AddOnRow>();
      const cycle = mapCycleRow(row, addOnResult.results ?? []);
      assertProfileQueueCycleInvariant(cycle);
      cycles.push(cloneCycle(cycle));
    }
    return cycles;
  }

  async findUnpublishedForProvisioning(
    input: FindProfileQueueCyclesForProvisioningInput,
  ): Promise<readonly ProfileQueueCycle[]> {
    assertProvisioningScanLimit(input.limit);
    const shipMonth = asShipMonth(input.shipMonth);
    const result = await this.database
      .prepare(SELECT_UNPUBLISHED_CYCLES_FOR_PROVISIONING)
      .bind(shipMonth, input.limit)
      .all<CycleRow>();
    return readCyclesWithAddOns(this.database, result.results ?? []);
  }

  async hasProvisionedFotmForShipMonth(shipMonth: string): Promise<boolean> {
    const row = await this.database
      .prepare(SELECT_PROVISIONED_FOTM_FOR_SHIP_MONTH)
      .bind(asShipMonth(shipMonth))
      .first<{ readonly present: number }>();
    return row !== null;
  }

  async persist(input: PersistProfileQueueMutationInput): Promise<ProfileQueuePersistedMutation> {
    validatePersistInput(input);
    const statements = input.expectedRevision === null
      ? createStatements(this.database, input)
      : updateStatements(this.database, input);
    const results = await this.database.batch(statements);
    const first = results[0];
    const auditResult = results.at(-2);
    const evidenceResult = results.at(-1);
    if (
      !first
      || first.meta?.changes !== 1
      || auditResult?.meta?.changes !== 1
      || evidenceResult?.meta?.changes !== 1
    ) {
      throw new ProfileQueueRepositoryConflictError("The profile queue changed; reload before saving.");
    }
    return {
      audit: { ...input.audit },
      cycle: cloneCycle(input.cycle),
      selectionEvidence: {
        ...input.selectionEvidence,
        addOnSnapshot: input.selectionEvidence.addOnSnapshot.map((entry) => ({ ...entry })),
      },
    };
  }
}

function createStatements(
  database: D1DatabasePort,
  input: PersistProfileQueueMutationInput,
): D1PreparedStatement[] {
  if (input.expectedRevision !== null || input.cycle.revision !== 0) {
    throw new ProfileQueueRepositoryConflictError("New profile queue cycles must use an empty revision boundary.");
  }
  const { cycle, audit } = input;
  const statements = [
    // A duplicate primary key aborts this D1 batch instead of overwriting the cycle.
    bindCycleInsert(database, cycle, audit),
    ...addOnReplacementStatements(database, cycle, audit, 0),
    bindAuditInsert(database, cycle, audit, 0),
    bindSelectionEvidenceInsert(database, input),
  ];
  return statements;
}

function updateStatements(
  database: D1DatabasePort,
  input: PersistProfileQueueMutationInput,
): D1PreparedStatement[] {
  const expectedRevision = input.expectedRevision;
  if (expectedRevision === null || input.cycle.revision !== expectedRevision + 1) {
    throw new ProfileQueueRepositoryConflictError("Profile queue updates must advance one optimistic revision.");
  }
  const { cycle, audit } = input;
  return [
    bindCycleUpdate(database, cycle, audit, expectedRevision),
    ...addOnReplacementStatements(database, cycle, audit, cycle.revision),
    bindAuditInsert(database, cycle, audit, cycle.revision),
    bindSelectionEvidenceInsert(database, input),
  ];
}

function bindCycleInsert(
  database: D1DatabasePort,
  cycle: ProfileQueueCycle,
  audit: ProfileQueueMutationAuditRecord,
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, member_choice_source,
      member_choice_variant_id, member_choice_selected_at, last_mutation_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      cycle.bindingId,
      cycle.cycleKey,
      cycle.shipMonth,
      cycle.state,
      cycle.revision,
      cycle.fotm.variantId,
      cycle.fotm.status,
      cycle.fotm.cutoffAt,
      cycle.fotm.merchantTimezone,
      cycle.memberChoice.source,
      cycle.memberChoice.variantId,
      cycle.memberChoice.selectedAt,
      audit.mutationId,
      cycle.updatedAt,
    );
}

function bindCycleUpdate(
  database: D1DatabasePort,
  cycle: ProfileQueueCycle,
  audit: ProfileQueueMutationAuditRecord,
  expectedRevision: number,
): D1PreparedStatement {
  return database.prepare(`
    UPDATE profile_queue_cycles
    SET state = ?, revision = ?, fotm_variant_id = ?, fotm_status = ?,
      fotm_cutoff_at = ?, merchant_timezone = ?, member_choice_source = ?,
      member_choice_variant_id = ?, member_choice_selected_at = ?, last_mutation_id = ?, updated_at = ?
    WHERE binding_id = ? AND cycle_key = ? AND ship_month = ? AND revision = ?`)
    .bind(
      cycle.state,
      cycle.revision,
      cycle.fotm.variantId,
      cycle.fotm.status,
      cycle.fotm.cutoffAt,
      cycle.fotm.merchantTimezone,
      cycle.memberChoice.source,
      cycle.memberChoice.variantId,
      cycle.memberChoice.selectedAt,
      audit.mutationId,
      cycle.updatedAt,
      cycle.bindingId,
      cycle.cycleKey,
      cycle.shipMonth,
      expectedRevision,
    );
}

function addOnReplacementStatements(
  database: D1DatabasePort,
  cycle: ProfileQueueCycle,
  audit: ProfileQueueMutationAuditRecord,
  resultingRevision: number,
): D1PreparedStatement[] {
  const guard = `
    EXISTS (
      SELECT 1 FROM profile_queue_cycles
      WHERE binding_id = ? AND cycle_key = ? AND revision = ? AND last_mutation_id = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM profile_queue_mutation_audit WHERE mutation_id = ?
    )`;
  const statements: D1PreparedStatement[] = [
    database.prepare(`
      DELETE FROM profile_queue_add_ons
      WHERE binding_id = ? AND cycle_key = ? AND ${guard}`)
      .bind(
        cycle.bindingId,
        cycle.cycleKey,
        cycle.bindingId,
        cycle.cycleKey,
        resultingRevision,
        audit.mutationId,
        audit.mutationId,
      ),
  ];
  for (const addOn of cycle.addOns) {
    statements.push(
      database.prepare(`
        INSERT INTO profile_queue_add_ons (
          binding_id, cycle_key, add_on_id, position, variant_id,
          unit_price_cents, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
        .bind(
          cycle.bindingId,
          cycle.cycleKey,
          addOn.id,
          addOn.position,
          addOn.variantId,
          addOn.unitPriceCents,
          addOn.createdAt,
          addOn.updatedAt,
          cycle.bindingId,
          cycle.cycleKey,
          resultingRevision,
          audit.mutationId,
          audit.mutationId,
        ),
    );
  }
  return statements;
}

function bindAuditInsert(
  database: D1DatabasePort,
  cycle: ProfileQueueCycle,
  audit: ProfileQueueMutationAuditRecord,
  resultingRevision: number,
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO profile_queue_mutation_audit (
      mutation_id, idempotency_key, actor_ref, binding_id, cycle_key,
      mutation_kind, expected_revision, resulting_revision, occurred_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM profile_queue_cycles
      WHERE binding_id = ? AND cycle_key = ? AND revision = ? AND last_mutation_id = ?
    )`)
    .bind(
      audit.mutationId,
      audit.idempotencyKey,
      audit.actorRef,
      audit.bindingId,
      audit.cycleKey,
      audit.mutationKind,
      audit.expectedRevision,
      audit.resultingRevision,
      audit.occurredAt,
      cycle.bindingId,
      cycle.cycleKey,
      resultingRevision,
      audit.mutationId,
    );
}

function bindSelectionEvidenceInsert(
  database: D1DatabasePort,
  input: PersistProfileQueueMutationInput,
): D1PreparedStatement {
  const { audit, cycle, selectionEvidence } = input;
  const snapshotJson = JSON.stringify(selectionEvidence.addOnSnapshot.map((addOn) => ({
    position: addOn.position,
    variantId: addOn.variantId,
  })));
  return database.prepare(`
    INSERT INTO profile_queue_selection_evidence (
      evidence_id, mutation_id, binding_id, cycle_key, event_kind,
      member_choice_source, member_choice_variant_id, add_on_snapshot_json,
      resulting_revision, occurred_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM profile_queue_mutation_audit
      WHERE mutation_id = ? AND binding_id = ? AND cycle_key = ?
        AND resulting_revision = ? AND occurred_at = ?
    ) AND EXISTS (
      SELECT 1 FROM profile_queue_cycles
      WHERE binding_id = ? AND cycle_key = ? AND revision = ? AND last_mutation_id = ?
    )`)
    .bind(
      selectionEvidence.evidenceId,
      selectionEvidence.mutationId,
      selectionEvidence.bindingId,
      selectionEvidence.cycleKey,
      selectionEvidence.eventKind,
      selectionEvidence.memberChoiceSource,
      selectionEvidence.memberChoiceVariantId,
      snapshotJson,
      selectionEvidence.resultingRevision,
      selectionEvidence.occurredAt,
      audit.mutationId,
      cycle.bindingId,
      cycle.cycleKey,
      cycle.revision,
      cycle.updatedAt,
      cycle.bindingId,
      cycle.cycleKey,
      cycle.revision,
      audit.mutationId,
    );
}

function mapCycleRow(row: CycleRow, addOnRows: readonly AddOnRow[]): ProfileQueueCycle {
  const fotmStatus = asFotmStatus(row.fotm_status);
  const fotm = fotmStatus === "UNPUBLISHED"
    ? { cutoffAt: null, merchantTimezone: null, status: fotmStatus, variantId: null }
    : {
        cutoffAt: asIsoTimestamp(requiredString(row.fotm_cutoff_at, "fotm_cutoff_at")),
        merchantTimezone: asMerchantTimezone(requiredString(row.merchant_timezone, "merchant_timezone")),
        status: fotmStatus,
        variantId: asProductVariantId(requiredString(row.fotm_variant_id, "fotm_variant_id")),
      };
  return {
    addOns: addOnRows.map(mapAddOnRow),
    bindingId: asBindingId(row.binding_id),
    cycleKey: asCycleKey(row.cycle_key),
    fotm,
    memberChoice: mapMemberChoice(row),
    revision: asRevision(row.revision),
    shipMonth: asShipMonth(row.ship_month),
    state: asQueueSlotState(row.state),
    updatedAt: asIsoTimestamp(row.updated_at),
  };
}

function mapMemberChoice(row: CycleRow): ProfileQueueCycle["memberChoice"] {
  const source = asMemberChoiceSource(row.member_choice_source);
  if (source === "UNSELECTED") {
    return { selectedAt: null, source, variantId: null };
  }
  return {
    selectedAt: asIsoTimestamp(requiredString(row.member_choice_selected_at, "member_choice_selected_at")),
    source,
    variantId: asProductVariantId(requiredString(row.member_choice_variant_id, "member_choice_variant_id")),
  };
}

function mapAddOnRow(row: AddOnRow): ProfileQueueAddOn {
  return {
    createdAt: asIsoTimestamp(row.created_at),
    id: asProfileQueueAddOnId(row.add_on_id),
    position: asRevision(row.position),
    unitPriceCents: row.unit_price_cents as 1_800,
    updatedAt: asIsoTimestamp(row.updated_at),
    variantId: asProductVariantId(row.variant_id),
  };
}

function mapAuditRow(row: AuditRow): ProfileQueueMutationAuditRecord {
  if (!isAuditMutationKind(row.mutation_kind)) {
    throw new Error("Queue audit contains an unsupported mutation kind.");
  }
  return {
    actorRef: asProfileQueueActorRef(row.actor_ref),
    bindingId: asBindingId(row.binding_id),
    cycleKey: asCycleKey(row.cycle_key),
    expectedRevision: row.expected_revision === null ? null : asRevision(row.expected_revision),
    idempotencyKey: asProfileQueueIdempotencyKey(row.idempotency_key),
    mutationId: asProfileQueueMutationId(row.mutation_id),
    mutationKind: row.mutation_kind,
    occurredAt: asIsoTimestamp(row.occurred_at),
    resultingRevision: asRevision(row.resulting_revision),
  };
}

function asFotmStatus(value: string): "UNPUBLISHED" | "PUBLISHED" | "RESOLVED" {
  if (value !== "UNPUBLISHED" && value !== "PUBLISHED" && value !== "RESOLVED") {
    throw new Error("Queue cycle contains an unsupported FOTM status.");
  }
  return value;
}

function asQueueSlotState(value: string): QueueSlotState {
  if (!["OPEN", "LOCKED", "APPLIED", "NEEDS_ATTENTION"].includes(value)) {
    throw new Error("Queue cycle contains an unsupported state.");
  }
  return value as QueueSlotState;
}

function asRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Queue persistence returned an invalid non-negative revision.");
  }
  return value;
}

function requiredString(value: string | null, field: string): string {
  if (value === null) throw new Error(`Queue persistence returned a missing ${field}.`);
  return value;
}

function isAuditMutationKind(
  value: string,
): value is ProfileQueueMutationAuditRecord["mutationKind"] {
  return [
    "CREATE_CYCLE",
    "ADD_ADD_ON",
    "CHANGE_ADD_ON",
    "REMOVE_ADD_ON",
    "PUBLISH_FOTM",
    "RESOLVE_FOTM",
    "SET_MEMBER_FRAGRANCE",
    "CLEAR_MEMBER_FRAGRANCE",
    "LOCK_MEMBER_FRAGRANCE_CUTOFF",
  ].includes(value);
}

function asMemberChoiceSource(value: string): ProfileQueueCycle["memberChoice"]["source"] {
  if (value === "UNSELECTED" || value === "MEMBER_SELECTED" || value === "FOTM_FALLBACK") {
    return value;
  }
  throw new Error("Queue cycle contains an unsupported member fragrance choice source.");
}

function assertCutoffScanLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error("Cutoff scans must use a bounded limit between one and fifty.");
  }
}

function assertProvisioningScanLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error("Staging Admin provisioning scans must use a bounded limit between one and ten.");
  }
}

async function readCyclesWithAddOns(
  database: D1DatabasePort,
  rows: readonly CycleRow[],
): Promise<readonly ProfileQueueCycle[]> {
  const cycles: ProfileQueueCycle[] = [];
  for (const row of rows) {
    const addOnResult = await database
      .prepare(SELECT_ADD_ONS)
      .bind(row.binding_id, row.cycle_key)
      .all<AddOnRow>();
    const cycle = mapCycleRow(row, addOnResult.results ?? []);
    assertProfileQueueCycleInvariant(cycle);
    cycles.push(cloneCycle(cycle));
  }
  return cycles;
}
