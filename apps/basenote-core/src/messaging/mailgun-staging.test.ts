import assert from "node:assert/strict";
import test from "node:test";

import type { MessageIntent } from "./contracts.js";
import type { RecordedMessagingEvent } from "./events.js";
import {
  MailgunStagingConfigurationError,
  MailgunStagingDeliveryError,
  MailgunStagingTransport,
  readMailgunStagingTransportConfig,
  type MailgunStagingDeliveryInput,
  type RuntimeEnvironment,
} from "./mailgun-staging.js";

const EVENT = {
  attributes: { source_ref: "fixture_101" },
  eventId: "evt_subscription_created_101",
  idempotencyKey: "event-subscription-created-101",
  occurredAt: "2026-09-01T12:00:00.000Z",
  profileId: "profile-101",
  recordedAt: "2026-09-01T12:00:01.000Z",
  source: "SHOPIFY_WEBHOOK",
  type: "SUBSCRIPTION_CREATED",
} as unknown as RecordedMessagingEvent;

const OUTBOX = {
  createdAt: "2026-09-01T12:00:02.000Z",
  eventId: EVENT.eventId,
  id: "msg_subscription_created_101",
  idempotencyKey: "message-subscription-created-101",
  profileId: EVENT.profileId,
  purpose: "TRANSACTIONAL",
  status: "CLAIMED",
  statusReason: null,
  templateKey: "subscription.created",
  updatedAt: "2026-09-01T12:00:03.000Z",
} as MessageIntent;

const DELIVERY: MailgunStagingDeliveryInput = {
  event: EVENT,
  outbox: OUTBOX,
  recipient: { email: "qa@example.test", profileId: EVENT.profileId },
  rendered: {
    html: "<p>Staging receipt</p>",
    subject: "Base Note staging receipt",
    text: "Staging receipt",
  },
};

test("requires all explicit staging gates before a Mailgun transport configuration exists", () => {
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({ ...stagingEnvironment(), BASENOTE_RUNTIME_STAGE: "production" }),
    "staging_not_enabled",
  );
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({ ...stagingEnvironment(), BASENOTE_MAILGUN_TEST_ONLY: "false" }),
    "staging_not_enabled",
  );
});

test("refuses a hand-built configuration that did not pass explicit runtime gates", () => {
  const approved = readMailgunStagingTransportConfig(stagingEnvironment());
  assert.throws(
    () => new MailgunStagingTransport({ ...approved }),
    (error: unknown) => error instanceof MailgunStagingConfigurationError && error.code === "staging_not_enabled",
  );
});

test("blocks a production-facing application host before Mailgun can be enabled", () => {
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_STAGING_APP_ORIGIN: "https://app.basenotescent.com",
    }),
    "unsafe_staging_origin",
  );
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_STAGING_APP_ORIGIN: "https://basenotescent.com",
    }),
    "unsafe_staging_origin",
  );
});

test("allows only a staging-named temporary Workers.dev application origin", () => {
  const configuration = readMailgunStagingTransportConfig({
    ...stagingEnvironment(),
    BASENOTE_STAGING_APP_ORIGIN: "https://basenote-profile-queue-staging.example-account.workers.dev",
  });
  assert.equal(
    configuration.stagingAppOrigin,
    "https://basenote-profile-queue-staging.example-account.workers.dev",
  );

  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_STAGING_APP_ORIGIN: "https://basenote-profile-queue.example-account.workers.dev",
    }),
    "unsafe_staging_origin",
  );
});

test("rejects an unapproved provider endpoint and an absent runtime secret", () => {
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_MAILGUN_API_BASE_URL: "https://mailgun-production.example",
    }),
    "invalid_api_base_url",
  );
  const withoutSecret: RuntimeEnvironment = {
    ...stagingEnvironment(),
    BASENOTE_MAILGUN_API_KEY: undefined,
  };
  assertConfigurationError(
    () => readMailgunStagingTransportConfig(withoutSecret),
    "missing_secret",
  );
});

test("requires a manually reviewed test-recipient allow-list", () => {
  const withoutAllowlist: RuntimeEnvironment = {
    ...stagingEnvironment(),
    BASENOTE_MAILGUN_TEST_RECIPIENTS: undefined,
    BASENOTE_MAILGUN_TEST_RECIPIENT_DOMAINS: undefined,
  };
  assertConfigurationError(
    () => readMailgunStagingTransportConfig(withoutAllowlist),
    "missing_recipient_allowlist",
  );
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_MAILGUN_TEST_RECIPIENT_DOMAINS: "basenotescent.com",
      BASENOTE_MAILGUN_TEST_RECIPIENTS: "",
    }),
    "invalid_recipient_allowlist",
  );
  assertConfigurationError(
    () => readMailgunStagingTransportConfig({
      ...stagingEnvironment(),
      BASENOTE_MAILGUN_TEST_RECIPIENT_DOMAINS: "",
      BASENOTE_MAILGUN_TEST_RECIPIENTS: "subscriber@basenotescent.com",
    }),
    "invalid_recipient_allowlist",
  );
});

test("uses opaque outbox/event identifiers and Mailgun simulation mode for an allowlisted test recipient", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const transport = new MailgunStagingTransport(readMailgunStagingTransportConfig(stagingEnvironment()), {
    fetch: async (input, init) => {
      requestUrl = input.toString();
      requestInit = init;
      return jsonResponse({ id: "<staging-message-101@mailgun.org>", message: "Queued" });
    },
  });

  const result = await transport.deliver(DELIVERY);

  assert.deepEqual(result, {
    deliveryKey: OUTBOX.idempotencyKey,
    mode: "SIMULATE",
    providerMessageId: "<staging-message-101@mailgun.org>",
  });
  assert.equal(requestUrl, "https://api.mailgun.net/v3/sandboxunit-test.mailgun.org/messages");
  assert.equal(requestInit?.method, "POST");
  assert.match(new Headers(requestInit?.headers).get("Authorization") ?? "", /^Basic /);
  const requestBody = requestInit?.body;
  assert.ok(requestBody instanceof FormData);
  const form = requestBody;
  assert.equal(form.get("from"), "postmaster@sandboxunit-test.mailgun.org");
  assert.equal(form.get("to"), "qa@example.test");
  assert.equal(form.get("o:testmode"), "yes");
  assert.equal(form.get("o:tracking"), "no");
  assert.equal(form.get("v:basenote_delivery_key"), OUTBOX.idempotencyKey);
  assert.equal(form.get("v:basenote_event_id"), EVENT.eventId);
  assert.equal(form.get("v:basenote_profile_id"), null);
});

test("does not let a caller widen a parsed recipient allow-list before invoking fetch", async () => {
  let fetchCalls = 0;
  const config = readMailgunStagingTransportConfig(stagingEnvironment());
  // A caller cannot widen a config after it passed the explicit runtime gate:
  // the transport uses an unexposed allow-list snapshot.
  (config.allowedRecipientAddresses as Set<string>).add("tampered@example.test");
  const transport = new MailgunStagingTransport(config, {
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ id: "<should-not-be-used@mailgun.org>" });
    },
  });

  await assert.rejects(
    () => transport.deliver({
      ...DELIVERY,
      recipient: { email: "tampered@example.test", profileId: EVENT.profileId },
    }),
    (error: unknown) => error instanceof MailgunStagingDeliveryError && error.code === "recipient_not_allowlisted",
  );
  assert.equal(fetchCalls, 0);
});

test("requires a claimed outbox and matching opaque event/profile identities before invoking fetch", async () => {
  let fetchCalls = 0;
  const transport = new MailgunStagingTransport(readMailgunStagingTransportConfig(stagingEnvironment()), {
    fetch: async () => {
      fetchCalls += 1;
      return jsonResponse({ id: "<should-not-be-used@mailgun.org>" });
    },
  });

  await assert.rejects(
    () => transport.deliver({ ...DELIVERY, outbox: { ...OUTBOX, status: "PENDING" } }),
    (error: unknown) => error instanceof MailgunStagingDeliveryError && error.code === "outbox_not_claimed",
  );
  await assert.rejects(
    () => transport.deliver({ ...DELIVERY, outbox: { ...OUTBOX, eventId: null } }),
    (error: unknown) => error instanceof MailgunStagingDeliveryError && error.code === "event_mismatch",
  );
  await assert.rejects(
    () => transport.deliver({
      ...DELIVERY,
      recipient: { ...DELIVERY.recipient, profileId: "profile-202" },
    }),
    (error: unknown) => error instanceof MailgunStagingDeliveryError && error.code === "profile_mismatch",
  );
  assert.equal(fetchCalls, 0);
});

test("allowlisted delivery is explicit and omits Mailgun simulation mode", async () => {
  const sentForms: FormData[] = [];
  const transport = new MailgunStagingTransport(readMailgunStagingTransportConfig({
    ...stagingEnvironment(),
    BASENOTE_MAILGUN_TEST_DELIVERY_MODE: "ALLOWLISTED_DELIVERY",
  }), {
    fetch: async (_input, init) => {
      const body = init?.body;
      assert.ok(body instanceof FormData);
      sentForms.push(body);
      return jsonResponse({ id: "<staging-delivery-202@mailgun.org>" });
    },
  });

  const result = await transport.deliver(DELIVERY);

  assert.equal(result.mode, "ALLOWLISTED_DELIVERY");
  assert.equal(sentForms.length, 1);
  const sentForm = sentForms[0];
  assert.ok(sentForm);
  assert.equal(sentForm.get("o:testmode"), null);
  assert.equal(sentForm.get("to"), "qa@example.test");
});

test("never exposes a provider rejection response body", async () => {
  const transport = new MailgunStagingTransport(readMailgunStagingTransportConfig(stagingEnvironment()), {
    fetch: async () => new Response("recipient=qa@example.test&provider=details", { status: 403 }),
  });

  await assert.rejects(
    () => transport.deliver(DELIVERY),
    (error: unknown) => {
      if (!(error instanceof MailgunStagingDeliveryError) || error.code !== "provider_rejected") return false;
      return !error.message.includes("qa@example.test") && !error.message.includes("provider=details");
    },
  );
});

function stagingEnvironment(): RuntimeEnvironment {
  return {
    BASENOTE_MAILGUN_API_BASE_URL: "https://api.mailgun.net",
    BASENOTE_MAILGUN_API_KEY: "key-unit-test-secret",
    BASENOTE_MAILGUN_STAGING_ENABLED: "true",
    BASENOTE_MAILGUN_TEST_DELIVERY_MODE: "SIMULATE",
    BASENOTE_MAILGUN_TEST_DOMAIN: "sandboxunit-test.mailgun.org",
    BASENOTE_MAILGUN_TEST_FROM: "postmaster@sandboxunit-test.mailgun.org",
    BASENOTE_MAILGUN_TEST_ONLY: "true",
    BASENOTE_MAILGUN_TEST_RECIPIENTS: "qa@example.test",
    BASENOTE_RUNTIME_STAGE: "staging",
    BASENOTE_STAGING_APP_ORIGIN: "https://app-staging.basenotescent.com",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function assertConfigurationError(
  operation: () => unknown,
  expectedCode: MailgunStagingConfigurationError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    return error instanceof MailgunStagingConfigurationError && error.code === expectedCode;
  });
}
