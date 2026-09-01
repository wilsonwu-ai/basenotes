import assert from "node:assert/strict";
import test from "node:test";

import { readLocalConfig } from "./config.js";

test("local mode only accepts loopback configuration", () => {
  assert.deepEqual(
    readLocalConfig({ BASENOTE_APP_MODE: "local", HOST: "127.0.0.1", PORT: "3100" }),
    { host: "127.0.0.1", mode: "local", port: 3100 },
  );

  assert.throws(
    () => readLocalConfig({ BASENOTE_APP_MODE: "production" }),
    /intentionally local-only/,
  );
  assert.throws(() => readLocalConfig({ HOST: "0.0.0.0" }), /loopback HOST/);
});

test("local mode refuses credential-like environment variables", () => {
  assert.throws(
    () => readLocalConfig({ SHOPIFY_API_SECRET: "not-a-real-secret" }),
    /Refusing local startup/,
  );
  assert.throws(
    () => readLocalConfig({ BASENOTE_MAILGUN_API_KEY: "not-a-real-secret" }),
    /Refusing local startup/,
  );
});
