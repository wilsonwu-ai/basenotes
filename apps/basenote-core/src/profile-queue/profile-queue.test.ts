import assert from "node:assert/strict";
import test from "node:test";

import {
  FUTURE_ADD_ON_UNIT_PRICE_CENTS,
  MAX_FUTURE_ADD_ONS_PER_CYCLE,
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  parseProfileQueueApiRequest,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import {
  InMemoryProfileQueueRepository,
  ProfileQueueRepositoryIdempotencyConflictError,
} from "./repository.js";
import {
  ProfileQueueCapacityError,
  ProfileQueueCutoffError,
  ProfileQueueLockedError,
  applyProfileQueueMutation,
  publishProfileQueueFotm,
  resolveProfileQueueAtCutoff,
} from "./service.js";
import { renderProfileQueueDropdown } from "./ui.js";

const timestamp = "2026-09-01T09:00:00.000Z";
const beforeCutoff = "2026-09-09T23:59:00.000Z";
const cutoff = "2026-09-10T04:01:00.000Z";
const fotmVariant = "gid://shopify/ProductVariant/401";

test("a future shipment retains automatic FOTM plus exactly four independently-priced add-ons", () => {
  let cycle = createCycle();
  cycle = publishProfileQueueFotm(cycle, {
    cutoffAt: cutoff,
    merchantTimezone: "America/New_York",
    occurredAt: timestamp,
    variantId: fotmVariant,
  });

  for (let index = 1; index <= MAX_FUTURE_ADD_ONS_PER_CYCLE; index += 1) {
    cycle = applyProfileQueueMutation(cycle, {
      expectedRevision: cycle.revision,
      mutation: {
        addOnId: `pqa_addon00${index}`,
        kind: "ADD_ADD_ON",
        variantId: `gid://shopify/ProductVariant/${500 + index}`,
      },
      occurredAt: beforeCutoff,
    });
  }

  assert.equal(cycle.fotm.status, "PUBLISHED");
  assert.equal(cycle.fotm.variantId, fotmVariant);
  assert.equal(cycle.addOns.length, 4);
  assert.deepEqual(cycle.addOns.map((addOn) => addOn.position), [1, 2, 3, 4]);
  assert.deepEqual(
    cycle.addOns.map((addOn) => addOn.unitPriceCents),
    [FUTURE_ADD_ON_UNIT_PRICE_CENTS, FUTURE_ADD_ON_UNIT_PRICE_CENTS, FUTURE_ADD_ON_UNIT_PRICE_CENTS, FUTURE_ADD_ON_UNIT_PRICE_CENTS],
  );

  assert.throws(
    () => applyProfileQueueMutation(cycle, {
      expectedRevision: cycle.revision,
      mutation: {
        addOnId: "pqa_addon005",
        kind: "ADD_ADD_ON",
        variantId: "gid://shopify/ProductVariant/505",
      },
      occurredAt: beforeCutoff,
    }),
    ProfileQueueCapacityError,
  );
});

test("changing and removing an add-on keeps FOTM isolated and positions contiguous", () => {
  let cycle = createCycle();
  cycle = applyProfileQueueMutation(cycle, {
    expectedRevision: 0,
    mutation: {
      addOnId: "pqa_addon001",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/501",
    },
    occurredAt: timestamp,
  });
  cycle = applyProfileQueueMutation(cycle, {
    expectedRevision: 1,
    mutation: {
      addOnId: "pqa_addon002",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/502",
    },
    occurredAt: timestamp,
  });
  cycle = applyProfileQueueMutation(cycle, {
    expectedRevision: 2,
    mutation: {
      addOnId: "pqa_addon001",
      kind: "CHANGE_ADD_ON",
      variantId: "gid://shopify/ProductVariant/503",
    },
    occurredAt: timestamp,
  });
  cycle = applyProfileQueueMutation(cycle, {
    expectedRevision: 3,
    mutation: { addOnId: "pqa_addon001", kind: "REMOVE_ADD_ON" },
    occurredAt: timestamp,
  });

  assert.equal(cycle.fotm.status, "UNPUBLISHED");
  assert.equal(cycle.addOns.length, 1);
  assert.equal(cycle.addOns[0]?.id, "pqa_addon002");
  assert.equal(cycle.addOns[0]?.position, 1);
  assert.equal(cycle.addOns[0]?.unitPriceCents, 1_800);
});

test("FOTM cutoff locks the whole future shipment without invoking an adapter", () => {
  let cycle = createCycle();
  cycle = publishProfileQueueFotm(cycle, {
    cutoffAt: cutoff,
    merchantTimezone: "America/New_York",
    occurredAt: timestamp,
    variantId: fotmVariant,
  });

  assert.throws(
    () => applyProfileQueueMutation(cycle, {
      expectedRevision: cycle.revision,
      mutation: {
        addOnId: "pqa_addon001",
        kind: "ADD_ADD_ON",
        variantId: "gid://shopify/ProductVariant/501",
      },
      occurredAt: cutoff,
    }),
    ProfileQueueCutoffError,
  );

  const locked = resolveProfileQueueAtCutoff(cycle, cutoff);
  assert.equal(locked.state, "LOCKED");
  assert.equal(locked.fotm.status, "RESOLVED");
  assert.throws(
    () => applyProfileQueueMutation(locked, {
      expectedRevision: locked.revision,
      mutation: {
        addOnId: "pqa_addon001",
        kind: "ADD_ADD_ON",
        variantId: "gid://shopify/ProductVariant/501",
      },
      occurredAt: "2026-09-10T04:02:00.000Z",
    }),
    ProfileQueueLockedError,
  );
});

test("repository compare-and-swap keeps queue mutations and audits immutable", async () => {
  const repository = new InMemoryProfileQueueRepository();
  const initial = createCycle();
  const created = await repository.persist({
    audit: auditFor(initial, null, "CREATE_CYCLE", "pqm_create001", "pqk_create001"),
    cycle: initial,
    expectedRevision: null,
  });
  const replay = await repository.persist({
    audit: auditFor(initial, null, "CREATE_CYCLE", "pqm_create001", "pqk_create001"),
    cycle: initial,
    expectedRevision: null,
  });
  assert.equal(created.cycle.revision, 0);
  assert.equal(replay.audit.mutationId, "pqm_create001");

  const changed = applyProfileQueueMutation(initial, {
    expectedRevision: 0,
    mutation: {
      addOnId: "pqa_addon001",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/501",
    },
    occurredAt: timestamp,
  });
  await repository.persist({
    audit: auditFor(changed, 0, "ADD_ADD_ON", "pqm_addon001", "pqk_addon001"),
    cycle: changed,
    expectedRevision: 0,
  });

  await assert.rejects(
    repository.persist({
      audit: auditFor(changed, 0, "REMOVE_ADD_ON", "pqm_other001", "pqk_addon001"),
      cycle: changed,
      expectedRevision: 0,
    }),
    ProfileQueueRepositoryIdempotencyConflictError,
  );
});

test("staging dropdown is quick, price-explicit, escaped, and has no submit endpoint", () => {
  const markup = renderProfileQueueDropdown({
    availableFragrances: [{ label: "Aventus <script>", variantId: "gid://shopify/ProductVariant/501" }],
    cycle: createCycle(),
  });
  assert.match(markup, /<select id="bn-profile-queue-fragrance"/);
  assert.match(markup, /Add for \$18\.00/);
  assert.match(markup, /up to 4 extra fragrances/);
  assert.match(markup, /Aventus &lt;script&gt;/);
  assert.doesNotMatch(markup, /<form\b/i);
  assert.doesNotMatch(markup, /https?:\/\//i);
});

test("profile queue API parser rejects a browser-selected binding ID", () => {
  const parsed = parseProfileQueueApiRequest({
    cycleKey: "appstle:delivery:2026-09-15",
    expectedRevision: 0,
    idempotencyKey: "pqk_request001",
    mutation: {
      addOnId: "pqa_addon001",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/501",
    },
    shipMonth: "2026-09",
  });
  assert.equal(parsed.mutation.kind, "ADD_ADD_ON");
  assert.equal(parsed.cycleKey, "appstle:delivery:2026-09-15");

  assert.throws(
    () => parseProfileQueueApiRequest({
      bindingId: "binding-another-customer",
      cycleKey: "appstle:delivery:2026-09-15",
      expectedRevision: 0,
      idempotencyKey: "pqk_request001",
      mutation: { addOnId: "pqa_addon001", kind: "REMOVE_ADD_ON" },
      shipMonth: "2026-09",
    }),
    /must not supply a contract binding ID/,
  );
});

function createCycle() {
  return createEmptyProfileQueueCycle({
    bindingId: "binding-profile-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    updatedAt: timestamp,
  });
}

function auditFor(
  cycle: ReturnType<typeof createCycle>,
  expectedRevision: number | null,
  mutationKind: ProfileQueueMutationAuditRecord["mutationKind"],
  mutationId: string,
  idempotencyKey: string,
): ProfileQueueMutationAuditRecord {
  return {
    actorRef: asProfileQueueActorRef("profile_101"),
    bindingId: cycle.bindingId,
    cycleKey: cycle.cycleKey,
    expectedRevision,
    idempotencyKey: idempotencyKey as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: mutationId as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind,
    occurredAt: cycle.updatedAt,
    resultingRevision: cycle.revision,
  };
}
