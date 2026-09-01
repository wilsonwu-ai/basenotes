import {
  asProfileQueueActorRef,
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  assertProfileQueueCycleInvariant,
  type ProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import { cloneCycle } from "./service.js";
import { asBindingId, asCycleKey, asIsoTimestamp } from "../queue/types.js";

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
  /** Lookup only; it is not an HTTP replay response snapshot. */
  findMutation(idempotencyKey: string): Promise<ProfileQueueMutationAuditRecord | null>;
  persist(input: PersistProfileQueueMutationInput): Promise<ProfileQueuePersistedMutation>;
}

export interface PersistProfileQueueMutationInput {
  readonly audit: ProfileQueueMutationAuditRecord;
  /** `null` means a first insert; a number means an optimistic update. */
  readonly expectedRevision: number | null;
  readonly cycle: ProfileQueueCycle;
}

export interface ProfileQueuePersistedMutation {
  readonly audit: ProfileQueueMutationAuditRecord;
  readonly cycle: ProfileQueueCycle;
}

/**
 * Local test double with the same immutable-audit and CAS behavior expected
 * from the D1 implementation. It does not write a file, database, or network.
 */
export class InMemoryProfileQueueRepository implements ProfileQueueRepository {
  private readonly cycles = new Map<string, ProfileQueueCycle>();
  private readonly mutations = new Map<string, ProfileQueuePersistedMutation>();

  async findCycle(bindingId: string, cycleKey: string): Promise<ProfileQueueCycle | null> {
    const key = cycleKeyFor(bindingId, cycleKey);
    const existing = this.cycles.get(key);
    return existing ? cloneCycle(existing) : null;
  }

  async findMutation(idempotencyKey: string): Promise<ProfileQueueMutationAuditRecord | null> {
    const existing = this.mutations.get(asProfileQueueIdempotencyKey(idempotencyKey));
    return existing ? { ...existing.audit } : null;
  }

  async persist(input: PersistProfileQueueMutationInput): Promise<ProfileQueuePersistedMutation> {
    validatePersistInput(input);
    const idempotencyKey = input.audit.idempotencyKey;
    const replay = this.mutations.get(idempotencyKey);
    if (replay) {
      if (!sameAuditEnvelope(replay.audit, input.audit)) {
        throw new ProfileQueueRepositoryIdempotencyConflictError(
          "A profile queue idempotency key cannot be reused for a different mutation.",
        );
      }
      return clonePersistedMutation(replay);
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
    };
    this.cycles.set(key, persisted.cycle);
    this.mutations.set(idempotencyKey, persisted);
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
  ) {
    throw new Error("The immutable queue audit must identify the exact persisted cycle and revision.");
  }
  if (input.audit.expectedRevision !== input.expectedRevision) {
    throw new Error("The immutable queue audit must record the compare-and-swap revision.");
  }
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

function clonePersistedMutation(value: ProfileQueuePersistedMutation): ProfileQueuePersistedMutation {
  return { audit: { ...value.audit }, cycle: cloneCycle(value.cycle) };
}
