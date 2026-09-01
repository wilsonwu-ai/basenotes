import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { handleStagingProfileQueueProxy } from "./app-proxy-bridge.js";

const SECRET = "staging-app-proxy-unit-test-secret";
const SHOP = "basenote-staging.myshopify.com";
const NOW = 1_800_000_000;

test("returns static markup only after a valid signed and logged-in App Proxy request", () => {
  const response = handleStagingProfileQueueProxy({
    appProxySharedSecret: SECRET,
    expectedStagingShop: SHOP,
    nowSeconds: NOW,
    rawQuery: signedQuery(
      "shop=basenote-staging.myshopify.com&logged_in_customer_id=42&path_prefix=%2Fapps%2Fbasenote-staging&timestamp=1800000000",
    ),
    relativePath: "/profile-queue",
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /staging-only preview/i);
  assert.doesNotMatch(response.body, /42/);
  assert.doesNotMatch(response.body, /<script|<form|fetch\(/i);
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(response.headers["Content-Security-Policy"] ?? "", /form-action 'none'/);
});

test("returns a generic response for unsigned, mismatched, and anonymous requests", () => {
  const unsigned = handleStagingProfileQueueProxy({
    appProxySharedSecret: SECRET,
    expectedStagingShop: SHOP,
    nowSeconds: NOW,
    rawQuery: "shop=basenote-staging.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
    relativePath: "/profile-queue",
  });
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body, "Unauthorized");

  const anonymous = handleStagingProfileQueueProxy({
    appProxySharedSecret: SECRET,
    expectedStagingShop: SHOP,
    nowSeconds: NOW,
    rawQuery: signedQuery(
      "shop=basenote-staging.myshopify.com&logged_in_customer_id=&timestamp=1800000000",
    ),
    relativePath: "/profile-queue",
  });
  assert.equal(anonymous.status, 401);

  const wrongShop = handleStagingProfileQueueProxy({
    appProxySharedSecret: SECRET,
    expectedStagingShop: SHOP,
    nowSeconds: NOW,
    rawQuery: signedQuery(
      "shop=another-store.myshopify.com&logged_in_customer_id=42&timestamp=1800000000",
    ),
    relativePath: "/profile-queue",
  });
  assert.equal(wrongShop.status, 401);
});

test("does not surface a proxy implementation from any other child route", () => {
  const response = handleStagingProfileQueueProxy({
    appProxySharedSecret: SECRET,
    expectedStagingShop: SHOP,
    nowSeconds: NOW,
    rawQuery: "irrelevant=true",
    relativePath: "/other-route",
  });
  assert.equal(response.status, 404);
});

function signedQuery(unsignedQuery: string): string {
  const canonical = canonicalize(unsignedQuery);
  const signature = createHmac("sha256", SECRET).update(canonical, "utf8").digest("hex");
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
    if (values) values.push(value);
    else grouped.set(key, [value]);
  }
  return [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}
