-- Staging-only replay protection for the authenticated embedded Admin FOTM
-- scheduler. Apply only after 0001–0004 through `wrangler d1 migrations
-- apply` to the isolated staging D1 database; never apply it to production or
-- by raw `sqlite3 < file` redirection.
--
-- The table intentionally retains only a SHA-256 base64url digest of an
-- already short-lived Shopify ID-token `jti`, plus expiry/consumption instants.
-- It never stores a bearer JWT, raw jti, staff ID, email, name, shop access
-- token, Appstle data, customer data, or provider payload.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS staging_admin_id_token_replays (
  token_digest TEXT PRIMARY KEY CHECK (
    length(token_digest) = 43
    AND token_digest NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  expires_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%S', expires_at) = substr(expires_at, 1, 19)
    AND (
      expires_at = substr(expires_at, 1, 19) || 'Z'
      OR expires_at = substr(expires_at, 1, 19) || '.000Z'
    )
  ),
  consumed_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%S', consumed_at) = substr(consumed_at, 1, 19)
    AND (
      consumed_at = substr(consumed_at, 1, 19) || 'Z'
      OR consumed_at = substr(consumed_at, 1, 19) || '.000Z'
    )
  ),
  CHECK (julianday(expires_at) > julianday(consumed_at))
);

CREATE INDEX IF NOT EXISTS staging_admin_id_token_replays_by_expiry
  ON staging_admin_id_token_replays (expires_at);

-- One-time replay records are audit evidence, not a mutable session cache.
-- Retention cleanup, if ever approved, must be a reviewed migration/process;
-- this Worker has no delete route or cleanup job.
CREATE TRIGGER IF NOT EXISTS staging_admin_id_token_replays_no_update
BEFORE UPDATE ON staging_admin_id_token_replays
BEGIN
  SELECT RAISE(ABORT, 'staging Admin token replay evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS staging_admin_id_token_replays_no_delete
BEFORE DELETE ON staging_admin_id_token_replays
BEGIN
  SELECT RAISE(ABORT, 'staging Admin token replay evidence is append-only');
END;
