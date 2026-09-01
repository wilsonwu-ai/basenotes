import assert from "node:assert/strict";
import test from "node:test";

import {
  asHistoricalBackfillRunId,
  asHistoricalEvidenceRef,
  toPricingSubscriptionHistory,
  type DurableHistoricalSubscriptionRecord,
} from "./contracts.js";
import {
  HistoricalBackfillRunConflictError,
  HistoricalMemberBackfillImporter,
  InMemoryHistoricalSubscriptionHistoryRepository,
} from "./backfill-importer.js";
import { asIsoTimestamp } from "../queue/types.js";

test("historical member dry run writes no eligibility history and produces immutable positive-only plan", async () => {
  const repository = new InMemoryHistoricalSubscriptionHistoryRepository();
  const importer = new HistoricalMemberBackfillImporter(repository);
  const dryRun = await importer.createDryRun({
    candidates: [
      candidate("101", "appstle/export-row-001"),
      candidate("101", "appstle/export-row-duplicate"),
      candidate("102", "shopify/order-row-002"),
    ],
    requestedAt: "2026-09-01T09:00:00.000Z",
    runId: "hbr_run00001",
  });

  assert.equal(dryRun.status, "DRY_RUN_COMPLETE");
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
    candidates: [candidate("101", "appstle/export-row-001")],
    requestedAt: "2026-09-01T09:00:00.000Z",
    runId: "hbr_run00001",
  });

  const records = await importer.applyReviewedDryRun("hbr_run00001", {
    approvalRef: "hba_review0001",
    approvedAt: "2026-09-01T09:05:00.000Z",
  });
  assert.equal(records.length, 1);
  assert.equal(toPricingSubscriptionHistory(records[0] ?? null), "durably_ever_subscribed");
  assert.equal(repository.listAudit().length, 2);
  assert.equal(repository.listAudit()[1]?.action, "EVER_SUBSCRIBED_RECORDED");

  await assert.rejects(
    importer.applyReviewedDryRun("hbr_run00001", {
      approvalRef: "hba_review0002",
      approvedAt: "2026-09-01T09:06:00.000Z",
    }),
    HistoricalBackfillRunConflictError,
  );

  const original: DurableHistoricalSubscriptionRecord = records[0] as DurableHistoricalSubscriptionRecord;
  const preserved = await repository.recordEverSubscribed({
    ...original,
    evidenceRef: asHistoricalEvidenceRef("merchant/review-later"),
    establishedAt: asIsoTimestamp("2026-09-02T09:00:00.000Z"),
    establishedByRunId: asHistoricalBackfillRunId("hbr_run00002"),
    source: "MERCHANT_REVIEW",
  });
  assert.deepEqual(preserved, original);
});

test("backfill rejects raw-email evidence references", async () => {
  const importer = new HistoricalMemberBackfillImporter(
    new InMemoryHistoricalSubscriptionHistoryRepository(),
  );
  await assert.rejects(
    importer.createDryRun({
      candidates: [candidate("101", "jeff@example.com")],
      requestedAt: "2026-09-01T09:00:00.000Z",
      runId: "hbr_run00001",
    }),
    /must not contain an email address/,
  );
});

function candidate(customerNumber: string, evidenceRef: string) {
  return {
    customerId: `gid://shopify/Customer/${customerNumber}`,
    evidenceRef,
    firstObservedAt: "2026-08-15T12:00:00.000Z",
    source: evidenceRef.startsWith("shopify/") ? "SHOPIFY_ORDER_EXPORT" as const : "APPSTLE_EXPORT" as const,
  };
}
