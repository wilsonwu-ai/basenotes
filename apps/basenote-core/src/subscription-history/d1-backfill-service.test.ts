import assert from "node:assert/strict";
import test from "node:test";

import {
  D1DurableHistoricalBackfillService,
  DurableHistoricalBackfillConflictError,
} from "./d1-backfill-service.js";
import { digestHistoricalBackfillDecisions } from "./backfill-importer.js";
import { asHistoricalBackfillRunId, normalizeHistoricalMemberCandidate } from "./contracts.js";
import { asIsoTimestamp } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

const REQUESTED_AT = "2026-09-01T09:00:00.000Z";
const APPROVED_AT = "2026-09-01T09:05:00.000Z";
const APPLIED_AT = "2026-09-01T09:10:00.000Z";
const RUN_ID = "hbr_run00001";
const APPROVAL_REF = "hba_review0001";
const DIGEST = digestHistoricalBackfillDecisions(
  asHistoricalBackfillRunId(RUN_ID),
  asIsoTimestamp(REQUESTED_AT),
  [{
    candidate: normalizeHistoricalMemberCandidate({
      customerId: "gid://shopify/Customer/101",
      evidenceRef: "appstle/export-row-001",
      firstObservedAt: "2026-08-15T12:00:00.000Z",
      source: "APPSTLE_EXPORT",
    }),
    disposition: "WILL_RECORD_EVER_SUBSCRIBED",
  }],
);

test("durable dry-run validates every opaque candidate before any D1 statement is prepared", async () => {
  const database = new RecordingD1Database();
  const service = createService(database);

  await assert.rejects(
    service.createDryRun({
      candidates: [
        candidate("101", "appstle/export-row-001"),
        candidate("102", "opaque@invalid"),
      ],
      requestedAt: REQUESTED_AT,
      runId: RUN_ID,
    }),
    /must not contain an email address/,
  );
  assert.equal(database.prepared.length, 0);
  assert.equal(database.batches.length, 0);
});

test("durable dry-run persists a plan and audit without raw export data", async () => {
  const database = new RecordingD1Database();
  const service = createService(database);
  const dryRun = await service.createDryRun({
    candidates: [
      candidate("101", "appstle/export-row-001"),
      candidate("101", "appstle/export-row-duplicate"),
    ],
    requestedAt: REQUESTED_AT,
    runId: RUN_ID,
  });

  assert.deepEqual(
    dryRun.decisions.map((decision) => decision.disposition),
    ["WILL_RECORD_EVER_SUBSCRIBED", "DUPLICATE_IN_INPUT"],
  );
  assert.equal(database.batches.length, 1);
  const statements = database.batches[0] ?? [];
  assert.equal(statements.length, 4);
  assert.match(statements[0]?.query ?? "", /historical_subscription_backfill_runs/);
  assert.match(statements[1]?.query ?? "", /DRY_RUN_COMPLETED/);
  assert.match(statements[2]?.query ?? "", /historical_subscription_backfill_plan/);
  assert.ok(statements.every((statement) => !statement.values.some((value) => String(value).includes("@"))));
});

test("approval is bound to a retained pending run and cannot be silently retried", async () => {
  const database = new RecordingD1Database();
  database.runRow = pendingRunRow();
  const service = createService(database);
  database.onBatch = () => {
    database.runRow = approvedRunRow();
    return changedResults(2);
  };

  const approved = await service.approveDryRun({
    approval: { approvalRef: APPROVAL_REF, approvedAt: APPROVED_AT },
    runId: RUN_ID,
  });
  assert.equal(approved.applyState, "APPROVED");
  assert.equal(database.batches.length, 1);
  assert.match(database.batches[0]?.[0]?.query ?? "", /RUN_APPROVED/);
  assert.match(database.batches[0]?.[1]?.query ?? "", /apply_state = 'APPROVED'/);

  await assert.rejects(
    service.approveDryRun({
      approval: { approvalRef: "hba_review0002", approvedAt: APPLIED_AT },
      runId: RUN_ID,
    }),
    DurableHistoricalBackfillConflictError,
  );
  assert.equal(database.batches.length, 1);
});

test("invalid approval input is rejected before a durable run lookup", async () => {
  const database = new RecordingD1Database();
  const service = createService(database);

  await assert.rejects(
    service.approveDryRun({
      approval: { approvalRef: "opaque@invalid", approvedAt: APPROVED_AT },
      runId: RUN_ID,
    }),
    /approvalRef must begin/,
  );
  assert.equal(database.prepared.length, 0);
  assert.equal(database.batches.length, 0);
});

test("an unconflicted approved plan records every fact before terminalizing applied", async () => {
  const database = configuredApprovedPlanDatabase();
  const service = createService(database);
  database.onBatch = (statements) => {
    database.runRow = appliedRunRow();
    const results = changedResults(statements.length, 0);
    results[0] = changedResult();
    results[1] = changedResult();
    results[3] = changedResult();
    results[4] = changedResult();
    results[7] = changedResult();
    results[8] = changedResult();
    return results;
  };

  const result = await service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID });
  assert.equal(result.run.applyState, "APPLIED");
  assert.equal(result.run.status, "APPLIED");
  assert.equal(result.conflictCount, 0);
  assert.equal(result.newlyRecordedCount, 1);
  const statements = database.batches[0] ?? [];
  assert.match(statements[3]?.query ?? "", /historical_subscription_history/);
  assert.match(statements[4]?.query ?? "", /EVER_SUBSCRIBED_RECORDED/);
  assert.match(statements[7]?.query ?? "", /RUN_APPLIED/);
});

test("a conflict outcome withholds every new fact and terminalizes as needs-review", async () => {
  const database = configuredApprovedPlanDatabase();
  database.conflictRows = [
    {
      competing_run_id: "hbr_other001",
      customer_id: "gid://shopify/Customer/101",
      detected_at: APPLIED_AT,
      reason: "ALREADY_RECORDED_BY_ANOTHER_RUN",
    },
  ];
  const service = createService(database);
  database.onBatch = (statements) => {
    database.runRow = needsReviewRunRow();
    const results = changedResults(statements.length, 0);
    results[0] = changedResult();
    results[1] = changedResult();
    results[2] = changedResult();
    results[5] = changedResult();
    results[6] = changedResult();
    return results;
  };

  const result = await service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID });
  assert.equal(result.run.applyState, "NEEDS_REVIEW");
  assert.equal(result.conflictCount, 1);
  assert.equal(result.newlyRecordedCount, 0);
  const statements = database.batches[0] ?? [];
  assert.match(statements[2]?.query ?? "", /apply_conflicts/);
  assert.match(statements[3]?.query ?? "", /historical_subscription_history/);
  assert.ok(statements[3]?.query.includes("NOT EXISTS (\n    SELECT 1 FROM historical_subscription_backfill_apply_conflicts"));
});

function candidate(customerNumber: string, evidenceRef: string) {
  return {
    customerId: "gid://shopify/Customer/" + customerNumber,
    evidenceRef,
    firstObservedAt: "2026-08-15T12:00:00.000Z",
    source: "APPSTLE_EXPORT" as const,
  };
}

function createService(database: RecordingD1Database): D1DurableHistoricalBackfillService {
  let factSequence = 0;
  let lifecycleSequence = 0;
  return new D1DurableHistoricalBackfillService(database, {
    createFactAuditId: () => "hbaudit_" + String(++factSequence).padStart(16, "0"),
    createLifecycleAuditId: () => "hblcaudit_" + String(++lifecycleSequence).padStart(16, "0"),
  });
}

function pendingRunRow() {
  return {
    approval_ref: null,
    approved_at: null,
    apply_started_at: null,
    apply_state: "PENDING_APPROVAL",
    digest: DIGEST,
    finalized_at: null,
    lifecycle_audit_id: null,
    requested_at: REQUESTED_AT,
    run_id: RUN_ID,
    status: "DRY_RUN_COMPLETE",
  };
}

function approvedRunRow() {
  return {
    ...pendingRunRow(),
    approval_ref: APPROVAL_REF,
    approved_at: APPROVED_AT,
    apply_state: "APPROVED",
    lifecycle_audit_id: "hblcaudit_0000000000000001",
  };
}

function needsReviewRunRow() {
  return {
    ...approvedRunRow(),
    apply_started_at: APPLIED_AT,
    apply_state: "NEEDS_REVIEW",
    finalized_at: APPLIED_AT,
    lifecycle_audit_id: "hblcaudit_0000000000000002",
  };
}

function appliedRunRow() {
  return {
    ...approvedRunRow(),
    apply_started_at: APPLIED_AT,
    apply_state: "APPLIED",
    finalized_at: APPLIED_AT,
    lifecycle_audit_id: "hblcaudit_0000000000000003",
    status: "APPLIED",
  };
}

function configuredApprovedPlanDatabase(): RecordingD1Database {
  const database = new RecordingD1Database();
  database.runRow = approvedRunRow();
  database.planRows = [
    {
      customer_id: "gid://shopify/Customer/101",
      decision_ordinal: 0,
      disposition: "WILL_RECORD_EVER_SUBSCRIBED",
      evidence_ref: "appstle/export-row-001",
      first_observed_at: "2026-08-15T12:00:00.000Z",
      source: "APPSTLE_EXPORT",
    },
  ];
  return database;
}

function changedResult(): D1Result {
  return { meta: { changes: 1 } };
}

function changedResults(length: number, changes = 1): D1Result[] {
  return Array.from({ length }, () => ({ meta: { changes } }));
}

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  readonly prepared: RecordedStatement[] = [];
  conflictRows: Record<string, unknown>[] = [];
  onBatch: ((statements: readonly D1PreparedStatement[]) => readonly D1Result[]) | null = null;
  planRows: Record<string, unknown>[] = [];
  runRow: Record<string, unknown> | null = null;

  prepare(query: string): D1PreparedStatement {
    const statement = new RecordingD1Statement(query, this);
    this.prepared.push(statement);
    return statement;
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]> {
    this.batches.push(statements.map(asRecordedStatement));
    return this.onBatch ? this.onBatch(statements) : changedResults(statements.length);
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
    if (this.query.includes("historical_subscription_backfill_runs")) {
      return this.database.runRow as T | null;
    }
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.query.includes("historical_subscription_backfill_plan")) {
      return { results: this.database.planRows as T[] };
    }
    if (this.query.includes("historical_subscription_backfill_apply_conflicts")) {
      return { results: this.database.conflictRows as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    return changedResult();
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
