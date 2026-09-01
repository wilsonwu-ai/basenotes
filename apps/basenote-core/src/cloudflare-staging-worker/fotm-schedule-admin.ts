import { asProfileQueueActorRef } from "../profile-queue/contracts.js";
import {
  asProfileQueueFotmScheduleAuditId,
  asProfileQueueFotmScheduleIdempotencyKey,
  asProfileQueueFotmScheduleMutationId,
  createDraftProfileQueueFotmSchedule,
  publishProfileQueueFotmSchedule,
  reviseDraftProfileQueueFotmSchedule,
  type ProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleAuditRecord,
  type ProfileQueueFotmScheduleRepository,
} from "../profile-queue/fotm-schedule.js";

/**
 * A caller may construct this only after an approved server-side staff auth
 * layer verifies the person and maps it to an opaque staging actor reference.
 * This Worker deliberately does not expose an HTTP endpoint that can create it.
 */
export interface ServerVerifiedStagingStaffContext {
  readonly actorRef: string;
  readonly authorization: "SERVER_VERIFIED_STAGING_STAFF";
}

export interface StagingFotmScheduleAdminBoundaryDependencies {
  readonly createOpaqueId: (prefix: "pfs" | "pfa" | "pfk") => string;
  readonly now: () => Date;
  readonly repository: ProfileQueueFotmScheduleRepository;
}

/**
 * Server-facing staging boundary for future-month FOTM schedules. It only
 * writes D1 through its repository and has no HTTP, Shopify, Appstle, email,
 * catalog, customer, or production behavior.
 */
export class StagingFotmScheduleAdminBoundary {
  constructor(private readonly dependencies: StagingFotmScheduleAdminBoundaryDependencies) {}

  async list(context: ServerVerifiedStagingStaffContext): Promise<readonly ProfileQueueFotmSchedule[]> {
    validateStaffContext(context);
    return this.dependencies.repository.listSchedules();
  }

  async scheduleDraft(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly cutoffAt: string;
    readonly merchantTimezone: string;
    readonly shipMonth: string;
    readonly variantId: string;
  }): Promise<ProfileQueueFotmSchedule> {
    const actorRef = validateStaffContext(input.context);
    const occurredAt = this.dependencies.now().toISOString();
    const existing = await this.dependencies.repository.findSchedule(input.shipMonth);
    const schedule = existing
      ? reviseDraftProfileQueueFotmSchedule(existing, {
          cutoffAt: input.cutoffAt,
          merchantTimezone: input.merchantTimezone,
          occurredAt,
          variantId: input.variantId,
        })
      : createDraftProfileQueueFotmSchedule({
          cutoffAt: input.cutoffAt,
          merchantTimezone: input.merchantTimezone,
          occurredAt,
          shipMonth: input.shipMonth,
          variantId: input.variantId,
        });
    const audit = createAudit({
      action: "SCHEDULED",
      actorRef,
      expectedRevision: existing?.revision ?? null,
      schedule,
      createOpaqueId: this.dependencies.createOpaqueId,
    });
    return this.dependencies.repository.persist({
      audit,
      expectedRevision: existing?.revision ?? null,
      schedule,
    });
  }

  async publish(input: {
    readonly context: ServerVerifiedStagingStaffContext;
    readonly shipMonth: string;
  }): Promise<ProfileQueueFotmSchedule> {
    const actorRef = validateStaffContext(input.context);
    const current = await this.dependencies.repository.findSchedule(input.shipMonth);
    if (!current) throw new Error("The requested future-month FOTM schedule was not found.");
    const schedule = publishProfileQueueFotmSchedule(current, this.dependencies.now().toISOString());
    const audit = createAudit({
      action: "PUBLISHED",
      actorRef,
      expectedRevision: current.revision,
      schedule,
      createOpaqueId: this.dependencies.createOpaqueId,
    });
    return this.dependencies.repository.persist({
      audit,
      expectedRevision: current.revision,
      schedule,
    });
  }
}

function validateStaffContext(context: ServerVerifiedStagingStaffContext): string {
  if (context.authorization !== "SERVER_VERIFIED_STAGING_STAFF") {
    throw new Error("The staging FOTM schedule boundary requires verified server-side staff authorization.");
  }
  return asProfileQueueActorRef(context.actorRef);
}

function createAudit(input: {
  readonly action: ProfileQueueFotmScheduleAuditRecord["action"];
  readonly actorRef: string;
  readonly createOpaqueId: (prefix: "pfs" | "pfa" | "pfk") => string;
  readonly expectedRevision: number | null;
  readonly schedule: ProfileQueueFotmSchedule;
}): ProfileQueueFotmScheduleAuditRecord {
  return {
    action: input.action,
    actorRef: input.actorRef,
    auditId: asProfileQueueFotmScheduleAuditId(input.createOpaqueId("pfa")),
    cutoffAt: input.schedule.cutoffAt,
    expectedRevision: input.expectedRevision,
    idempotencyKey: asProfileQueueFotmScheduleIdempotencyKey(input.createOpaqueId("pfk")),
    merchantTimezone: input.schedule.merchantTimezone,
    mutationId: asProfileQueueFotmScheduleMutationId(input.createOpaqueId("pfs")),
    occurredAt: input.schedule.updatedAt,
    resultingRevision: input.schedule.revision,
    shipMonth: input.schedule.shipMonth,
    variantId: input.schedule.variantId,
  };
}
