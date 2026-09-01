import assert from "node:assert/strict";
import test from "node:test";

import {
  asHistoricalBackfillRunId,
  asHistoricalEvidenceRef,
  canonicalizeHistoricalTimestamp,
  toPricingSubscriptionHistory,
  type DurableHistoricalSubscriptionRecord,
} from "./contracts.js";
import {
  HistoricalBackfillRunConflictError,
  HistoricalMemberBackfillImporter,
  InMemoryHistoricalSubscriptionHistoryRepository,
  digestHistoricalBackfillDecisions,
} from "./backfill-importer.js";

const RUN_ONE = "hbr_" + "1".repeat(32);
const RUN_TWO = "hbr_" + "2".repeat(32);
const APPROVAL_ONE = "hba_" + "a".repeat(32);
const APPROVAL_TWO = "hba_" + "b".repeat(32);

test("historical member dry run writes no eligibility history and produces immutable positive-only plan", async () => {
  const repository = new InMemoryHistoricalSubscriptionHistoryRepository();
  const importer = new HistoricalMemberBackfillImporter(repository);
  const dryRun = await importer.createDryRun({
    candidates: [
      candidate("101", evidence("a")),
      candidate("101", evidence("b")),
      candidate("102", evidence("c")),
    ],
    requestedAt: "2026-09-01T09:00:00Z",
    runId: RUN_ONE,
  });

  assert.equal(dryRun.status, "DRY_RUN_COMPLETE");
  assert.equal(dryRun.requestedAt, "2026-09-01T09:00:00.000Z");
  assert.deepEqual(
    dryRun.decisions.map((decision) => decision.disposition),
    ["WILL_RECORD_EVER_SUBSCRIBED", "DUPLICATE_IN_INPUT", "WILL_RECORD_EVER_SUBSCRIBED"],
  );
  assert.equal(await repository.findEverSubscribed("gid://shopify/Customer/101"), null);
  assert.equal(toPricingSubscriptionHistory(null), "unknown");
  assert.equal(repository.listAudit().length, 1);
  assert.equal(repository.listAudit()[0]?.action, "DRY_RUN_COMPLETED");
});

test("approved backfill creates one-way historic evidence and cannot be applied twice", async () => {
  const repository = new InMemoryHistoricalSubscriptionHistoryRepository();
  const importer = new HistoricalMemberBackfillImporter(repository);
  await importer.createDryRun({
    candidates: [candidate("101", evidence("a"))],
    requestedAt: "2026-09-01T09:00:00.000Z",
    runId: RUN_ONE,
  });

  await assert.rejects(
    importer.applyReviewedDryRun(RUN_ONE, {
      approvalRef: APPROVAL_ONE,
      approvedAt: "2026-09-01T08:59:59.999Z",
    }),
    /cannot predate/,
  );

  const records = await importer.applyReviewedDryRun(RUN_ONE, {
    approvalRef: APPROVAL_ONE,
    approvedAt: "2026-09-01T09:05:00Z",
  });
  assert.equal(records.length, 1);
  assert.equal(toPricingSubscriptionHistory(records[0] ?? null), "durably_ever_subscribed");
  assert.equal(repository.listAudit().length, 2);
  assert.equal(repository.listAudit()[1]?.action, "EVER_SUBSCRIBED_RECORDED");

  await assert.rejects(
    importer.applyReviewedDryRun(RUN_ONE, {
      approvalRef: APPROVAL_TWO,
      approvedAt: "2026-09-01T09:06:00.000Z",
    }),
    HistoricalBackfillRunConflictError,
  );

  const original: DurableHistoricalSubscriptionRecord = records[0] as DurableHistoricalSubscriptionRecord;
  const preserved = await repository.recordEverSubscribed({
    ...original,
    evidenceRef: asHistoricalEvidenceRef(
      "merchant-review/sha256/" + "d".repeat(64),
      "MERCHANT_REVIEW",
    ),
    establishedAt: canonicalizeHistoricalTimestamp("2026-09-02T09:00:00.000Z"),
    establishedByRunId: asHistoricalBackfillRunId(RUN_TWO),
    source: "MERCHANT_REVIEW",
  });
  assert.deepEqual(preserved, original);
});

test("backfill rejects raw email, phone, name-shaped, and source-mismatched evidence before persistence", async () => {
  const importer = new HistoricalMemberBackfillImporter(
    new InMemoryHistoricalSubscriptionHistoryRepository(),
  );
  for (const unsafeEvidence of [
    "jeff@example.com",
    "555-123-4567",
    "Jeff-Smith",
    "shopify-order/sha256/" + "a".repeat(64),
  ]) {
    await assert.rejects(
      importer.createDryRun({
        candidates: [candidate("101", unsafeEvidence)],
        requestedAt: "2026-09-01T09:00:00.000Z",
        runId: RUN_ONE,
      }),
      /source-qualified SHA-256 surrogate/,
    );
  }
});

test("historical digest is stable across equivalent UTC second and millisecond input", () => {
  const normalized = candidate("101", evidence("a"));
  const withSeconds = digestHistoricalBackfillDecisions(
    asHistoricalBackfillRunId(RUN_ONE),
    canonicalizeHistoricalTimestamp("2026-09-01T09:00:00Z"),
    [{ candidate: normalizedCandidate(normalized), disposition: "WILL_RECORD_EVER_SUBSCRIBED" }],
  );
  const withMilliseconds = digestHistoricalBackfillDecisions(
    asHistoricalBackfillRunId(RUN_ONE),
    canonicalizeHistoricalTimestamp("2026-09-01T09:00:00.000Z"),
    [{ candidate: normalizedCandidate(normalized), disposition: "WILL_RECORD_EVER_SUBSCRIBED" }],
  );
  assert.equal(withSeconds, withMilliseconds);
  assert.throws(
    () => canonicalizeHistoricalTimestamp("2026-02-31T09:00:00.000Z"),
    /real UTC instant/,
  );
});

function candidate(customerNumber: string, evidenceRef: string) {
  return {
    customerId: `gid://shopify/Customer/${customerNumber}`,
    evidenceRef,
    firstObservedAt: "2026-08-15T12:00:00Z",
    source: "APPSTLE_EXPORT" as const,
  };
}

function normalizedCandidate(input: ReturnType<typeof candidate>) {
  return {
    customerId: input.customerId as `gid://shopify/Customer/${string}`,
    evidenceRef: asHistoricalEvidenceRef(input.evidenceRef, input.source),
    firstObservedAt: canonicalizeHistoricalTimestamp(input.firstObservedAt),
    source: input.source,
  };
}

function evidence(fill: string): string {
  return "appstle/sha256/" + fill.repeat(64);
}
