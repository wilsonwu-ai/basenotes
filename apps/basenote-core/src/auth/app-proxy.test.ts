import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  AppProxyVerificationError,
  verifyAppProxyRequest,
  type VerifyAppProxyRequestInput,
} from "./app-proxy.js";

const TEST_HMAC_KEY = "unit-test-app-proxy-key";
const NOW = 1_800_000_000;
const SHOP = "base-note.myshopify.com";

test("verifies a signed request before deriving the customer identity", () => {
  const rawQuery = signedQuery(
    "extra=one&extra=two&shop=base-note.myshopify.com&logged_in_customer_id=42&path_prefix=%2Fapps%2Fbasenote&timestamp=1800000000",
  );

  const verified = verify(rawQuery);

  assert.deepEqual(verified, {
    customer: { shopifyCustomerId: "42" },
    shop: SHOP,
    timestamp: NOW,
  });
});

test("rejects a tampered customer ID even though the query otherwise looks valid", () => {
  const rawQuery = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&path_prefix=%2Fapps%2Fbasenote&timestamp=1800000000",
  ).replace("logged_in_customer_id=42", "logged_in_customer_id=43");

  assertVerificationError(() => verify(rawQuery), "invalid_signature");
});

test("supports a signed anonymous proxy request but rejects it for a customer-only route", () => {
  const rawQuery = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=&path_prefix=%2Fapps%2Fbasenote&timestamp=1800000000",
  );

  assert.equal(verify(rawQuery).customer, null);
  assertVerificationError(
    () => verify(rawQuery, { requireLoggedInCustomer: true }),
    "unauthenticated_customer",
  );
});

test("rejects missing or repeated signed identity parameters", () => {
  const missingCustomer = signedQuery(
    "shop=base-note.myshopify.com&path_prefix=%2Fapps%2Fbasenote&timestamp=1800000000",
  );
  const repeatedShop = signedQuery(
    "shop=base-note.myshopify.com&shop=other-shop.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
  );

  assertVerificationError(() => verify(missingCustomer), "missing_identity");
  assertVerificationError(() => verify(repeatedShop), "malformed_identity");
});

test("rejects duplicate, encoded, and non-hex signature values", () => {
  const valid = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
  );
  const signature = getSignature(valid);

  assertVerificationError(() => verify(`${valid}&signature=${signature}`), "malformed_signature");
  assertVerificationError(
    () => verify(valid.replace("signature=", "signature=%")),
    "malformed_signature",
  );
  assertVerificationError(
    () => verify(valid.replace(signature, "not-a-sha256-signature")),
    "malformed_signature",
  );
});

test("rejects malformed percent encoding before calculating a signature", () => {
  const rawQuery = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
  ).replace("shop=base-note", "shop=%ZZbase-note");

  assertVerificationError(() => verify(rawQuery), "malformed_query");
});

test("rejects stale and implausibly future signed timestamps", () => {
  const stale = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&timestamp=1799999699",
  );
  const future = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&timestamp=1800000031",
  );

  assertVerificationError(() => verify(stale), "stale_timestamp");
  assertVerificationError(() => verify(future), "future_timestamp");
});

test("can bind a verified proxy request to the intended shop", () => {
  const rawQuery = signedQuery(
    "shop=base-note.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
  );

  assertVerificationError(() => verify(rawQuery, { expectedShop: "other-shop.myshopify.com" }), "shop_mismatch");
});

function verify(
  rawQuery: string,
  overrides: Partial<Omit<VerifyAppProxyRequestInput, "rawQuery" | "sharedSecret">> = {},
) {
  return verifyAppProxyRequest({
    maxAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    nowSeconds: NOW,
    rawQuery,
    sharedSecret: TEST_HMAC_KEY,
    ...overrides,
  });
}

function signedQuery(unsignedQuery: string): string {
  const canonical = canonicalize(unsignedQuery);
  const signature = createHmac("sha256", TEST_HMAC_KEY).update(canonical, "utf8").digest("hex");
  return `${unsignedQuery}&signature=${signature}`;
}

function canonicalize(rawQuery: string): string {
  const grouped = new Map<string, string[]>();
  for (const segment of rawQuery.split("&")) {
    const separator = segment.indexOf("=");
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? "" : segment.slice(separator + 1);
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    const values = grouped.get(key);
    if (values === undefined) grouped.set(key, [value]);
    else values.push(value);
  }

  return [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}

function getSignature(rawQuery: string): string {
  const signature = rawQuery.split("&").find((parameter) => parameter.startsWith("signature="));
  assert.ok(signature !== undefined);
  return signature.slice("signature=".length);
}

function assertVerificationError(
  operation: () => unknown,
  expectedCode: AppProxyVerificationError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    return error instanceof AppProxyVerificationError && error.code === expectedCode;
  });
}
