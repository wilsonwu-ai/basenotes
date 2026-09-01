import assert from "node:assert/strict";
import test from "node:test";

import { StagingFotmScheduleAdminBoundary } from "../cloudflare-staging-worker/fotm-schedule-admin.js";
import {
  StagingFotmProvisioningRecoveryRequiredError,
  StagingFotmProvisioningRecoveryNotReadyError,
  StagingFotmScheduleNeedsAttentionError,
} from "../cloudflare-staging-worker/fotm-schedule-admin.js";
import {
  InMemoryProfileQueueFotmScheduleRepository,
  applyPublishedFotmScheduleToProfileQueueCycle,
} from "./fotm-schedule.js";
import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import { InMemoryProfileQueueRepository } from "./repository.js";
import { resolveProfileQueueAtCutoff } from "./service.js";
import { createProfileQueueSelectionEvidence } from "../cloudflare-staging-worker/cutoff-locker.js";

const now = "2026-08-01T15:00:00.000Z";
const central = "America/Chicago";

test("staff boundary schedules independent durable FOTM drafts for September, October, and November", async () => {
  const repository = new InMemoryProfileQueueFotmScheduleRepository();
  const boundary = createBoundary(repository);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };

  await boundary.scheduleDraft({
    context,
    cutoffAt: "2026-09-10T05:01:00.000Z",
    merchantTimezone: central,
    shipMonth: "2026-09",
    variantId: "gid://shopify/ProductVariant/901",
  });
  await boundary.scheduleDraft({
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  await boundary.scheduleDraft({
    context,
    cutoffAt: "2026-11-10T06:01:00.000Z",
    merchantTimezone: central,
    shipMonth: "2026-11",
    variantId: "gid://shopify/ProductVariant/903",
  });

  const schedules = await boundary.list(context);
  assert.deepEqual(schedules.map((schedule) => schedule.shipMonth), ["2026-09", "2026-10", "2026-11"]);
  assert.ok(schedules.every((schedule) => schedule.merchantTimezone === central));
  assert.ok(schedules.every((schedule) => schedule.status === "DRAFT"));
});

test("a published future-month schedule configures FOTM only as the unselected member fallback", async () => {
  const repository = new InMemoryProfileQueueFotmScheduleRepository();
  const boundary = createBoundary(repository);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };
  await boundary.scheduleDraft({
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  const published = await boundary.publish({ context, shipMonth: "2026-10" });

  const cycle = applyPublishedFotmScheduleToProfileQueueCycle(
    createEmptyProfileQueueCycle({
      bindingId: "binding-profile-220",
      cycleKey: "staging:delivery:2026-10-15",
      shipMonth: "2026-10",
      updatedAt: now,
    }),
    published,
    now,
  );
  assert.equal(cycle.memberChoice.source, "UNSELECTED");
  assert.equal(cycle.fotm.variantId, "gid://shopify/ProductVariant/902");

  const locked = resolveProfileQueueAtCutoff(cycle, published.cutoffAt);
  assert.equal(locked.memberChoice.source, "FOTM_FALLBACK");
  assert.equal(locked.memberChoice.variantId, "gid://shopify/ProductVariant/902");

  await assert.rejects(
    boundary.scheduleDraft({
      context,
      cutoffAt: "2026-10-11T05:01:00.000Z",
      merchantTimezone: central,
      shipMonth: "2026-10",
      variantId: "gid://shopify/ProductVariant/904",
    }),
    /Only a draft FOTM schedule may be revised/,
  );
});

test("the server-facing schedule boundary rejects an unverified opaque staff context", async () => {
  const boundary = createBoundary(new InMemoryProfileQueueFotmScheduleRepository());
  await assert.rejects(
    boundary.list({ actorRef: "staff stage", authorization: "SERVER_VERIFIED_STAGING_STAFF" }),
    /opaque identifier/,
  );
});

test("authenticated scheduler commands use CAS/idempotency and provision bounded preselected FOTM defaults without delivery", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const cycles = new InMemoryProfileQueueRepository();
  for (let index = 1; index <= 6; index += 1) {
    await seedUnpublishedCycle(cycles, index);
  }
  const boundary = createBoundary(schedules, cycles);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };
  const draftInput = {
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    idempotencyKey: "pfk_admin_draft_001",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  };

  const drafted = await boundary.submitDraft(draftInput);
  assert.equal(drafted.replayed, false);
  assert.equal(drafted.schedule.revision, 0);
  const replayed = await boundary.submitDraft(draftInput);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.schedule.revision, 0, "a duplicate scheduler submit must not create another revision.");

  await assert.rejects(
    boundary.submitDraft({ ...draftInput, variantId: "gid://shopify/ProductVariant/903" }),
    /idempotency key cannot be reused/i,
  );
  await assert.rejects(
    boundary.submitDraft({
      ...draftInput,
      expectedRevision: 1,
      idempotencyKey: "pfk_admin_draft_stale_001",
    }),
    /changed; reload before saving/i,
  );

  const published = await boundary.submitPublish({
    context,
    expectedRevision: 0,
    idempotencyKey: "pfk_admin_publish_001",
    shipMonth: "2026-10",
  });
  assert.equal(published.schedule.status, "PUBLISHED");
  assert.equal(published.schedule.revision, 1);

  const firstBatch = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_provision_001",
    shipMonth: "2026-10",
  });
  assert.deepEqual(firstBatch, { configured: 5, conflicted: 0, mayHaveMore: true, replayed: false, scanned: 5 });
  for (let index = 1; index <= 5; index += 1) {
    const cycle = await cycles.findCycle(
      `binding-profile-${index}`,
      `staging:delivery:2026-10-${index.toString().padStart(2, "0")}`,
    );
    assert.equal(cycle?.fotm.status, "PUBLISHED");
    assert.equal(cycle?.fotm.variantId, "gid://shopify/ProductVariant/902");
    assert.equal(cycle?.memberChoice.source, "UNSELECTED", "published FOTM is visible default, never an invented member override.");
  }
  const replayedFirstBatch = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_provision_001",
    shipMonth: "2026-10",
  });
  assert.deepEqual(
    replayedFirstBatch,
    { configured: 5, conflicted: 0, mayHaveMore: true, replayed: true, scanned: 5 },
    "an unknown-outcome retry must return the original durable result without provisioning a new batch.",
  );
  const sixthBeforeNewCommand = await cycles.findCycle("binding-profile-6", "staging:delivery:2026-10-06");
  assert.equal(sixthBeforeNewCommand?.fotm.status, "UNPUBLISHED", "the replay must not fan out to a new cycle.");

  await assert.rejects(
    boundary.provisionPublishedMonth({
      context,
      expectedScheduleRevision: 2,
      idempotencyKey: "pfk_admin_provision_001",
      shipMonth: "2026-10",
    }),
    /idempotency key cannot be reused/i,
  );
  await assert.rejects(
    boundary.submitRetire({
      context,
      expectedRevision: 1,
      idempotencyKey: "pfk_admin_provision_001",
      shipMonth: "2026-10",
    }),
    /idempotency key cannot be reused/i,
    "a provision command key cannot be repurposed as a schedule lifecycle command.",
  );

  const secondBatch = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_provision_002",
    shipMonth: "2026-10",
  });
  assert.deepEqual(secondBatch, { configured: 1, conflicted: 0, mayHaveMore: false, replayed: false, scanned: 1 });
  const duplicateProvision = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_provision_003",
    shipMonth: "2026-10",
  });
  assert.deepEqual(duplicateProvision, { configured: 0, conflicted: 0, mayHaveMore: false, replayed: false, scanned: 0 });

  await assert.rejects(
    boundary.submitRetire({
      context,
      expectedRevision: 1,
      idempotencyKey: "pfk_admin_retire_blocked_001",
      shipMonth: "2026-10",
    }),
    (error: unknown) => error instanceof StagingFotmScheduleNeedsAttentionError,
  );
  const stillPublished = await schedules.findSchedule("2026-10");
  assert.equal(stillPublished?.status, "PUBLISHED", "a blocked retirement must never silently alter the scheduled FOTM.");

  const exception = await boundary.recordRecoveryException({
    context,
    expectedRevision: 1,
    idempotencyKey: "pfk_admin_recovery_exception_001",
    shipMonth: "2026-10",
  });
  assert.deepEqual(exception, { replayed: false });
  const replayedException = await boundary.recordRecoveryException({
    context,
    expectedRevision: 1,
    idempotencyKey: "pfk_admin_recovery_exception_001",
    shipMonth: "2026-10",
  });
  assert.deepEqual(replayedException, { replayed: true }, "the recovery exception itself is immutable and replay-safe.");
});

test("staff can retire and explicitly recover an unprovisioned month without changing any cycle", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const cycles = new InMemoryProfileQueueRepository();
  const boundary = createBoundary(schedules, cycles);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };

  const drafted = await boundary.submitDraft({
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    idempotencyKey: "pfk_admin_lifecycle_draft_001",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  const retired = await boundary.submitRetire({
    context,
    expectedRevision: drafted.schedule.revision,
    idempotencyKey: "pfk_admin_lifecycle_retire_001",
    shipMonth: "2026-10",
  });
  assert.equal(retired.replayed, false);
  assert.equal(retired.schedule.status, "RETIRED");
  assert.equal(retired.schedule.revision, 1);

  const recovered = await boundary.submitRecoverDraft({
    context,
    cutoffAt: "2026-10-11T05:01:00.000Z",
    expectedRevision: retired.schedule.revision,
    idempotencyKey: "pfk_admin_lifecycle_recover_001",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/903",
  });
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.schedule.status, "DRAFT");
  assert.equal(recovered.schedule.revision, 2);
  assert.equal(recovered.schedule.variantId, "gid://shopify/ProductVariant/903");
  assert.equal(await cycles.hasProvisionedFotmForShipMonth("2026-10"), false);
});

test("a pending provision command fails closed rather than restarting a bounded fan-out", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const cycles = new InMemoryProfileQueueRepository();
  const boundary = createBoundary(schedules, cycles);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };
  await boundary.submitDraft({
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    idempotencyKey: "pfk_admin_pending_draft_001",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  await boundary.submitPublish({
    context,
    expectedRevision: 0,
    idempotencyKey: "pfk_admin_pending_publish_001",
    shipMonth: "2026-10",
  });
  await schedules.claimProvisionCommand({
    actorRef: context.actorRef,
    createdAt: now,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_pending_provision_001",
    plan: [],
    shipMonth: "2026-10",
  });

  await assert.rejects(
    boundary.submitRetire({
      context,
      expectedRevision: 1,
      idempotencyKey: "pfk_admin_pending_retire_001",
      shipMonth: "2026-10",
    }),
    /pending FOTM provision command prevents schedule retirement/i,
  );

  await assert.rejects(
    boundary.provisionPublishedMonth({
      context,
      expectedScheduleRevision: 1,
      idempotencyKey: "pfk_admin_pending_provision_001",
      shipMonth: "2026-10",
    }),
    (error: unknown) => error instanceof StagingFotmProvisioningRecoveryRequiredError,
  );
});

test("an old pending provision stays discoverable per month after more than 24 newer command records", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const boundary = createBoundary(schedules);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };
  const oldShipMonth = "2027-01";
  await boundary.scheduleDraft({
    context,
    cutoffAt: "2027-01-10T06:01:00.000Z",
    merchantTimezone: central,
    shipMonth: oldShipMonth,
    variantId: "gid://shopify/ProductVariant/902",
  });
  await boundary.publish({ context, shipMonth: oldShipMonth });
  await schedules.claimProvisionCommand({
    actorRef: context.actorRef,
    createdAt: now,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_old_pending_provision_001",
    plan: [],
    shipMonth: oldShipMonth,
  });

  for (let index = 0; index < 25; index += 1) {
    const year = 2028 + index;
    const shipMonth = `${year}-01`;
    await boundary.scheduleDraft({
      context,
      cutoffAt: `${year}-01-10T06:01:00.000Z`,
      merchantTimezone: central,
      shipMonth,
      variantId: "gid://shopify/ProductVariant/902",
    });
    await boundary.publish({ context, shipMonth });
    const idempotencyKey = `pfk_recent_provision_${index.toString().padStart(3, "0")}`;
    await schedules.claimProvisionCommand({
      actorRef: context.actorRef,
      createdAt: "2026-08-02T00:00:00.000Z",
      expectedScheduleRevision: 1,
      idempotencyKey,
      plan: [],
      shipMonth,
    });
    await schedules.completeProvisionCommand({
      completedAt: "2026-08-02T00:01:00.000Z",
      idempotencyKey,
      result: { configured: 0, conflicted: 0, mayHaveMore: false, scanned: 0 },
    });
  }

  const recentHistory = await boundary.listProvisionCommands(context);
  assert.equal(recentHistory.length, 24);
  assert.equal(
    recentHistory.some((command) => command.idempotencyKey === "pfk_old_pending_provision_001"),
    false,
    "the bounded audit-history panel intentionally omits the 25th older record.",
  );
  assert.deepEqual(
    (await boundary.listPendingProvisionCommands(context)).map((command) => command.idempotencyKey),
    ["pfk_old_pending_provision_001"],
    "the schedule-scoped active recovery handle must never depend on the recent-history limit.",
  );
});

test("an aged unknown-outcome provision can terminalize to immutable needs-attention before an unprovisioned month is retired", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const cycles = new InMemoryProfileQueueRepository();
  let lifecycleNow = now;
  const boundary = createBoundary(schedules, cycles, () => lifecycleNow);
  const context = { actorRef: "staff_stage_101", authorization: "SERVER_VERIFIED_STAGING_STAFF" as const };
  await boundary.submitDraft({
    context,
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    idempotencyKey: "pfk_admin_attention_draft_001",
    merchantTimezone: central,
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  await boundary.submitPublish({
    context,
    expectedRevision: 0,
    idempotencyKey: "pfk_admin_attention_publish_001",
    shipMonth: "2026-10",
  });
  await schedules.claimProvisionCommand({
    actorRef: context.actorRef,
    createdAt: now,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_attention_provision_001",
    plan: [],
    shipMonth: "2026-10",
  });

  await assert.rejects(
    boundary.markProvisionNeedsAttention({
      context,
      expectedScheduleRevision: 1,
      idempotencyKey: "pfk_admin_attention_provision_001",
      shipMonth: "2026-10",
    }),
    (error: unknown) => error instanceof StagingFotmProvisioningRecoveryNotReadyError,
  );

  lifecycleNow = "2026-08-01T15:15:00.000Z";
  const marked = await boundary.markProvisionNeedsAttention({
    context,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_admin_attention_provision_001",
    shipMonth: "2026-10",
  });
  assert.deepEqual(marked, { replayed: false, status: "NEEDS_ATTENTION" });
  assert.deepEqual(
    await boundary.markProvisionNeedsAttention({
      context,
      expectedScheduleRevision: 1,
      idempotencyKey: "pfk_admin_attention_provision_001",
      shipMonth: "2026-10",
    }),
    { replayed: true, status: "NEEDS_ATTENTION" },
  );
  const command = await schedules.findProvisionCommandByIdempotency("pfk_admin_attention_provision_001");
  assert.equal(command?.status, "NEEDS_ATTENTION");
  assert.equal(command?.result, null, "needs-attention is a terminal audit state, never a synthetic provisioning result.");

  const retired = await boundary.submitRetire({
    context,
    expectedRevision: 1,
    idempotencyKey: "pfk_admin_attention_retire_001",
    shipMonth: "2026-10",
  });
  assert.equal(retired.schedule.status, "RETIRED", "the terminal no-fan-out record unblocks only an unprovisioned month.");
  assert.equal(await cycles.hasProvisionedFotmForShipMonth("2026-10"), false);
});

function createBoundary(
  repository: InMemoryProfileQueueFotmScheduleRepository,
  cycleRepository?: InMemoryProfileQueueRepository,
  at: string | (() => string) = now,
): StagingFotmScheduleAdminBoundary {
  let serial = 0;
  return new StagingFotmScheduleAdminBoundary({
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_future_month_schedule_${serial.toString().padStart(3, "0")}`;
    },
    cycleRepository,
    now: () => new Date(typeof at === "function" ? at() : at),
    repository,
  });
}

async function seedUnpublishedCycle(repository: InMemoryProfileQueueRepository, index: number): Promise<void> {
  const bindingId = `binding-profile-${index}`;
  const cycleKey = `staging:delivery:2026-10-${index.toString().padStart(2, "0")}`;
  const cycle = createEmptyProfileQueueCycle({
    bindingId,
    cycleKey,
    shipMonth: "2026-10",
    updatedAt: now,
  });
  const audit: ProfileQueueMutationAuditRecord = {
    actorRef: asProfileQueueActorRef("staff_stage_101"),
    bindingId: cycle.bindingId,
    cycleKey: cycle.cycleKey,
    expectedRevision: null,
    idempotencyKey: `pqk_seed_cycle_${index.toString().padStart(3, "0")}` as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: `pqm_seed_cycle_${index.toString().padStart(3, "0")}` as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind: "CREATE_CYCLE",
    occurredAt: cycle.updatedAt,
    resultingRevision: cycle.revision,
  };
  await repository.persist({
    audit,
    cycle,
    expectedRevision: null,
    selectionEvidence: createProfileQueueSelectionEvidence({
      audit,
      cycle,
      evidenceId: `pqe_seed_cycle_${index.toString().padStart(3, "0")}`,
    }),
  });
}
