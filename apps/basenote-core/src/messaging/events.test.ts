import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryMessagingEventLedger,
  MessagingEventIdempotencyConflictError,
  MessagingEventValidationError,
  type RecordMessagingEventInput,
} from "./events.js";

const RECORDED_AT = "2026-09-01T12:00:00.000Z";

function createLedger(): InMemoryMessagingEventLedger {
  return new InMemoryMessagingEventLedger({ clock: () => new Date(RECORDED_AT) });
}

function eventInput(overrides: Partial<RecordMessagingEventInput> = {}): RecordMessagingEventInput {
  return {
    eventId: "evt_queue-change-0001",
    idempotencyKey: "queue-change-0001",
    profileId: "profile-001",
    occurredAt: "2026-09-01T11:59:00.000Z",
    source: "STOREFRONT",
    type: "QUEUE_SELECTION_CHANGED",
    attributes: {
      contract_ref: "contract-001",
      cycle_key: "delivery-2026-09",
      selection_source: "customer",
      revision: 2,
    },
    ...overrides,
  };
}

test("records a safe event and retrieves profile-scoped immutable audit copies", () => {
  const ledger = createLedger();
  const input = eventInput();
  const result = ledger.record(input);

  assert.equal(result.outcome, "RECORDED");
  assert.equal(result.event.recordedAt, RECORDED_AT);
  assert.equal(ledger.size, 1);
  assert.deepEqual(ledger.listEventsForProfile("profile-001"), [result.event]);
  assert.deepEqual(ledger.listEventsForProfile("profile-002"), []);
  assert.equal(ledger.getEvent("evt_queue-change-0001")?.eventId, "evt_queue-change-0001");

  (input.attributes as Record<string, unknown>).revision = 999;
  assert.equal(ledger.listEventsForProfile("profile-001")[0]?.attributes.revision, 2);

  const retrieved = ledger.listEventsForProfile("profile-001")[0];
  assert.ok(retrieved);
  assert.throws(() => {
    (retrieved.attributes as Record<string, unknown>).revision = 999;
  }, TypeError);
  assert.equal(ledger.listEventsForProfile("profile-001")[0]?.attributes.revision, 2);
});

test("replays an identical event only once by both event ID and idempotency key", () => {
  const ledger = createLedger();
  const first = ledger.record(eventInput());
  const replay = ledger.record(eventInput());

  assert.equal(first.outcome, "RECORDED");
  assert.equal(replay.outcome, "DEDUPLICATED");
  assert.equal(replay.event.recordedAt, first.event.recordedAt);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.listEventsForProfile("profile-001").length, 1);
});

test("an event ID or idempotency key cannot be recycled for a different immutable event", () => {
  const ledger = createLedger();
  ledger.record(eventInput());

  assert.throws(
    () => ledger.record(eventInput({ attributes: { contract_ref: "contract-002" } })),
    MessagingEventIdempotencyConflictError,
  );
  assert.throws(
    () =>
      ledger.record(
        eventInput({
          eventId: "evt_queue-change-0002",
          idempotencyKey: "queue-change-0001",
        }),
      ),
    MessagingEventIdempotencyConflictError,
  );
  assert.equal(ledger.size, 1);
});

test("rejects unknown or provenance-incompatible source/type pairs", () => {
  const ledger = createLedger();
  assert.throws(
    () => ledger.record(eventInput({ source: "KLAVIYO" })),
    MessagingEventValidationError,
  );
  assert.throws(
    () => ledger.record(eventInput({ type: "PROFILE_CREATED" })),
    MessagingEventValidationError,
  );
  assert.throws(
    () => ledger.record(eventInput({ type: "ORDER_PAID" })),
    MessagingEventValidationError,
  );
  assert.doesNotThrow(() =>
    ledger.record(
      eventInput({
        eventId: "evt_order-paid-0002",
        idempotencyKey: "order-paid-0002",
        source: "SHOPIFY_WEBHOOK",
        type: "ORDER_PAID",
        attributes: { order_ref: "order-001", currency: "USD", order_total_cents: 2500 },
      }),
    ),
  );
});

test("rejects nested, unsafe, and PII-shaped attributes before retaining an event", () => {
  const ledger = createLedger();
  const invalidAttributes: readonly unknown[] = [
    { metadata: { nested: "value" } },
    { customer_email: "person@example.com" },
    { order_ref: "person@example.com" },
    { phone_ref: "+1 555 123 4567" },
    { customer_ref: "gid://shopify/Customer/1" },
    { freeform_code: "this contains whitespace" },
    { amount: Number.POSITIVE_INFINITY },
  ];

  for (const attributes of invalidAttributes) {
    assert.throws(
      () => ledger.record(eventInput({ attributes })),
      MessagingEventValidationError,
    );
  }
  assert.equal(ledger.size, 0);
});

test("all catalog event types are accepted from their permitted trusted source", () => {
  const ledger = createLedger();
  const events = [
    ["QUIZ_COMPLETED", "STOREFRONT"],
    ["QUEUE_SELECTION_CHANGED", "STOREFRONT"],
    ["QUEUE_SELECTION_REMOVED", "STOREFRONT"],
    ["CANCELLATION_REQUESTED", "STOREFRONT"],
    ["RETENTION_REQUESTED", "STOREFRONT"],
    ["SUBSCRIPTION_CREATED", "SHOPIFY_WEBHOOK"],
    ["SUBSCRIPTION_CANCELLED", "SHOPIFY_WEBHOOK"],
    ["SUBSCRIPTION_BILLING_SUCCEEDED", "SHOPIFY_WEBHOOK"],
    ["SUBSCRIPTION_BILLING_FAILED", "SHOPIFY_WEBHOOK"],
    ["ORDER_PAID", "SHOPIFY_WEBHOOK"],
  ] as const;

  for (const [type, source] of events) {
    const index = ledger.size + 1;
    const result = ledger.record(
      eventInput({
        eventId: `evt_catalog-event-${index}`,
        idempotencyKey: `catalog-event-${index}`,
        source,
        type,
        attributes: { event_code: `catalog-${index}` },
      }),
    );
    assert.equal(result.outcome, "RECORDED");
  }
  assert.equal(ledger.size, events.length);
});
