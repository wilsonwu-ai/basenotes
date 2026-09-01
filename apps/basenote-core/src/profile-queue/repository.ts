import {
  asProfileQueueActorRef,
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  asProfileQueueSelectionEvidenceId,
  assertProfileQueueCycleInvariant,
  MEMBER_FRAGRANCE_CUTOFF_TIMEZONE,
  type ProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
  type ProfileQueueSelectionEvidenceRecord,
} from "./contracts.js";
import { cloneCycle } from "./service.js";
import { asBindingId, asCycleKey, asIsoTimestamp, asShipMonth, compareIsoTimestamps } from "../queue/types.js";
import { asProductVariantId } from "../domain/ids.js";

export class ProfileQueueRepositoryConflictError extends Error {
  override name = "ProfileQueueRepositoryConflictError";
}

export class ProfileQueueRepositoryIdempotencyConflictError extends Error {
  override name = "ProfileQueueRepositoryIdempotencyConflictError";
}

/**
 * Compare-and-swap persistence boundary for the profile queue aggregate.
 * Implementations must atomically persist the cycle, its ordered add-ons, and
 * its append-only audit record. Browser code must never implement this port.
 */
export interface ProfileQueueRepository {
  findCycle(bindingId: string, cycleKey: string): Promise<ProfileQueueCycle | null>;
  /** Bounded, deterministic scan used only by the staging cutoff scheduler. */
  findDueForCutoff(input: FindProfileQueueCyclesDueForCutoffInput): Promise<readonly ProfileQueueCycle[]>;
  /** Bounded exact-month scan used only by the staging Admin FOTM provisioner. */
  findUnpublishedForProvisioning(input: FindProfileQueueCyclesForProvisioningInput): Promise<readonly ProfileQueueCycle[]>;
  /** Lookup only; it is not an HTTP replay response snapshot. */
  findMutation(idempotencyKey: string): Promise<ProfileQueueMutationAuditRecord | null>;
  persist(input: PersistProfileQueueMutationInput): Promise<ProfileQueuePersistedMutation>;
}

export interface PersistProfileQueueMutationInput {
  readonly audit: ProfileQueueMutationAuditRecord;
  /** `null` means a first insert; a number means an optimistic update. */
  readonly expectedRevision: number | null;
  readonly cycle: ProfileQueueCycle;
  /** Immutable, non-PII snapshot of the resulting selection set. */
  readonly selectionEvidence: ProfileQueueSelectionEvidenceRecord;
}

export interface ProfileQueuePersistedMutation {
  readonly audit: ProfileQueueMutationAuditRecord;
  readonly cycle: ProfileQueueCycle;
  readonly selectionEvidence: ProfileQueueSelectionEvidenceRecord;
}

export interface FindProfileQueueCyclesDueForCutoffInput {
  readonly asOf: string;
  readonly limit: number;
}

export interface FindProfileQueueCyclesForProvisioningInput {
  readonly limit: number;
  readonly shipMonth: string;
}

/**
 * Local test double with the same immutable-audit and CAS behavior expected
 * from the D1 implementation. It does not write a file, database, or network.
 */
export class InMemoryProfileQueueRepository implements ProfileQueueRepository {
  private readonly cycles = new Map<string, ProfileQueueCycle>();
  private readonly mutations = new Map<string, ProfileQueuePersistedMutation>();
  private readonly evidenceIds = new Set<string>();

  async findCycle(bindingId: string, cycleKey: string): Promise<ProfileQueueCycle | null> {
    const key = cycleKeyFor(bindingId, cycleKey);
    const existing = this.cycles.get(key);
    return existing ? cloneCycle(existing) : null;
  }

  async findMutation(idempotencyKey: string): Promise<ProfileQueueMutationAuditRecord | null> {
    const existing = this.mutations.get(asProfileQueueIdempotencyKey(idempotencyKey));
    return existing ? { ...existing.audit } : null;
  }

  async findDueForCutoff(input: FindProfileQueueCyclesDueForCutoffInput): Promise<readonly ProfileQueueCycle[]> {
    const asOf = asIsoTimestamp(input.asOf);
    assertCutoffScanLimit(input.limit);
    return [...this.cycles.values()]
      .filter((cycle) => (
        cycle.state === "OPEN"
        && cycle.fotm.status === "PUBLISHED"
        && cycle.fotm.cutoffAt !== null
        && cycle.fotm.merchantTimezone === MEMBER_FRAGRANCE_CUTOFF_TIMEZONE
        && compareIsoTimestamps(cycle.fotm.cutoffAt, asOf) <= 0
      ))
      .sort((left, right) => {
        const cutoffComparison = compareIsoTimestamps(
          left.fotm.cutoffAt ?? asOf,
          right.fotm.cutoffAt ?? asOf,
        );
        if (cutoffComparison !== 0) return cutoffComparison;
        return `${left.bindingId}\u0000${left.cycleKey}`.localeCompare(`${right.bindingId}\u0000${right.cycleKey}`);
      })
      .slice(0, input.limit)
      .map(cloneCycle);
  }

  async findUnpublishedForProvisioning(
    input: FindProfileQueueCyclesForProvisioningInput,
  ): Promise<readonly ProfileQueueCycle[]> {
    const shipMonth = asShipMonth(input.shipMonth);
    assertProvisioningScanLimit(input.limit);
    return [...this.cycles.values()]
      .filter((cycle) => (
        cycle.shipMonth === shipMonth
        && cycle.state === "OPEN"
        && cycle.fotm.status === "UNPUBLISHED"
      ))
      .sort((left, right) => `${left.bindingId}\u0000${left.cycleKey}`.localeCompare(`${right.bindingId}\u0000${right.cycleKey}`))
      .slice(0, input.limit)
      .map(cloneCycle);
  }

  async persist(input: PersistProfileQueueMutationInput): Promise<ProfileQueuePersistedMutation> {
    validatePersistInput(input);
    const idempotencyKey = input.audit.idempotencyKey;
    const replay = this.mutations.get(idempotencyKey);
    if (replay) {
      if (!sameAuditEnvelope(replay.audit, input.audit) || !sameSelectionEvidence(replay.selectionEvidence, input.selectionEvidence)) {
        throw new ProfileQueueRepositoryIdempotencyConflictError(
          "A profile queue idempotency key cannot be reused for a different mutation.",
        );
      }
      return clonePersistedMutation(replay);
    }

    if (this.evidenceIds.has(input.selectionEvidence.evidenceId)) {
      throw new ProfileQueueRepositoryConflictError("A profile queue selection evidence ID cannot be reused.");
    }

    const key = cycleKeyFor(input.cycle.bindingId, input.cycle.cycleKey);
    const existing = this.cycles.get(key);
    if (input.expectedRevision === null) {
      if (existing) {
        throw new ProfileQueueRepositoryConflictError("The profile queue cycle already exists.");
      }
      if (input.cycle.revision !== 0) {
        throw new ProfileQueueRepositoryConflictError("A new profile queue cycle must begin at revision zero.");
      }
    } else {
      if (!existing || existing.revision !== input.expectedRevision) {
        throw new ProfileQueueRepositoryConflictError("The profile queue changed; reload before saving.");
      }
      if (input.cycle.revision !== input.expectedRevision + 1) {
        throw new ProfileQueueRepositoryConflictError("A profile queue update must increment revision exactly once.");
      }
    }

    const persisted: ProfileQueuePersistedMutation = {
      audit: { ...input.audit },
      cycle: cloneCycle(input.cycle),
      selectionEvidence: cloneSelectionEvidence(input.selectionEvidence),
    };
    this.cycles.set(key, persisted.cycle);
    this.mutations.set(idempotencyKey, persisted);
    this.evidenceIds.add(persisted.selectionEvidence.evidenceId);
    return clonePersistedMutation(persisted);
  }
}

export function validatePersistInput(input: PersistProfileQueueMutationInput): void {
  assertProfileQueueCycleInvariant(input.cycle);
  asProfileQueueActorRef(input.audit.actorRef);
  asProfileQueueMutationId(input.audit.mutationId);
  asProfileQueueIdempotencyKey(input.audit.idempotencyKey);
  asIsoTimestamp(input.audit.occurredAt);
  if (input.audit.expectedRevision !== null) {
    if (!Number.isSafeInteger(input.audit.expectedRevision) || input.audit.expectedRevision < 0) {
      throw new Error("The queue audit expected revision must be null or a non-negative safe integer.");
    }
  }
  if (
    input.audit.bindingId !== input.cycle.bindingId
    || input.audit.cycleKey !== input.cycle.cycleKey
    || input.audit.resultingRevision !== input.cycle.revision
    || input.audit.occurredAt !== input.cycle.updatedAt
  ) {
    throw new Error("The immutable queue audit must identify the exact persisted cycle, revision, and timestamp.");
  }
  if (input.audit.expectedRevision !== input.expectedRevision) {
    throw new Error("The immutable queue audit must record the compare-and-swap revision.");
  }
  assertSelectionEvidence(input.selectionEvidence, input.audit, input.cycle);
}

function cycleKeyFor(bindingId: string, cycleKey: string): string {
  return `${asBindingId(bindingId)}\u0000${asCycleKey(cycleKey)}`;
}

function sameAuditEnvelope(
  left: ProfileQueueMutationAuditRecord,
  right: ProfileQueueMutationAuditRecord,
): boolean {
  return left.mutationId === right.mutationId
    && left.bindingId === right.bindingId
    && left.cycleKey === right.cycleKey
    && left.expectedRevision === right.expectedRevision
    && left.mutationKind === right.mutationKind
    && left.actorRef === right.actorRef;
}

function sameSelectionEvidence(
  left: ProfileQueueSelectionEvidenceRecord,
  right: ProfileQueueSelectionEvidenceRecord,
): boolean {
  return left.evidenceId === right.evidenceId
    && left.mutationId === right.mutationId
    && left.eventKind === right.eventKind
    && left.memberChoiceSource === right.memberChoiceSource
    && left.memberChoiceVariantId === right.memberChoiceVariantId
    && left.resultingRevision === right.resultingRevision
    && left.occurredAt === right.occurredAt
    && left.addOnSnapshot.length === right.addOnSnapshot.length
    && left.addOnSnapshot.every((entry, index) => (
      entry.position === right.addOnSnapshot[index]?.position
      && entry.variantId === right.addOnSnapshot[index]?.variantId
    ));
}

function assertSelectionEvidence(
  evidence: ProfileQueueSelectionEvidenceRecord,
  audit: ProfileQueueMutationAuditRecord,
  cycle: ProfileQueueCycle,
): void {
  asProfileQueueSelectionEvidenceId(evidence.evidenceId);
  asProfileQueueMutationId(evidence.mutationId);
  asBindingId(evidence.bindingId);
  asCycleKey(evidence.cycleKey);
  asIsoTimestamp(evidence.occurredAt);
  if (!Number.isSafeInteger(evidence.resultingRevision) || evidence.resultingRevision < 0) {
    throw new Error("Selection evidence must record a non-negative resulting revision.");
  }
  if (
    evidence.mutationId !== audit.mutationId
    || evidence.bindingId !== cycle.bindingId
    || evidence.cycleKey !== cycle.cycleKey
    || evidence.resultingRevision !== cycle.revision
    || evidence.occurredAt !== cycle.updatedAt
  ) {
    throw new Error("Selection evidence must identify the exact persisted cycle mutation and revision.");
  }
  if (evidence.eventKind !== selectionEvidenceKindFor(audit.mutationKind)) {
    throw new Error("Selection evidence must use the immutable event kind for its queue mutation.");
  }
  if (
    evidence.memberChoiceSource !== cycle.memberChoice.source
    || evidence.memberChoiceVariantId !== cycle.memberChoice.variantId
  ) {
    throw new Error("Selection evidence must preserve the resulting included fragrance choice.");
  }
  if (evidence.memberChoiceVariantId !== null) asProductVariantId(evidence.memberChoiceVariantId);
  if (evidence.addOnSnapshot.length !== cycle.addOns.length) {
    throw new Error("Selection evidence must include every resulting $18 add-on.");
  }
  for (const [index, entry] of evidence.addOnSnapshot.entries()) {
    const addOn = cycle.addOns[index];
    if (!addOn || entry.position !== addOn.position || entry.variantId !== addOn.variantId) {
      throw new Error("Selection evidence must preserve the ordered resulting add-on variants.");
    }
    asProductVariantId(entry.variantId);
  }
}

function selectionEvidenceKindFor(
  mutationKind: ProfileQueueMutationAuditRecord["mutationKind"],
): ProfileQueueSelectionEvidenceRecord["eventKind"] {
  switch (mutationKind) {
    case "CREATE_CYCLE": return "CYCLE_CREATED";
    case "SET_MEMBER_FRAGRANCE": return "MEMBER_CHOICE_SET";
    case "CLEAR_MEMBER_FRAGRANCE": return "MEMBER_CHOICE_CLEARED";
    case "ADD_ADD_ON":
    case "CHANGE_ADD_ON":
    case "REMOVE_ADD_ON": return "ADD_ONS_CHANGED";
    case "PUBLISH_FOTM": return "FOTM_PUBLISHED";
    case "RESOLVE_FOTM":
    case "LOCK_MEMBER_FRAGRANCE_CUTOFF": return "CUTOFF_LOCKED";
  }
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

function clonePersistedMutation(value: ProfileQueuePersistedMutation): ProfileQueuePersistedMutation {
  return {
    audit: { ...value.audit },
    cycle: cloneCycle(value.cycle),
    selectionEvidence: cloneSelectionEvidence(value.selectionEvidence),
  };
}

function cloneSelectionEvidence(value: ProfileQueueSelectionEvidenceRecord): ProfileQueueSelectionEvidenceRecord {
  return { ...value, addOnSnapshot: value.addOnSnapshot.map((entry) => ({ ...entry })) };
}
