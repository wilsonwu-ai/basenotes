import {
  asProfileQueueActorRef,
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  asProfileQueueSelectionEvidenceId,
  type ProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
  type ProfileQueueSelectionEvidenceRecord,
} from "../profile-queue/contracts.js";
import {
  ProfileQueueRepositoryConflictError,
  type ProfileQueueRepository,
} from "../profile-queue/repository.js";
import {
  ProfileQueueCutoffError,
  ProfileQueueLockedError,
  resolveProfileQueueAtCutoff,
} from "../profile-queue/service.js";
import { asIsoTimestamp } from "../queue/types.js";

/**
 * One scheduler tick performs one due-cycle query, at most ten add-on reads,
 * and at most ten D1-only CAS writes. This stays deliberately beneath common
 * Worker subrequest ceilings even if every due cycle has paid add-ons.
 */
export const STAGING_CUTOFF_LOCK_BATCH_SIZE = 10;
const CUTOFF_SCHEDULER_ACTOR_REF = asProfileQueueActorRef("system_cutoff_scheduler");

export interface RunStagingCutoffLockInput {
  readonly asOf: string;
  readonly createOpaqueId: (prefix: "pqm" | "pqk" | "pqe") => string;
  readonly repository: ProfileQueueRepository;
}

export interface StagingCutoffLockResult {
  readonly conflicted: number;
  readonly locked: number;
  readonly scanned: number;
}

/**
 * Locks due staging cycles in D1 only. It has no Shopify/Appstle adapter,
 * customer lookup, HTTP fetch, email, or production fallback. The repository
 * CAS means a retry after a crash simply sees the cycle already locked.
 */
export async function runStagingCutoffLock(input: RunStagingCutoffLockInput): Promise<StagingCutoffLockResult> {
  const asOf = asIsoTimestamp(input.asOf);
  const due = await input.repository.findDueForCutoff({
    asOf,
    limit: STAGING_CUTOFF_LOCK_BATCH_SIZE,
  });
  let locked = 0;
  let conflicted = 0;
  for (const current of due) {
    const updated = resolveProfileQueueAtCutoff(current, asOf);
    const audit: ProfileQueueMutationAuditRecord = {
      actorRef: CUTOFF_SCHEDULER_ACTOR_REF,
      bindingId: updated.bindingId,
      cycleKey: updated.cycleKey,
      expectedRevision: current.revision,
      idempotencyKey: asProfileQueueIdempotencyKey(input.createOpaqueId("pqk")),
      mutationId: asProfileQueueMutationId(input.createOpaqueId("pqm")),
      mutationKind: "LOCK_MEMBER_FRAGRANCE_CUTOFF",
      occurredAt: updated.updatedAt,
      resultingRevision: updated.revision,
    };
    try {
      await input.repository.persist({
        audit,
        cycle: updated,
        expectedRevision: current.revision,
        selectionEvidence: createProfileQueueSelectionEvidence({
          audit,
          cycle: updated,
          evidenceId: input.createOpaqueId("pqe"),
        }),
      });
      locked += 1;
    } catch (error) {
      // A concurrent customer form or second cron tick wins safely through
      // CAS. Other failures remain visible to the platform retry mechanism.
      if (
        error instanceof ProfileQueueRepositoryConflictError
        || error instanceof ProfileQueueLockedError
        || error instanceof ProfileQueueCutoffError
      ) {
        conflicted += 1;
        continue;
      }
      throw error;
    }
  }
  return { conflicted, locked, scanned: due.length };
}

/** Builds the immutable selection snapshot paired atomically with a mutation. */
export function createProfileQueueSelectionEvidence(input: {
  readonly audit: ProfileQueueMutationAuditRecord;
  readonly cycle: ProfileQueueCycle;
  readonly evidenceId: string;
}): ProfileQueueSelectionEvidenceRecord {
  return {
    addOnSnapshot: input.cycle.addOns.map((addOn) => ({
      position: addOn.position,
      variantId: addOn.variantId,
    })),
    bindingId: input.cycle.bindingId,
    cycleKey: input.cycle.cycleKey,
    eventKind: selectionEvidenceKindFor(input.audit.mutationKind),
    evidenceId: asProfileQueueSelectionEvidenceId(input.evidenceId),
    memberChoiceSource: input.cycle.memberChoice.source,
    memberChoiceVariantId: input.cycle.memberChoice.variantId,
    mutationId: input.audit.mutationId,
    occurredAt: input.cycle.updatedAt,
    resultingRevision: input.cycle.revision,
  };
}

export function selectionEvidenceKindFor(
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
