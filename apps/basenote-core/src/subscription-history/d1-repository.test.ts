import assert from "node:assert/strict";
import test from "node:test";

import {
  DurableHistoricalBackfillConflictError,
  D1HistoricalSubscriptionHistoryRepository,
} from "./d1-repository.js";
import {
  asHistoricalBackfillApprovalRef,
  asHistoricalBackfillRunId,
  asHistoricalEvidenceRef,
} from "./contracts.js";
import { asCustomerId, asIsoTimestamp } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

const RUN_ID = asHistoricalBackfillRunId("hbr_appstle_20260901_154347");
const DIGEST = "e8c4c4046360296138ca56568f8f29b541df869156c3d00ab0a5a48030f64336";
const CUSTOMER_ID = asCustomerId("gid://shopify/Customer/101");
const APPROVAL_REF = asHistoricalBackfillApprovalRef("hba_approved_20260901");
const ESTABLISHED_AT = asIsoTimestamp("2025-01-01T12:00:00.000Z");
const APPROVED_AT = asIsoTimestamp("2026-09-01T16:00:00.000Z");
const EVIDENCE_REF = asHistoricalEvidenceRef("appstle-export-b116e4ddc7525304-8c3c77ac2a11223344556677");

test("D1 durable history repository opens an audited dry run without source rows or PII", async () => {
  const database = new RecordingD1Database();
  const repository = createRepository(database);

  await repository.appendAudit({
    action: "DRY_RUN_COMPLETED",
    approvalRef: null,
    customerId: null,
    digest: DIGEST,
    occurredAt: asIsoTimestamp("2026-09-01T15:50:00.000Z"),
    runId: RUN_ID,
  });

  assert.equal(database.batches.length, 1);
  const statements = database.batches[0] ?? [];
  assert.equal(statements.length, 2);
  assert.match(statements[0]?.query ?? "", /INSERT INTO historical_subscription_backfill_runs/);
  assert.match(statements[1]?.query ?? "", /INSERT INTO historical_subscription_backfill_audit/);
  assert.ok(statements.every((statement) => !/email|@/i.test(`${statement.query} ${statement.values.join(" ")}`)));
  assert.ok(statements.every((statement) => !/DELETE|UPDATE historical_subscription_history/i.test(statement.query)));
});

test("D1 durable history repository records a positive fact and matching audit atomically", async () => {
  const database = new RecordingD1Database();
  database.firstRow = historyRow();
  const repository = createRepository(database);

  const result = await repository.recordEverSubscribedWithAudit({
    audit: {
      action: "EVER_SUBSCRIBED_RECORDED",
      approvalRef: APPROVAL_REF,
      customerId: CUSTOMER_ID,
      digest: DIGEST,
      occurredAt: APPROVED_AT,
      runId: RUN_ID,
    },
    record: {
      customerId: CUSTOMER_ID,
      establishedAt: ESTABLISHED_AT,
      establishedByRunId: RUN_ID,
      evidenceRef: EVIDENCE_REF,
      source: "APPSTLE_EXPORT",
    },
  });

  assert.equal(result.newlyRecorded, true);
  assert.equal(result.record.customerId, CUSTOMER_ID);
  assert.equal(database.batches.length, 1);
  const statements = database.batches[0] ?? [];
  assert.match(statements[0]?.query ?? "", /INSERT OR IGNORE INTO historical_subscription_history/);
  assert.match(statements[0]?.query ?? "", /status = 'DRY_RUN_COMPLETE'/);
  assert.match(statements[1]?.query ?? "", /INSERT INTO historical_subscription_backfill_audit/);
  assert.match(statements[1]?.query ?? "", /NOT EXISTS/);
  assert.ok(statements.every((statement) => !/https?:\/\//.test(statement.query)));
});

test("D1 durable history repository refuses mismatched audit/record envelopes and terminalizes only a reviewed dry run", async () => {
  const database = new RecordingD1Database();
  const repository = createRepository(database);

  await assert.rejects(
    () => repository.recordEverSubscribedWithAudit({
      audit: {
        action: "EVER_SUBSCRIBED_RECORDED",
        approvalRef: APPROVAL_REF,
        customerId: CUSTOMER_ID,
        digest: DIGEST,
        occurredAt: APPROVED_AT,
        runId: RUN_ID,
      },
      record: {
        customerId: asCustomerId("gid://shopify/Customer/102"),
        establishedAt: ESTABLISHED_AT,
        establishedByRunId: RUN_ID,
        evidenceRef: EVIDENCE_REF,
        source: "APPSTLE_EXPORT",
      },
    }),
    DurableHistoricalBackfillConflictError,
  );

  await repository.markRunApplied({
    approval: { approvalRef: APPROVAL_REF, approvedAt: APPROVED_AT },
    digest: DIGEST,
    runId: RUN_ID,
  });
  assert.match(database.runs[0]?.query ?? "", /UPDATE historical_subscription_backfill_runs/);
  assert.ok(database.runs[0]?.values.includes(APPROVAL_REF));
});

function createRepository(database: RecordingD1Database): D1HistoricalSubscriptionHistoryRepository {
  let sequence = 0;
  return new D1HistoricalSubscriptionHistoryRepository(database, {
    createAuditId: () => `hbaudit_${String(++sequence).padStart(16, "0")}`,
  });
}

function historyRow() {
  return {
    customer_id: CUSTOMER_ID,
    established_at: ESTABLISHED_AT,
    established_by_run_id: RUN_ID,
    evidence_ref: EVIDENCE_REF,
    source: "APPSTLE_EXPORT",
  };
}

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  readonly runs: RecordedStatement[] = [];
  firstRow: Record<string, unknown> | null = null;
  nextBatchChanges: readonly number[] = [1, 1];

  prepare(query: string): D1PreparedStatement {
    return new RecordingD1Statement(query, this);
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]> {
    const recorded = statements.map(asRecordedStatement);
    this.batches.push(recorded);
    return statements.map((_, index) => ({ meta: { changes: this.nextBatchChanges[index] ?? 1 } }));
  }
}

class RecordingD1Statement implements D1PreparedStatement {
  readonly values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly database: RecordingD1Database,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatement {
    this.values.push(...values);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.database.firstRow as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    this.database.runs.push(asRecordedStatement(this));
    return { meta: { changes: 1 } };
  }
}

interface RecordedStatement {
  readonly query: string;
  readonly values: readonly unknown[];
}

function asRecordedStatement(statement: D1PreparedStatement): RecordedStatement {
  if (!(statement instanceof RecordingD1Statement)) throw new Error("Unexpected statement implementation.");
  return { query: statement.query, values: [...statement.values] };
}
