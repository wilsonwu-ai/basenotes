import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  StagingAdminIdTokenNotConfiguredError,
  StagingAdminIdTokenRejectedError,
  StagingAdminStaffDeniedError,
} from "./boundaries.js";
import { WebCryptoShopifyAdminIdTokenVerifier } from "./webcrypto-shopify-admin-id-token.js";
import type { StagingWorkerEnv } from "./contracts.js";

const nowSeconds = 1_788_264_000;
const clientId = "staging_client_123";
const clientSecret = "unit-test-shopify-admin-client-secret";
const shopDomain = "base-note-subscription-staging.myshopify.com";

test("verifies a fresh exact-shop Shopify Admin HS256 ID token and derives only opaque scheduler identity", async () => {
  const verifier = createVerifier();
  const identity = await verifier.verify({
    environment: stagingEnvironment(),
    request: bearerRequest(signToken()),
  });

  assert.deepEqual(identity, { actorRef: "staff_42" });
  assert.doesNotMatch(JSON.stringify(identity), /client-secret/i);
});

test("rejects missing, malformed, invalid-HMAC, stale, not-yet-valid, wrong-audience, and wrong-shop tokens", async () => {
  const verifier = createVerifier();
  const scenarios: readonly [string, Request][] = [
    ["missing", new Request("https://scheduler-staging.example/api/admin/fotm-schedules")],
    ["malformed", bearerRequest("not-a-jwt")],
    ["tampered signature", bearerRequest(tamperSignature(signToken()))],
    ["expired", bearerRequest(signToken({ exp: nowSeconds, iat: nowSeconds - 60, nbf: nowSeconds - 60 }))],
    ["not before", bearerRequest(signToken({ nbf: nowSeconds + 1 }))],
    ["stale issued", bearerRequest(signToken({ exp: nowSeconds + 60, iat: nowSeconds - 91, nbf: nowSeconds - 91 }))],
    ["wrong audience", bearerRequest(signToken({ aud: "other_client_123" }))],
    ["wrong destination", bearerRequest(signToken({ dest: "https://other-staging.myshopify.com" }))],
    ["non-default destination port", bearerRequest(signToken({ dest: `https://${shopDomain}:444` }))],
    ["issuer destination mismatch", bearerRequest(signToken({ iss: `https://${shopDomain}/not-admin` }))],
    ["nonzero prefix", bearerRequest(signToken({ sub: "042" }))],
  ];

  for (const [label, request] of scenarios) {
    await assert.rejects(
      verifier.verify({ environment: stagingEnvironment(), request }),
      StagingAdminIdTokenRejectedError,
      label,
    );
  }
});

test("rejects an authenticated Shopify staff subject outside the exact staging allowlist", async () => {
  await assert.rejects(
    createVerifier().verify({
      environment: stagingEnvironment(),
      request: bearerRequest(signToken({ sub: "43" })),
    }),
    StagingAdminStaffDeniedError,
  );
});

test("fails closed when required staging Admin runtime configuration is absent or placeholder-shaped", async () => {
  await assert.rejects(
    createVerifier().verify({
      environment: { ...stagingEnvironment(), SHOPIFY_ADMIN_CLIENT_SECRET: undefined },
      request: bearerRequest(signToken()),
    }),
    StagingAdminIdTokenNotConfiguredError,
  );
  await assert.rejects(
    createVerifier().verify({
      environment: { ...stagingEnvironment(), STAGING_ADMIN_ALLOWED_STAFF_IDS: "REPLACE_WITH_STAFF_IDS" },
      request: bearerRequest(signToken()),
    }),
    StagingAdminIdTokenNotConfiguredError,
  );
  await assert.rejects(
    createVerifier().verify({
      environment: { ...stagingEnvironment(), STAGING_SHOP_DOMAIN: "basenotescent.myshopify.com" },
      request: bearerRequest(signToken()),
    }),
    StagingAdminIdTokenNotConfiguredError,
  );
});

function createVerifier(): WebCryptoShopifyAdminIdTokenVerifier {
  return new WebCryptoShopifyAdminIdTokenVerifier({ nowSeconds: () => nowSeconds });
}

function stagingEnvironment(): StagingWorkerEnv {
  return {
    BASENOTE_RUNTIME_STAGE: "staging",
    SHOPIFY_ADMIN_CLIENT_ID: clientId,
    SHOPIFY_ADMIN_CLIENT_SECRET: clientSecret,
    STAGING_ADMIN_ALLOWED_STAFF_IDS: "42,99",
    STAGING_SHOP_DOMAIN: shopDomain,
  };
}

function bearerRequest(token: string): Request {
  return new Request("https://scheduler-staging.example/api/admin/fotm-schedules", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function signToken(overrides: Partial<Record<"aud" | "dest" | "exp" | "iat" | "iss" | "jti" | "nbf" | "sub", string | number>> = {}): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: clientId,
    dest: `https://${shopDomain}`,
    exp: nowSeconds + 60,
    iat: nowSeconds - 1,
    iss: `https://${shopDomain}/admin`,
    jti: "f8912129-1af6-4cad-9ca3-76b0f7621087",
    nbf: nowSeconds - 1,
    sub: "42",
    ...overrides,
  });
  const signature = createHmac("sha256", clientSecret).update(`${header}.${payload}`, "utf8").digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function encode(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function tamperSignature(token: string): string {
  const last = token.at(-1);
  if (!last) throw new Error("Expected a token to tamper with.");
  return `${token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}
