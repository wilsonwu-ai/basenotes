import { asProductVariantId, type ProductVariantId } from "../domain/ids.js";
import {
  asIsoTimestamp,
  asShipMonth,
  compareIsoTimestamps,
  type IsoTimestamp,
  type ShipMonth,
} from "../queue/types.js";
import {
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  assertMemberFragranceCutoff,
  type ProfileQueueCycle,
} from "./contracts.js";
import { publishProfileQueueFotm } from "./service.js";

export type ProfileQueueFotmScheduleStatus = "DRAFT" | "PUBLISHED";
export type ProfileQueueFotmScheduleMutationId = string & { readonly __brand: "ProfileQueueFotmScheduleMutationId" };
export type ProfileQueueFotmScheduleAuditId = string & { readonly __brand: "ProfileQueueFotmScheduleAuditId" };
export type ProfileQueueFotmScheduleIdempotencyKey = string & { readonly __brand: "ProfileQueueFotmScheduleIdempotencyKey" };

export interface ProfileQueueFotmSchedule {
  readonly cutoffAt: IsoTimestamp;
  readonly merchantTimezone: typeof MEMBER_FRAGRANCE_CUTOFF_TIMEZONE;
  readonly revision: number;
  readonly shipMonth: ShipMonth;
  readonly status: ProfileQueueFotmScheduleStatus;
  readonly updatedAt: IsoTimestamp;
  readonly variantId: ProductVariantId;
}

export interface ProfileQueueFotmScheduleAuditRecord {
  readonly action: "SCHEDULED" | "PUBLISHED";
  readonly actorRef: string;
  readonly auditId: ProfileQueueFotmScheduleAuditId;
  readonly cutoffAt: IsoTimestamp;
  readonly expectedRevision: number | null;
  readonly idempotencyKey: ProfileQueueFotmScheduleIdempotencyKey;
  readonly merchantTimezone: typeof MEMBER_FRAGRANCE_CUTOFF_TIMEZONE;
  readonly mutationId: ProfileQueueFotmScheduleMutationId;
  readonly occurredAt: IsoTimestamp;
  readonly resultingRevision: number;
  readonly shipMonth: ShipMonth;
  readonly variantId: ProductVariantId;
}

export interface PersistProfileQueueFotmScheduleInput {
  readonly audit: ProfileQueueFotmScheduleAuditRecord;
  readonly expectedRevision: number | null;
  readonly schedule: ProfileQueueFotmSchedule;
}

export interface ProfileQueueFotmScheduleRepository {
  findAuditByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleAuditRecord | null>;
  findSchedule(shipMonth: string): Promise<ProfileQueueFotmSchedule | null>;
  listSchedules(): Promise<readonly ProfileQueueFotmSchedule[]>;
  persist(input: PersistProfileQueueFotmScheduleInput): Promise<ProfileQueueFotmSchedule>;
}

const MUTATION_ID = /^pfs_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const AUDIT_ID = /^pfa_[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const IDEMPOTENCY_KEY = /^pfk_[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/;
const ACTOR_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

export function asProfileQueueFotmScheduleMutationId(value: string): ProfileQueueFotmScheduleMutationId {
  if (!MUTATION_ID.test(value)) throw new Error("FOTM schedule mutation ID must be opaque and begin with pfs_.");
  return value as ProfileQueueFotmScheduleMutationId;
}

export function asProfileQueueFotmScheduleAuditId(value: string): ProfileQueueFotmScheduleAuditId {
  if (!AUDIT_ID.test(value)) throw new Error("FOTM schedule audit ID must be opaque and begin with pfa_.");
  return value as ProfileQueueFotmScheduleAuditId;
}

export function asProfileQueueFotmScheduleIdempotencyKey(value: string): ProfileQueueFotmScheduleIdempotencyKey {
  if (!IDEMPOTENCY_KEY.test(value)) throw new Error("FOTM schedule idempotency key must be opaque and begin with pfk_.");
  return value as ProfileQueueFotmScheduleIdempotencyKey;
}

export function createDraftProfileQueueFotmSchedule(input: {
  readonly cutoffAt: string;
  readonly merchantTimezone: string;
  readonly occurredAt: string;
  readonly shipMonth: string;
  readonly variantId: string;
}): ProfileQueueFotmSchedule {
  const occurredAt = asIsoTimestamp(input.occurredAt);
  const cutoffAt = assertMemberFragranceCutoff(input.cutoffAt, input.merchantTimezone);
  if (compareIsoTimestamps(occurredAt, cutoffAt) >= 0) {
    throw new Error("A future FOTM schedule must be configured before its cutoff.");
  }
  return {
    cutoffAt,
    merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
    revision: 0,
    shipMonth: asShipMonth(input.shipMonth),
    status: "DRAFT",
    updatedAt: occurredAt,
    variantId: asProductVariantId(input.variantId),
  };
}

/** Staff may revise a future draft month; published schedules are immutable. */
export function reviseDraftProfileQueueFotmSchedule(
  current: ProfileQueueFotmSchedule,
  input: {
    readonly cutoffAt: string;
    readonly merchantTimezone: string;
    readonly occurredAt: string;
    readonly variantId: string;
  },
): ProfileQueueFotmSchedule {
  assertProfileQueueFotmScheduleInvariant(current);
  if (current.status !== "DRAFT") throw new Error("Only a draft FOTM schedule may be revised.");
  const occurredAt = asIsoTimestamp(input.occurredAt);
  const cutoffAt = assertMemberFragranceCutoff(input.cutoffAt, input.merchantTimezone);
  if (compareIsoTimestamps(occurredAt, cutoffAt) >= 0) {
    throw new Error("A future FOTM schedule must remain before its cutoff.");
  }
  return {
    ...current,
    cutoffAt,
    merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
    revision: incrementRevision(current.revision),
    updatedAt: occurredAt,
    variantId: asProductVariantId(input.variantId),
  };
}

export function publishProfileQueueFotmSchedule(
  current: ProfileQueueFotmSchedule,
  occurredAt: string,
): ProfileQueueFotmSchedule {
  assertProfileQueueFotmScheduleInvariant(current);
  if (current.status !== "DRAFT") throw new Error("Only a draft FOTM schedule may be published.");
  const now = asIsoTimestamp(occurredAt);
  if (compareIsoTimestamps(now, current.cutoffAt) >= 0) {
    throw new Error("An FOTM schedule cannot be published at or after its cutoff.");
  }
  return {
    ...current,
    revision: incrementRevision(current.revision),
    status: "PUBLISHED",
    updatedAt: now,
  };
}

/**
 * Applies one exact published month schedule when a future queue cycle is
 * provisioned. The FOTM remains a fallback only; member selection is not
 * altered here and no provider is called.
 */
export function applyPublishedFotmScheduleToProfileQueueCycle(
  cycle: ProfileQueueCycle,
  schedule: ProfileQueueFotmSchedule,
  occurredAt: string,
): ProfileQueueCycle {
  assertProfileQueueFotmScheduleInvariant(schedule);
  if (schedule.status !== "PUBLISHED" || schedule.shipMonth !== cycle.shipMonth) {
    throw new Error("Only the exact published ship-month FOTM schedule may configure a queue cycle.");
  }
  return publishProfileQueueFotm(cycle, {
    cutoffAt: schedule.cutoffAt,
    merchantTimezone: schedule.merchantTimezone,
    occurredAt,
    variantId: schedule.variantId,
  });
}

export function assertProfileQueueFotmScheduleInvariant(schedule: ProfileQueueFotmSchedule): void {
  asShipMonth(schedule.shipMonth);
  asProductVariantId(schedule.variantId);
  assertMemberFragranceCutoff(schedule.cutoffAt, schedule.merchantTimezone);
  asIsoTimestamp(schedule.updatedAt);
  if (!Number.isSafeInteger(schedule.revision) || schedule.revision < 0) {
    throw new Error("FOTM schedule revisions must be non-negative safe integers.");
  }
  if (schedule.status !== "DRAFT" && schedule.status !== "PUBLISHED") {
    throw new Error("FOTM schedule status is unsupported.");
  }
}

export function validateProfileQueueFotmSchedulePersistInput(input: PersistProfileQueueFotmScheduleInput): void {
  assertProfileQueueFotmScheduleInvariant(input.schedule);
  asProfileQueueFotmScheduleAuditId(input.audit.auditId);
  asProfileQueueFotmScheduleMutationId(input.audit.mutationId);
  asProfileQueueFotmScheduleIdempotencyKey(input.audit.idempotencyKey);
  if (!ACTOR_REF.test(input.audit.actorRef)) {
    throw new Error("FOTM schedule actor must be an opaque non-email reference.");
  }
  if (
    input.audit.shipMonth !== input.schedule.shipMonth
    || input.audit.variantId !== input.schedule.variantId
    || input.audit.cutoffAt !== input.schedule.cutoffAt
    || input.audit.merchantTimezone !== input.schedule.merchantTimezone
    || input.audit.resultingRevision !== input.schedule.revision
    || input.audit.occurredAt !== input.schedule.updatedAt
  ) {
    throw new Error("FOTM schedule audit must capture the exact resulting schedule revision.");
  }
  if (input.audit.expectedRevision !== input.expectedRevision) {
    throw new Error("FOTM schedule audit must capture the compare-and-swap revision.");
  }
  if (input.expectedRevision === null) {
    if (input.schedule.revision !== 0 || input.audit.action !== "SCHEDULED") {
      throw new Error("A first FOTM schedule write must create draft revision zero.");
    }
    return;
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("FOTM schedule compare-and-swap revisions must be non-negative safe integers.");
  }
  if (input.schedule.revision !== input.expectedRevision + 1) {
    throw new Error("FOTM schedule updates must advance one revision.");
  }
  if (input.audit.action === "PUBLISHED" && input.schedule.status !== "PUBLISHED") {
    throw new Error("A published FOTM audit must result in a published schedule.");
  }
  if (input.audit.action === "SCHEDULED" && input.schedule.status !== "DRAFT") {
    throw new Error("A scheduled FOTM audit must result in a draft schedule.");
  }
}

/** In-memory test double; it cannot connect to D1 or a provider. */
export class InMemoryProfileQueueFotmScheduleRepository implements ProfileQueueFotmScheduleRepository {
  private readonly schedules = new Map<string, ProfileQueueFotmSchedule>();
  private readonly idempotency = new Map<string, ProfileQueueFotmScheduleAuditRecord>();
  private readonly auditIds = new Set<string>();

  async findAuditByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleAuditRecord | null> {
    const audit = this.idempotency.get(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey));
    return audit ? { ...audit } : null;
  }

  async findSchedule(shipMonth: string): Promise<ProfileQueueFotmSchedule | null> {
    const value = this.schedules.get(asShipMonth(shipMonth));
    return value ? { ...value } : null;
  }

  async listSchedules(): Promise<readonly ProfileQueueFotmSchedule[]> {
    return [...this.schedules.values()]
      .sort((left, right) => left.shipMonth.localeCompare(right.shipMonth))
      .map((schedule) => ({ ...schedule }));
  }

  async persist(input: PersistProfileQueueFotmScheduleInput): Promise<ProfileQueueFotmSchedule> {
    validateProfileQueueFotmSchedulePersistInput(input);
    const replay = this.idempotency.get(input.audit.idempotencyKey);
    if (replay) {
      if (!sameAudit(replay, input.audit)) {
        throw new Error("An FOTM schedule idempotency key cannot be reused for a different write.");
      }
      return scheduleFromAudit(replay);
    }
    if (this.auditIds.has(input.audit.auditId)) throw new Error("An FOTM schedule audit ID cannot be reused.");
    const existing = this.schedules.get(input.schedule.shipMonth);
    if (
      (input.expectedRevision === null && existing)
      || (input.expectedRevision !== null && (!existing || existing.revision !== input.expectedRevision))
    ) {
      throw new Error("The FOTM schedule changed; reload before saving.");
    }
    const persisted = { ...input.schedule };
    this.schedules.set(persisted.shipMonth, persisted);
    this.idempotency.set(input.audit.idempotencyKey, { ...input.audit });
    this.auditIds.add(input.audit.auditId);
    return { ...persisted };
  }
}

function sameAudit(left: ProfileQueueFotmScheduleAuditRecord, right: ProfileQueueFotmScheduleAuditRecord): boolean {
  return (
    left.action === right.action
    && left.actorRef === right.actorRef
    && left.auditId === right.auditId
    && left.cutoffAt === right.cutoffAt
    && left.expectedRevision === right.expectedRevision
    && left.idempotencyKey === right.idempotencyKey
    && left.merchantTimezone === right.merchantTimezone
    && left.mutationId === right.mutationId
    && left.occurredAt === right.occurredAt
    && left.resultingRevision === right.resultingRevision
    && left.shipMonth === right.shipMonth
    && left.variantId === right.variantId
  );
}

export function scheduleFromAudit(audit: ProfileQueueFotmScheduleAuditRecord): ProfileQueueFotmSchedule {
  return {
    cutoffAt: audit.cutoffAt,
    merchantTimezone: audit.merchantTimezone,
    revision: audit.resultingRevision,
    shipMonth: audit.shipMonth,
    status: audit.action === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    updatedAt: audit.occurredAt,
    variantId: audit.variantId,
  };
}

function incrementRevision(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error("FOTM schedule revision overflow.");
  return value + 1;
}
