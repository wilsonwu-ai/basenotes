import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryQueueService,
  type QueueServiceOptions,
} from "./in-memory-queue-service.js";
import {
  QueueCutoffError,
  QueueIdempotencyConflictError,
  QueueRevisionConflictError,
} from "./errors.js";
import type { VariantResolutionGuards } from "./types.js";

const customerId = "gid://shopify/Customer/201";
const contractId = "gid://shopify/SubscriptionContract/101";
const lineId = "gid://shopify/SubscriptionLine/401";
const aventus = "gid://shopify/ProductVariant/301";
const greenIrishTweed = "gid://shopify/ProductVariant/302";

const clearGuards: VariantResolutionGuards = {
  isAvailable: () => true,
  isCompatible: () => true,
};

test("delivery-cycle IDs—not ship month—keep same-month slots independent and revisioned", () => {
  const service = createService("2026-09-01T09:00:00.000Z");

  const first = service.setCustomerSelection({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-01",
    shipMonth: "2026-09",
    expectedRevision: 0,
    variantId: aventus,
  });
  const second = service.setCustomerSelection({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    expectedRevision: 0,
    variantId: greenIrishTweed,
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(service.listSlots("binding-101").length, 2);
  assert.throws(
    () =>
      service.clearCustomerSelection({
        bindingId: "binding-101",
        cycleKey: "appstle:delivery:2026-09-01",
        shipMonth: "2026-09",
        expectedRevision: 0,
      }),
    QueueRevisionConflictError,
  );
});

test("distinct subscription lines on one contract remain independently bindable", () => {
  const service = createService("2026-09-01T09:00:00.000Z");

  assert.doesNotThrow(() =>
    service.createContractBinding({
      id: "binding-102",
      adapterOwner: "APPSTLE",
      canonicalContractId: contractId,
      adapterContractRef: "appstle-contract-101",
      customerId,
      subscriptionLineId: "gid://shopify/SubscriptionLine/402",
      status: "ACTIVE",
      verifiedAt: "2026-09-01T09:00:00.000Z",
    }),
  );
});

test("published FOTM locks one exact cycle and emits a pending outbox, never an applied shipment", () => {
  let now = "2026-09-01T09:00:00.000Z";
  const service = createService(() => now);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");

  now = "2026-09-10T12:00:00.000Z";
  const result = service.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-september-15",
    guards: clearGuards,
  });

  assert.equal(result.outcome, "ENQUEUED");
  if (result.outcome !== "ENQUEUED") return assert.fail("expected an outbox item");
  assert.equal(result.slot.source, "FOTM");
  assert.equal(result.slot.state, "LOCKED");
  assert.equal(result.slot.selectedVariantId, greenIrishTweed);
  assert.equal(result.outbox.status, "PENDING");
  assert.equal(result.outbox.shipMonth, "2026-09");
});

test("unavailable customer selection fails closed and creates no adapter outbox", () => {
  let now = "2026-09-01T09:00:00.000Z";
  const service = createService(() => now);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");
  service.setCustomerSelection({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    expectedRevision: 0,
    variantId: aventus,
  });

  now = "2026-09-10T12:00:00.000Z";
  const result = service.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-unavailable-15",
    guards: { ...clearGuards, isAvailable: () => false },
  });

  assert.deepEqual(result.outcome, "NEEDS_ATTENTION");
  if (result.outcome !== "NEEDS_ATTENTION") return assert.fail("expected attention");
  assert.equal(result.reason, "CUSTOMER_SELECTION_UNAVAILABLE");
  assert.equal(result.slot.state, "NEEDS_ATTENTION");
  assert.equal(service.listOutbox("binding-101").length, 0);
});

test("adapter readback mismatch cannot report success and is not auto-retried", () => {
  let now = "2026-09-01T09:00:00.000Z";
  const service = createService(() => now);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");
  now = "2026-09-10T12:00:00.000Z";

  const resolution = service.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-readback-15",
    guards: clearGuards,
  });
  if (resolution.outcome !== "ENQUEUED") return assert.fail("expected an outbox item");

  assert.equal(service.claimOutbox(resolution.outbox.id).status, "APPLYING");
  const completed = service.confirmOutboxReadback(
    resolution.outbox.id,
    aventus,
    "adapter-receipt-1",
  );

  assert.equal(completed.status, "NEEDS_ATTENTION");
  assert.equal(completed.error, "READBACK_MISMATCH");
  assert.equal(
    service.getSlot("binding-101", "appstle:delivery:2026-09-15")?.state,
    "NEEDS_ATTENTION",
  );
  assert.throws(() => service.claimOutbox(resolution.outbox.id), /Only a pending outbox item/);
});

test("only a matching adapter readback can mark a locked cycle applied", () => {
  let now = "2026-09-01T09:00:00.000Z";
  const service = createService(() => now);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");
  now = "2026-09-10T12:00:00.000Z";

  const resolution = service.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-success-readback-15",
    guards: clearGuards,
  });
  if (resolution.outcome !== "ENQUEUED") return assert.fail("expected an outbox item");

  assert.equal(service.claimOutbox(resolution.outbox.id).status, "APPLYING");
  const completed = service.confirmOutboxReadback(
    resolution.outbox.id,
    greenIrishTweed,
    "adapter-receipt-success",
  );

  assert.equal(completed.status, "APPLIED");
  assert.equal(
    service.getSlot("binding-101", "appstle:delivery:2026-09-15")?.state,
    "APPLIED",
  );
});

test("missing published FOTM and reused idempotency keys fail closed", () => {
  const service = createService("2026-09-11T12:00:00.000Z");
  const first = service.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-no-fotm-15",
    guards: clearGuards,
  });
  assert.equal(first.outcome, "NEEDS_ATTENTION");
  if (first.outcome !== "NEEDS_ATTENTION") return assert.fail("expected attention");
  assert.equal(first.reason, "FOTM_NOT_PUBLISHED");

  const scheduled = createService("2026-09-01T09:00:00.000Z");
  scheduled.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  scheduled.publishFotm("2026-09");
  const replayClock = "2026-09-10T12:00:00.000Z";
  // This deliberately reuses the service's deterministic clock through a new
  // instance rather than trusting a caller-supplied timestamp.
  const atCutoff = createScheduledService(replayClock);
  const resolution = atCutoff.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-idempotent-15",
    guards: clearGuards,
  });
  if (resolution.outcome !== "ENQUEUED") return assert.fail("expected an outbox item");

  const replay = atCutoff.resolveDeliveryCycle({
    bindingId: "binding-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    idempotencyKey: "resolve-idempotent-15",
    guards: clearGuards,
  });
  assert.equal(replay.outcome, "ENQUEUED");
  if (replay.outcome !== "ENQUEUED") return assert.fail("expected replay");
  assert.equal(replay.outbox.id, resolution.outbox.id);

  assert.throws(
    () =>
      atCutoff.resolveDeliveryCycle({
        bindingId: "binding-101",
        cycleKey: "appstle:delivery:2026-09-22",
        shipMonth: "2026-09",
        idempotencyKey: "resolve-idempotent-15",
        guards: clearGuards,
      }),
    QueueIdempotencyConflictError,
  );
});

test("customer writes are blocked at a published merchant cutoff", () => {
  let now = "2026-09-01T09:00:00.000Z";
  const service = createService(() => now);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");
  now = "2026-09-10T12:00:00.000Z";

  assert.throws(
    () =>
      service.setCustomerSelection({
        bindingId: "binding-101",
        cycleKey: "appstle:delivery:2026-09-15",
        shipMonth: "2026-09",
        expectedRevision: 0,
        variantId: aventus,
      }),
    QueueCutoffError,
  );
});

function createService(clock: string | (() => string)): InMemoryQueueService {
  const options: QueueServiceOptions = {
    clock: () => new Date(typeof clock === "string" ? clock : clock()),
  };
  const service = new InMemoryQueueService(options);
  service.createContractBinding({
    id: "binding-101",
    adapterOwner: "APPSTLE",
    canonicalContractId: contractId,
    adapterContractRef: "appstle-contract-101",
    customerId,
    subscriptionLineId: lineId,
    status: "ACTIVE",
    nextBillingAt: "2026-09-15T12:00:00.000Z",
    verifiedAt: "2026-09-01T09:00:00.000Z",
  });
  return service;
}

function createScheduledService(now: string): InMemoryQueueService {
  let clock = "2026-09-01T09:00:00.000Z";
  const service = createService(() => clock);
  service.scheduleFotm({
    shipMonth: "2026-09",
    variantId: greenIrishTweed,
    merchantTimezone: "America/New_York",
    cutoffAt: "2026-09-10T12:00:00.000Z",
  });
  service.publishFotm("2026-09");
  clock = now;
  return service;
}
