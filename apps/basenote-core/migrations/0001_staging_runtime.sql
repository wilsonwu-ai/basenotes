-- Base Note staging-runtime schema for Cloudflare D1 / SQLite.
--
-- This file is a reviewed artifact only. It is NOT executed by npm scripts,
-- this repository, or this branch. Apply it only to a separately approved,
-- isolated staging D1 database after a backup/rollback review.
--
-- It stores opaque Shopify IDs and audit references, never raw email addresses,
-- payment data, Appstle credentials, or provider payloads.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile_queue_cycles (
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'LOCKED', 'APPLIED', 'NEEDS_ATTENTION')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  fotm_variant_id TEXT,
  fotm_status TEXT NOT NULL CHECK (fotm_status IN ('UNPUBLISHED', 'PUBLISHED', 'RESOLVED')),
  fotm_cutoff_at TEXT,
  merchant_timezone TEXT,
  last_mutation_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (binding_id, cycle_key),
  CHECK (
    (fotm_status = 'UNPUBLISHED'
      AND fotm_variant_id IS NULL
      AND fotm_cutoff_at IS NULL
      AND merchant_timezone IS NULL)
    OR
    (fotm_status IN ('PUBLISHED', 'RESOLVED')
      AND fotm_variant_id IS NOT NULL
      AND fotm_cutoff_at IS NOT NULL
      AND merchant_timezone IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS profile_queue_add_ons (
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  add_on_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  variant_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents = 1800),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (binding_id, cycle_key, add_on_id),
  UNIQUE (binding_id, cycle_key, position),
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- This count guard remains necessary even though positions are capped: without
-- it a malformed write could create more than four non-contiguous rows.
CREATE TRIGGER IF NOT EXISTS profile_queue_add_ons_limit_insert
BEFORE INSERT ON profile_queue_add_ons
FOR EACH ROW
WHEN (
  SELECT COUNT(*)
  FROM profile_queue_add_ons
  WHERE binding_id = NEW.binding_id AND cycle_key = NEW.cycle_key
) >= 4
BEGIN
  SELECT RAISE(ABORT, 'profile queue add-on limit exceeded');
END;

CREATE TABLE IF NOT EXISTS profile_queue_mutation_audit (
  mutation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_ref TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  mutation_kind TEXT NOT NULL CHECK (
    mutation_kind IN ('CREATE_CYCLE', 'ADD_ADD_ON', 'CHANGE_ADD_ON', 'REMOVE_ADD_ON', 'PUBLISH_FOTM', 'RESOLVE_FOTM')
  ),
  expected_revision INTEGER,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- Audit rows are append-only. A correction must create a new reviewed event,
-- never rewrite what a customer or operator did at the time.
CREATE TRIGGER IF NOT EXISTS profile_queue_mutation_audit_no_update
BEFORE UPDATE ON profile_queue_mutation_audit
BEGIN
  SELECT RAISE(ABORT, 'profile queue audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_mutation_audit_no_delete
BEFORE DELETE ON profile_queue_mutation_audit
BEGIN
  SELECT RAISE(ABORT, 'profile queue audit is append-only');
END;

CREATE TABLE IF NOT EXISTS historical_subscription_history (
  customer_id TEXT PRIMARY KEY,
  established_at TEXT NOT NULL,
  established_by_run_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('APPSTLE_EXPORT', 'SHOPIFY_ORDER_EXPORT', 'MERCHANT_REVIEW')),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_subscription_backfill_runs (
  run_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRY_RUN_COMPLETE', 'APPLIED')),
  approval_ref TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS historical_subscription_backfill_audit (
  audit_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('DRY_RUN_COMPLETED', 'EVER_SUBSCRIBED_RECORDED')),
  customer_id TEXT,
  approval_ref TEXT,
  digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES historical_subscription_backfill_runs (run_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_audit_no_update
BEFORE UPDATE ON historical_subscription_backfill_audit
BEGIN
  SELECT RAISE(ABORT, 'historical backfill audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_audit_no_delete
BEFORE DELETE ON historical_subscription_backfill_audit
BEGIN
  SELECT RAISE(ABORT, 'historical backfill audit is append-only');
END;

CREATE INDEX IF NOT EXISTS profile_queue_cycles_by_month
  ON profile_queue_cycles (ship_month, state);

CREATE INDEX IF NOT EXISTS profile_queue_audit_by_cycle
  ON profile_queue_mutation_audit (binding_id, cycle_key, occurred_at);

CREATE INDEX IF NOT EXISTS historical_subscription_backfill_audit_by_run
  ON historical_subscription_backfill_audit (run_id, occurred_at);
