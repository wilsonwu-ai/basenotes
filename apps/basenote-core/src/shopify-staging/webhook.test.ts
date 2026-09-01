import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  ShopifyWebhookVerificationError,
  verifyRawBodyHmac,
  verifyShopifyWebhook,
} from "./webhook.js";

const SECRET = "staging-only-unit-test-client-secret";
const SHOP = "basenote-staging.myshopify.com";
const BODY = Buffer.from('{"id":42,"note":"raw bytes stay raw"}', "utf8");

test("verifies a valid Shopify webhook before exposing metadata", () => {
  const verified = verifyShopifyWebhook({
    appClientSecret: SECRET,
    deliveryIdHeader: "123e4567-e89b-12d3-a456-426614174000",
    expectedShop: SHOP,
    hmacHeader: hmac(BODY),
    rawBody: BODY,
    shopHeader: SHOP,
    topicHeader: "app/uninstalled",
  });

  assert.deepEqual(verified, {
    deliveryId: "123e4567-e89b-12d3-a456-426614174000",
    shop: SHOP,
    topic: "app/uninstalled",
  });
});

test("rejects a tampered body and does not accept matching-looking metadata", () => {
  const tampered = Buffer.from('{"id":43,"note":"raw bytes stay raw"}', "utf8");

  assertVerificationError(
    () => verifyShopifyWebhook({
      appClientSecret: SECRET,
      deliveryIdHeader: "123e4567-e89b-12d3-a456-426614174000",
      expectedShop: SHOP,
      hmacHeader: hmac(BODY),
      rawBody: tampered,
      shopHeader: SHOP,
      topicHeader: "app/uninstalled",
    }),
    "invalid_hmac",
  );
});

test("rejects malformed or unequal HMAC values without throwing a timing-comparison length error", () => {
  assertVerificationError(() => verifyRawBodyHmac(BODY, "not-base64", SECRET), "malformed_hmac");
  assertVerificationError(() => verifyRawBodyHmac(BODY, "YQ==", SECRET), "malformed_hmac");
  assertVerificationError(
    () => verifyRawBodyHmac(BODY, hmac(Buffer.from("different", "utf8")), SECRET),
    "invalid_hmac",
  );
});

test("rejects a valid webhook for a different development store", () => {
  assertVerificationError(
    () => verifyShopifyWebhook({
      appClientSecret: SECRET,
      deliveryIdHeader: "123e4567-e89b-12d3-a456-426614174000",
      expectedShop: SHOP,
      hmacHeader: hmac(BODY),
      rawBody: BODY,
      shopHeader: "another-test-store.myshopify.com",
      topicHeader: "app/uninstalled",
    }),
    "shop_mismatch",
  );
});

function hmac(value: Uint8Array): string {
  return createHmac("sha256", SECRET).update(value).digest("base64");
}

function assertVerificationError(
  operation: () => unknown,
  expectedCode: ShopifyWebhookVerificationError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    return error instanceof ShopifyWebhookVerificationError && error.code === expectedCode;
  });
}
