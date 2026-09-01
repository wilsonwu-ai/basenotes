import assert from "node:assert/strict";
import test from "node:test";

import {
  StagingAdminSchedulerRequestValidationError,
  parseStagingAdminSchedulerCommand,
} from "./admin-scheduler-request-validation.js";

const endpoint = "https://basenote-profile-queue-staging.wilson-af8.workers.dev/api/admin/fotm-schedules";
const idempotencyKey = "pfk_adminscheduler001";

test("parses only explicit authenticated scheduler command shapes", async () => {
  const draft = await parseStagingAdminSchedulerCommand(commandRequest({
    action: "SAVE_DRAFT",
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    merchantTimezone: "America/Chicago",
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/901",
  }));
  assert.deepEqual(draft, {
    action: "SAVE_DRAFT",
    cutoffAt: "2026-10-10T05:01:00.000Z",
    expectedRevision: null,
    idempotencyKey,
    merchantTimezone: "America/Chicago",
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/901",
  });

  const publish = await parseStagingAdminSchedulerCommand(commandRequest({
    action: "PUBLISH",
    expectedRevision: 0,
    shipMonth: "2026-10",
  }));
  assert.deepEqual(publish, {
    action: "PUBLISH",
    expectedRevision: 0,
    idempotencyKey,
    shipMonth: "2026-10",
  });

  const provision = await parseStagingAdminSchedulerCommand(commandRequest({
    action: "PROVISION",
    expectedScheduleRevision: 1,
    shipMonth: "2026-10",
  }));
  assert.deepEqual(provision, {
    action: "PROVISION",
    expectedScheduleRevision: 1,
    idempotencyKey,
    shipMonth: "2026-10",
  });
});

test("scheduler parsing rejects malformed, overspecified, or non-opaque requests without echoing input", async () => {
  const secret = "person@example.test";
  for (const request of [
    new Request(endpoint, { method: "GET" }),
    new Request(endpoint, {
      body: JSON.stringify({ action: "PUBLISH", expectedRevision: 0, shipMonth: "2026-10" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    commandRequest({ action: "PUBLISH", expectedRevision: -1, shipMonth: "2026-10" }),
    commandRequest({ action: "PUBLISH", expectedRevision: 0, shipMonth: "2026-10", staffEmail: secret }),
    commandRequest({ action: "SAVE_DRAFT", cutoffAt: "x", expectedRevision: null, merchantTimezone: "America/Chicago", shipMonth: "2026-010", variantId: "gid://shopify/ProductVariant/901" }),
    new Request(endpoint, {
      body: JSON.stringify({ action: "PUBLISH", expectedRevision: 0, shipMonth: "2026-10" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "pfk_short" },
      method: "POST",
    }),
  ]) {
    await assert.rejects(
      parseStagingAdminSchedulerCommand(request),
      (error: unknown) => {
        assert.ok(error instanceof StagingAdminSchedulerRequestValidationError);
        assert.doesNotMatch(error.message, /person@example\.test/);
        return true;
      },
    );
  }
});

function commandRequest(body: Record<string, unknown>): Request {
  return new Request(endpoint, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    method: "POST",
  });
}
