import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baseMigration = readFileSync(resolve(coreRoot, "migrations/0001_staging_runtime.sql"), "utf8");
const durableMigration = readFileSync(
  resolve(coreRoot, "migrations/0004_durable_historical_backfill.sql"),
  "utf8",
);
const migration = [baseMigration, durableMigration].join("\n");

const RUN_ONE = "hbr_" + "1".repeat(32);
const RUN_TWO = "hbr_" + "2".repeat(32);
const CUSTOMER = "gid://shopify/Customer/101";
const EVIDENCE = "appstle/sha256/" + "a".repeat(64);
const EVIDENCE_TWO = "appstle/sha256/" + "b".repeat(64);
const REQUESTED = "2026-09-01T09:00:00.000Z";
const APPROVED = "2026-09-01T09:05:00.000Z";
const APPLIED = "2026-09-01T09:10:00.000Z";
const INVALID_24_HOUR = "2026-09-01T24:00:00.000Z";
const APPROVAL = "hba_" + "c".repeat(32);
const DIGEST_ONE = "1".repeat(64);
const DIGEST_TWO = "2".repeat(64);

test("migration quarantines legacy runs and legacy unvalidated evidence instead of reopening them", () => {
  withDatabase((database) => {
    run(database, baseMigration);
    run(database, sql([
      "INSERT INTO historical_subscription_backfill_runs (",
      "  run_id, digest, requested_at, status, approval_ref, approved_at",
      ") VALUES ('legacy-run-001', '" + "e".repeat(64) + "', '2026-09-01T09:00:00Z',",
      "  'DRY_RUN_COMPLETE', NULL, NULL)",
      ";",
      "INSERT INTO historical_subscription_backfill_audit (",
      "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
      ") VALUES ('legacy-audit-001', 'legacy-run-001', 'DRY_RUN_COMPLETED', NULL, NULL,",
      "  '" + "e".repeat(64) + "', '2026-09-01T09:00:00Z')",
      ";",
      "INSERT INTO historical_subscription_history (",
      "  customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at",
      ") VALUES ('gid://shopify/Customer/999', '2026-08-01T00:00:00Z', 'legacy-run-001',",
      "  'legacy/source-row', 'APPSTLE_EXPORT', '2026-09-01T09:00:00Z')",
    ]));
    run(database, durableMigration);

    assert.equal(
      run(database, sql([
        "SELECT requested_at || '|' || apply_state || '|' || legacy_quarantined || '|' ||",
        "  legacy_quarantine_reason",
        "FROM historical_subscription_backfill_runs WHERE run_id = 'legacy-run-001'",
      ])).trim(),
      "2026-09-01T09:00:00.000Z|NEEDS_REVIEW|1|NO_IMMUTABLE_PLAN",
    );
    assert.equal(
      run(database, "SELECT legacy_quarantined || '|' || legacy_quarantine_reason FROM historical_subscription_history").trim(),
      "1|PREVIOUSLY_UNVALIDATED_EVIDENCE",
    );
    assert.equal(
      run(database, "SELECT legacy_quarantined || '|' || legacy_quarantine_reason FROM historical_subscription_backfill_audit").trim(),
      "1|PREVIOUSLY_UNVALIDATED_AUDIT",
    );
    mustReject(
      database,
      "UPDATE historical_subscription_backfill_runs SET apply_state = 'PENDING_APPROVAL' WHERE run_id = 'legacy-run-001'",
      /immutable|one-way/,
    );
  });
});

test("durable schema rejects 24:00 for every direct SQL timestamp input", () => {
  withDatabase((database) => {
    run(database, migration);
    // SQLite itself formats 24:00 unchanged, unlike the TypeScript
    // canonicalizer. Each direct SQL write below must therefore hit an
    // explicit hour-range guard rather than relying only on strftime.
    assert.equal(
      run(database, "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', '" + INVALID_24_HOUR + "')").trim(),
      INVALID_24_HOUR,
    );

    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_runs (",
        "  run_id, digest, requested_at, status, approval_ref, approved_at,",
        "  apply_state, apply_started_at, finalized_at, lifecycle_audit_id",
        ") VALUES ('" + RUN_ONE + "', '" + DIGEST_ONE + "', '" + INVALID_24_HOUR + "',",
        "  'DRY_RUN_COMPLETE', NULL, NULL, 'PENDING_APPROVAL', NULL, NULL, NULL)",
      ]),
      /canonical unapproved/,
    );

    createDryRun(database, RUN_ONE, DIGEST_ONE, "1");
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_audit (",
        "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
        ") VALUES ('" + factAuditId("e") + "', '" + RUN_ONE + "', 'DRY_RUN_COMPLETED',",
        "  NULL, NULL, '" + DIGEST_ONE + "', '" + INVALID_24_HOUR + "')",
      ]),
      /historical backfill audit is malformed/,
    );
    mustReject(
      database,
      planInsert(RUN_ONE, EVIDENCE, INVALID_24_HOUR),
      /canonical source-qualified/,
    );
    insertPlan(database, RUN_ONE, EVIDENCE);

    mustReject(
      database,
      approveRunStatement(RUN_ONE, "e", INVALID_24_HOUR),
      /one-way/,
    );
    approveRun(database, RUN_ONE, "2");
    mustReject(
      database,
      beginApplyStatement(RUN_ONE, "e", INVALID_24_HOUR),
      /one-way/,
    );
    beginApply(database, RUN_ONE, "3");

    mustReject(
      database,
      historyInsertAt(RUN_ONE, EVIDENCE, INVALID_24_HOUR, APPLIED),
      /canonical opaque surrogate bound to an approved applying plan/,
    );
    mustReject(
      database,
      historyInsertAt(RUN_ONE, EVIDENCE, "2026-08-15T12:00:00.000Z", INVALID_24_HOUR),
      /canonical opaque surrogate bound to an approved applying plan/,
    );
    run(database, historyInsert(RUN_ONE, EVIDENCE));
    mustReject(
      database,
      factAuditInsertAt(RUN_ONE, DIGEST_ONE, "e", INVALID_24_HOUR),
      /historical backfill audit is malformed/,
    );
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
        "  audit_id, run_id, action, approval_ref, digest, occurred_at",
        ") VALUES ('" + lifecycleId("e") + "', '" + RUN_ONE + "', 'RUN_APPLYING',",
        "  '" + APPROVAL + "', '" + DIGEST_ONE + "', '" + INVALID_24_HOUR + "')",
      ]),
      /generated by and bound/,
    );

    createDryRun(database, RUN_TWO, DIGEST_TWO, "4");
    insertPlan(database, RUN_TWO, EVIDENCE_TWO);
    approveRun(database, RUN_TWO, "5");
    beginApply(database, RUN_TWO, "6");
    mustReject(
      database,
      conflictInsert(RUN_TWO, RUN_ONE, "ALREADY_RECORDED_BY_ANOTHER_RUN", INVALID_24_HOUR),
      /bound to a durable or quarantined legacy record/,
    );
    run(database, conflictInsert(RUN_TWO, RUN_ONE, "ALREADY_RECORDED_BY_ANOTHER_RUN", APPLIED));
    mustReject(
      database,
      finishNeedsReviewStatement(RUN_TWO, "e", INVALID_24_HOUR),
      /one-way/,
    );
  });
});

test("quarantined legacy evidence terminalizes a new run as auditable needs-review", () => {
  withDatabase((database) => {
    run(database, baseMigration);
    run(database, sql([
      "INSERT INTO historical_subscription_history (",
      "  customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at",
      ") VALUES ('" + CUSTOMER + "', '2026-08-01T00:00:00Z', 'legacy-run-001',",
      "  'legacy/source-row', 'APPSTLE_EXPORT', '2026-09-01T09:00:00Z')",
    ]));
    run(database, durableMigration);

    createDryRun(database, RUN_ONE, DIGEST_ONE, "1");
    insertPlan(database, RUN_ONE, EVIDENCE);
    approveRun(database, RUN_ONE, "2");
    beginApply(database, RUN_ONE, "3");
    run(database, sql([
      "INSERT INTO historical_subscription_backfill_apply_conflicts (",
      "  run_id, customer_id, competing_run_id, reason, detected_at",
      ")",
      "SELECT '" + RUN_ONE + "', plan.customer_id, NULL, 'LEGACY_EVIDENCE_REQUIRES_REVIEW', '" + APPLIED + "'",
      "FROM historical_subscription_history AS history",
      "JOIN historical_subscription_backfill_plan AS plan ON plan.customer_id = history.customer_id",
      "JOIN historical_subscription_backfill_runs AS current_run ON current_run.run_id = plan.run_id",
      "WHERE current_run.run_id = '" + RUN_ONE + "'",
      "  AND current_run.apply_state = 'APPLYING'",
      "  AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'",
      "  AND history.legacy_quarantined = 1",
    ]));
    finishNeedsReview(database, RUN_ONE, "4");

    assert.equal(
      run(database, sql([
        "SELECT reason || '|' || COALESCE(competing_run_id, 'none')",
        "FROM historical_subscription_backfill_apply_conflicts",
        "WHERE run_id = '" + RUN_ONE + "'",
      ])).trim(),
      "LEGACY_EVIDENCE_REQUIRES_REVIEW|none",
    );
    assert.equal(
      run(database, sql([
        "SELECT apply_state || '|' ||",
        "  (SELECT COUNT(*) FROM historical_subscription_history WHERE legacy_quarantined = 0)",
        "FROM historical_subscription_backfill_runs WHERE run_id = '" + RUN_ONE + "'",
      ])).trim(),
      "NEEDS_REVIEW|0",
    );
    assert.equal(
      run(database, sql([
        "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit",
        "WHERE run_id = '" + RUN_ONE + "' AND action = 'RUN_NEEDS_REVIEW'",
      ])).trim(),
      "1",
    );
  });
});

test("durable schema rejects PII-shaped values and enforces bound one-way lifecycle events", () => {
  withDatabase((database) => {
    run(database, migration);
    createDryRun(database, RUN_ONE, DIGEST_ONE, "1");

    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_plan (",
        "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
        ") VALUES ('" + RUN_ONE + "', 0, '" + CUSTOMER + "',",
        "  'appstle/sha256/555-123-4567', '2026-08-15T12:00:00.000Z',",
        "  'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
      ]),
      /source-qualified/,
    );
    assert.equal(
      run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_plan WHERE evidence_ref LIKE '%555%' ").trim(),
      "0",
    );
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_plan (",
        "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
        ") VALUES ('" + RUN_ONE + "', 0, '" + CUSTOMER + "', '" + EVIDENCE + "',",
        "  '2026-08-15T12:00:00Z', 'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
      ]),
      /canonical source-qualified/,
    );
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
        "  audit_id, run_id, action, approval_ref, digest, occurred_at",
        ") VALUES ('" + lifecycleId("f") + "', '" + RUN_ONE + "', 'RUN_APPROVED',",
        "  '" + APPROVAL + "', '" + DIGEST_ONE + "', '" + APPROVED + "')",
      ]),
      /generated by and bound/,
    );
    assert.equal(run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit").trim(), "0");

    insertPlan(database, RUN_ONE, EVIDENCE);
    mustReject(database, historyInsert(RUN_ONE, EVIDENCE), /approved applying plan/);
    approveRun(database, RUN_ONE, "1");
    assert.equal(
      run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit WHERE action = 'RUN_APPROVED'").trim(),
      "1",
    );
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
        "  audit_id, run_id, action, approval_ref, digest, occurred_at",
        ") VALUES ('" + lifecycleId("e") + "', '" + RUN_ONE + "', 'RUN_APPROVED',",
        "  '" + APPROVAL + "', '" + DIGEST_ONE + "', '" + APPROVED + "')",
      ]),
      /generated by and bound/,
    );
    assert.equal(run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit").trim(), "1");

    mustReject(
      database,
      sql([
        "UPDATE historical_subscription_backfill_runs",
        "SET approval_ref = 'hba_jeffsmith', approved_at = '" + APPROVED + "',",
        "  apply_state = 'APPROVED', lifecycle_audit_id = '" + lifecycleId("d") + "'",
        "WHERE run_id = '" + RUN_ONE + "'",
      ]),
      /one-way/,
    );

    beginApply(database, RUN_ONE, "2");
    run(database, historyInsert(RUN_ONE, EVIDENCE));
    insertFactAudit(database, RUN_ONE, DIGEST_ONE, "2");
    mustReject(
      database,
      "UPDATE historical_subscription_history SET evidence_ref = 'appstle/sha256/" + "d".repeat(64) + "' WHERE customer_id = '" + CUSTOMER + "'",
      /immutable/,
    );
    mustReject(
      database,
      "DELETE FROM historical_subscription_history WHERE customer_id = '" + CUSTOMER + "'",
      /immutable/,
    );
    finishApplied(database, RUN_ONE, "3");
    assert.equal(
      run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit WHERE action = 'RUN_APPLIED'").trim(),
      "1",
    );
    mustReject(
      database,
      "UPDATE historical_subscription_backfill_runs SET apply_state = 'APPROVED' WHERE run_id = '" + RUN_ONE + "'",
      /one-way/,
    );

    createDryRun(database, RUN_TWO, DIGEST_TWO, "4");
    insertPlan(database, RUN_TWO, EVIDENCE_TWO);
    approveRun(database, RUN_TWO, "5");
    beginApply(database, RUN_TWO, "6");
    run(database, sql([
      "INSERT INTO historical_subscription_backfill_apply_conflicts (",
      "  run_id, customer_id, competing_run_id, reason, detected_at",
      ") VALUES ('" + RUN_TWO + "', '" + CUSTOMER + "', '" + RUN_ONE + "',",
      "  'ALREADY_RECORDED_BY_ANOTHER_RUN', '" + APPLIED + "')",
    ]));
    finishNeedsReview(database, RUN_TWO, "7");
    assert.equal(
      run(database, sql([
        "SELECT apply_state || '|' ||",
        "  (SELECT COUNT(*) FROM historical_subscription_history",
        "   WHERE established_by_run_id = '" + RUN_TWO + "')",
        "FROM historical_subscription_backfill_runs",
        "WHERE run_id = '" + RUN_TWO + "'",
      ])).trim(),
      "NEEDS_REVIEW|0",
    );
    assert.equal(
      run(database, "SELECT COUNT(*) FROM historical_subscription_backfill_lifecycle_audit WHERE run_id = '" + RUN_TWO + "' AND action = 'RUN_NEEDS_REVIEW'").trim(),
      "1",
    );
    mustReject(
      database,
      "UPDATE historical_subscription_backfill_apply_conflicts SET reason = 'ALREADY_RECORDED_BY_ANOTHER_RUN' WHERE run_id = '" + RUN_TWO + "'",
      /append-only/,
    );
  });
});

function createDryRun(database: string, runId: string, digest: string, suffix: string): void {
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_runs (",
    "  run_id, digest, requested_at, status, approval_ref, approved_at,",
    "  apply_state, apply_started_at, finalized_at, lifecycle_audit_id",
    ") VALUES ('" + runId + "', '" + digest + "', '" + REQUESTED + "', 'DRY_RUN_COMPLETE',",
    "  NULL, NULL, 'PENDING_APPROVAL', NULL, NULL, NULL)",
    ";",
    "INSERT INTO historical_subscription_backfill_audit (",
    "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
    ") VALUES ('" + factAuditId(suffix) + "', '" + runId + "', 'DRY_RUN_COMPLETED',",
    "  NULL, NULL, '" + digest + "', '" + REQUESTED + "')",
  ]));
}

function insertPlan(database: string, runId: string, evidence: string): void {
  run(database, planInsert(runId, evidence, "2026-08-15T12:00:00.000Z"));
}

function planInsert(runId: string, evidence: string, firstObservedAt: string): string {
  return sql([
    "INSERT INTO historical_subscription_backfill_plan (",
    "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
    ") VALUES ('" + runId + "', 0, '" + CUSTOMER + "', '" + evidence + "',",
    "  '" + firstObservedAt + "', 'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
  ]);
}

function approveRun(database: string, runId: string, suffix: string): void {
  run(database, approveRunStatement(runId, suffix, APPROVED));
}

function approveRunStatement(runId: string, suffix: string, approvedAt: string): string {
  return sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET approval_ref = '" + APPROVAL + "', approved_at = '" + approvedAt + "',",
    "  apply_state = 'APPROVED', lifecycle_audit_id = '" + lifecycleId(suffix) + "'",
    "WHERE run_id = '" + runId + "'",
  ]);
}

function beginApply(database: string, runId: string, suffix: string): void {
  run(database, beginApplyStatement(runId, suffix, APPLIED));
}

function beginApplyStatement(runId: string, suffix: string, applyStartedAt: string): string {
  return sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET apply_state = 'APPLYING', apply_started_at = '" + applyStartedAt + "',",
    "  lifecycle_audit_id = '" + lifecycleId(suffix) + "'",
    "WHERE run_id = '" + runId + "'",
  ]);
}

function historyInsert(runId: string, evidence: string): string {
  return historyInsertAt(runId, evidence, "2026-08-15T12:00:00.000Z", APPLIED);
}

function historyInsertAt(runId: string, evidence: string, establishedAt: string, recordedAt: string): string {
  return sql([
    "INSERT INTO historical_subscription_history (",
    "  customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at",
    ") VALUES ('" + CUSTOMER + "', '" + establishedAt + "', '" + runId + "',",
    "  '" + evidence + "', 'APPSTLE_EXPORT', '" + recordedAt + "')",
  ]);
}

function insertFactAudit(database: string, runId: string, digest: string, suffix: string): void {
  run(database, factAuditInsertAt(runId, digest, suffix, APPLIED));
}

function factAuditInsertAt(runId: string, digest: string, suffix: string, occurredAt: string): string {
  return sql([
    "INSERT INTO historical_subscription_backfill_audit (",
    "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
    ") VALUES ('" + factAuditId(suffix) + "', '" + runId + "',",
    "  'EVER_SUBSCRIBED_RECORDED', '" + CUSTOMER + "', '" + APPROVAL + "',",
    "  '" + digest + "', '" + occurredAt + "')",
  ]);
}

function finishApplied(database: string, runId: string, suffix: string): void {
  run(database, sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET status = 'APPLIED', apply_state = 'APPLIED', finalized_at = '" + APPLIED + "',",
    "  lifecycle_audit_id = '" + lifecycleId(suffix) + "'",
    "WHERE run_id = '" + runId + "'",
  ]));
}

function finishNeedsReview(database: string, runId: string, suffix: string): void {
  run(database, finishNeedsReviewStatement(runId, suffix, APPLIED));
}

function finishNeedsReviewStatement(runId: string, suffix: string, finalizedAt: string): string {
  return sql([
    "UPDATE historical_subscription_backfill_runs",
    "SET apply_state = 'NEEDS_REVIEW', finalized_at = '" + finalizedAt + "',",
    "  lifecycle_audit_id = '" + lifecycleId(suffix) + "'",
    "WHERE run_id = '" + runId + "'",
  ]);
}

function conflictInsert(
  runId: string,
  competingRunId: string,
  reason: "ALREADY_RECORDED_BY_ANOTHER_RUN",
  detectedAt: string,
): string {
  return sql([
    "INSERT INTO historical_subscription_backfill_apply_conflicts (",
    "  run_id, customer_id, competing_run_id, reason, detected_at",
    ") VALUES ('" + runId + "', '" + CUSTOMER + "', '" + competingRunId + "',",
    "  '" + reason + "', '" + detectedAt + "')",
  ]);
}

function factAuditId(suffix: string): string {
  return "hbaudit_" + suffix.repeat(32);
}

function lifecycleId(suffix: string): string {
  return "hblcaudit_" + suffix.repeat(32);
}

function withDatabase(work: (database: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "basenote-history-schema-"));
  const database = join(directory, "history.db");
  try {
    work(database);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function mustReject(database: string, statement: string, error: RegExp): void {
  const result = invokeSqlite(database, statement);
  assert.notEqual(result.status, 0, "SQLite unexpectedly accepted a rejected historical backfill write.");
  assert.match(result.stderr, error);
}

function run(database: string, statement: string): string {
  const result = invokeSqlite(database, statement);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function invokeSqlite(database: string, statement: string) {
  const result = spawnSync("sqlite3", [database], {
    encoding: "utf8",
    input: statement,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function sql(lines: readonly string[]): string {
  return lines.join("\n") + "\n";
}
