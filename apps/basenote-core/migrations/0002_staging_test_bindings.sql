-- Staging-only authorization records for disposable development-store tests.
--
-- Apply only after 0001_staging_runtime.sql to a separately approved empty
-- staging D1 database. This migration creates no customer binding by itself.
-- A designated operator must seed one exact disposable-store binding manually
-- after review; without it the Worker denies every signed customer request.
--
-- Never insert names, email addresses, payment data, Appstle credentials, or
-- production records. All fields below are opaque Shopify/worker references.

CREATE TABLE IF NOT EXISTS staging_profile_queue_test_bindings (
  shop_domain TEXT NOT NULL,
  shopify_customer_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  actor_ref TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source = 'DISPOSABLE_DEVELOPMENT_STORE'),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  seed_ref TEXT NOT NULL,
  seeded_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (shop_domain, shopify_customer_id, cycle_key),
  UNIQUE (binding_id, cycle_key),
  CHECK (expires_at > seeded_at),
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- This lookup deliberately requires every authorization dimension. It cannot
-- find a customer's arbitrary/first active contract or authorize a different
-- delivery cycle with the same customer ID.
CREATE INDEX IF NOT EXISTS staging_test_bindings_active_lookup
  ON staging_profile_queue_test_bindings (
    shop_domain,
    shopify_customer_id,
    cycle_key,
    ship_month,
    status,
    expires_at
  );

-- One-use, short-lived form nonces protect signed App Proxy form posts from
-- cross-site intent replay. They are bound to the same exact disposable scope
-- as the test binding and may not be used as a general customer session.
CREATE TABLE IF NOT EXISTS staging_profile_queue_form_nonces (
  form_nonce TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  shopify_customer_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS staging_profile_queue_form_nonces_expiry
  ON staging_profile_queue_form_nonces (expires_at, consumed_at);
