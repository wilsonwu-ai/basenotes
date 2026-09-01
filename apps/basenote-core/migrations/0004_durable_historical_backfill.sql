-- Durable historical-subscription backfill lifecycle for the isolated staging
-- D1 database. It stores opaque Shopify IDs and source-qualified SHA-256
-- surrogates only. It never stores raw export rows, names, email addresses,
-- phone numbers, payment data, provider credentials, or customer-facing text.
--
-- This migration is schema-only. It is not a backfill runner and must never be
-- applied to production. Existing 0001 history/audit rows are explicitly
-- quarantined: they did not have an immutable reviewed plan under this schema.

PRAGMA foreign_keys = ON;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN apply_state TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
  CHECK (apply_state IN ('PENDING_APPROVAL', 'APPROVED', 'APPLYING', 'APPLIED', 'NEEDS_REVIEW'));

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN apply_started_at TEXT;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN finalized_at TEXT;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN lifecycle_audit_id TEXT;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN legacy_quarantined INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_quarantined IN (0, 1));

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN legacy_quarantine_reason TEXT;

ALTER TABLE historical_subscription_history
  ADD COLUMN legacy_quarantined INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_quarantined IN (0, 1));

ALTER TABLE historical_subscription_history
  ADD COLUMN legacy_quarantine_reason TEXT;

ALTER TABLE historical_subscription_backfill_audit
  ADD COLUMN legacy_quarantined INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_quarantined IN (0, 1));

ALTER TABLE historical_subscription_backfill_audit
  ADD COLUMN legacy_quarantine_reason TEXT;

-- 0001 already seals audit rows. Temporarily remove those two guards so this
-- migration can add the explicit quarantine marker, then recreate stricter
-- append-only guards below before the migration completes.
DROP TRIGGER IF EXISTS historical_subscription_backfill_audit_no_update;
DROP TRIGGER IF EXISTS historical_subscription_backfill_audit_no_delete;

-- Canonicalize valid legacy timestamps before sealing their rows. Invalid
-- values remain quarantined and cannot be read by the durable service.
UPDATE historical_subscription_backfill_runs
SET
  requested_at = CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', requested_at) IS NOT NULL
      AND substr(requested_at, 12, 2) BETWEEN '00' AND '23'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', requested_at)
    ELSE requested_at
  END,
  approved_at = CASE
    WHEN approved_at IS NULL THEN NULL
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', approved_at) IS NOT NULL
      AND substr(approved_at, 12, 2) BETWEEN '00' AND '23'
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', approved_at)
    ELSE approved_at
  END;

-- Every pre-0004 row lacks the retained immutable manifest required to run.
-- Do not silently reopen it. Completed legacy runs stay informationally
-- terminal; incomplete ones are terminalized as NEEDS_REVIEW.
UPDATE historical_subscription_backfill_runs
SET
  apply_state = CASE status
    WHEN 'APPLIED' THEN 'APPLIED'
    ELSE 'NEEDS_REVIEW'
  END,
  apply_started_at = NULL,
  finalized_at = COALESCE(approved_at, requested_at),
  lifecycle_audit_id = NULL,
  legacy_quarantined = 1,
  legacy_quarantine_reason = 'NO_IMMUTABLE_PLAN';

-- Existing history/audit rows predate source-qualified surrogates and are not
-- selected by this service. Retain them for a separately approved remediation
-- instead of copying, exposing, or deleting potentially sensitive values.
UPDATE historical_subscription_history
SET legacy_quarantined = 1,
    legacy_quarantine_reason = 'PREVIOUSLY_UNVALIDATED_EVIDENCE';

UPDATE historical_subscription_backfill_audit
SET legacy_quarantined = 1,
    legacy_quarantine_reason = 'PREVIOUSLY_UNVALIDATED_AUDIT';

CREATE TABLE IF NOT EXISTS historical_subscription_backfill_plan (
  run_id TEXT NOT NULL,
  decision_ordinal INTEGER NOT NULL CHECK (decision_ordinal >= 0),
  customer_id TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('APPSTLE_EXPORT', 'SHOPIFY_ORDER_EXPORT', 'MERCHANT_REVIEW')),
  disposition TEXT NOT NULL CHECK (
    disposition IN ('WILL_RECORD_EVER_SUBSCRIBED', 'ALREADY_DURABLE', 'DUPLICATE_IN_INPUT')
  ),
  PRIMARY KEY (run_id, decision_ordinal),
  FOREIGN KEY (run_id) REFERENCES historical_subscription_backfill_runs (run_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE TABLE IF NOT EXISTS historical_subscription_backfill_lifecycle_audit (
  audit_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('RUN_APPROVED', 'RUN_APPLYING', 'RUN_APPLIED', 'RUN_NEEDS_REVIEW')
  ),
  approval_ref TEXT NOT NULL,
  digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES historical_subscription_backfill_runs (run_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE TABLE IF NOT EXISTS historical_subscription_backfill_apply_conflicts (
  run_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  -- A quarantined legacy row has no trustworthy durable run identity. Preserve
  -- the ambiguity explicitly rather than inventing one or failing the batch.
  competing_run_id TEXT,
  reason TEXT NOT NULL CHECK (
    reason IN ('ALREADY_RECORDED_BY_ANOTHER_RUN', 'LEGACY_EVIDENCE_REQUIRES_REVIEW')
  ),
  detected_at TEXT NOT NULL,
  PRIMARY KEY (run_id, customer_id),
  FOREIGN KEY (run_id) REFERENCES historical_subscription_backfill_runs (run_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- Positive subscriber history cannot be rewritten or removed. A source-export
-- correction requires a separate reviewed remediation, never a silent
-- downgrade of eligibility history.
CREATE TRIGGER IF NOT EXISTS historical_subscription_history_no_update
BEFORE UPDATE ON historical_subscription_history
BEGIN
  SELECT RAISE(ABORT, 'historical subscription evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_history_no_delete
BEFORE DELETE ON historical_subscription_history
BEGIN
  SELECT RAISE(ABORT, 'historical subscription evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_history_validate_insert
BEFORE INSERT ON historical_subscription_history
WHEN NEW.legacy_quarantined != 0
  OR NEW.legacy_quarantine_reason IS NOT NULL
  OR NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
  OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
  OR NOT (
    (NEW.source = 'APPSTLE_EXPORT'
      AND length(NEW.evidence_ref) = 79
      AND substr(NEW.evidence_ref, 1, 15) = 'appstle/sha256/'
      AND substr(NEW.evidence_ref, 16) NOT GLOB '*[^0-9a-f]*')
    OR (NEW.source = 'SHOPIFY_ORDER_EXPORT'
      AND length(NEW.evidence_ref) = 85
      AND substr(NEW.evidence_ref, 1, 21) = 'shopify-order/sha256/'
      AND substr(NEW.evidence_ref, 22) NOT GLOB '*[^0-9a-f]*')
    OR (NEW.source = 'MERCHANT_REVIEW'
      AND length(NEW.evidence_ref) = 87
      AND substr(NEW.evidence_ref, 1, 23) = 'merchant-review/sha256/'
      AND substr(NEW.evidence_ref, 24) NOT GLOB '*[^0-9a-f]*')
  )
  OR length(NEW.established_at) != 24
  OR NEW.established_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.established_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.established_at) IS NOT NEW.established_at
  OR length(NEW.recorded_at) != 24
  OR NEW.recorded_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.recorded_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.recorded_at) IS NOT NEW.recorded_at
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    JOIN historical_subscription_backfill_plan AS plan
      ON plan.run_id = run.run_id
    WHERE run.run_id = NEW.established_by_run_id
      AND run.legacy_quarantined = 0
      AND run.status = 'DRY_RUN_COMPLETE'
      AND run.apply_state = 'APPLYING'
      AND run.approval_ref IS NOT NULL
      AND plan.customer_id = NEW.customer_id
      AND plan.evidence_ref = NEW.evidence_ref
      AND plan.first_observed_at = NEW.established_at
      AND plan.source = NEW.source
      AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
  )
BEGIN
  SELECT RAISE(ABORT, 'historical subscription evidence must be a canonical opaque surrogate bound to an approved applying plan');
END;

-- All new runs begin as unapproved dry runs. Legacy rows were quarantined
-- above before these triggers were installed.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_validate_insert
BEFORE INSERT ON historical_subscription_backfill_runs
WHEN NEW.run_id NOT GLOB 'hbr_*'
  OR length(NEW.run_id) != 36
  OR substr(NEW.run_id, 5) GLOB '*[^0-9a-f]*'
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.requested_at) != 24
  OR NEW.requested_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.requested_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.requested_at) IS NOT NEW.requested_at
  OR NEW.status != 'DRY_RUN_COMPLETE'
  OR NEW.apply_state != 'PENDING_APPROVAL'
  OR NEW.approval_ref IS NOT NULL
  OR NEW.approved_at IS NOT NULL
  OR NEW.apply_started_at IS NOT NULL
  OR NEW.finalized_at IS NOT NULL
  OR NEW.lifecycle_audit_id IS NOT NULL
  OR NEW.legacy_quarantined != 0
  OR NEW.legacy_quarantine_reason IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'historical backfill run must begin as a canonical unapproved non-legacy dry run');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_no_delete
BEFORE DELETE ON historical_subscription_backfill_runs
BEGIN
  SELECT RAISE(ABORT, 'historical backfill runs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_immutable_fields
BEFORE UPDATE OF run_id, digest, requested_at, legacy_quarantined, legacy_quarantine_reason
ON historical_subscription_backfill_runs
BEGIN
  SELECT RAISE(ABORT, 'historical backfill run identity and quarantine state are immutable');
END;

-- A valid transition supplies a fresh opaque lifecycle ID. The AFTER trigger
-- below creates its audit row atomically, making direct/orphan audit inserts
-- impossible and binding every lifecycle event to exactly one transition.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_one_way_lifecycle
BEFORE UPDATE ON historical_subscription_backfill_runs
WHEN OLD.legacy_quarantined != 0
  OR NEW.legacy_quarantined != 0
  OR NEW.legacy_quarantine_reason IS NOT NULL
  OR NOT (
    (
      OLD.status = 'DRY_RUN_COMPLETE'
      AND OLD.apply_state = 'PENDING_APPROVAL'
      AND OLD.approval_ref IS NULL
      AND OLD.approved_at IS NULL
      AND OLD.apply_started_at IS NULL
      AND OLD.finalized_at IS NULL
      AND OLD.lifecycle_audit_id IS NULL
      AND NEW.status = 'DRY_RUN_COMPLETE'
      AND NEW.apply_state = 'APPROVED'
      AND NEW.approval_ref IS NOT NULL
      AND NEW.approval_ref GLOB 'hba_*'
      AND length(NEW.approval_ref) = 36
      AND substr(NEW.approval_ref, 5) NOT GLOB '*[^0-9a-f]*'
      AND NEW.approved_at IS NOT NULL
      AND length(NEW.approved_at) = 24
      AND NEW.approved_at GLOB '????-??-??T??:??:??.???Z'
      AND substr(NEW.approved_at, 12, 2) BETWEEN '00' AND '23'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.approved_at) IS NEW.approved_at
      AND NEW.approved_at >= OLD.requested_at
      AND NEW.apply_started_at IS NULL
      AND NEW.finalized_at IS NULL
      AND NEW.lifecycle_audit_id IS NOT NULL
      AND NEW.lifecycle_audit_id GLOB 'hblcaudit_*'
      AND length(NEW.lifecycle_audit_id) = 42
      AND substr(NEW.lifecycle_audit_id, 11) NOT GLOB '*[^0-9a-f]*'
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_lifecycle_audit AS audit
        WHERE audit.audit_id = NEW.lifecycle_audit_id
      )
    )
    OR (
      OLD.status = 'DRY_RUN_COMPLETE'
      AND OLD.apply_state = 'APPROVED'
      AND OLD.approval_ref IS NOT NULL
      AND OLD.approved_at IS NOT NULL
      AND OLD.apply_started_at IS NULL
      AND OLD.finalized_at IS NULL
      AND OLD.lifecycle_audit_id IS NOT NULL
      AND NEW.status = 'DRY_RUN_COMPLETE'
      AND NEW.apply_state = 'APPLYING'
      AND NEW.approval_ref = OLD.approval_ref
      AND NEW.approved_at = OLD.approved_at
      AND NEW.apply_started_at IS NOT NULL
      AND length(NEW.apply_started_at) = 24
      AND NEW.apply_started_at GLOB '????-??-??T??:??:??.???Z'
      AND substr(NEW.apply_started_at, 12, 2) BETWEEN '00' AND '23'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.apply_started_at) IS NEW.apply_started_at
      AND NEW.apply_started_at >= OLD.approved_at
      AND NEW.finalized_at IS NULL
      AND NEW.lifecycle_audit_id IS NOT NULL
      AND NEW.lifecycle_audit_id GLOB 'hblcaudit_*'
      AND length(NEW.lifecycle_audit_id) = 42
      AND substr(NEW.lifecycle_audit_id, 11) NOT GLOB '*[^0-9a-f]*'
      AND NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_lifecycle_audit AS audit
        WHERE audit.audit_id = NEW.lifecycle_audit_id
      )
    )
    OR (
      OLD.status = 'DRY_RUN_COMPLETE'
      AND OLD.apply_state = 'APPLYING'
      AND OLD.approval_ref IS NOT NULL
      AND OLD.approved_at IS NOT NULL
      AND OLD.apply_started_at IS NOT NULL
      AND OLD.finalized_at IS NULL
      AND OLD.lifecycle_audit_id IS NOT NULL
      AND NEW.status = 'DRY_RUN_COMPLETE'
      AND NEW.apply_state = 'NEEDS_REVIEW'
      AND NEW.approval_ref = OLD.approval_ref
      AND NEW.approved_at = OLD.approved_at
      AND NEW.apply_started_at = OLD.apply_started_at
      AND NEW.finalized_at IS NOT NULL
      AND length(NEW.finalized_at) = 24
      AND NEW.finalized_at GLOB '????-??-??T??:??:??.???Z'
      AND substr(NEW.finalized_at, 12, 2) BETWEEN '00' AND '23'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.finalized_at) IS NEW.finalized_at
      AND NEW.finalized_at >= OLD.apply_started_at
      AND NEW.lifecycle_audit_id IS NOT NULL
      AND NEW.lifecycle_audit_id GLOB 'hblcaudit_*'
      AND length(NEW.lifecycle_audit_id) = 42
      AND substr(NEW.lifecycle_audit_id, 11) NOT GLOB '*[^0-9a-f]*'
      AND NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_lifecycle_audit AS audit
        WHERE audit.audit_id = NEW.lifecycle_audit_id
      )
      AND EXISTS (
        SELECT 1 FROM historical_subscription_backfill_apply_conflicts AS conflict
        WHERE conflict.run_id = OLD.run_id
      )
    )
    OR (
      OLD.status = 'DRY_RUN_COMPLETE'
      AND OLD.apply_state = 'APPLYING'
      AND OLD.approval_ref IS NOT NULL
      AND OLD.approved_at IS NOT NULL
      AND OLD.apply_started_at IS NOT NULL
      AND OLD.finalized_at IS NULL
      AND OLD.lifecycle_audit_id IS NOT NULL
      AND NEW.status = 'APPLIED'
      AND NEW.apply_state = 'APPLIED'
      AND NEW.approval_ref = OLD.approval_ref
      AND NEW.approved_at = OLD.approved_at
      AND NEW.apply_started_at = OLD.apply_started_at
      AND NEW.finalized_at IS NOT NULL
      AND length(NEW.finalized_at) = 24
      AND NEW.finalized_at GLOB '????-??-??T??:??:??.???Z'
      AND substr(NEW.finalized_at, 12, 2) BETWEEN '00' AND '23'
      AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW.finalized_at) IS NEW.finalized_at
      AND NEW.finalized_at >= OLD.apply_started_at
      AND NEW.lifecycle_audit_id IS NOT NULL
      AND NEW.lifecycle_audit_id GLOB 'hblcaudit_*'
      AND length(NEW.lifecycle_audit_id) = 42
      AND substr(NEW.lifecycle_audit_id, 11) NOT GLOB '*[^0-9a-f]*'
      AND NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_lifecycle_audit AS audit
        WHERE audit.audit_id = NEW.lifecycle_audit_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_apply_conflicts AS conflict
        WHERE conflict.run_id = OLD.run_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM historical_subscription_backfill_plan AS plan
        WHERE plan.run_id = OLD.run_id
          AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
          AND (
            NOT EXISTS (
              SELECT 1 FROM historical_subscription_history AS history
              WHERE history.customer_id = plan.customer_id
                AND history.legacy_quarantined = 0
                AND history.established_by_run_id = OLD.run_id
                AND history.evidence_ref = plan.evidence_ref
                AND history.established_at = plan.first_observed_at
                AND history.source = plan.source
            )
            OR NOT EXISTS (
              SELECT 1 FROM historical_subscription_backfill_audit AS audit
              WHERE audit.run_id = OLD.run_id
                AND audit.legacy_quarantined = 0
                AND audit.action = 'EVER_SUBSCRIBED_RECORDED'
                AND audit.customer_id = plan.customer_id
                AND audit.approval_ref = OLD.approval_ref
                AND audit.digest = OLD.digest
            )
          )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill lifecycle is one-way, canonical, and requires a fresh bound audit ID');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_append_lifecycle_audit
AFTER UPDATE ON historical_subscription_backfill_runs
WHEN OLD.legacy_quarantined = 0 AND NEW.legacy_quarantined = 0
BEGIN
  INSERT INTO historical_subscription_backfill_lifecycle_audit (
    audit_id, run_id, action, approval_ref, digest, occurred_at
  ) VALUES (
    NEW.lifecycle_audit_id,
    NEW.run_id,
    CASE NEW.apply_state
      WHEN 'APPROVED' THEN 'RUN_APPROVED'
      WHEN 'APPLYING' THEN 'RUN_APPLYING'
      WHEN 'APPLIED' THEN 'RUN_APPLIED'
      WHEN 'NEEDS_REVIEW' THEN 'RUN_NEEDS_REVIEW'
    END,
    NEW.approval_ref,
    NEW.digest,
    CASE NEW.apply_state
      WHEN 'APPROVED' THEN NEW.approved_at
      WHEN 'APPLYING' THEN NEW.apply_started_at
      ELSE NEW.finalized_at
    END
  );
END;

-- The immutable manifest can only be written as part of the initial dry run.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_plan_validate_insert
BEFORE INSERT ON historical_subscription_backfill_plan
WHEN NEW.decision_ordinal != (
    SELECT COUNT(*)
    FROM historical_subscription_backfill_plan
    WHERE run_id = NEW.run_id
  )
  OR NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
  OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
  OR NOT (
    (NEW.source = 'APPSTLE_EXPORT'
      AND length(NEW.evidence_ref) = 79
      AND substr(NEW.evidence_ref, 1, 15) = 'appstle/sha256/'
      AND substr(NEW.evidence_ref, 16) NOT GLOB '*[^0-9a-f]*')
    OR (NEW.source = 'SHOPIFY_ORDER_EXPORT'
      AND length(NEW.evidence_ref) = 85
      AND substr(NEW.evidence_ref, 1, 21) = 'shopify-order/sha256/'
      AND substr(NEW.evidence_ref, 22) NOT GLOB '*[^0-9a-f]*')
    OR (NEW.source = 'MERCHANT_REVIEW'
      AND length(NEW.evidence_ref) = 87
      AND substr(NEW.evidence_ref, 1, 23) = 'merchant-review/sha256/'
      AND substr(NEW.evidence_ref, 24) NOT GLOB '*[^0-9a-f]*')
  )
  OR length(NEW.first_observed_at) != 24
  OR NEW.first_observed_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.first_observed_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.first_observed_at) IS NOT NEW.first_observed_at
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    JOIN historical_subscription_backfill_audit AS audit
      ON audit.run_id = run.run_id
    WHERE run.run_id = NEW.run_id
      AND run.legacy_quarantined = 0
      AND run.status = 'DRY_RUN_COMPLETE'
      AND run.apply_state = 'PENDING_APPROVAL'
      AND audit.legacy_quarantined = 0
      AND audit.action = 'DRY_RUN_COMPLETED'
      AND audit.customer_id IS NULL
      AND audit.approval_ref IS NULL
      AND audit.digest = run.digest
      AND audit.occurred_at = run.requested_at
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill plan must be a canonical source-qualified unapproved dry-run manifest');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_plan_no_update
BEFORE UPDATE ON historical_subscription_backfill_plan
BEGIN
  SELECT RAISE(ABORT, 'historical backfill plan is immutable');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_plan_no_delete
BEFORE DELETE ON historical_subscription_backfill_plan
BEGIN
  SELECT RAISE(ABORT, 'historical backfill plan is immutable');
END;

-- The original audit table records the dry run and each positive fact. It is
-- append-only and only accepts opaque IDs plus canonical timestamps.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_audit_validate_insert
BEFORE INSERT ON historical_subscription_backfill_audit
WHEN NEW.legacy_quarantined != 0
  OR NEW.legacy_quarantine_reason IS NOT NULL
  OR NEW.audit_id NOT GLOB 'hbaudit_*'
  OR length(NEW.audit_id) != 40
  OR substr(NEW.audit_id, 9) GLOB '*[^0-9a-f]*'
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.occurred_at) != 24
  OR NEW.occurred_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.occurred_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.occurred_at) IS NOT NEW.occurred_at
  OR (
    NEW.action = 'DRY_RUN_COMPLETED'
    AND (
      NEW.customer_id IS NOT NULL
      OR NEW.approval_ref IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        WHERE run.run_id = NEW.run_id
          AND run.legacy_quarantined = 0
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'PENDING_APPROVAL'
          AND run.digest = NEW.digest
          AND run.requested_at = NEW.occurred_at
      )
    )
  )
  OR (
    NEW.action = 'EVER_SUBSCRIBED_RECORDED'
    AND (
      NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
      OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
      OR NEW.approval_ref IS NULL
      OR NEW.approval_ref NOT GLOB 'hba_*'
      OR length(NEW.approval_ref) != 36
      OR substr(NEW.approval_ref, 5) GLOB '*[^0-9a-f]*'
      OR NOT EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        JOIN historical_subscription_backfill_plan AS plan
          ON plan.run_id = run.run_id
        JOIN historical_subscription_history AS history
          ON history.customer_id = plan.customer_id
        WHERE run.run_id = NEW.run_id
          AND run.legacy_quarantined = 0
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND run.approval_ref = NEW.approval_ref
          AND run.digest = NEW.digest
          AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
          AND plan.customer_id = NEW.customer_id
          AND history.legacy_quarantined = 0
          AND history.established_by_run_id = run.run_id
          AND history.evidence_ref = plan.evidence_ref
          AND history.established_at = plan.first_observed_at
          AND history.source = plan.source
          AND history.recorded_at = NEW.occurred_at
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill audit is malformed or not bound to an applying plan');
END;

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

-- Lifecycle audit rows are generated by the run transition trigger. The
-- validator only accepts the post-transition row that already names the exact
-- audit ID, so an orphan or false lifecycle event cannot be inserted.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_lifecycle_audit_validate_insert
BEFORE INSERT ON historical_subscription_backfill_lifecycle_audit
WHEN NEW.audit_id NOT GLOB 'hblcaudit_*'
  OR length(NEW.audit_id) != 42
  OR substr(NEW.audit_id, 11) GLOB '*[^0-9a-f]*'
  OR NEW.approval_ref NOT GLOB 'hba_*'
  OR length(NEW.approval_ref) != 36
  OR substr(NEW.approval_ref, 5) GLOB '*[^0-9a-f]*'
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.occurred_at) != 24
  OR NEW.occurred_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.occurred_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.occurred_at) IS NOT NEW.occurred_at
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    WHERE run.run_id = NEW.run_id
      AND run.legacy_quarantined = 0
      AND run.lifecycle_audit_id = NEW.audit_id
      AND run.approval_ref = NEW.approval_ref
      AND run.digest = NEW.digest
      AND (
        (NEW.action = 'RUN_APPROVED'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPROVED'
          AND NEW.occurred_at = run.approved_at)
        OR (NEW.action = 'RUN_APPLYING'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND NEW.occurred_at = run.apply_started_at)
        OR (NEW.action = 'RUN_NEEDS_REVIEW'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'NEEDS_REVIEW'
          AND NEW.occurred_at = run.finalized_at)
        OR (NEW.action = 'RUN_APPLIED'
          AND run.status = 'APPLIED'
          AND run.apply_state = 'APPLIED'
          AND NEW.occurred_at = run.finalized_at)
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'historical lifecycle audit must be generated by and bound to one durable transition');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_lifecycle_audit_no_update
BEFORE UPDATE ON historical_subscription_backfill_lifecycle_audit
BEGIN
  SELECT RAISE(ABORT, 'historical backfill lifecycle audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_lifecycle_audit_no_delete
BEFORE DELETE ON historical_subscription_backfill_lifecycle_audit
BEGIN
  SELECT RAISE(ABORT, 'historical backfill lifecycle audit is append-only');
END;

-- A concurrent run which reaches the same customer never silently converges:
-- the second run records the competing durable run and terminalizes as
-- NEEDS_REVIEW. A quarantined legacy row cannot safely name a durable run, so
-- it records a distinct, auditable review conflict with no competing ID.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_apply_conflicts_validate_insert
BEFORE INSERT ON historical_subscription_backfill_apply_conflicts
WHEN NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
  OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
  OR length(NEW.detected_at) != 24
  OR NEW.detected_at NOT GLOB '????-??-??T??:??:??.???Z'
  OR substr(NEW.detected_at, 12, 2) NOT BETWEEN '00' AND '23'
  OR strftime('%Y-%m-%dT%H:%M:%fZ', NEW.detected_at) IS NOT NEW.detected_at
  OR NOT (
    (
      NEW.reason = 'ALREADY_RECORDED_BY_ANOTHER_RUN'
      AND NEW.competing_run_id IS NOT NULL
      AND NEW.competing_run_id GLOB 'hbr_*'
      AND length(NEW.competing_run_id) = 36
      AND substr(NEW.competing_run_id, 5) NOT GLOB '*[^0-9a-f]*'
      AND EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        JOIN historical_subscription_backfill_plan AS plan
          ON plan.run_id = run.run_id
        JOIN historical_subscription_history AS history
          ON history.customer_id = plan.customer_id
        WHERE run.run_id = NEW.run_id
          AND run.legacy_quarantined = 0
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
          AND plan.customer_id = NEW.customer_id
          AND history.legacy_quarantined = 0
          AND history.established_by_run_id = NEW.competing_run_id
          AND history.established_by_run_id <> run.run_id
      )
    )
    OR (
      NEW.reason = 'LEGACY_EVIDENCE_REQUIRES_REVIEW'
      AND NEW.competing_run_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        JOIN historical_subscription_backfill_plan AS plan
          ON plan.run_id = run.run_id
        JOIN historical_subscription_history AS history
          ON history.customer_id = plan.customer_id
        WHERE run.run_id = NEW.run_id
          AND run.legacy_quarantined = 0
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
          AND plan.customer_id = NEW.customer_id
          AND history.legacy_quarantined = 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill conflict must be bound to a durable or quarantined legacy record');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_apply_conflicts_no_update
BEFORE UPDATE ON historical_subscription_backfill_apply_conflicts
BEGIN
  SELECT RAISE(ABORT, 'historical backfill conflicts are append-only');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_apply_conflicts_no_delete
BEFORE DELETE ON historical_subscription_backfill_apply_conflicts
BEGIN
  SELECT RAISE(ABORT, 'historical backfill conflicts are append-only');
END;

CREATE UNIQUE INDEX IF NOT EXISTS historical_subscription_backfill_dry_run_audit_once
  ON historical_subscription_backfill_audit (run_id)
  WHERE action = 'DRY_RUN_COMPLETED';

CREATE UNIQUE INDEX IF NOT EXISTS historical_subscription_backfill_fact_audit_once
  ON historical_subscription_backfill_audit (run_id, customer_id)
  WHERE action = 'EVER_SUBSCRIBED_RECORDED';

CREATE UNIQUE INDEX IF NOT EXISTS historical_subscription_backfill_lifecycle_once
  ON historical_subscription_backfill_lifecycle_audit (run_id, action);

CREATE INDEX IF NOT EXISTS historical_subscription_backfill_plan_by_run
  ON historical_subscription_backfill_plan (run_id, decision_ordinal);

CREATE INDEX IF NOT EXISTS historical_subscription_backfill_conflicts_by_run
  ON historical_subscription_backfill_apply_conflicts (run_id, detected_at);
