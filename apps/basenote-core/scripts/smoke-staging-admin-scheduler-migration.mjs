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
  // Imported byte-for-byte from staging head; its lifecycle implementation is
  // deliberately separate from this scheduler work.
  "0004_durable_historical_backfill.sql",
  "0005_staging_admin_scheduler.sql",
]
  .map(readMigration)
  .join("\n");
const smokeDirectory = mkdtempSync(join(tmpdir(), "basenote-0004-smoke-"));

try {
  const database = join(smokeDirectory, "admin-scheduler.sqlite");
  run(database, migrations);
  const table = run(database, `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'staging_admin_id_token_replays';
  `);
  assert.equal(table.trim(), "staging_admin_id_token_replays");

  const digest = "a".repeat(43);
  run(database, `
    INSERT INTO staging_admin_id_token_replays (token_digest, expires_at, consumed_at)
    VALUES ('${digest}', '2030-10-01T05:02:00.000Z', '2030-10-01T05:01:00.000Z');
  `);

  for (const [label, sql] of [
    ["duplicate digest", `
      INSERT INTO staging_admin_id_token_replays (token_digest, expires_at, consumed_at)
      VALUES ('${digest}', '2030-10-01T05:02:00.000Z', '2030-10-01T05:01:00.000Z');
    `],
    ["non-digest value", `
      INSERT INTO staging_admin_id_token_replays (token_digest, expires_at, consumed_at)
      VALUES ('not-a-valid-token-digest', '2030-10-01T05:02:00.000Z', '2030-10-01T05:01:00.000Z');
    `],
    ["already expired token", `
      INSERT INTO staging_admin_id_token_replays (token_digest, expires_at, consumed_at)
      VALUES ('${"b".repeat(43)}', '2030-10-01T05:01:00.000Z', '2030-10-01T05:01:00.000Z');
    `],
    ["append-only update", `
      UPDATE staging_admin_id_token_replays
      SET expires_at = '2030-10-01T05:03:00.000Z'
      WHERE token_digest = '${digest}';
    `],
    ["append-only delete", `
      DELETE FROM staging_admin_id_token_replays WHERE token_digest = '${digest}';
    `],
  ]) {
    const result = invoke(database, sql);
    assert.notEqual(result.status, 0, `${label} must be rejected by 0005.`);
  }
  process.stdout.write("0005 staging Admin scheduler migration smoke passed.\n");
} finally {
  rmSync(smokeDirectory, { force: true, recursive: true });
}

function readMigration(name) {
  return readFileSync(resolve(root, "migrations", name), "utf8");
}

function run(database, sql) {
  const result = invoke(database, sql);
  assert.equal(result.status, 0, result.stderr || `sqlite3 failed while running migration smoke for ${database}.`);
  return result.stdout;
}

function invoke(database, sql) {
  const result = spawnSync("sqlite3", ["-bail", database], { encoding: "utf8", input: sql });
  if (result.error) throw new Error(`sqlite3 is required for migration smoke: ${result.error.message}`);
  return result;
}
