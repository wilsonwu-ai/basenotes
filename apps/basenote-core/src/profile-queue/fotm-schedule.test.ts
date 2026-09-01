import assert from "node:assert/strict";
import test from "node:test";

import { StagingFotmScheduleAdminBoundary } from "../cloudflare-staging-worker/fotm-schedule-admin.js";
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
    shipMonth: "2026-10",
  });
  assert.deepEqual(firstBatch, { configured: 5, conflicted: 0, mayHaveMore: true, scanned: 5 });
  for (let index = 1; index <= 5; index += 1) {
    const cycle = await cycles.findCycle(
      `binding-profile-${index}`,
      `staging:delivery:2026-10-${index.toString().padStart(2, "0")}`,
    );
    assert.equal(cycle?.fotm.status, "PUBLISHED");
    assert.equal(cycle?.fotm.variantId, "gid://shopify/ProductVariant/902");
    assert.equal(cycle?.memberChoice.source, "UNSELECTED", "published FOTM is visible default, never an invented member override.");
  }
  const secondBatch = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    shipMonth: "2026-10",
  });
  assert.deepEqual(secondBatch, { configured: 1, conflicted: 0, mayHaveMore: false, scanned: 1 });
  const duplicateProvision = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: 1,
    shipMonth: "2026-10",
  });
  assert.deepEqual(duplicateProvision, { configured: 0, conflicted: 0, mayHaveMore: false, scanned: 0 });
});

function createBoundary(
  repository: InMemoryProfileQueueFotmScheduleRepository,
  cycleRepository?: InMemoryProfileQueueRepository,
): StagingFotmScheduleAdminBoundary {
  let serial = 0;
  return new StagingFotmScheduleAdminBoundary({
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_future_month_schedule_${serial.toString().padStart(3, "0")}`;
    },
    cycleRepository,
    now: () => new Date(now),
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
