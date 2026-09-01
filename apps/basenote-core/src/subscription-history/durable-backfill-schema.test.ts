import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = [
  readFileSync(resolve(coreRoot, "migrations/0001_staging_runtime.sql"), "utf8"),
  readFileSync(resolve(coreRoot, "migrations/0004_durable_historical_backfill.sql"), "utf8"),
].join("\n");

const RUN_ONE = "hbr_run00001";
const RUN_TWO = "hbr_run00002";
const CUSTOMER = "gid://shopify/Customer/101";
const EVIDENCE = "appstle/export-row-001";
const REQUESTED = "2026-09-01T09:00:00.000Z";
const APPROVED = "2026-09-01T09:05:00.000Z";
const APPLIED = "2026-09-01T09:10:00.000Z";
const APPROVAL = "hba_review0001";
const DIGEST_ONE = "1".repeat(64);
const DIGEST_TWO = "2".repeat(64);

test("durable historical backfill schema rejects malformed writes and enforces one-way audited state", () => {
  const directory = mkdtempSync(join(tmpdir(), "basenote-history-schema-"));
  const database = join(directory, "history.db");
  try {
    run(database, migration);
    createDryRun(database, RUN_ONE, DIGEST_ONE, "1");
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_plan (",
        "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
        ") VALUES ('" + RUN_ONE + "', 0, 'opaque@invalid', '" + EVIDENCE + "',",
        "  '2026-08-15T12:00:00.000Z', 'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
      ]),
      /opaque unapproved dry-run manifest/,
    );
    insertPlan(database, RUN_ONE);
    mustReject(
      database,
      historyInsert(RUN_ONE),
      /approved applying plan/,
    );
    mustReject(
      database,
      sql([
        "UPDATE historical_subscription_backfill_runs",
        "SET approval_ref = '" + APPROVAL + "', approved_at = '" + APPROVED + "',",
        "  apply_state = 'APPROVED', lifecycle_audit_id = 'hblcaudit_9999999999999999'",
        "WHERE run_id = '" + RUN_ONE + "'",
      ]),
      /one-way and requires a matching audit/,
    );

    approveRun(database, RUN_ONE, DIGEST_ONE, "1");
    mustReject(
      database,
      sql([
        "INSERT INTO historical_subscription_backfill_plan (",
        "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
        ") VALUES ('" + RUN_ONE + "', 1, 'gid://shopify/Customer/102', 'appstle/export-row-002',",
        "  '2026-08-15T12:00:00.000Z', 'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
      ]),
      /opaque unapproved dry-run manifest/,
    );
    beginApply(database, RUN_ONE, DIGEST_ONE, "1");
    run(database, historyInsert(RUN_ONE));
    insertFactAudit(database, RUN_ONE, DIGEST_ONE, "1");
    mustReject(
      database,
      "UPDATE historical_subscription_history SET evidence_ref = 'different-evidence' WHERE customer_id = '" + CUSTOMER + "'",
      /immutable/,
    );
    mustReject(
      database,
      "DELETE FROM historical_subscription_history WHERE customer_id = '" + CUSTOMER + "'",
      /immutable/,
    );
    finishApplied(database, RUN_ONE, DIGEST_ONE, "1");
    mustReject(
      database,
      "UPDATE historical_subscription_backfill_runs SET apply_state = 'APPROVED' WHERE run_id = '" + RUN_ONE + "'",
      /one-way and requires a matching audit/,
    );

    createDryRun(database, RUN_TWO, DIGEST_TWO, "2");
    insertPlan(database, RUN_TWO);
    approveRun(database, RUN_TWO, DIGEST_TWO, "2");
    beginApply(database, RUN_TWO, DIGEST_TWO, "2");
    run(database, sql([
      "INSERT INTO historical_subscription_backfill_apply_conflicts (",
      "  run_id, customer_id, competing_run_id, reason, detected_at",
      ") VALUES ('" + RUN_TWO + "', '" + CUSTOMER + "', '" + RUN_ONE + "',",
      "  'ALREADY_RECORDED_BY_ANOTHER_RUN', '" + APPLIED + "')",
    ]));
    finishNeedsReview(database, RUN_TWO, DIGEST_TWO, "2");
    const state = run(database, sql([
      "SELECT apply_state || '|' ||",
      "  (SELECT COUNT(*) FROM historical_subscription_history",
      "   WHERE established_by_run_id = '" + RUN_TWO + "')",
      "FROM historical_subscription_backfill_runs",
      "WHERE run_id = '" + RUN_TWO + "'",
    ])).trim();
    assert.equal(state, "NEEDS_REVIEW|0");
    mustReject(
      database,
      "UPDATE historical_subscription_backfill_apply_conflicts SET reason = 'ALREADY_RECORDED_BY_ANOTHER_RUN' WHERE run_id = '" + RUN_TWO + "'",
      /append-only/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
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
    ") VALUES ('hbaudit_" + suffix.repeat(16) + "', '" + runId + "', 'DRY_RUN_COMPLETED',",
    "  NULL, NULL, '" + digest + "', '" + REQUESTED + "')",
  ]));
}

function insertPlan(database: string, runId: string): void {
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_plan (",
    "  run_id, decision_ordinal, customer_id, evidence_ref, first_observed_at, source, disposition",
    ") VALUES ('" + runId + "', 0, '" + CUSTOMER + "', '" + EVIDENCE + "',",
    "  '2026-08-15T12:00:00.000Z', 'APPSTLE_EXPORT', 'WILL_RECORD_EVER_SUBSCRIBED')",
  ]));
}

function approveRun(database: string, runId: string, digest: string, suffix: string): void {
  const lifecycleId = "hblcaudit_" + suffix.repeat(16);
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
    "  audit_id, run_id, action, approval_ref, digest, occurred_at",
    ") VALUES ('" + lifecycleId + "', '" + runId + "', 'RUN_APPROVED',",
    "  '" + APPROVAL + "', '" + digest + "', '" + APPROVED + "')",
    ";",
    "UPDATE historical_subscription_backfill_runs",
    "SET approval_ref = '" + APPROVAL + "', approved_at = '" + APPROVED + "',",
    "  apply_state = 'APPROVED', lifecycle_audit_id = '" + lifecycleId + "'",
    "WHERE run_id = '" + runId + "'",
  ]));
}

function beginApply(database: string, runId: string, digest: string, suffix: string): void {
  const lifecycleId = "hblcaudit_a" + suffix.repeat(15);
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
    "  audit_id, run_id, action, approval_ref, digest, occurred_at",
    ") VALUES ('" + lifecycleId + "', '" + runId + "', 'RUN_APPLYING',",
    "  '" + APPROVAL + "', '" + digest + "', '" + APPLIED + "')",
    ";",
    "UPDATE historical_subscription_backfill_runs",
    "SET apply_state = 'APPLYING', apply_started_at = '" + APPLIED + "',",
    "  lifecycle_audit_id = '" + lifecycleId + "'",
    "WHERE run_id = '" + runId + "'",
  ]));
}

function historyInsert(runId: string): string {
  return sql([
    "INSERT INTO historical_subscription_history (",
    "  customer_id, established_at, established_by_run_id, evidence_ref, source, recorded_at",
    ") VALUES ('" + CUSTOMER + "', '2026-08-15T12:00:00.000Z', '" + runId + "',",
    "  '" + EVIDENCE + "', 'APPSTLE_EXPORT', '" + APPLIED + "')",
  ]);
}

function insertFactAudit(database: string, runId: string, digest: string, suffix: string): void {
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_audit (",
    "  audit_id, run_id, action, customer_id, approval_ref, digest, occurred_at",
    ") VALUES ('hbaudit_a" + suffix.repeat(15) + "', '" + runId + "',",
    "  'EVER_SUBSCRIBED_RECORDED', '" + CUSTOMER + "', '" + APPROVAL + "',",
    "  '" + digest + "', '" + APPLIED + "')",
  ]));
}

function finishApplied(database: string, runId: string, digest: string, suffix: string): void {
  const lifecycleId = "hblcaudit_b" + suffix.repeat(15);
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
    "  audit_id, run_id, action, approval_ref, digest, occurred_at",
    ") VALUES ('" + lifecycleId + "', '" + runId + "', 'RUN_APPLIED',",
    "  '" + APPROVAL + "', '" + digest + "', '" + APPLIED + "')",
    ";",
    "UPDATE historical_subscription_backfill_runs",
    "SET status = 'APPLIED', apply_state = 'APPLIED', finalized_at = '" + APPLIED + "',",
    "  lifecycle_audit_id = '" + lifecycleId + "'",
    "WHERE run_id = '" + runId + "'",
  ]));
}

function finishNeedsReview(database: string, runId: string, digest: string, suffix: string): void {
  const lifecycleId = "hblcaudit_b" + suffix.repeat(15);
  run(database, sql([
    "INSERT INTO historical_subscription_backfill_lifecycle_audit (",
    "  audit_id, run_id, action, approval_ref, digest, occurred_at",
    ") VALUES ('" + lifecycleId + "', '" + runId + "', 'RUN_NEEDS_REVIEW',",
    "  '" + APPROVAL + "', '" + digest + "', '" + APPLIED + "')",
    ";",
    "UPDATE historical_subscription_backfill_runs",
    "SET apply_state = 'NEEDS_REVIEW', finalized_at = '" + APPLIED + "',",
    "  lifecycle_audit_id = '" + lifecycleId + "'",
    "WHERE run_id = '" + runId + "'",
  ]));
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
