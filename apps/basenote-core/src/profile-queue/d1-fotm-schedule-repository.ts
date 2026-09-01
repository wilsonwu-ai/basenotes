import { asProductVariantId } from "../domain/ids.js";
import { asIsoTimestamp, asShipMonth } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement } from "../staging-runtime/d1.js";
import {
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
} from "./contracts.js";
import {
  assertProfileQueueFotmScheduleInvariant,
  type PersistProfileQueueFotmScheduleInput,
  type ProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleRepository,
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

const SELECT_SCHEDULE = `
  SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision, updated_at
  FROM profile_queue_fotm_schedules
  WHERE ship_month = ?`;

const SELECT_SCHEDULES = `
  SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision, updated_at
  FROM profile_queue_fotm_schedules
  ORDER BY ship_month ASC`;

/**
 * D1-only schedule repository. It has no staff authentication, HTTP route,
 * Shopify/Appstle client, or production fallback; the boundary injecting it
 * must establish an authenticated opaque staff actor before calling persist.
 */
export class D1ProfileQueueFotmScheduleRepository implements ProfileQueueFotmScheduleRepository {
  constructor(private readonly database: D1DatabasePort) {}

  async findSchedule(shipMonth: string): Promise<ProfileQueueFotmSchedule | null> {
    const row = await this.database.prepare(SELECT_SCHEDULE).bind(asShipMonth(shipMonth)).first<ScheduleRow>();
    return row ? mapScheduleRow(row) : null;
  }

  async listSchedules(): Promise<readonly ProfileQueueFotmSchedule[]> {
    const result = await this.database.prepare(SELECT_SCHEDULES).all<ScheduleRow>();
    return (result.results ?? []).map(mapScheduleRow);
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
        revision, last_mutation_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.schedule.shipMonth,
        input.schedule.variantId,
        input.schedule.cutoffAt,
        input.schedule.merchantTimezone,
        input.schedule.status,
        input.schedule.revision,
        input.audit.mutationId,
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
        revision = ?, last_mutation_id = ?, updated_at = ?
      WHERE ship_month = ? AND revision = ?`)
      .bind(
        input.schedule.variantId,
        input.schedule.cutoffAt,
        input.schedule.merchantTimezone,
        input.schedule.status,
        input.schedule.revision,
        input.audit.mutationId,
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

function asScheduleStatus(value: string): ProfileQueueFotmSchedule["status"] {
  if (value === "DRAFT" || value === "PUBLISHED") return value;
  throw new Error("FOTM schedule contains an unsupported status.");
}

function asRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("FOTM schedule has an invalid revision.");
  return value;
}
