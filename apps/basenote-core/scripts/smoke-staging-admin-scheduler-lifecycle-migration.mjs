import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = [
  "0001_staging_runtime.sql",
  "0002_staging_test_bindings.sql",
  "0003_member_fragrance_choice.sql",
  "0004_durable_historical_backfill.sql",
  "0005_staging_admin_scheduler.sql",
  "0006_staging_admin_scheduler_lifecycle.sql",
]
  .map(readMigration)
  .join("\n");
const smokeDirectory = mkdtempSync(join(tmpdir(), "basenote-0006-smoke-"));

try {
  const database = join(smokeDirectory, "admin-scheduler-lifecycle.sqlite");
  run(database, migrations);
  smokeCommandReplayAndLifecycle(database);
  smokeProvisionedRecoveryException(database);
  process.stdout.write("0006 staging Admin scheduler lifecycle migration smoke passed.\n");
} finally {
  rmSync(smokeDirectory, { force: true, recursive: true });
}

function smokeCommandReplayAndLifecycle(database) {
  run(database, `
    INSERT INTO profile_queue_fotm_schedules (
      ship_month, variant_id, cutoff_at, merchant_timezone, status,
      revision, last_mutation_id, last_action, updated_at
    ) VALUES (
      '2030-10', 'gid://shopify/ProductVariant/901', '2030-10-10T05:01:00.000Z',
      'America/Chicago', 'DRAFT', 0, 'pfs-life-draft-001', 'SCHEDULED',
      '2030-09-01T00:00:00.000Z'
    );
    UPDATE profile_queue_fotm_schedules
    SET status = 'PUBLISHED', revision = 1, last_mutation_id = 'pfs-life-publish-001',
      last_action = 'PUBLISHED', updated_at = '2030-09-02T00:00:00.000Z'
    WHERE ship_month = '2030-10';
    INSERT INTO profile_queue_fotm_provision_commands (
      idempotency_key, actor_ref, ship_month, expected_schedule_revision,
      candidate_plan_json, status, configured_count, conflicted_count,
      created_at, completed_at
    ) VALUES (
      'pfk_life_provision_001', 'staff_stage_001', '2030-10', 1,
      '[]', 'PENDING', NULL, NULL, '2030-09-02T00:00:00.000Z', NULL
    );
  `);

  const pendingRetire = invoke(database, `
    UPDATE profile_queue_fotm_schedules
    SET status = 'RETIRED', revision = 2, last_mutation_id = 'pfs-life-retire-pending',
      last_action = 'RETIRED', updated_at = '2030-09-03T00:00:00.000Z'
    WHERE ship_month = '2030-10';
  `);
  assert.notEqual(pendingRetire.status, 0, "a pending provision command must block schedule retirement.");

  run(database, `
    UPDATE profile_queue_fotm_provision_commands
    SET status = 'COMPLETED', configured_count = 0, conflicted_count = 0,
      completed_at = '2030-09-02T00:01:00.000Z'
    WHERE idempotency_key = 'pfk_life_provision_001';
    INSERT INTO profile_queue_fotm_provision_commands (
      idempotency_key, actor_ref, ship_month, expected_schedule_revision,
      candidate_plan_json, status, configured_count, conflicted_count,
      created_at, completed_at
    ) VALUES (
      'pfk_life_recovery_pending_001', 'staff_stage_001', '2030-10', 1,
      '[]', 'PENDING', NULL, NULL, '2030-09-02T00:00:00.000Z', NULL
    );
  `);
  assert.equal(
    run(database, `
      SELECT GROUP_CONCAT(action, ',')
      FROM profile_queue_fotm_provision_command_audit
      WHERE idempotency_key = 'pfk_life_provision_001'
      ORDER BY action;
    `).trim(),
    "CLAIMED,COMPLETED",
    "claim and completion must emit immutable command audit evidence.",
  );
  const tooSoonAttention = invoke(database, `
    UPDATE profile_queue_fotm_provision_commands
    SET status = 'NEEDS_ATTENTION', attention_at = '2030-09-02T00:14:59.000Z'
    WHERE idempotency_key = 'pfk_life_recovery_pending_001';
  `);
  assert.notEqual(tooSoonAttention.status, 0, "needs-attention terminalization must wait past the 15-minute recovery delay.");
  run(database, `
    UPDATE profile_queue_fotm_provision_commands
    SET status = 'NEEDS_ATTENTION', attention_at = '2030-09-02T00:15:00.000Z'
    WHERE idempotency_key = 'pfk_life_recovery_pending_001';
    INSERT INTO profile_queue_fotm_provision_commands (
      idempotency_key, actor_ref, ship_month, expected_schedule_revision,
      candidate_plan_json, status, configured_count, conflicted_count,
      created_at, completed_at
    ) VALUES (
      'pfk_life_hour_pending_001', 'staff_stage_001', '2030-10', 1,
      '[]', 'PENDING', NULL, NULL, '2030-09-02T00:02:00.000Z', NULL
    );
  `);
  assert.equal(
    run(database, `
      SELECT GROUP_CONCAT(action, ',')
      FROM profile_queue_fotm_provision_command_audit
      WHERE idempotency_key = 'pfk_life_recovery_pending_001'
      ORDER BY action;
    `).trim(),
    "CLAIMED,NEEDS_ATTENTION",
    "an aged unknown-outcome claim must gain immutable terminal needs-attention evidence.",
  );
  const duplicatePending = invoke(database, `
    INSERT INTO profile_queue_fotm_provision_commands (
      idempotency_key, actor_ref, ship_month, expected_schedule_revision,
      candidate_plan_json, status, configured_count, conflicted_count,
      created_at, completed_at
    ) VALUES (
      'pfk_life_duplicate_pending_001', 'staff_stage_001', '2030-10', 1,
      '[]', 'PENDING', NULL, NULL, '2030-09-02T00:16:00.000Z', NULL
    );
  `);
  assert.notEqual(duplicatePending.status, 0, "only one active provision recovery handle may exist per ship month.");
  for (const [label, sql] of [
    ["stale command claim", `
      INSERT INTO profile_queue_fotm_provision_commands (
        idempotency_key, actor_ref, ship_month, expected_schedule_revision,
        candidate_plan_json, status, configured_count, conflicted_count, created_at, completed_at
      ) VALUES (
        'pfk_life_stale_001', 'staff_stage_001', '2030-10', 0,
        '[]', 'PENDING', NULL, NULL, '2030-09-03T00:00:00.000Z', NULL
      );
    `],
    ["append-only command rewrite", `
      UPDATE profile_queue_fotm_provision_commands
      SET configured_count = 1
      WHERE idempotency_key = 'pfk_life_provision_001';
    `],
    ["24-hour provision created timestamp", `
      INSERT INTO profile_queue_fotm_provision_commands (
        idempotency_key, actor_ref, ship_month, expected_schedule_revision,
        candidate_plan_json, status, configured_count, conflicted_count,
        created_at, completed_at
      ) VALUES (
        'pfk_life_hour_created_001', 'staff_stage_001', '2030-10', 1,
        '[]', 'PENDING', NULL, NULL, '2030-09-02T24:00:00.000Z', NULL
      );
    `],
    ["24-hour provision completed timestamp", `
      UPDATE profile_queue_fotm_provision_commands
      SET status = 'COMPLETED', configured_count = 0, conflicted_count = 0,
        completed_at = '2030-09-02T24:03:00.000Z'
      WHERE idempotency_key = 'pfk_life_hour_pending_001';
    `],
    ["24-hour provision attention timestamp", `
      UPDATE profile_queue_fotm_provision_commands
      SET status = 'NEEDS_ATTENTION', attention_at = '2030-09-02T24:15:00.000Z'
      WHERE idempotency_key = 'pfk_life_hour_pending_001';
    `],
    ["needs-attention command completion", `
      UPDATE profile_queue_fotm_provision_commands
      SET status = 'COMPLETED', configured_count = 0, conflicted_count = 0,
        completed_at = '2030-09-02T00:16:00.000Z'
      WHERE idempotency_key = 'pfk_life_recovery_pending_001';
    `],
    ["silent published variant rewrite", `
      UPDATE profile_queue_fotm_schedules
      SET variant_id = 'gid://shopify/ProductVariant/902', status = 'PUBLISHED', revision = 2,
        last_mutation_id = 'pfs-life-silent-001', last_action = 'PUBLISHED',
        updated_at = '2030-09-03T00:00:00.000Z'
      WHERE ship_month = '2030-10';
    `],
  ]) {
    const result = invoke(database, sql);
    assert.notEqual(result.status, 0, `${label} must fail closed.`);
  }
}

function smokeProvisionedRecoveryException(database) {
  run(database, `
    INSERT INTO profile_queue_cycles (
      binding_id, cycle_key, ship_month, state, revision, fotm_variant_id,
      fotm_status, fotm_cutoff_at, merchant_timezone, last_mutation_id, updated_at
    ) VALUES (
      'binding-life-001', 'cycle-life-001', '2030-10', 'OPEN', 1,
      'gid://shopify/ProductVariant/901', 'PUBLISHED', '2030-10-10T05:01:00.000Z',
      'America/Chicago', 'pqm-life-cycle-001', '2030-09-03T00:00:00.000Z'
    );
  `);
  const blockedRetire = invoke(database, `
    UPDATE profile_queue_fotm_schedules
    SET status = 'RETIRED', revision = 2, last_mutation_id = 'pfs-life-retire-001',
      last_action = 'RETIRED', updated_at = '2030-09-03T00:00:00.000Z'
    WHERE ship_month = '2030-10';
  `);
  assert.notEqual(blockedRetire.status, 0, "a provisioned FOTM cycle must block retirement and split-month recovery.");

  run(database, `
    INSERT INTO profile_queue_fotm_schedule_recovery_exceptions (
      idempotency_key, actor_ref, ship_month, expected_revision, reason, occurred_at
    ) VALUES (
      'pfk_life_exception_001', 'staff_stage_001', '2030-10', 1,
      'PROVISIONED_CYCLES', '2030-09-03T00:00:00.000Z'
    );
  `);
  for (const [label, sql] of [
    ["24-hour recovery exception timestamp", `
      INSERT INTO profile_queue_fotm_schedule_recovery_exceptions (
        idempotency_key, actor_ref, ship_month, expected_revision, reason, occurred_at
      ) VALUES (
        'pfk_life_hour_exception_001', 'staff_stage_001', '2030-10', 1,
        'PROVISIONED_CYCLES', '2030-09-03T24:00:00.000Z'
      );
    `],
    ["recovery exception rewrite", `
      UPDATE profile_queue_fotm_schedule_recovery_exceptions
      SET reason = 'PROVISIONED_CYCLES'
      WHERE idempotency_key = 'pfk_life_exception_001';
    `],
    ["recovery exception delete", `
      DELETE FROM profile_queue_fotm_schedule_recovery_exceptions
      WHERE idempotency_key = 'pfk_life_exception_001';
    `],
  ]) {
    const result = invoke(database, sql);
    assert.notEqual(result.status, 0, `${label} must remain append-only.`);
  }
}

function readMigration(name) {
  return readFileSync(resolve(root, "migrations", name), "utf8");
}

function run(database, sql) {
  const result = invoke(database, sql);
  assert.equal(result.status, 0, result.stderr || `sqlite3 failed while running 0006 migration smoke for ${database}.`);
  return result.stdout;
}

function invoke(database, sql) {
  const result = spawnSync("sqlite3", ["-bail", database], { encoding: "utf8", input: sql });
  if (result.error) throw new Error(`sqlite3 is required for migration smoke: ${result.error.message}`);
  return result;
}
