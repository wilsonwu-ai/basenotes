import assert from "node:assert/strict";
import test from "node:test";

import {
  D1DurableHistoricalBackfillService,
  DurableHistoricalBackfillConflictError,
  MAX_DRY_RUN_CANDIDATES,
} from "./d1-backfill-service.js";
import { digestHistoricalBackfillDecisions } from "./backfill-importer.js";
import {
  asHistoricalBackfillRunId,
  canonicalizeHistoricalTimestamp,
  normalizeHistoricalMemberCandidate,
} from "./contracts.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

const REQUESTED_AT = "2026-09-01T09:00:00.000Z";
const APPROVED_AT = "2026-09-01T09:05:00.000Z";
const APPLIED_AT = "2026-09-01T09:10:00.000Z";
const RUN_ID = "hbr_" + "1".repeat(32);
const APPROVAL_REF = "hba_" + "a".repeat(32);
const EVIDENCE = "appstle/sha256/" + "b".repeat(64);
const DIGEST = digestHistoricalBackfillDecisions(
  asHistoricalBackfillRunId(RUN_ID),
  canonicalizeHistoricalTimestamp(REQUESTED_AT),
  [{
    candidate: normalizeHistoricalMemberCandidate({
      customerId: "gid://shopify/Customer/101",
      evidenceRef: EVIDENCE,
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
        candidate("101", EVIDENCE),
        candidate("102", "555-123-4567"),
      ],
      requestedAt: REQUESTED_AT,
      runId: RUN_ID,
    }),
    /source-qualified SHA-256 surrogate/,
  );
  assert.equal(database.prepared.length, 0);
  assert.equal(database.batches.length, 0);
});

test("durable dry-run uses one bounded history lookup and persists only canonical opaque values", async () => {
  const database = new RecordingD1Database();
  const service = createService(database);
  const dryRun = await service.createDryRun({
    candidates: [
      candidate("101", EVIDENCE),
      candidate("102", evidence("c")),
      candidate("101", evidence("d")),
    ],
    requestedAt: "2026-09-01T09:00:00Z",
    runId: RUN_ID,
  });

  assert.equal(dryRun.requestedAt, REQUESTED_AT);
  assert.deepEqual(
    dryRun.decisions.map((decision) => decision.disposition),
    ["WILL_RECORD_EVER_SUBSCRIBED", "WILL_RECORD_EVER_SUBSCRIBED", "DUPLICATE_IN_INPUT"],
  );
  const historyLookups = database.prepared.filter((statement) => statement.query.includes("historical_subscription_history"));
  assert.equal(historyLookups.length, 1);
  assert.equal(historyLookups[0]?.values.length, 2);
  assert.equal(database.batches.length, 1);
  const statements = database.batches[0] ?? [];
  assert.equal(statements.length, 5);
  assert.match(statements[0]?.query ?? "", /historical_subscription_backfill_runs/);
  assert.match(statements[1]?.query ?? "", /DRY_RUN_COMPLETED/);
  assert.match(statements[2]?.query ?? "", /historical_subscription_backfill_plan/);
  assert.ok(statements.every((statement) => !statement.values.some((value) => /@|555|Jeff/i.test(String(value)))));
});

test("Worker-safe cap prevents an oversized dry run before it performs a D1 lookup", async () => {
  const database = new RecordingD1Database();
  const service = createService(database);
  const candidates = Array.from({ length: MAX_DRY_RUN_CANDIDATES + 1 }, (_value, index) => (
    candidate(String(index + 100), evidence((index % 10).toString()))
  ));

  await assert.rejects(
    service.createDryRun({ candidates, requestedAt: REQUESTED_AT, runId: RUN_ID }),
    new RegExp("at most " + MAX_DRY_RUN_CANDIDATES),
  );
  assert.equal(database.prepared.length, 0);
  assert.equal(database.batches.length, 0);
});

test("approval is bound to a retained pending run and cannot be silently retried", async () => {
  const database = new RecordingD1Database();
  database.runRow = pendingRunRow();
  const service = createService(database);
  await assert.rejects(
    service.approveDryRun({
      approval: { approvalRef: APPROVAL_REF, approvedAt: "2026-09-01T08:59:59.999Z" },
      runId: RUN_ID,
    }),
    /cannot predate/,
  );
  assert.equal(database.batches.length, 0);
  database.onBatch = () => {
    database.runRow = approvedRunRow();
    return changedResults(1);
  };

  const approved = await service.approveDryRun({
    approval: { approvalRef: APPROVAL_REF, approvedAt: APPROVED_AT },
    runId: RUN_ID,
  });
  assert.equal(approved.applyState, "APPROVED");
  assert.equal(database.batches.length, 1);
  assert.match(database.batches[0]?.[0]?.query ?? "", /apply_state = 'APPROVED'/);
  assert.doesNotMatch(database.batches[0]?.[0]?.query ?? "", /INSERT INTO historical_subscription_backfill_lifecycle_audit/);

  await assert.rejects(
    service.approveDryRun({
      approval: { approvalRef: "hba_" + "c".repeat(32), approvedAt: APPLIED_AT },
      runId: RUN_ID,
    }),
    DurableHistoricalBackfillConflictError,
  );
  assert.equal(database.batches.length, 1);
});

test("legacy quarantined run is never reopened for approval", async () => {
  const database = new RecordingD1Database();
  database.runRow = {
    ...pendingRunRow(),
    apply_state: "NEEDS_REVIEW",
    finalized_at: REQUESTED_AT,
    legacy_quarantined: 1,
    legacy_quarantine_reason: "NO_IMMUTABLE_PLAN",
  };
  const service = createService(database);

  await assert.rejects(
    service.approveDryRun({
      approval: { approvalRef: APPROVAL_REF, approvedAt: APPROVED_AT },
      runId: RUN_ID,
    }),
    /quarantined/,
  );
  assert.equal(database.batches.length, 0);
});

test("durable apply rejects a retained manifest whose timestamp is not already canonical", async () => {
  const database = configuredApprovedPlanDatabase();
  database.planRows = [{
    ...database.planRows[0],
    first_observed_at: "2026-08-15T12:00:00Z",
  }];
  const service = createService(database);

  await assert.rejects(
    service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID }),
    /retained durable manifest contains malformed data/,
  );
  assert.equal(database.batches.length, 0);
});

test("an unconflicted approved plan records every fact before terminalizing applied", async () => {
  const database = configuredApprovedPlanDatabase();
  const service = createService(database);
  database.onBatch = (statements) => {
    database.runRow = appliedRunRow();
    const results = changedResults(statements.length, 0);
    results[0] = changedResult();
    results[2] = changedResult();
    results[3] = changedResult();
    results[5] = changedResult();
    return results;
  };

  const result = await service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID });
  assert.equal(result.run.applyState, "APPLIED");
  assert.equal(result.run.status, "APPLIED");
  assert.equal(result.conflictCount, 0);
  assert.equal(result.newlyRecordedCount, 1);
  const statements = database.batches[0] ?? [];
  assert.equal(statements.length, 6);
  assert.match(statements[0]?.query ?? "", /apply_state = 'APPLYING'/);
  assert.match(statements[2]?.query ?? "", /historical_subscription_history/);
  assert.match(statements[3]?.query ?? "", /EVER_SUBSCRIBED_RECORDED/);
  assert.match(statements[5]?.query ?? "", /apply_state = 'APPLIED'/);
});

test("a conflict outcome withholds every new fact and terminalizes as needs-review", async () => {
  const database = configuredApprovedPlanDatabase();
  database.conflictRows = [{
    competing_run_id: "hbr_" + "f".repeat(32),
    customer_id: "gid://shopify/Customer/101",
    detected_at: APPLIED_AT,
    reason: "ALREADY_RECORDED_BY_ANOTHER_RUN",
  }];
  const service = createService(database);
  database.onBatch = (statements) => {
    database.runRow = needsReviewRunRow();
    const results = changedResults(statements.length, 0);
    results[0] = changedResult();
    results[1] = changedResult();
    results[4] = changedResult();
    return results;
  };

  const result = await service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID });
  assert.equal(result.run.applyState, "NEEDS_REVIEW");
  assert.equal(result.conflictCount, 1);
  assert.equal(result.newlyRecordedCount, 0);
  const statements = database.batches[0] ?? [];
  assert.match(statements[1]?.query ?? "", /apply_conflicts/);
  assert.match(statements[2]?.query ?? "", /historical_subscription_history/);
  assert.ok(statements[2]?.query.includes("NOT EXISTS (\n    SELECT 1 FROM historical_subscription_backfill_apply_conflicts"));
  assert.match(statements[4]?.query ?? "", /NEEDS_REVIEW/);
});

test("a quarantined legacy collision becomes an auditable needs-review outcome", async () => {
  const database = configuredApprovedPlanDatabase();
  database.conflictRows = [{
    competing_run_id: null,
    customer_id: "gid://shopify/Customer/101",
    detected_at: APPLIED_AT,
    reason: "LEGACY_EVIDENCE_REQUIRES_REVIEW",
  }];
  const service = createService(database);
  database.onBatch = (statements) => {
    database.runRow = needsReviewRunRow();
    const results = changedResults(statements.length, 0);
    results[0] = changedResult();
    results[1] = changedResult();
    results[4] = changedResult();
    return results;
  };

  const result = await service.applyApprovedDryRun({ appliedAt: APPLIED_AT, runId: RUN_ID });
  assert.equal(result.run.applyState, "NEEDS_REVIEW");
  assert.equal(result.conflictCount, 1);
  assert.equal(result.newlyRecordedCount, 0);
  const statements = database.batches[0] ?? [];
  assert.match(statements[1]?.query ?? "", /LEGACY_EVIDENCE_REQUIRES_REVIEW/);
  assert.match(statements[1]?.query ?? "", /history\.legacy_quarantined = 1/);
  assert.ok(statements[2]?.query.includes("NOT EXISTS (\n    SELECT 1 FROM historical_subscription_backfill_apply_conflicts"));
  const conflicts = await service.listConflicts(RUN_ID);
  assert.deepEqual(conflicts, [{
    competingRunId: null,
    customerId: "gid://shopify/Customer/101",
    detectedAt: APPLIED_AT,
    reason: "LEGACY_EVIDENCE_REQUIRES_REVIEW",
  }]);
});

function candidate(customerNumber: string, evidenceRef: string) {
  return {
    customerId: "gid://shopify/Customer/" + customerNumber,
    evidenceRef,
    firstObservedAt: "2026-08-15T12:00:00.000Z",
    source: "APPSTLE_EXPORT" as const,
  };
}

function evidence(fill: string): string {
  return "appstle/sha256/" + fill.repeat(64);
}

function createService(database: RecordingD1Database): D1DurableHistoricalBackfillService {
  let factSequence = 0;
  let lifecycleSequence = 0;
  return new D1DurableHistoricalBackfillService(database, {
    createFactAuditId: () => "hbaudit_" + String(++factSequence).padStart(32, "0"),
    createLifecycleAuditId: () => "hblcaudit_" + String(++lifecycleSequence).padStart(32, "0"),
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
    legacy_quarantined: 0,
    legacy_quarantine_reason: null,
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
    lifecycle_audit_id: "hblcaudit_" + "1".repeat(32),
  };
}

function needsReviewRunRow() {
  return {
    ...approvedRunRow(),
    apply_started_at: APPLIED_AT,
    apply_state: "NEEDS_REVIEW",
    finalized_at: APPLIED_AT,
    lifecycle_audit_id: "hblcaudit_" + "2".repeat(32),
  };
}

function appliedRunRow() {
  return {
    ...approvedRunRow(),
    apply_started_at: APPLIED_AT,
    apply_state: "APPLIED",
    finalized_at: APPLIED_AT,
    lifecycle_audit_id: "hblcaudit_" + "3".repeat(32),
    status: "APPLIED",
  };
}

function configuredApprovedPlanDatabase(): RecordingD1Database {
  const database = new RecordingD1Database();
  database.runRow = approvedRunRow();
  database.planRows = [{
    customer_id: "gid://shopify/Customer/101",
    decision_ordinal: 0,
    disposition: "WILL_RECORD_EVER_SUBSCRIBED",
    evidence_ref: EVIDENCE,
    first_observed_at: "2026-08-15T12:00:00.000Z",
    source: "APPSTLE_EXPORT",
  }];
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
  historyRows: Record<string, unknown>[] = [];
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
    if (this.query.includes("historical_subscription_history")) {
      return { results: this.database.historyRows as T[] };
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
