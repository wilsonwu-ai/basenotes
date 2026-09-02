import assert from "node:assert/strict";
import test from "node:test";

import { DomainValidationError, asProductVariantId } from "./ids.js";
import { resolveShipment, upsertQueueSlot } from "./queue.js";

const contractA = "gid://shopify/SubscriptionContract/101";
const contractB = "gid://shopify/SubscriptionContract/202";
const aventus = "gid://shopify/ProductVariant/301";
const greenIrishTweed = "gid://shopify/ProductVariant/302";

test("queue slots remain scoped to their explicit subscription contract", () => {
  const first = upsertQueueSlot([], {
    contractId: contractA,
    productTitle: "Aventus",
    shipMonth: "2026-09",
    variantId: aventus,
  });

  assert.throws(
    () =>
      upsertQueueSlot(first, {
        contractId: contractB,
        productTitle: "Green Irish Tweed",
        shipMonth: "2026-10",
        variantId: greenIrishTweed,
      }),
    /isolated to one subscription contract/,
  );
});

test("a new queue slot rejects ambiguous non-variant identifiers", () => {
  assert.throws(() => asProductVariantId("aventus"), DomainValidationError);
});

test("an empty month resolves explicitly to Fragrance of the Month", () => {
  const selection = resolveShipment(
    [],
    contractA,
    "2026-09",
    { productTitle: "Green Irish Tweed", variantId: asProductVariantId(greenIrishTweed) },
  );

  assert.deepEqual(selection, {
    source: "fotm",
    fragrance: {
      productTitle: "Green Irish Tweed",
      variantId: greenIrishTweed,
    },
  });
});
