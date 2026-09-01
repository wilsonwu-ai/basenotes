import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryMessageOutbox,
  MessageOutboxIdempotencyConflictError,
  MessageOutboxTransitionError,
  type EnqueueMessageIntentInput,
} from "./outbox.js";

const INPUT: EnqueueMessageIntentInput = {
  eventId: "evt_subscription_created_101",
  idempotencyKey: "subscription-created-101",
  profileId: "profile-101",
  purpose: "TRANSACTIONAL",
  templateKey: "subscription.created",
};

test("enqueue is deterministic for an exact idempotency replay and rejects a retargeted key", () => {
  const outbox = createOutbox();
  const first = outbox.enqueue(INPUT);
  const replay = outbox.enqueue({ ...INPUT });

  assert.equal(first.status, "PENDING");
  assert.equal(first.id, replay.id);
  assert.deepEqual(first, replay);
  assert.equal(outbox.list().length, 1);

  assert.throws(
    () => outbox.enqueue({ ...INPUT, templateKey: "subscription.payment-failed" }),
    MessageOutboxIdempotencyConflictError,
  );
  assert.equal(outbox.list().length, 1);
});

test("template keys are validated before a delivery intent is stored", () => {
  const outbox = createOutbox();

  assert.throws(
    () => outbox.enqueue({ ...INPUT, idempotencyKey: "invalid-template-102", templateKey: "Subscription Created" }),
    /templateKey must be 3-128 lowercase URL-safe characters/,
  );
  assert.equal(outbox.list().length, 0);
});

test("an explicit eligible decision transitions PENDING to CLAIMED and then SENT", () => {
  const outbox = createOutbox();
  const pending = outbox.enqueue(INPUT);

  const claimed = outbox.claim({ intentId: pending.id, eligibility: { eligible: true } });
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(outbox.get(pending.id)?.status, "CLAIMED");

  const sent = outbox.markSent(pending.id);
  assert.equal(sent.status, "SENT");
  assert.equal(sent.statusReason, null);
  assert.throws(() => outbox.markSent(pending.id), MessageOutboxTransitionError);
});

test("an explicit ineligible decision suppresses a pending intent without delivery", () => {
  const outbox = createOutbox();
  const pending = outbox.enqueue(INPUT);

  const suppressed = outbox.claim({
    intentId: pending.id,
    eligibility: { eligible: false, reason: "CALLER_POLICY_DECLINED" },
  });
  assert.equal(suppressed.status, "SUPPRESSED");
  assert.equal(suppressed.statusReason, "CALLER_POLICY_DECLINED");
  assert.throws(
    () => outbox.claim({ intentId: pending.id, eligibility: { eligible: true } }),
    MessageOutboxTransitionError,
  );
});

test("a claimed intent can be explicitly suppressed before completion", () => {
  const outbox = createOutbox();
  const pending = outbox.enqueue(INPUT);
  outbox.claim({ intentId: pending.id, eligibility: { eligible: true } });

  const suppressed = outbox.suppress({
    intentId: pending.id,
    eligibility: { eligible: false, reason: "CALLER_POLICY_CHANGED" },
  });
  assert.equal(suppressed.status, "SUPPRESSED");
  assert.throws(() => outbox.markSent(pending.id), MessageOutboxTransitionError);
});

test("failed and suppressed intents are terminal: an idempotency replay never auto-resends them", () => {
  const outbox = createOutbox();
  const failedPending = outbox.enqueue(INPUT);
  outbox.claim({ intentId: failedPending.id, eligibility: { eligible: true } });
  const failed = outbox.markFailed(failedPending.id, "DELIVERY_ADAPTER_REPORTED_FAILURE");
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.statusReason, "DELIVERY_ADAPTER_REPORTED_FAILURE");

  const failedReplay = outbox.enqueue(INPUT);
  assert.equal(failedReplay.id, failedPending.id);
  assert.equal(failedReplay.status, "FAILED");
  assert.throws(
    () => outbox.claim({ intentId: failedPending.id, eligibility: { eligible: true } }),
    MessageOutboxTransitionError,
  );

  const suppressedPending = outbox.enqueue({
    ...INPUT,
    idempotencyKey: "subscription-created-102",
  });
  outbox.claim({
    intentId: suppressedPending.id,
    eligibility: { eligible: false, reason: "CALLER_POLICY_DECLINED" },
  });
  const suppressedReplay = outbox.enqueue({
    ...INPUT,
    idempotencyKey: "subscription-created-102",
  });
  assert.equal(suppressedReplay.status, "SUPPRESSED");
  assert.throws(
    () => outbox.claim({ intentId: suppressedPending.id, eligibility: { eligible: true } }),
    MessageOutboxTransitionError,
  );
});

test("canonicalizes equal-instant clock values and claims exactly one deterministically ordered intent", () => {
  const clockInputs = [
    "2026-09-01T12:00:00Z",
    "2026-09-01T12:00:00.000Z",
    "2026-09-01T12:00:00Z",
  ];
  let clockIndex = 0;
  const outbox = new InMemoryMessageOutbox({
    clock: () => new Date(clockInputs[clockIndex++] ?? "2026-09-01T12:00:00.000Z"),
  });
  const first = outbox.enqueue({ ...INPUT, idempotencyKey: "timestamp-ordering-001" });
  const second = outbox.enqueue({ ...INPUT, idempotencyKey: "timestamp-ordering-002" });

  assert.equal(first.createdAt, "2026-09-01T12:00:00.000Z");
  assert.equal(second.createdAt, "2026-09-01T12:00:00.000Z");
  const ordered = outbox.list();
  assert.deepEqual(
    ordered.map((intent) => intent.id),
    [first, second].map((intent) => intent.id).sort(),
  );

  const claimed = outbox.claim({ intentId: ordered[0]!.id, eligibility: { eligible: true } });
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.updatedAt, "2026-09-01T12:00:00.000Z");
  assert.equal(outbox.get(ordered[1]!.id)?.status, "PENDING");
  assert.throws(
    () => outbox.claim({ intentId: claimed.id, eligibility: { eligible: true } }),
    MessageOutboxTransitionError,
  );
});

test("the public outbox stores profile references only and returns defensive snapshots", () => {
  const outbox = createOutbox();
  const created = outbox.enqueue(INPUT);
  const localMutation = created as { templateKey: string };
  localMutation.templateKey = "tampered-local-copy";

  assert.equal(outbox.get(created.id)?.templateKey, INPUT.templateKey);
  assert.deepEqual(outbox.list().map((intent) => intent.profileId), [INPUT.profileId]);
});

function createOutbox(): InMemoryMessageOutbox {
  return new InMemoryMessageOutbox({
    clock: () => new Date("2026-09-01T12:00:00.000Z"),
  });
}
