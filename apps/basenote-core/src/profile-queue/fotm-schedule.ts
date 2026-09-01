import { asProductVariantId, type ProductVariantId } from "../domain/ids.js";
import {
  asBindingId,
  asCycleKey,
  asIsoTimestamp,
  asShipMonth,
  compareIsoTimestamps,
  type BindingId,
  type CycleKey,
  type IsoTimestamp,
  type ShipMonth,
} from "../queue/types.js";
import {
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  assertMemberFragranceCutoff,
  type ProfileQueueCycle,
} from "./contracts.js";
import { publishProfileQueueFotm } from "./service.js";

export type ProfileQueueFotmScheduleStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type ProfileQueueFotmScheduleAuditAction = "SCHEDULED" | "PUBLISHED" | "RETIRED" | "RECOVERED";
export type ProfileQueueFotmProvisionCommandStatus = "PENDING" | "COMPLETED" | "NEEDS_ATTENTION";
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
  readonly action: ProfileQueueFotmScheduleAuditAction;
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

/** One exact opaque queue-cycle target captured before a bounded provision fan-out. */
export interface ProfileQueueFotmProvisionPlanEntry {
  readonly bindingId: BindingId;
  readonly cycleKey: CycleKey;
  readonly expectedRevision: number;
}

export interface ProfileQueueFotmProvisioningResult {
  readonly configured: number;
  readonly conflicted: number;
  readonly mayHaveMore: boolean;
  readonly scanned: number;
}

/**
 * Durable staging-only command/result record. A PENDING record is deliberately
 * fail-closed: a retry must never start another five-cycle fan-out.
 */
export interface ProfileQueueFotmProvisionCommand {
  readonly actorRef: string;
  readonly attentionAt: IsoTimestamp | null;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly expectedScheduleRevision: number;
  readonly idempotencyKey: ProfileQueueFotmScheduleIdempotencyKey;
  readonly plan: readonly ProfileQueueFotmProvisionPlanEntry[];
  readonly result: ProfileQueueFotmProvisioningResult | null;
  readonly shipMonth: ShipMonth;
  readonly status: ProfileQueueFotmProvisionCommandStatus;
}

export interface ClaimProfileQueueFotmProvisionCommandInput {
  readonly actorRef: string;
  readonly createdAt: string;
  readonly expectedScheduleRevision: number;
  readonly idempotencyKey: string;
  readonly plan: readonly ProfileQueueFotmProvisionPlanEntry[];
  readonly shipMonth: string;
}

export interface CompleteProfileQueueFotmProvisionCommandInput {
  readonly completedAt: string;
  readonly idempotencyKey: string;
  readonly result: ProfileQueueFotmProvisioningResult;
}

/** Marks an aged unknown-outcome claim terminal without changing a queue cycle. */
export interface MarkProfileQueueFotmProvisionCommandNeedsAttentionInput {
  readonly actorRef: string;
  readonly attentionAt: string;
  readonly expectedScheduleRevision: number;
  readonly idempotencyKey: string;
  /** Server-derived latest permitted command creation instant. */
  readonly notBefore: string;
  readonly shipMonth: string;
}

/** Explicit no-mutation record for a blocked recovery/replacement attempt. */
export interface ProfileQueueFotmScheduleRecoveryException {
  readonly actorRef: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: ProfileQueueFotmScheduleIdempotencyKey;
  readonly occurredAt: IsoTimestamp;
  readonly reason: "PROVISIONED_CYCLES";
  readonly shipMonth: ShipMonth;
}

export interface RecordProfileQueueFotmScheduleRecoveryExceptionInput {
  readonly actorRef: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly shipMonth: string;
}

export interface PersistProfileQueueFotmScheduleInput {
  readonly audit: ProfileQueueFotmScheduleAuditRecord;
  readonly expectedRevision: number | null;
  readonly schedule: ProfileQueueFotmSchedule;
}

export interface ProfileQueueFotmScheduleRepository {
  findAuditByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleAuditRecord | null>;
  findProvisionCommandByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmProvisionCommand | null>;
  findRecoveryExceptionByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleRecoveryException | null>;
  findSchedule(shipMonth: string): Promise<ProfileQueueFotmSchedule | null>;
  /** One discoverable active claim per schedule/month; never subject to the recent-history limit. */
  listPendingProvisionCommands(): Promise<readonly ProfileQueueFotmProvisionCommand[]>;
  listProvisionCommands(limit: number): Promise<readonly ProfileQueueFotmProvisionCommand[]>;
  listSchedules(): Promise<readonly ProfileQueueFotmSchedule[]>;
  claimProvisionCommand(input: ClaimProfileQueueFotmProvisionCommandInput): Promise<ProfileQueueFotmProvisionCommand>;
  completeProvisionCommand(input: CompleteProfileQueueFotmProvisionCommandInput): Promise<ProfileQueueFotmProvisionCommand>;
  markProvisionCommandNeedsAttention(
    input: MarkProfileQueueFotmProvisionCommandNeedsAttentionInput,
  ): Promise<ProfileQueueFotmProvisionCommand>;
  persist(input: PersistProfileQueueFotmScheduleInput): Promise<ProfileQueueFotmSchedule>;
  recordRecoveryException(
    input: RecordProfileQueueFotmScheduleRecoveryExceptionInput,
  ): Promise<ProfileQueueFotmScheduleRecoveryException>;
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
 * Explicitly retires a future schedule without touching any queue cycle.
 * A previously provisioned or locked cycle remains exactly as it was; a
 * replacement requires a separate recovery draft, publish, and provision
 * command with fresh CAS/idempotency evidence.
 */
export function retireProfileQueueFotmSchedule(
  current: ProfileQueueFotmSchedule,
  occurredAt: string,
): ProfileQueueFotmSchedule {
  assertProfileQueueFotmScheduleInvariant(current);
  if (current.status !== "DRAFT" && current.status !== "PUBLISHED") {
    throw new Error("Only a draft or published FOTM schedule may be retired.");
  }
  const now = asIsoTimestamp(occurredAt);
  if (compareIsoTimestamps(now, current.cutoffAt) >= 0) {
    throw new Error("An FOTM schedule cannot be retired at or after its cutoff.");
  }
  return {
    ...current,
    revision: incrementRevision(current.revision),
    status: "RETIRED",
    updatedAt: now,
  };
}

/**
 * An explicit, auditable recovery from RETIRED to a new draft. It is guarded
 * by both the old and replacement cutoff, and it never rewrites a cycle that
 * was already provisioned or locked under the prior published schedule.
 */
export function recoverRetiredProfileQueueFotmSchedule(
  current: ProfileQueueFotmSchedule,
  input: {
    readonly cutoffAt: string;
    readonly merchantTimezone: string;
    readonly occurredAt: string;
    readonly variantId: string;
  },
): ProfileQueueFotmSchedule {
  assertProfileQueueFotmScheduleInvariant(current);
  if (current.status !== "RETIRED") {
    throw new Error("Only a retired FOTM schedule may be explicitly recovered to a draft.");
  }
  const occurredAt = asIsoTimestamp(input.occurredAt);
  const cutoffAt = assertMemberFragranceCutoff(input.cutoffAt, input.merchantTimezone);
  if (
    compareIsoTimestamps(occurredAt, current.cutoffAt) >= 0
    || compareIsoTimestamps(occurredAt, cutoffAt) >= 0
  ) {
    throw new Error("A retired FOTM schedule may be recovered only before both cutoffs.");
  }
  return {
    ...current,
    cutoffAt,
    merchantTimezone: MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
    revision: incrementRevision(current.revision),
    status: "DRAFT",
    updatedAt: occurredAt,
    variantId: asProductVariantId(input.variantId),
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
  if (schedule.status !== "DRAFT" && schedule.status !== "PUBLISHED" && schedule.status !== "RETIRED") {
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
  if (input.schedule.status !== scheduleStatusForAuditAction(input.audit.action)) {
    throw new Error("FOTM schedule audit action must match the resulting schedule status.");
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
}

/** In-memory test double; it cannot connect to D1 or a provider. */
export class InMemoryProfileQueueFotmScheduleRepository implements ProfileQueueFotmScheduleRepository {
  private readonly schedules = new Map<string, ProfileQueueFotmSchedule>();
  private readonly idempotency = new Map<string, ProfileQueueFotmScheduleAuditRecord>();
  private readonly auditIds = new Set<string>();
  private readonly provisionCommands = new Map<string, ProfileQueueFotmProvisionCommand>();
  private readonly recoveryExceptions = new Map<string, ProfileQueueFotmScheduleRecoveryException>();

  async findAuditByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmScheduleAuditRecord | null> {
    const audit = this.idempotency.get(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey));
    return audit ? { ...audit } : null;
  }

  async findProvisionCommandByIdempotency(idempotencyKey: string): Promise<ProfileQueueFotmProvisionCommand | null> {
    const command = this.provisionCommands.get(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey));
    return command ? cloneProvisionCommand(command) : null;
  }

  async findRecoveryExceptionByIdempotency(
    idempotencyKey: string,
  ): Promise<ProfileQueueFotmScheduleRecoveryException | null> {
    const exception = this.recoveryExceptions.get(asProfileQueueFotmScheduleIdempotencyKey(idempotencyKey));
    return exception ? { ...exception } : null;
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

  async listProvisionCommands(limit: number): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    assertProvisionCommandListLimit(limit);
    return [...this.provisionCommands.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(cloneProvisionCommand);
  }

  async listPendingProvisionCommands(): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    return [...this.provisionCommands.values()]
      .filter((command) => command.status === "PENDING")
      .sort((left, right) => left.shipMonth.localeCompare(right.shipMonth))
      .map(cloneProvisionCommand);
  }

  async claimProvisionCommand(input: ClaimProfileQueueFotmProvisionCommandInput): Promise<ProfileQueueFotmProvisionCommand> {
    const command = createPendingProfileQueueFotmProvisionCommand(input);
    if (
      this.provisionCommands.has(command.idempotencyKey)
      || this.idempotency.has(command.idempotencyKey)
      || this.recoveryExceptions.has(command.idempotencyKey)
    ) {
      throw new Error("An FOTM provision command idempotency key cannot be reused.");
    }
    if ([...this.provisionCommands.values()].some((existing) => (
      existing.shipMonth === command.shipMonth && existing.status === "PENDING"
    ))) {
      throw new Error("Only one pending FOTM provision command may exist for a ship month.");
    }
    const schedule = this.schedules.get(command.shipMonth);
    if (
      !schedule
      || schedule.status !== "PUBLISHED"
      || schedule.revision !== command.expectedScheduleRevision
    ) {
      throw new Error("The published FOTM schedule changed; reload before provisioning.");
    }
    this.provisionCommands.set(command.idempotencyKey, command);
    return cloneProvisionCommand(command);
  }

  async completeProvisionCommand(input: CompleteProfileQueueFotmProvisionCommandInput): Promise<ProfileQueueFotmProvisionCommand> {
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const existing = this.provisionCommands.get(idempotencyKey);
    if (!existing) throw new Error("The staging FOTM provision command was not found.");
    const completedAt = asIsoTimestamp(input.completedAt);
    const result = validateProfileQueueFotmProvisioningResult(input.result, existing.plan.length);
    if (existing.status === "COMPLETED") {
      if (!sameProvisioningResult(existing.result, result)) {
        throw new Error("The staging FOTM provision command already has a different result.");
      }
      return cloneProvisionCommand(existing);
    }
    if (existing.status !== "PENDING") {
      throw new Error("A terminal staging FOTM provision command cannot be completed.");
    }
    const completed: ProfileQueueFotmProvisionCommand = {
      ...existing,
      completedAt,
      result,
      status: "COMPLETED",
    };
    this.provisionCommands.set(idempotencyKey, completed);
    return cloneProvisionCommand(completed);
  }

  async markProvisionCommandNeedsAttention(
    input: MarkProfileQueueFotmProvisionCommandNeedsAttentionInput,
  ): Promise<ProfileQueueFotmProvisionCommand> {
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const existing = this.provisionCommands.get(idempotencyKey);
    if (!existing) throw new Error("The staging FOTM provision command was not found.");
    if (existing.status === "NEEDS_ATTENTION") return cloneProvisionCommand(existing);
    if (existing.status !== "PENDING") {
      throw new Error("Only a pending staging FOTM provision command may be marked for attention.");
    }
    if (
      existing.actorRef !== input.actorRef
      || existing.shipMonth !== asShipMonth(input.shipMonth)
      || existing.expectedScheduleRevision !== input.expectedScheduleRevision
    ) {
      throw new Error("The staging FOTM provision command changed; reload before recording attention.");
    }
    const notBefore = asIsoTimestamp(input.notBefore);
    if (compareIsoTimestamps(existing.createdAt, notBefore) > 0) {
      throw new Error("The staging FOTM provision command is still within its recovery delay.");
    }
    const attentionAt = asIsoTimestamp(input.attentionAt);
    if (compareIsoTimestamps(attentionAt, existing.createdAt) < 0) {
      throw new Error("The staging FOTM provision attention timestamp precedes its claim.");
    }
    const marked: ProfileQueueFotmProvisionCommand = {
      ...existing,
      attentionAt,
      status: "NEEDS_ATTENTION",
    };
    this.provisionCommands.set(idempotencyKey, marked);
    return cloneProvisionCommand(marked);
  }

  async recordRecoveryException(
    input: RecordProfileQueueFotmScheduleRecoveryExceptionInput,
  ): Promise<ProfileQueueFotmScheduleRecoveryException> {
    const exception = createRecoveryException(input);
    if (
      this.recoveryExceptions.has(exception.idempotencyKey)
      || this.idempotency.has(exception.idempotencyKey)
      || this.provisionCommands.has(exception.idempotencyKey)
    ) {
      throw new Error("An FOTM schedule recovery exception idempotency key cannot be reused.");
    }
    const schedule = this.schedules.get(exception.shipMonth);
    if (
      !schedule
      || schedule.revision !== exception.expectedRevision
      || (schedule.status !== "PUBLISHED" && schedule.status !== "RETIRED")
    ) {
      throw new Error("The FOTM schedule changed; reload before recording recovery attention.");
    }
    this.recoveryExceptions.set(exception.idempotencyKey, exception);
    return { ...exception };
  }

  async persist(input: PersistProfileQueueFotmScheduleInput): Promise<ProfileQueueFotmSchedule> {
    validateProfileQueueFotmSchedulePersistInput(input);
    if (
      this.provisionCommands.has(input.audit.idempotencyKey)
      || this.recoveryExceptions.has(input.audit.idempotencyKey)
    ) {
      throw new Error("An FOTM schedule idempotency key cannot be reused for another command.");
    }
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
    if (
      input.audit.action === "RETIRED"
      && [...this.provisionCommands.values()].some((command) => (
        command.shipMonth === input.schedule.shipMonth && command.status === "PENDING"
      ))
    ) {
      throw new Error("A pending FOTM provision command prevents schedule retirement.");
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
    status: scheduleStatusForAuditAction(audit.action),
    updatedAt: audit.occurredAt,
    variantId: audit.variantId,
  };
}

function scheduleStatusForAuditAction(action: ProfileQueueFotmScheduleAuditAction): ProfileQueueFotmScheduleStatus {
  switch (action) {
    case "SCHEDULED":
    case "RECOVERED":
      return "DRAFT";
    case "PUBLISHED":
      return "PUBLISHED";
    case "RETIRED":
      return "RETIRED";
  }
}

export function createPendingProfileQueueFotmProvisionCommand(
  input: ClaimProfileQueueFotmProvisionCommandInput,
): ProfileQueueFotmProvisionCommand {
  const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
  const plan = validateProvisionPlan(input.plan);
  if (!ACTOR_REF.test(input.actorRef)) {
    throw new Error("FOTM provision actor must be an opaque non-email reference.");
  }
  if (!Number.isSafeInteger(input.expectedScheduleRevision) || input.expectedScheduleRevision < 0) {
    throw new Error("FOTM provision command requires a non-negative schedule revision.");
  }
  return {
    actorRef: input.actorRef,
    attentionAt: null,
    completedAt: null,
    createdAt: asIsoTimestamp(input.createdAt),
    expectedScheduleRevision: input.expectedScheduleRevision,
    idempotencyKey,
    plan,
    result: null,
    shipMonth: asShipMonth(input.shipMonth),
    status: "PENDING",
  };
}

export function createRecoveryException(
  input: RecordProfileQueueFotmScheduleRecoveryExceptionInput,
): ProfileQueueFotmScheduleRecoveryException {
  if (!ACTOR_REF.test(input.actorRef)) {
    throw new Error("FOTM schedule recovery actor must be an opaque non-email reference.");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("FOTM schedule recovery requires a non-negative schedule revision.");
  }
  return {
    actorRef: input.actorRef,
    expectedRevision: input.expectedRevision,
    idempotencyKey: asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey),
    occurredAt: asIsoTimestamp(input.occurredAt),
    reason: "PROVISIONED_CYCLES",
    shipMonth: asShipMonth(input.shipMonth),
  };
}

function validateProvisionPlan(
  plan: readonly ProfileQueueFotmProvisionPlanEntry[],
): readonly ProfileQueueFotmProvisionPlanEntry[] {
  if (!Array.isArray(plan) || plan.length > 5) {
    throw new Error("A staging FOTM provision command may target at most five exact cycles.");
  }
  const seen = new Set<string>();
  let prior: string | null = null;
  const normalized = plan.map((entry) => {
    const bindingId = asBindingId(entry.bindingId);
    const cycleKey = asCycleKey(entry.cycleKey);
    if (!Number.isSafeInteger(entry.expectedRevision) || entry.expectedRevision < 0) {
      throw new Error("A staging FOTM provision plan requires non-negative cycle revisions.");
    }
    const key = `${bindingId}\u0000${cycleKey}`;
    if (seen.has(key) || (prior !== null && prior.localeCompare(key) >= 0)) {
      throw new Error("A staging FOTM provision plan must contain unique deterministic cycle targets.");
    }
    seen.add(key);
    prior = key;
    return { bindingId, cycleKey, expectedRevision: entry.expectedRevision };
  });
  return normalized;
}

export function validateProfileQueueFotmProvisioningResult(
  result: ProfileQueueFotmProvisioningResult,
  plannedCount: number,
): ProfileQueueFotmProvisioningResult {
  if (
    !Number.isSafeInteger(result.configured)
    || !Number.isSafeInteger(result.conflicted)
    || !Number.isSafeInteger(result.scanned)
    || result.configured < 0
    || result.conflicted < 0
    || result.scanned < 0
    || result.scanned !== plannedCount
    || result.configured + result.conflicted !== result.scanned
    || typeof result.mayHaveMore !== "boolean"
    || result.mayHaveMore !== (plannedCount === 5)
  ) {
    throw new Error("A staging FOTM provision result must exactly reconcile its bounded plan.");
  }
  return { ...result };
}

function cloneProvisionCommand(command: ProfileQueueFotmProvisionCommand): ProfileQueueFotmProvisionCommand {
  return {
    ...command,
    plan: command.plan.map((entry) => ({ ...entry })),
    result: command.result ? { ...command.result } : null,
  };
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

function incrementRevision(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error("FOTM schedule revision overflow.");
  return value + 1;
}
