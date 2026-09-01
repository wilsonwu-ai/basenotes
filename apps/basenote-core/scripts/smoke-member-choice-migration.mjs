import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration001 = readMigration("0001_staging_runtime.sql");
const migration002 = readMigration("0002_staging_test_bindings.sql");
const migration003 = readMigration("0003_member_fragrance_choice.sql");
const baseSchema = `${migration001}\n${migration002}`;
const smokeDirectory = mkdtempSync(join(tmpdir(), "basenote-0003-smoke-"));

try {
  smokeFreshMigration();
  smokeScheduleCutoffExactness();
  smokeLegacyResolvedBackfill();
  assertLegacyRejectionLeavesNo0003Artifacts("invalid-cutoff", `
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-invalid-cutoff', 'cycle-invalid-cutoff', '2026-09', 'OPEN', 0,
      'gid://shopify/ProductVariant/601', 'PUBLISHED', '2026-09-10T06:01:00.000Z',
      'America/Chicago', 'pqm-invalid-cutoff', '2026-09-01T00:00:00.000Z'
    );
  `);
  assertLegacyRejectionLeavesNo0003Artifacts("invalid-calendar", `
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-invalid-calendar', 'cycle-invalid-calendar', '2026-02', 'OPEN', 0,
      'gid://shopify/ProductVariant/606', 'PUBLISHED', '2026-02-30T06:01:00.000Z',
      'America/Chicago', 'pqm-invalid-calendar', '2026-02-01T00:00:00.000Z'
    );
  `);
  assertLegacyRejectionLeavesNo0003Artifacts("ambiguous-closed", `
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-ambiguous-closed', 'cycle-ambiguous-closed', '2026-09', 'LOCKED', 0,
      'gid://shopify/ProductVariant/602', 'PUBLISHED', '2026-09-10T05:01:00.000Z',
      'America/Chicago', 'pqm-ambiguous-closed', '2026-09-01T00:00:00.000Z'
    );
  `);
  smokeEvidenceReconciliation();
  process.stdout.write("0003 member-fragrance migration smoke passed.\n");
} finally {
  rmSync(smokeDirectory, { force: true, recursive: true });
}

function smokeFreshMigration() {
  const database = databasePath("fresh");
  run(database, `${baseSchema}\n${migration003}`);
  const output = run(database, `
    SELECT COUNT(*)
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('profile_queue_fotm_schedules', 'profile_queue_selection_evidence');
  `);
  assert.equal(output.trim(), "2", "0003 must create both durable schedule and selection-evidence tables.");
}

function smokeScheduleCutoffExactness() {
  const database = databasePath("schedule-cutoff");
  run(database, `${baseSchema}\n${migration003}`);
  for (const [label, invalidCutoff] of [
    ["normalized invalid calendar date", "2030-02-30T06:01:00.000Z"],
    ["subsecond cutoff", "2030-10-01T05:01:00.999Z"],
  ]) {
    const result = invoke(database, `
      INSERT INTO profile_queue_fotm_schedules (
        ship_month, variant_id, cutoff_at, merchant_timezone, status,
        revision, last_mutation_id, updated_at
      ) VALUES (
        '2030-10', 'gid://shopify/ProductVariant/607', '${invalidCutoff}',
        'America/Chicago', 'DRAFT', 0, 'pfm-schedule-cutoff',
        '2030-01-01T00:00:00.000Z'
      );
    `);
    assert.notEqual(
      result.status,
      0,
      `a ${label} must not become a durable future-month FOTM cutoff.`,
    );
  }
}

function smokeLegacyResolvedBackfill() {
  const database = databasePath("legacy-resolved");
  run(database, `${baseSchema}
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-legacy-resolved', 'cycle-legacy-resolved', '2026-09', 'LOCKED', 2,
      'gid://shopify/ProductVariant/603', 'RESOLVED', '2026-09-10T05:01:00.000Z',
      'America/Chicago', 'pqm-legacy-resolved', '2026-09-10T05:01:00.000Z'
    );
  `);
  run(database, migration003);
  const output = run(database, `
    SELECT member_choice_source, member_choice_variant_id, member_choice_selected_at
    FROM profile_queue_cycles
    WHERE binding_id = 'binding-legacy-resolved' AND cycle_key = 'cycle-legacy-resolved';
  `);
  assert.equal(
    output.trim(),
    "FOTM_FALLBACK|gid://shopify/ProductVariant/603|2026-09-10T05:01:00.000Z",
    "a legacy resolved cycle must deterministically become an FOTM fallback, never an invented override.",
  );
}

function assertLegacyRejectionLeavesNo0003Artifacts(label, seedSql) {
  const database = databasePath(label);
  run(database, `${baseSchema}\n${seedSql}`);
  const rejected = invoke(database, migration003);
  assert.notEqual(rejected.status, 0, `${label} legacy row must stop 0003 before persistent DDL.`);

  const schemaObjects = run(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('profile_queue_fotm_schedules', 'profile_queue_selection_evidence');
  `);
  assert.equal(schemaObjects.trim(), "", `${label} rejection must not leave 0003 tables behind.`);
  const cycleColumns = run(database, "PRAGMA table_info(profile_queue_cycles);");
  assert.doesNotMatch(cycleColumns, /member_choice_/, `${label} rejection must not leave 0003 cycle columns behind.`);
}

function smokeEvidenceReconciliation() {
  const database = databasePath("evidence");
  run(database, `${baseSchema}\n${migration003}
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-evidence', 'cycle-evidence', '2030-10', 'OPEN', 1,
      'gid://shopify/ProductVariant/604', 'PUBLISHED', '2030-10-01T05:01:00.000Z',
      'America/Chicago', 'pqm-evidence', '2030-09-01T00:00:00.000Z'
    );
    INSERT INTO profile_queue_add_ons (
      binding_id, cycle_key, add_on_id, position, variant_id,
      unit_price_cents, created_at, updated_at
    ) VALUES (
      'binding-evidence', 'cycle-evidence', 'pqa-evidence', 1,
      'gid://shopify/ProductVariant/605', 1800,
      '2030-09-01T00:00:00.000Z', '2030-09-01T00:00:00.000Z'
    );
    INSERT INTO profile_queue_mutation_audit (
      mutation_id, idempotency_key, actor_ref, binding_id, cycle_key, mutation_kind,
      expected_revision, resulting_revision, occurred_at
    ) VALUES (
      'pqm-evidence', 'pqk-evidence', 'staff-evidence',
      'binding-evidence', 'cycle-evidence', 'ADD_ADD_ON', 0, 1,
      '2030-09-01T00:00:00.000Z'
    );
  `);
  for (const [label, invalidCutoff] of [
    ["wrong Central wall-clock", "2030-10-01T06:01:00.000Z"],
    ["normalized invalid calendar date", "2030-02-30T06:01:00.000Z"],
    ["subsecond cutoff", "2030-10-01T05:01:00.999Z"],
  ]) {
    const invalidCutoffRewrite = invoke(database, `
      UPDATE profile_queue_cycles
      SET fotm_cutoff_at = '${invalidCutoff}'
      WHERE binding_id = 'binding-evidence' AND cycle_key = 'cycle-evidence';
    `);
    assert.notEqual(
      invalidCutoffRewrite.status,
      0,
      `a direct ${label} rewrite must remain subject to the exact Central 12:01 AM guard.`,
    );
  }
  const mismatchedSnapshot = invoke(database, `
    INSERT INTO profile_queue_selection_evidence (
      evidence_id, mutation_id, binding_id, cycle_key, event_kind,
      member_choice_source, member_choice_variant_id, add_on_snapshot_json,
      resulting_revision, occurred_at
    ) VALUES (
      'pqe-evidence-mismatch', 'pqm-evidence', 'binding-evidence', 'cycle-evidence',
      'ADD_ONS_CHANGED', 'UNSELECTED', NULL, '[]', 1,
      '2030-09-01T00:00:00.000Z'
    );
  `);
  assert.notEqual(
    mismatchedSnapshot.status,
    0,
    "selection evidence must reject a snapshot that omits a durable paid add-on.",
  );
  run(database, `
    INSERT INTO profile_queue_selection_evidence (
      evidence_id, mutation_id, binding_id, cycle_key, event_kind,
      member_choice_source, member_choice_variant_id, add_on_snapshot_json,
      resulting_revision, occurred_at
    ) VALUES (
      'pqe-evidence', 'pqm-evidence', 'binding-evidence', 'cycle-evidence',
      'ADD_ONS_CHANGED', 'UNSELECTED', NULL,
      '[{"position":1,"variantId":"gid://shopify/ProductVariant/605"}]', 1,
      '2030-09-01T00:00:00.000Z'
    );
  `);
  const result = invoke(database, `
    UPDATE profile_queue_selection_evidence
    SET add_on_snapshot_json = '[]'
    WHERE evidence_id = 'pqe-evidence';
  `);
  assert.notEqual(result.status, 0, "selection evidence must stay append-only after a valid audited write.");
}

function readMigration(name) {
  return readFileSync(resolve(root, "migrations", name), "utf8");
}

function databasePath(label) {
  return join(smokeDirectory, `${label}.sqlite`);
}

function run(database, sql) {
  const result = invoke(database, sql);
  assert.equal(result.status, 0, result.stderr || `sqlite3 failed while running migration smoke for ${database}.`);
  return result.stdout;
}

function invoke(database, sql) {
  const result = spawnSync("sqlite3", ["-bail", database], {
    encoding: "utf8",
    input: sql,
  });
  if (result.error) {
    throw new Error(`sqlite3 is required for migration smoke: ${result.error.message}`);
  }
  return result;
}
