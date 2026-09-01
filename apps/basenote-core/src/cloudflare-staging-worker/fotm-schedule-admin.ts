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
  recoverRetiredProfileQueueFotmSchedule,
  retireProfileQueueFotmSchedule,
  reviseDraftProfileQueueFotmSchedule,
  scheduleFromAudit,
  type ProfileQueueFotmProvisionCommand,
  type ProfileQueueFotmProvisioningResult,
  type ProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleAuditRecord,
  type ProfileQueueFotmScheduleRepository,
} from "../profile-queue/fotm-schedule.js";
import {
  ProfileQueueRepositoryConflictError,
  type ProfileQueueRepository,
} from "../profile-queue/repository.js";
import { asProductVariantId } from "../domain/ids.js";
import { asIsoTimestamp, asShipMonth, compareIsoTimestamps } from "../queue/types.js";
import { createProfileQueueSelectionEvidence } from "./cutoff-locker.js";

/** One admin request provisions at most five exact staging cycles. */
export const STAGING_ADMIN_PROVISION_BATCH_SIZE = 5;
/** Exceeds one HTTP Worker request window before an unknown claim can terminalize. */
export const STAGING_ADMIN_PROVISION_RECOVERY_DELAY_MILLISECONDS = 15 * 60 * 1_000;
/** Kept equal to the D1 trigger's `+900 seconds` safety gate. */
export const STAGING_ADMIN_PROVISION_RECOVERY_DELAY_SECONDS = 900;

export class StagingFotmScheduleConflictError extends Error {
  override name = "StagingFotmScheduleConflictError";
}

export class StagingFotmProvisioningNotConfiguredError extends Error {
  override name = "StagingFotmProvisioningNotConfiguredError";
}

/** A claimed command without a durable result must be reviewed, never fanned out again. */
export class StagingFotmProvisioningRecoveryRequiredError extends Error {
  override name = "StagingFotmProvisioningRecoveryRequiredError";
}

/** A claimed command is too recent to terminalize safely. */
export class StagingFotmProvisioningRecoveryNotReadyError extends Error {
  override name = "StagingFotmProvisioningRecoveryNotReadyError";
}

/** A no-mutation recovery exception must be recorded and reviewed explicitly. */
export class StagingFotmScheduleNeedsAttentionError extends Error {
  override name = "StagingFotmScheduleNeedsAttentionError";
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

export interface StagingFotmProvisioningResult extends ProfileQueueFotmProvisioningResult {
  /** A durable command/result lookup satisfied this request without fan-out. */
  readonly replayed: boolean;
}

export interface StagingFotmProvisionNeedsAttentionResult {
  readonly replayed: boolean;
  readonly status: "NEEDS_ATTENTION";
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

  /** Bounded non-PII command evidence for the authenticated staging scheduler UI. */
  async listProvisionCommands(
    context: ServerVerifiedStagingStaffContext,
  ): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    validateStaffContext(context);
    return this.dependencies.repository.listProvisionCommands(24);
  }

  /**
   * Active claims are intentionally independent from the bounded recent-history
   * view: one PENDING command per ship month remains recoverable in the UI.
   */
  async listPendingProvisionCommands(
    context: ServerVerifiedStagingStaffContext,
  ): Promise<readonly ProfileQueueFotmProvisionCommand[]> {
    validateStaffContext(context);
    return this.dependencies.repository.listPendingProvisionCommands();
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
    await assertScheduleCommandKeyUnusedByOtherEvidence(this.dependencies.repository, idempotencyKey);

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
    await assertScheduleCommandKeyUnusedByOtherEvidence(this.dependencies.repository, idempotencyKey);

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

  /** Explicitly retires a future DRAFT/PUBLISHED schedule without changing any cycle. */
  async submitRetire(input: {
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
        replay.action !== "RETIRED"
        || replay.actorRef !== actorRef
        || replay.shipMonth !== shipMonth
        || replay.expectedRevision !== input.expectedRevision
      ) {
        throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
      }
      return { replayed: true, schedule: scheduleFromAudit(replay) };
    }

    await assertScheduleCommandKeyUnusedByOtherEvidence(this.dependencies.repository, idempotencyKey);

    const current = await this.dependencies.repository.findSchedule(shipMonth);
    if (!current) throw new StagingFotmScheduleConflictError("The requested future-month FOTM schedule was not found.");
    assertExpectedRevision(current, input.expectedRevision);
    await assertNoProvisionedCycles(this.dependencies.cycleRepository, shipMonth);
    const schedule = retireProfileQueueFotmSchedule(current, this.dependencies.now().toISOString());
    const audit = createAudit({
      action: "RETIRED",
      actorRef,
      createOpaqueId: this.dependencies.createOpaqueId,
      expectedRevision: input.expectedRevision,
      idempotencyKey,
      schedule,
    });
    try {
      return {
        replayed: false,
        schedule: await this.dependencies.repository.persist({
          audit,
          expectedRevision: input.expectedRevision,
          schedule,
        }),
      };
    } catch (error) {
      return await rethrowNeedsAttentionIfProvisioned(this.dependencies.cycleRepository, shipMonth, error);
    }
  }

  /**
   * Guarded recovery is intentionally separate from ordinary replacement:
   * RETIRED -> DRAFT needs a fresh CAS/key/audit and touches no queue cycle.
   */
  async submitRecoverDraft(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly cutoffAt: string;
    readonly expectedRevision: number;
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
        replay.action !== "RECOVERED"
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

    await assertScheduleCommandKeyUnusedByOtherEvidence(this.dependencies.repository, idempotencyKey);

    const current = await this.dependencies.repository.findSchedule(shipMonth);
    if (!current) throw new StagingFotmScheduleConflictError("The requested retired FOTM schedule was not found.");
    assertExpectedRevision(current, input.expectedRevision);
    await assertNoProvisionedCycles(this.dependencies.cycleRepository, shipMonth);
    const schedule = recoverRetiredProfileQueueFotmSchedule(current, {
      cutoffAt,
      merchantTimezone: input.merchantTimezone,
      occurredAt: this.dependencies.now().toISOString(),
      variantId,
    });
    const audit = createAudit({
      action: "RECOVERED",
      actorRef,
      createOpaqueId: this.dependencies.createOpaqueId,
      expectedRevision: input.expectedRevision,
      idempotencyKey,
      schedule,
    });
    try {
      return {
        replayed: false,
        schedule: await this.dependencies.repository.persist({
          audit,
          expectedRevision: input.expectedRevision,
          schedule,
        }),
      };
    } catch (error) {
      return await rethrowNeedsAttentionIfProvisioned(this.dependencies.cycleRepository, shipMonth, error);
    }
  }

  /**
   * Creates immutable, non-PII no-mutation evidence for a month whose old
   * FOTM has already reached a queue cycle. It is intentionally not a repair.
   */
  async recordRecoveryException(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly shipMonth: string;
  }): Promise<{ readonly replayed: boolean }> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const scheduleReplay = await this.dependencies.repository.findAuditByIdempotency(idempotencyKey);
    if (scheduleReplay) {
      throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
    }
    const provisionReplay = await this.dependencies.repository.findProvisionCommandByIdempotency(idempotencyKey);
    if (provisionReplay) {
      throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
    }
    const replay = await this.dependencies.repository.findRecoveryExceptionByIdempotency(idempotencyKey);
    if (replay) {
      if (
        replay.actorRef !== actorRef
        || replay.shipMonth !== shipMonth
        || replay.expectedRevision !== input.expectedRevision
      ) {
        throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
      }
      return { replayed: true };
    }
    const schedule = await this.dependencies.repository.findSchedule(shipMonth);
    if (!schedule || schedule.revision !== input.expectedRevision || (schedule.status !== "PUBLISHED" && schedule.status !== "RETIRED")) {
      throw new StagingFotmScheduleConflictError("The FOTM schedule changed; reload before recording recovery attention.");
    }
    const cycleRepository = requireCycleRepositoryForLifecycle(this.dependencies.cycleRepository);
    if (!await cycleRepository.hasProvisionedFotmForShipMonth(shipMonth)) {
      throw new StagingFotmScheduleConflictError("No provisioned FOTM cycle requires a recovery exception.");
    }
    await this.dependencies.repository.recordRecoveryException({
      actorRef,
      expectedRevision: input.expectedRevision,
      idempotencyKey,
      occurredAt: this.dependencies.now().toISOString(),
      shipMonth,
    });
    return { replayed: false };
  }

  /**
   * Terminalizes only an aged unknown-outcome provision claim. It does not
   * retry the plan, alter a schedule, or mutate any cycle/provider state.
   */
  async markProvisionNeedsAttention(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedScheduleRevision: number;
    readonly idempotencyKey: string;
    readonly shipMonth: string;
  }): Promise<StagingFotmProvisionNeedsAttentionResult> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const command = await this.dependencies.repository.findProvisionCommandByIdempotency(idempotencyKey);
    if (!command) {
      throw new StagingFotmScheduleConflictError("The staging FOTM provision command was not found.");
    }
    assertProvisionCommandFingerprint(command, {
      actorRef,
      expectedScheduleRevision: input.expectedScheduleRevision,
      shipMonth,
    });
    if (command.status === "NEEDS_ATTENTION") return { replayed: true, status: "NEEDS_ATTENTION" };
    if (command.status !== "PENDING") {
      throw new StagingFotmScheduleConflictError("Only a pending staging FOTM provision command may be marked for attention.");
    }
    const attentionAt = asIsoTimestamp(this.dependencies.now().toISOString());
    const notBefore = asIsoTimestamp(
      new Date(new Date(attentionAt).getTime() - STAGING_ADMIN_PROVISION_RECOVERY_DELAY_MILLISECONDS).toISOString(),
    );
    if (compareIsoTimestamps(command.createdAt, notBefore) > 0) {
      throw new StagingFotmProvisioningRecoveryNotReadyError(
        "The staging FOTM provision command is still within its recovery delay.",
      );
    }
    try {
      await this.dependencies.repository.markProvisionCommandNeedsAttention({
        actorRef,
        attentionAt,
        expectedScheduleRevision: input.expectedScheduleRevision,
        idempotencyKey,
        notBefore,
        shipMonth,
      });
      return { replayed: false, status: "NEEDS_ATTENTION" };
    } catch (error) {
      const replay = await this.dependencies.repository.findProvisionCommandByIdempotency(idempotencyKey);
      if (
        replay?.status === "NEEDS_ATTENTION"
        && replay.actorRef === actorRef
        && replay.shipMonth === shipMonth
        && replay.expectedScheduleRevision === input.expectedScheduleRevision
      ) {
        return { replayed: true, status: "NEEDS_ATTENTION" };
      }
      throw error;
    }
  }

  /**
   * Bounded, provider-free fan-out from one immutable published schedule to
   * exact currently-unconfigured staging cycles. Each cycle has its own CAS,
   * append-only mutation audit, and non-PII selection evidence.
   */
  async provisionPublishedMonth(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly expectedScheduleRevision: number;
    readonly idempotencyKey: string;
    readonly shipMonth: string;
  }): Promise<StagingFotmProvisioningResult> {
    const actorRef = validateStaffContext(input.context);
    const shipMonth = asShipMonth(input.shipMonth);
    const idempotencyKey = asProfileQueueFotmScheduleIdempotencyKey(input.idempotencyKey);
    const existingCommand = await this.dependencies.repository.findProvisionCommandByIdempotency(idempotencyKey);
    if (existingCommand) {
      assertProvisionCommandFingerprint(existingCommand, {
        actorRef,
        expectedScheduleRevision: input.expectedScheduleRevision,
        shipMonth,
      });
      if (existingCommand.status === "COMPLETED" && existingCommand.result) {
        return { ...existingCommand.result, replayed: true };
      }
      throw new StagingFotmProvisioningRecoveryRequiredError(
        "The prior bounded provision command has no durable result; inspect its audit before creating a new command.",
      );
    }
    await assertProvisionCommandKeyUnusedByOtherEvidence(this.dependencies.repository, idempotencyKey);

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
    const plan = candidates.map((cycle) => ({
      bindingId: cycle.bindingId,
      cycleKey: cycle.cycleKey,
      expectedRevision: cycle.revision,
    }));
    try {
      await this.dependencies.repository.claimProvisionCommand({
        actorRef,
        createdAt: this.dependencies.now().toISOString(),
        expectedScheduleRevision: input.expectedScheduleRevision,
        idempotencyKey,
        plan,
        shipMonth,
      });
    } catch (error) {
      // A simultaneous same-key request may have claimed the command after the
      // first lookup. Re-read it; never issue another fan-out for that key.
      const raced = await this.dependencies.repository.findProvisionCommandByIdempotency(idempotencyKey);
      if (!raced) throw error;
      assertProvisionCommandFingerprint(raced, {
        actorRef,
        expectedScheduleRevision: input.expectedScheduleRevision,
        shipMonth,
      });
      if (raced.status === "COMPLETED" && raced.result) return { ...raced.result, replayed: true };
      throw new StagingFotmProvisioningRecoveryRequiredError(
        "The prior bounded provision command has no durable result; inspect its audit before creating a new command.",
      );
    }

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
    const result: ProfileQueueFotmProvisioningResult = {
      configured,
      conflicted,
      mayHaveMore: candidates.length === STAGING_ADMIN_PROVISION_BATCH_SIZE,
      scanned: candidates.length,
    };
    const completed = await this.dependencies.repository.completeProvisionCommand({
      completedAt: this.dependencies.now().toISOString(),
      idempotencyKey,
      result,
    });
    if (!completed.result) {
      throw new StagingFotmProvisioningRecoveryRequiredError(
        "The bounded provision command has no durable result; inspect its audit before creating a new command.",
      );
    }
    return { ...completed.result, replayed: false };
  }
}

function validateStaffContext(context: ServerVerifiedStagingStaffContext): string {
  if (context.authorization !== "SERVER_VERIFIED_STAGING_STAFF") {
    throw new Error("The staging FOTM schedule boundary requires verified server-side staff authorization.");
  }
  return asProfileQueueActorRef(context.actorRef);
}

function requireCycleRepositoryForLifecycle(
  repository: ProfileQueueRepository | undefined,
): ProfileQueueRepository {
  if (!repository) {
    throw new StagingFotmProvisioningNotConfiguredError(
      "Staging FOTM lifecycle safety requires the D1 cycle repository.",
    );
  }
  return repository;
}

async function assertNoProvisionedCycles(
  repository: ProfileQueueRepository | undefined,
  shipMonth: string,
): Promise<void> {
  if (await requireCycleRepositoryForLifecycle(repository).hasProvisionedFotmForShipMonth(shipMonth)) {
    throw new StagingFotmScheduleNeedsAttentionError(
      "This month already has provisioned FOTM cycles. Record a no-mutation recovery exception for review; do not retire or replace it.",
    );
  }
}

async function rethrowNeedsAttentionIfProvisioned(
  repository: ProfileQueueRepository | undefined,
  shipMonth: string,
  error: unknown,
): Promise<never> {
  if (await requireCycleRepositoryForLifecycle(repository).hasProvisionedFotmForShipMonth(shipMonth)) {
    throw new StagingFotmScheduleNeedsAttentionError(
      "This month already has provisioned FOTM cycles. Record a no-mutation recovery exception for review; do not retire or replace it.",
    );
  }
  throw error;
}

function assertExpectedRevision(current: ProfileQueueFotmSchedule | null, expectedRevision: number | null): void {
  const currentRevision = current?.revision ?? null;
  if (currentRevision !== expectedRevision) {
    throw new StagingFotmScheduleConflictError("The FOTM schedule changed; reload before saving.");
  }
}

async function assertScheduleCommandKeyUnusedByOtherEvidence(
  repository: ProfileQueueFotmScheduleRepository,
  idempotencyKey: string,
): Promise<void> {
  const [provisionCommand, recoveryException] = await Promise.all([
    repository.findProvisionCommandByIdempotency(idempotencyKey),
    repository.findRecoveryExceptionByIdempotency(idempotencyKey),
  ]);
  if (provisionCommand || recoveryException) {
    throw new StagingFotmScheduleConflictError("An FOTM schedule idempotency key cannot be reused for another command.");
  }
}

async function assertProvisionCommandKeyUnusedByOtherEvidence(
  repository: ProfileQueueFotmScheduleRepository,
  idempotencyKey: string,
): Promise<void> {
  const [scheduleAudit, recoveryException] = await Promise.all([
    repository.findAuditByIdempotency(idempotencyKey),
    repository.findRecoveryExceptionByIdempotency(idempotencyKey),
  ]);
  if (scheduleAudit || recoveryException) {
    throw new StagingFotmScheduleConflictError("An FOTM provision idempotency key cannot be reused for another command.");
  }
}

function assertProvisionCommandFingerprint(
  command: ProfileQueueFotmProvisionCommand,
  input: {
    readonly actorRef: string;
    readonly expectedScheduleRevision: number;
    readonly shipMonth: string;
  },
): void {
  if (
    command.actorRef !== input.actorRef
    || command.expectedScheduleRevision !== input.expectedScheduleRevision
    || command.shipMonth !== input.shipMonth
  ) {
    throw new StagingFotmScheduleConflictError("An FOTM provision idempotency key cannot be reused for another command.");
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
