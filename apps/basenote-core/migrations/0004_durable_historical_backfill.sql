-- Durable historical-subscription backfill lifecycle for the isolated staging
-- D1 database. This migration stores opaque Shopify IDs and opaque evidence
-- references only. It never stores raw export rows, names, email addresses,
-- payment data, provider credentials, or customer-facing content.
--
-- A dry run is immutable before approval. The reviewed plan is retained in D1,
-- lifecycle transitions are one-way, and every positive historic fact is
-- append-only. This migration is a schema artifact only; it is not a backfill
-- runner and must not be applied to production.

PRAGMA foreign_keys = ON;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN apply_state TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
  CHECK (apply_state IN ('PENDING_APPROVAL', 'APPROVED', 'APPLYING', 'APPLIED', 'NEEDS_REVIEW'));

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN apply_started_at TEXT;

ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN finalized_at TEXT;

-- Points to the immutable audit event that authorized the current lifecycle
-- state. SQLite cannot add a table-level foreign key with ALTER TABLE, so the
-- lifecycle trigger below enforces this relationship before every transition.
ALTER TABLE historical_subscription_backfill_runs
  ADD COLUMN lifecycle_audit_id TEXT;

-- Preserve any legacy terminal rows without reopening them for a transition.
UPDATE historical_subscription_backfill_runs
SET
  apply_state = CASE status
    WHEN 'APPLIED' THEN 'APPLIED'
    ELSE 'PENDING_APPROVAL'
  END,
  finalized_at = CASE
    WHEN status = 'APPLIED' THEN COALESCE(approved_at, requested_at)
    ELSE NULL
  END;

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
  competing_run_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason = 'ALREADY_RECORDED_BY_ANOTHER_RUN'),
  detected_at TEXT NOT NULL,
  PRIMARY KEY (run_id, customer_id),
  FOREIGN KEY (run_id) REFERENCES historical_subscription_backfill_runs (run_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

-- Positive subscriber history cannot be rewritten or removed. A source-export
-- correction requires a separate reviewed remediation migration, never a
-- silent downgrade of eligibility history.
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
WHEN NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
  OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
  OR instr(NEW.customer_id, '@') > 0
  OR length(NEW.evidence_ref) NOT BETWEEN 3 AND 192
  OR NEW.evidence_ref NOT GLOB '[A-Za-z0-9][A-Za-z0-9._:/-]*'
  OR NEW.evidence_ref GLOB '*[^A-Za-z0-9._:/-]*'
  OR instr(NEW.evidence_ref, '@') > 0
  OR length(NEW.established_at) NOT IN (20, 24)
  OR NEW.established_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.established_at) IS NULL
  OR length(NEW.recorded_at) NOT IN (20, 24)
  OR NEW.recorded_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.recorded_at) IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    JOIN historical_subscription_backfill_plan AS plan
      ON plan.run_id = run.run_id
    WHERE run.run_id = NEW.established_by_run_id
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
  SELECT RAISE(ABORT, 'historical subscription evidence must match an approved applying plan');
END;

-- All newly created runs begin as unapproved dry runs. Existing terminal rows
-- were normalized above before these triggers were installed.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_validate_insert
BEFORE INSERT ON historical_subscription_backfill_runs
WHEN NEW.run_id NOT GLOB 'hbr_[A-Za-z0-9]*'
  OR length(NEW.run_id) NOT BETWEEN 12 AND 132
  OR NEW.run_id GLOB '*[^A-Za-z0-9._:-]*'
  OR instr(NEW.run_id, '@') > 0
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.requested_at) NOT IN (20, 24)
  OR NEW.requested_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.requested_at) IS NULL
  OR NEW.status != 'DRY_RUN_COMPLETE'
  OR NEW.apply_state != 'PENDING_APPROVAL'
  OR NEW.approval_ref IS NOT NULL
  OR NEW.approved_at IS NOT NULL
  OR NEW.apply_started_at IS NOT NULL
  OR NEW.finalized_at IS NOT NULL
  OR NEW.lifecycle_audit_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'historical backfill run must begin as an unapproved dry run');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_no_delete
BEFORE DELETE ON historical_subscription_backfill_runs
BEGIN
  SELECT RAISE(ABORT, 'historical backfill runs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_immutable_fields
BEFORE UPDATE OF run_id, digest, requested_at ON historical_subscription_backfill_runs
BEGIN
  SELECT RAISE(ABORT, 'historical backfill run identity is immutable');
END;

-- A transition must carry the ID of a matching append-only lifecycle event.
-- Events are inserted first in the same D1 batch; the run update is rejected
-- unless the event proves the exact next state.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_runs_one_way_lifecycle
BEFORE UPDATE ON historical_subscription_backfill_runs
WHEN NOT (
  (
    OLD.status = 'DRY_RUN_COMPLETE'
    AND OLD.apply_state = 'PENDING_APPROVAL'
    AND NEW.status = 'DRY_RUN_COMPLETE'
    AND NEW.apply_state = 'APPROVED'
    AND OLD.approval_ref IS NULL
    AND OLD.approved_at IS NULL
    AND NEW.approval_ref IS NOT NULL
    AND NEW.approved_at >= OLD.requested_at
    AND NEW.apply_started_at IS NULL
    AND NEW.finalized_at IS NULL
    AND NEW.lifecycle_audit_id IS NOT NULL
    AND (OLD.lifecycle_audit_id IS NULL OR NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id)
    AND EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_lifecycle_audit AS audit
      WHERE audit.audit_id = NEW.lifecycle_audit_id
        AND audit.run_id = OLD.run_id
        AND audit.action = 'RUN_APPROVED'
        AND audit.approval_ref = NEW.approval_ref
        AND audit.digest = OLD.digest
        AND audit.occurred_at = NEW.approved_at
    )
  )
  OR (
    OLD.status = 'DRY_RUN_COMPLETE'
    AND OLD.apply_state = 'APPROVED'
    AND NEW.status = 'DRY_RUN_COMPLETE'
    AND NEW.apply_state = 'APPLYING'
    AND NEW.approval_ref = OLD.approval_ref
    AND NEW.approved_at = OLD.approved_at
    AND NEW.apply_started_at IS NOT NULL
    AND NEW.apply_started_at >= OLD.approved_at
    AND NEW.finalized_at IS NULL
    AND NEW.lifecycle_audit_id IS NOT NULL
    AND (OLD.lifecycle_audit_id IS NULL OR NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id)
    AND EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_lifecycle_audit AS audit
      WHERE audit.audit_id = NEW.lifecycle_audit_id
        AND audit.run_id = OLD.run_id
        AND audit.action = 'RUN_APPLYING'
        AND audit.approval_ref = OLD.approval_ref
        AND audit.digest = OLD.digest
        AND audit.occurred_at = NEW.apply_started_at
    )
  )
  OR (
    OLD.status = 'DRY_RUN_COMPLETE'
    AND OLD.apply_state = 'APPLYING'
    AND NEW.status = 'DRY_RUN_COMPLETE'
    AND NEW.apply_state = 'NEEDS_REVIEW'
    AND NEW.approval_ref = OLD.approval_ref
    AND NEW.approved_at = OLD.approved_at
    AND NEW.apply_started_at = OLD.apply_started_at
    AND NEW.finalized_at IS NOT NULL
    AND NEW.finalized_at >= OLD.apply_started_at
    AND NEW.lifecycle_audit_id IS NOT NULL
    AND NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id
    AND EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_lifecycle_audit AS audit
      WHERE audit.audit_id = NEW.lifecycle_audit_id
        AND audit.run_id = OLD.run_id
        AND audit.action = 'RUN_NEEDS_REVIEW'
        AND audit.approval_ref = OLD.approval_ref
        AND audit.digest = OLD.digest
        AND audit.occurred_at = NEW.finalized_at
    )
    AND EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_apply_conflicts AS conflict
      WHERE conflict.run_id = OLD.run_id
    )
  )
  OR (
    OLD.status = 'DRY_RUN_COMPLETE'
    AND OLD.apply_state = 'APPLYING'
    AND NEW.status = 'APPLIED'
    AND NEW.apply_state = 'APPLIED'
    AND NEW.approval_ref = OLD.approval_ref
    AND NEW.approved_at = OLD.approved_at
    AND NEW.apply_started_at = OLD.apply_started_at
    AND NEW.finalized_at IS NOT NULL
    AND NEW.finalized_at >= OLD.apply_started_at
    AND NEW.lifecycle_audit_id IS NOT NULL
    AND NEW.lifecycle_audit_id <> OLD.lifecycle_audit_id
    AND EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_lifecycle_audit AS audit
      WHERE audit.audit_id = NEW.lifecycle_audit_id
        AND audit.run_id = OLD.run_id
        AND audit.action = 'RUN_APPLIED'
        AND audit.approval_ref = OLD.approval_ref
        AND audit.digest = OLD.digest
        AND audit.occurred_at = NEW.finalized_at
    )
    AND NOT EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_apply_conflicts AS conflict
      WHERE conflict.run_id = OLD.run_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM historical_subscription_backfill_plan AS plan
      WHERE plan.run_id = OLD.run_id
        AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
        AND (
          NOT EXISTS (
            SELECT 1
            FROM historical_subscription_history AS history
            WHERE history.customer_id = plan.customer_id
              AND history.established_by_run_id = OLD.run_id
              AND history.evidence_ref = plan.evidence_ref
              AND history.established_at = plan.first_observed_at
              AND history.source = plan.source
          )
          OR NOT EXISTS (
            SELECT 1
            FROM historical_subscription_backfill_audit AS audit
            WHERE audit.run_id = OLD.run_id
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
  SELECT RAISE(ABORT, 'historical backfill lifecycle is one-way and requires a matching audit');
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
  OR instr(NEW.customer_id, '@') > 0
  OR length(NEW.evidence_ref) NOT BETWEEN 3 AND 192
  OR NEW.evidence_ref NOT GLOB '[A-Za-z0-9][A-Za-z0-9._:/-]*'
  OR NEW.evidence_ref GLOB '*[^A-Za-z0-9._:/-]*'
  OR instr(NEW.evidence_ref, '@') > 0
  OR length(NEW.first_observed_at) NOT IN (20, 24)
  OR NEW.first_observed_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.first_observed_at) IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    JOIN historical_subscription_backfill_audit AS audit
      ON audit.run_id = run.run_id
    WHERE run.run_id = NEW.run_id
      AND run.status = 'DRY_RUN_COMPLETE'
      AND run.apply_state = 'PENDING_APPROVAL'
      AND audit.action = 'DRY_RUN_COMPLETED'
      AND audit.customer_id IS NULL
      AND audit.approval_ref IS NULL
      AND audit.digest = run.digest
      AND audit.occurred_at = run.requested_at
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill plan must be an opaque unapproved dry-run manifest');
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

-- The original audit table records the initial dry run and each fact. It is
-- append-only and cannot be used to smuggle customer data or a mismatched
-- approval into D1.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_audit_validate_insert
BEFORE INSERT ON historical_subscription_backfill_audit
WHEN NEW.audit_id NOT GLOB 'hbaudit_[A-Za-z0-9]*'
  OR length(NEW.audit_id) NOT BETWEEN 24 AND 136
  OR NEW.audit_id GLOB '*[^A-Za-z0-9._:-]*'
  OR instr(NEW.audit_id, '@') > 0
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.occurred_at) NOT IN (20, 24)
  OR NEW.occurred_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.occurred_at) IS NULL
  OR instr(COALESCE(NEW.customer_id, ''), '@') > 0
  OR instr(COALESCE(NEW.approval_ref, ''), '@') > 0
  OR (
    NEW.action = 'DRY_RUN_COMPLETED'
    AND (
      NEW.customer_id IS NOT NULL
      OR NEW.approval_ref IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        WHERE run.run_id = NEW.run_id
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
      NEW.customer_id IS NULL
      OR NEW.approval_ref IS NULL
      OR NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
      OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
      OR NEW.approval_ref NOT GLOB 'hba_[A-Za-z0-9]*'
      OR length(NEW.approval_ref) NOT BETWEEN 12 AND 132
      OR NEW.approval_ref GLOB '*[^A-Za-z0-9._:-]*'
      OR NOT EXISTS (
        SELECT 1
        FROM historical_subscription_backfill_runs AS run
        JOIN historical_subscription_backfill_plan AS plan
          ON plan.run_id = run.run_id
        JOIN historical_subscription_history AS history
          ON history.customer_id = plan.customer_id
        WHERE run.run_id = NEW.run_id
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND run.approval_ref = NEW.approval_ref
          AND run.digest = NEW.digest
          AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
          AND plan.customer_id = NEW.customer_id
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

-- Lifecycle audit rows are written immediately before their corresponding
-- state update. The run trigger then requires the exact audit ID.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_lifecycle_audit_validate_insert
BEFORE INSERT ON historical_subscription_backfill_lifecycle_audit
WHEN NEW.audit_id NOT GLOB 'hblcaudit_[A-Za-z0-9]*'
  OR length(NEW.audit_id) NOT BETWEEN 26 AND 138
  OR NEW.audit_id GLOB '*[^A-Za-z0-9._:-]*'
  OR instr(NEW.audit_id, '@') > 0
  OR NEW.approval_ref NOT GLOB 'hba_[A-Za-z0-9]*'
  OR length(NEW.approval_ref) NOT BETWEEN 12 AND 132
  OR NEW.approval_ref GLOB '*[^A-Za-z0-9._:-]*'
  OR instr(NEW.approval_ref, '@') > 0
  OR length(NEW.digest) != 64
  OR NEW.digest GLOB '*[^0-9a-f]*'
  OR length(NEW.occurred_at) NOT IN (20, 24)
  OR NEW.occurred_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.occurred_at) IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    WHERE run.run_id = NEW.run_id
      AND run.digest = NEW.digest
      AND (
        (
          NEW.action = 'RUN_APPROVED'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'PENDING_APPROVAL'
          AND run.approval_ref IS NULL
          AND run.approved_at IS NULL
          AND NEW.occurred_at >= run.requested_at
        )
        OR (
          NEW.action = 'RUN_APPLYING'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPROVED'
          AND run.approval_ref = NEW.approval_ref
          AND run.approved_at <= NEW.occurred_at
        )
        OR (
          NEW.action = 'RUN_NEEDS_REVIEW'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND run.approval_ref = NEW.approval_ref
          AND run.apply_started_at <= NEW.occurred_at
          AND EXISTS (
            SELECT 1
            FROM historical_subscription_backfill_apply_conflicts AS conflict
            WHERE conflict.run_id = run.run_id
          )
        )
        OR (
          NEW.action = 'RUN_APPLIED'
          AND run.status = 'DRY_RUN_COMPLETE'
          AND run.apply_state = 'APPLYING'
          AND run.approval_ref = NEW.approval_ref
          AND run.apply_started_at <= NEW.occurred_at
          AND NOT EXISTS (
            SELECT 1
            FROM historical_subscription_backfill_apply_conflicts AS conflict
            WHERE conflict.run_id = run.run_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM historical_subscription_backfill_plan AS plan
            WHERE plan.run_id = run.run_id
              AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM historical_subscription_history AS history
                  WHERE history.customer_id = plan.customer_id
                    AND history.established_by_run_id = run.run_id
                    AND history.evidence_ref = plan.evidence_ref
                    AND history.established_at = plan.first_observed_at
                    AND history.source = plan.source
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM historical_subscription_backfill_audit AS audit
                  WHERE audit.run_id = run.run_id
                    AND audit.action = 'EVER_SUBSCRIBED_RECORDED'
                    AND audit.customer_id = plan.customer_id
                    AND audit.approval_ref = run.approval_ref
                    AND audit.digest = run.digest
                )
              )
          )
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill lifecycle audit does not match the durable run state');
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
-- the second run records the competing run and terminalizes as NEEDS_REVIEW.
CREATE TRIGGER IF NOT EXISTS historical_subscription_backfill_apply_conflicts_validate_insert
BEFORE INSERT ON historical_subscription_backfill_apply_conflicts
WHEN NEW.customer_id NOT GLOB 'gid://shopify/Customer/[1-9]*'
  OR substr(NEW.customer_id, 24) GLOB '*[^0-9]*'
  OR instr(NEW.customer_id, '@') > 0
  OR NEW.competing_run_id NOT GLOB 'hbr_[A-Za-z0-9]*'
  OR length(NEW.competing_run_id) NOT BETWEEN 12 AND 132
  OR NEW.competing_run_id GLOB '*[^A-Za-z0-9._:-]*'
  OR instr(NEW.competing_run_id, '@') > 0
  OR length(NEW.detected_at) NOT IN (20, 24)
  OR NEW.detected_at NOT GLOB '????-??-??T??:??:??*Z'
  OR strftime('%s', NEW.detected_at) IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM historical_subscription_backfill_runs AS run
    JOIN historical_subscription_backfill_plan AS plan
      ON plan.run_id = run.run_id
    JOIN historical_subscription_history AS history
      ON history.customer_id = plan.customer_id
    WHERE run.run_id = NEW.run_id
      AND run.status = 'DRY_RUN_COMPLETE'
      AND run.apply_state = 'APPLYING'
      AND plan.disposition = 'WILL_RECORD_EVER_SUBSCRIBED'
      AND plan.customer_id = NEW.customer_id
      AND history.established_by_run_id = NEW.competing_run_id
      AND history.established_by_run_id <> run.run_id
  )
BEGIN
  SELECT RAISE(ABORT, 'historical backfill conflict must name a competing durable run');
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

CREATE INDEX IF NOT EXISTS historical_subscription_backfill_plan_by_run
  ON historical_subscription_backfill_plan (run_id, decision_ordinal);

CREATE INDEX IF NOT EXISTS historical_subscription_backfill_conflicts_by_run
  ON historical_subscription_backfill_apply_conflicts (run_id, detected_at);
