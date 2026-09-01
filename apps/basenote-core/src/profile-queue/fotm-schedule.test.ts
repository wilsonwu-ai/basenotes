import assert from "node:assert/strict";
import test from "node:test";

import { StagingFotmScheduleAdminBoundary } from "../cloudflare-staging-worker/fotm-schedule-admin.js";
import {
  InMemoryProfileQueueFotmScheduleRepository,
  applyPublishedFotmScheduleToProfileQueueCycle,
} from "./fotm-schedule.js";
import { createEmptyProfileQueueCycle } from "./contracts.js";
import { resolveProfileQueueAtCutoff } from "./service.js";

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

function createBoundary(repository: InMemoryProfileQueueFotmScheduleRepository): StagingFotmScheduleAdminBoundary {
  let serial = 0;
  return new StagingFotmScheduleAdminBoundary({
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_future_month_schedule_${serial.toString().padStart(3, "0")}`;
    },
    now: () => new Date(now),
    repository,
  });
}
