import {
  asProfileQueueActorRef,
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  assertMemberFragranceCutoff,
  type ProfileQueueMutationAuditRecord,
} from "../profile-queue/contracts.js";
import {
  asProfileQueueFotmScheduleAuditId,
  asProfileQueueFotmScheduleIdempotencyKey,
  asProfileQueueFotmScheduleMutationId,
  applyPublishedFotmScheduleToProfileQueueCycle,
  createDraftProfileQueueFotmSchedule,
  publishProfileQueueFotmSchedule,
  reviseDraftProfileQueueFotmSchedule,
  scheduleFromAudit,
  type ProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleAuditRecord,
  type ProfileQueueFotmScheduleRepository,
} from "../profile-queue/fotm-schedule.js";
import {
  ProfileQueueRepositoryConflictError,
  type ProfileQueueRepository,
} from "../profile-queue/repository.js";
import { asProductVariantId } from "../domain/ids.js";
import { asIsoTimestamp, asShipMonth } from "../queue/types.js";
import { createProfileQueueSelectionEvidence } from "./cutoff-locker.js";

/** One admin request provisions at most five exact staging cycles. */
export const STAGING_ADMIN_PROVISION_BATCH_SIZE = 5;

export class StagingFotmScheduleConflictError extends Error {
  override name = "StagingFotmScheduleConflictError";
}

export class StagingFotmProvisioningNotConfiguredError extends Error {
  override name = "StagingFotmProvisioningNotConfiguredError";
}

/**
 * A caller may construct this only after an approved server-side staff auth
 * layer verifies the person and maps it to an opaque staging actor reference.
 * It is never an App Proxy or storefront authorization context.
 */
export interface ServerVerifiedStagingStaffContext {
  readonly actorRef: string;
  readonly authorization: "SERVER_VERIFIED_STAGING_STAFF";
}

export interface StagingFotmScheduleCommandResult {
  readonly replayed: boolean;
  readonly schedule: ProfileQueueFotmSchedule;
}

export interface StagingFotmProvisioningResult {
  readonly configured: number;
  readonly conflicted: number;
  /** `true` means the caller may submit another bounded staging batch. */
  readonly mayHaveMore: boolean;
  readonly scanned: number;
}

export interface StagingFotmScheduleAdminBoundaryDependencies {
  readonly createOpaqueId: (prefix: "pfa" | "pfk" | "pfs" | "pqe" | "pqk" | "pqm") => string;
  /** Optional only because core unit tests may exercise schedules without cycles. */
  readonly cycleRepository?: ProfileQueueRepository;
  readonly now: () => Date;
  readonly repository: ProfileQueueFotmScheduleRepository;
}

/**
 * Server-facing staging boundary for future-month FOTM schedules. It writes
 * D1 only through injected repositories. It has no Shopify Admin API,
 * Appstle, email, customer, checkout, or provider-delivery behavior.
 */
export class StagingFotmScheduleAdminBoundary {
  constructor(private readonly dependencies: StagingFotmScheduleAdminBoundaryDependencies) {}

  async list(context: ServerVerifiedStagingStaffContext): Promise<readonly ProfileQueueFotmSchedule[]> {
    validateStaffContext(context);
    return this.dependencies.repository.listSchedules();
  }

  /** Legacy server-only helper; scheduler HTTP uses `submitDraft` with an explicit CAS/key. */
  async scheduleDraft(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly cutoffAt: string;
    readonly expectedRevision?: number | null;
    readonly idempotencyKey?: string;
    readonly merchantTimezone: string;
    readonly shipMonth: string;
    readonly variantId: string;
  }): Promise<ProfileQueueFotmSchedule> {
    const current = await this.dependencies.repository.findSchedule(input.shipMonth);
    const result = await this.submitDraft({
      ...input,
      expectedRevision: input.expectedRevision ?? current?.revision ?? null,
      idempotencyKey: input.idempotencyKey ?? asProfileQueueFotmScheduleIdempotencyKey(this.dependencies.createOpaqueId("pfk")),
    });
    return result.schedule;
  }

  async submitDraft(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly cutoffAt: string;
    readonly expectedRevision: number | null;
    readonly idempotencyKey: string;
    readonly merchantTimezone: string;
    readonly shipMonth: string;
    readonly variantId: string;
  }): Promise<StagingFotmScheduleCommandResult> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const cutoffAt = assertMemberFragranceCutoff(input.cutoffAt, input.merchantTimezone);
    const variantId = asProductVariantId(input.variantId);
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const replay = await this.dependencies.repository.findAuditByIdempotency(idempotencyKey);
    if (replay) {
      if (
        replay.action !== "SCHEDULED"
        || replay.actorRef !== actorRef
        || replay.shipMonth !== shipMonth
        || replay.variantId !== variantId
        || replay.cutoffAt !== cutoffAt
        || replay.merchantTimezone !== input.merchantTimezone
        || replay.expectedRevision !== input.expectedRevision
      ) {
        throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
      }
      return { replayed: true, schedule: scheduleFromAudit(replay) };
    }

    const current = await this.dependencies.repository.findSchedule(shipMonth);
    assertExpectedRevision(current, input.expectedRevision);
    const occurredAt = asIsoTimestamp(this.dependencies.now().toISOString());
    const schedule = current
      ? reviseDraftProfileQueueFotmSchedule(current, {
          cutoffAt,
          merchantTimezone: input.merchantTimezone,
          occurredAt,
          variantId,
        })
      : createDraftProfileQueueFotmSchedule({
          cutoffAt,
          merchantTimezone: input.merchantTimezone,
          occurredAt,
          shipMonth,
          variantId,
        });
    const audit = createAudit({
      action: "SCHEDULED",
      actorRef,
      createOpaqueId: this.dependencies.createOpaqueId,
      expectedRevision: input.expectedRevision,
      idempotencyKey,
      schedule,
    });
    return {
      replayed: false,
      schedule: await this.dependencies.repository.persist({
        audit,
        expectedRevision: input.expectedRevision,
        schedule,
      }),
    };
  }

  /** Legacy server-only helper; scheduler HTTP uses `submitPublish` with an explicit CAS/key. */
  async publish(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedRevision?: number;
    readonly idempotencyKey?: string;
    readonly shipMonth: string;
  }): Promise<ProfileQueueFotmSchedule> {
    const current = await this.dependencies.repository.findSchedule(input.shipMonth);
    if (!current) throw new StagingFotmScheduleConflictError("The requested future-month FOTM schedule was not found.");
    const result = await this.submitPublish({
      ...input,
      expectedRevision: input.expectedRevision ?? current.revision,
      idempotencyKey: input.idempotencyKey ?? asProfileQueueFotmScheduleIdempotencyKey(this.dependencies.createOpaqueId("pfk")),
    });
    return result.schedule;
  }

  async submitPublish(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly shipMonth: string;
  }): Promise<StagingFotmScheduleCommandResult> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const replay = await this.dependencies.repository.findAuditByIdempotency(idempotencyKey);
    if (replay) {
      if (
        replay.action !== "PUBLISHED"
        || replay.actorRef !== actorRef
        || replay.shipMonth !== shipMonth
        || replay.expectedRevision !== input.expectedRevision
      ) {
        throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
      }
      return { replayed: true, schedule: scheduleFromAudit(replay) };
    }

    const current = await this.dependencies.repository.findSchedule(shipMonth);
    if (!current) throw new StagingFotmScheduleConflictError("The requested future-month FOTM schedule was not found.");
    assertExpectedRevision(current, input.expectedRevision);
    const schedule = publishProfileQueueFotmSchedule(current, this.dependencies.now().toISOString());
    const audit = createAudit({
      action: "PUBLISHED",
      actorRef,
      createOpaqueId: this.dependencies.createOpaqueId,
      expectedRevision: input.expectedRevision,
      idempotencyKey,
      schedule,
    });
    return {
      replayed: false,
      schedule: await this.dependencies.repository.persist({
        audit,
        expectedRevision: input.expectedRevision,
        schedule,
      }),
    };
  }

  /**
   * Bounded, provider-free fan-out from one immutable published schedule to
   * exact currently-unconfigured staging cycles. Each cycle has its own CAS,
   * append-only mutation audit, and non-PII selection evidence.
   */
  async provisionPublishedMonth(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedScheduleRevision: number;
    readonly shipMonth: string;
  }): Promise<StagingFotmProvisioningResult> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const schedule = await this.dependencies.repository.findSchedule(shipMonth);
    if (!schedule || schedule.status !== "PUBLISHED" || schedule.revision !== input.expectedScheduleRevision) {
      throw new StagingFotmScheduleConflictError("The published FOTM schedule changed; reload before provisioning.");
    }
    const cycleRepository = this.dependencies.cycleRepository;
    if (!cycleRepository) {
      throw new StagingFotmProvisioningNotConfiguredError("Staging cycle provisioning is not configured.");
    }
    const candidates = await cycleRepository.findUnpublishedForProvisioning({
      limit: STAGING_ADMIN_PROVISION_BATCH_SIZE,
      shipMonth,
    });
    let configured = 0;
    let conflicted = 0;
    for (const current of candidates) {
      const updated = applyPublishedFotmScheduleToProfileQueueCycle(
        current,
        schedule,
        this.dependencies.now().toISOString(),
      );
      const audit: ProfileQueueMutationAuditRecord = {
        actorRef: asProfileQueueActorRef(actorRef),
        bindingId: current.bindingId,
        cycleKey: current.cycleKey,
        expectedRevision: current.revision,
        idempotencyKey: asProfileQueueIdempotencyKey(this.dependencies.createOpaqueId("pqk")),
        mutationId: asProfileQueueMutationId(this.dependencies.createOpaqueId("pqm")),
        mutationKind: "PUBLISH_FOTM",
        occurredAt: updated.updatedAt,
        resultingRevision: updated.revision,
      };
      try {
        await cycleRepository.persist({
          audit,
          cycle: updated,
          expectedRevision: current.revision,
          selectionEvidence: createProfileQueueSelectionEvidence({
            audit,
            cycle: updated,
            evidenceId: this.dependencies.createOpaqueId("pqe"),
          }),
        });
        configured += 1;
      } catch (error) {
        if (error instanceof ProfileQueueRepositoryConflictError) {
          conflicted += 1;
          continue;
        }
        throw error;
      }
    }
    return {
      configured,
      conflicted,
      mayHaveMore: candidates.length === STAGING_ADMIN_PROVISION_BATCH_SIZE,
      scanned: candidates.length,
    };
  }
}

function validateStaffContext(context: ServerVerifiedStagingStaffContext): string {
  if (context.authorization !== "SERVER_VERIFIED_STAGING_STAFF") {
    throw new Error("The staging FOTM schedule boundary requires verified server-side staff authorization.");
  }
  return asProfileQueueActorRef(context.actorRef);
}

function assertExpectedRevision(current: ProfileQueueFotmSchedule | null, expectedRevision: number | null): void {
  const currentRevision = current?.revision ?? null;
  if (currentRevision !== expectedRevision) {
    throw new StagingFotmScheduleConflictError("The FOTM schedule changed; reload before saving.");
  }
}

function createAudit(input: {
  readonly action: ProfileQueueFotmScheduleAuditRecord["action"];
  readonly actorRef: string;
  readonly createOpaqueId: StagingFotmScheduleAdminBoundaryDependencies["createOpaqueId"];
  readonly expectedRevision: number | null;
  readonly idempotencyKey: ReturnType<typeof asProfileQueueFotmScheduleIdempotencyKey>;
  readonly schedule: ProfileQueueFotmSchedule;
}): ProfileQueueFotmScheduleAuditRecord {
  return {
    action: input.action,
    actorRef: input.actorRef,
    auditId: asProfileQueueFotmScheduleAuditId(input.createOpaqueId("pfa")),
    cutoffAt: input.schedule.cutoffAt,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    merchantTimezone: input.schedule.merchantTimezone,
    mutationId: asProfileQueueFotmScheduleMutationId(input.createOpaqueId("pfs")),
    occurredAt: input.schedule.updatedAt,
    resultingRevision: input.schedule.revision,
    shipMonth: input.schedule.shipMonth,
    variantId: input.schedule.variantId,
  };
}
