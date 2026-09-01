import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryConsentLedger,
  type ConsentAppendResult,
  type SuppressionReleaseInput,
} from "./consent.js";
import {
  asIsoTimestamp,
  asMessagingEventId,
  asMessagingProfileId,
  type ConsentRecord,
} from "./contracts.js";

const PROFILE_ID = asMessagingProfileId("profile_customer_001");

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    profileId: PROFILE_ID,
    channel: "EMAIL",
    eventId: asMessagingEventId("evt_consent_000001"),
    occurredAt: asIsoTimestamp("2026-09-01T12:00:00Z"),
    source: "BASE_NOTE_FORM",
    state: "SUBSCRIBED",
    legalTextVersion: "marketing-v1",
    ...overrides,
  };
}

function release(overrides: Partial<SuppressionReleaseInput> = {}): SuppressionReleaseInput {
  return {
    profileId: PROFILE_ID,
    channel: "EMAIL",
    eventId: asMessagingEventId("evt_release_000001"),
    occurredAt: asIsoTimestamp("2026-09-03T12:00:00Z"),
    reviewReference: "review_case_000001",
    ...overrides,
  };
}

function applied(result: ConsentAppendResult): void {
  assert.equal(result.outcome, "APPLIED");
}

test("records immutable consent events and derives the latest causal snapshot", () => {
  const ledger = new InMemoryConsentLedger();
  const first = record();
  applied(ledger.record(first));

  const unsubscribe = record({
    eventId: asMessagingEventId("evt_consent_000002"),
    occurredAt: asIsoTimestamp("2026-09-02T12:00:00Z"),
    source: "CUSTOMER_UNSUBSCRIBE",
    state: "UNSUBSCRIBED",
    legalTextVersion: null,
  });
  applied(ledger.record(unsubscribe));

  assert.deepEqual(ledger.getSnapshot(PROFILE_ID), {
    profileId: PROFILE_ID,
    channel: "EMAIL",
    current: unsubscribe,
  });

  const history = ledger.listEvents(PROFILE_ID);
  assert.equal(history.length, 2);
  assert.throws(() => {
    (history[0] as { record: { state: string } }).record.state = "SUBSCRIBED";
  }, TypeError);
  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.state, "UNSUBSCRIBED");
});

test("same event ID is idempotent only when its immutable payload matches exactly", () => {
  const ledger = new InMemoryConsentLedger();
  const first = record();
  applied(ledger.record(first));

  assert.equal(ledger.record({ ...first }).outcome, "IDEMPOTENT");
  assert.deepEqual(
    ledger.record({
      ...first,
      source: "SHOPIFY",
      state: "UNKNOWN",
      legalTextVersion: null,
    }),
    {
      outcome: "REJECTED",
      reason: "event_id_conflict",
      snapshot: {
        profileId: PROFILE_ID,
        channel: "EMAIL",
        current: first,
      },
    },
  );
  assert.equal(ledger.listEvents(PROFILE_ID).length, 1);
});

test("hard bounces and spam complaints are monotonic suppressions until explicit review release", () => {
  const ledger = new InMemoryConsentLedger();
  const bounce = record({
    eventId: asMessagingEventId("evt_bounce_000001"),
    occurredAt: asIsoTimestamp("2026-09-02T12:00:00Z"),
    source: "HARD_BOUNCE",
    state: "SUPPRESSED",
    legalTextVersion: null,
  });
  applied(ledger.record(bounce));

  const attemptedOptIn = record({
    eventId: asMessagingEventId("evt_optin_000001"),
    occurredAt: asIsoTimestamp("2026-09-03T12:00:00Z"),
  });
  const blocked = ledger.record(attemptedOptIn);
  assert.equal(blocked.outcome, "BLOCKED_BY_SUPPRESSION");
  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.state, "SUPPRESSED");

  applied(ledger.releaseSuppression(release()));
  assert.deepEqual(ledger.getSnapshot(PROFILE_ID), {
    profileId: PROFILE_ID,
    channel: "EMAIL",
    current: {
      profileId: PROFILE_ID,
      channel: "EMAIL",
      eventId: asMessagingEventId("evt_release_000001"),
      occurredAt: asIsoTimestamp("2026-09-03T12:00:00Z"),
      source: "MERCHANT_REVIEW",
      state: "UNSUBSCRIBED",
      legalTextVersion: null,
    },
  });

  const freshOptIn = record({
    eventId: asMessagingEventId("evt_optin_000002"),
    occurredAt: asIsoTimestamp("2026-09-04T12:00:00Z"),
  });
  applied(ledger.record(freshOptIn));
  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.state, "SUBSCRIBED");

  const complaint = record({
    eventId: asMessagingEventId("evt_spam_00000001"),
    occurredAt: asIsoTimestamp("2026-09-05T12:00:00Z"),
    source: "SPAM_COMPLAINT",
    state: "SUPPRESSED",
    legalTextVersion: null,
  });
  applied(ledger.record(complaint));
  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.source, "SPAM_COMPLAINT");
});

test("late historical events do not overwrite newer state, while chronology is still preserved", () => {
  const ledger = new InMemoryConsentLedger();
  const unsubscribe = record({
    eventId: asMessagingEventId("evt_late_00000002"),
    occurredAt: asIsoTimestamp("2026-09-05T12:00:00Z"),
    source: "CUSTOMER_UNSUBSCRIBE",
    state: "UNSUBSCRIBED",
    legalTextVersion: null,
  });
  applied(ledger.record(unsubscribe));

  const earlierOptIn = record({
    eventId: asMessagingEventId("evt_late_00000001"),
    occurredAt: asIsoTimestamp("2026-09-01T12:00:00Z"),
  });
  applied(ledger.record(earlierOptIn));

  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.eventId, unsubscribe.eventId);
  assert.deepEqual(
    ledger.listEvents(PROFILE_ID).map((event) => event.record.eventId),
    [earlierOptIn.eventId, unsubscribe.eventId],
  );
});

test("same-timestamp conflicts resolve toward the safer state", () => {
  const ledger = new InMemoryConsentLedger();
  const optIn = record({ eventId: asMessagingEventId("evt_tie_000000001") });
  const unsubscribe = record({
    eventId: asMessagingEventId("evt_tie_000000002"),
    source: "CUSTOMER_UNSUBSCRIBE",
    state: "UNSUBSCRIBED",
    legalTextVersion: null,
  });
  applied(ledger.record(unsubscribe));
  applied(ledger.record(optIn));

  assert.equal(ledger.getSnapshot(PROFILE_ID)?.current.state, "UNSUBSCRIBED");
});

test("malformed input, email-like profile IDs, and invalid source-state pairs fail without mutation", () => {
  const ledger = new InMemoryConsentLedger();
  const invalidProfile = {
    ...record(),
    profileId: "person@example.test",
  };
  assert.deepEqual(ledger.record(invalidProfile), {
    outcome: "REJECTED",
    reason: "invalid_profile_id",
    snapshot: null,
  });
  assert.deepEqual(
    ledger.record({
      ...record(),
      source: "HARD_BOUNCE",
      state: "SUBSCRIBED",
    }),
    {
      outcome: "REJECTED",
      reason: "invalid_source_state",
      snapshot: null,
    },
  );
  assert.deepEqual(
    ledger.record({
      ...record(),
      occurredAt: "2026-02-30T12:00:00Z",
    }),
    {
      outcome: "REJECTED",
      reason: "invalid_timestamp",
      snapshot: null,
    },
  );
  assert.deepEqual(ledger.releaseSuppression(release()), {
    outcome: "REJECTED",
    reason: "release_requires_active_suppression",
    snapshot: null,
  });
  assert.deepEqual(ledger.listEvents(PROFILE_ID), []);
});

test("merchant review cannot be smuggled through the ordinary event API", () => {
  const ledger = new InMemoryConsentLedger();
  assert.deepEqual(
    ledger.record(
      record({
        source: "MERCHANT_REVIEW",
        state: "SUBSCRIBED",
      }),
    ),
    {
      outcome: "REJECTED",
      reason: "merchant_review_requires_release_path",
      snapshot: null,
    },
  );
});
