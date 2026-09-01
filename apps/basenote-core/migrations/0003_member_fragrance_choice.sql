-- Staging-only member-fragrance choice and cutoff-locking schema.
--
-- This migration is intentionally a reviewed artifact. It is never applied by
-- npm, the Worker source, or a deployment command. Apply only after 0001 and
-- 0002 to the isolated Base Note staging D1 database, never to production.
--
-- It stores opaque bindings and Shopify ProductVariant GIDs only. Do not put
-- names, email addresses, payment data, Appstle data, or provider payloads in
-- these tables.
--
-- Apply this file only through `wrangler d1 migrations apply`, whose migration
-- runner stops and rolls back on an error. Do not feed it directly to a raw
-- `sqlite3 < file` shell redirection: the SQLite CLI can continue after an
-- error unless invoked with `-bail`. The local migration smoke uses `-bail`.

PRAGMA foreign_keys = ON;

-- Preflight the old schema before any persistent 0003 DDL. A legacy resolved
-- non-open cycle can be carried forward as an FOTM fallback below; every other
-- closed state is ambiguous and must be reconciled manually. This temporary
-- trigger also verifies the newly approved 12:01 AM Central rule against old
-- published/resolved cutoffs. It disappears with the migration connection.
CREATE TEMP TRIGGER profile_queue_0003_legacy_preflight
BEFORE UPDATE OF state ON profile_queue_cycles
FOR EACH ROW
WHEN (
  (OLD.state <> 'OPEN' AND OLD.fotm_status <> 'RESOLVED')
  OR (OLD.state = 'OPEN' AND OLD.fotm_status = 'RESOLVED')
  OR (OLD.fotm_status IN ('PUBLISHED', 'RESOLVED') AND OLD.merchant_timezone <> 'America/Chicago')
  OR (OLD.fotm_status IN ('PUBLISHED', 'RESOLVED') AND COALESCE(NOT (
    strftime('%Y-%m-%dT%H:%M:%S', OLD.fotm_cutoff_at) = substr(OLD.fotm_cutoff_at, 1, 19)
    AND (
      OLD.fotm_cutoff_at = substr(OLD.fotm_cutoff_at, 1, 19) || 'Z'
      OR OLD.fotm_cutoff_at = substr(OLD.fotm_cutoff_at, 1, 19) || '.000Z'
    )
    AND substr(OLD.fotm_cutoff_at, 18, 2) = '00'
    AND CASE WHEN (
      CAST(strftime('%m', OLD.fotm_cutoff_at) AS INTEGER) BETWEEN 4 AND 10
      OR (
        strftime('%m', OLD.fotm_cutoff_at) = '03'
        AND CAST(strftime('%d', OLD.fotm_cutoff_at) AS INTEGER) > CAST(strftime('%d', date(strftime('%Y-%m-01', OLD.fotm_cutoff_at), 'weekday 0', '+7 days')) AS INTEGER)
      )
      OR (
        strftime('%m', OLD.fotm_cutoff_at) = '11'
        AND CAST(strftime('%d', OLD.fotm_cutoff_at) AS INTEGER) <= CAST(strftime('%d', date(strftime('%Y-%m-01', OLD.fotm_cutoff_at), 'weekday 0')) AS INTEGER)
      )
    ) THEN substr(OLD.fotm_cutoff_at, 12, 6) = '05:01:'
      ELSE substr(OLD.fotm_cutoff_at, 12, 6) = '06:01:'
    END
  ), 1))
)
BEGIN
  SELECT RAISE(ABORT, '0003 legacy queue cycle requires manual reconciliation');
END;

UPDATE profile_queue_cycles
SET state = state;

DROP TRIGGER profile_queue_0003_legacy_preflight;

ALTER TABLE profile_queue_cycles
  ADD COLUMN member_choice_source TEXT NOT NULL DEFAULT 'UNSELECTED'
    CHECK (member_choice_source IN ('UNSELECTED', 'MEMBER_SELECTED', 'FOTM_FALLBACK'));

ALTER TABLE profile_queue_cycles
  ADD COLUMN member_choice_variant_id TEXT;

ALTER TABLE profile_queue_cycles
  ADD COLUMN member_choice_selected_at TEXT;

-- Prior staging cycles had only the automatic FOTM base item. A previously
-- resolved cycle therefore has a deterministic, non-customer-specific
-- fallback to carry forward. Do not invent an override for any old row.
UPDATE profile_queue_cycles
SET
  member_choice_source = 'FOTM_FALLBACK',
  member_choice_variant_id = fotm_variant_id,
  member_choice_selected_at = updated_at
WHERE state <> 'OPEN'
  AND fotm_status = 'RESOLVED'
  AND member_choice_source = 'UNSELECTED'
  AND member_choice_variant_id IS NULL
  AND member_choice_selected_at IS NULL;

-- The existing audit CHECK predates member-choice actions. Rebuild only this
-- append-only table so legacy records remain intact while new actions use
-- explicit, reconcilable mutation names.
DROP TRIGGER IF EXISTS profile_queue_mutation_audit_no_update;
DROP TRIGGER IF EXISTS profile_queue_mutation_audit_no_delete;
DROP INDEX IF EXISTS profile_queue_audit_by_cycle;

CREATE TABLE profile_queue_mutation_audit_next (
  mutation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_ref TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  mutation_kind TEXT NOT NULL CHECK (
    mutation_kind IN (
      'CREATE_CYCLE',
      'SET_MEMBER_FRAGRANCE',
      'CLEAR_MEMBER_FRAGRANCE',
      'ADD_ADD_ON',
      'CHANGE_ADD_ON',
      'REMOVE_ADD_ON',
      'PUBLISH_FOTM',
      'RESOLVE_FOTM',
      'LOCK_MEMBER_FRAGRANCE_CUTOFF'
    )
  ),
  expected_revision INTEGER,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

INSERT INTO profile_queue_mutation_audit_next (
  mutation_id, idempotency_key, actor_ref, binding_id, cycle_key,
  mutation_kind, expected_revision, resulting_revision, occurred_at
)
SELECT
  mutation_id, idempotency_key, actor_ref, binding_id, cycle_key,
  mutation_kind, expected_revision, resulting_revision, occurred_at
FROM profile_queue_mutation_audit;

DROP TABLE profile_queue_mutation_audit;
ALTER TABLE profile_queue_mutation_audit_next RENAME TO profile_queue_mutation_audit;

CREATE INDEX IF NOT EXISTS profile_queue_audit_by_cycle
  ON profile_queue_mutation_audit (binding_id, cycle_key, occurred_at);

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

-- One durable schedule per future ship month. This is intentionally separate
-- from any theme-only current FOTM setting: a theme setting may display a
-- product, but it cannot enforce a future shipment choice or cutoff lock.
CREATE TABLE IF NOT EXISTS profile_queue_fotm_schedules (
  ship_month TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  merchant_timezone TEXT NOT NULL CHECK (merchant_timezone = 'America/Chicago'),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  last_mutation_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);

-- A schedule is born as a future draft. The Worker boundary may revise a
-- draft or publish it exactly once; a published month cannot be silently
-- rewritten in D1. This deliberately excludes any public/admin HTTP route.
--
-- SQLite/D1 has no IANA timezone conversion. For future America/Chicago
-- dates, the current US DST rule makes a 12:01 AM local cutoff either 05:01Z
-- (DST) or 06:01Z (standard time). The Worker additionally validates the
-- IANA rule with Intl; this database guard prevents an arbitrary wall-clock
-- value from being persisted outside that server boundary.
CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_insert_guard
BEFORE INSERT ON profile_queue_fotm_schedules
FOR EACH ROW
WHEN (
  NEW.status <> 'DRAFT'
  OR NEW.revision <> 0
  OR COALESCE(julianday(NEW.updated_at) >= julianday(NEW.cutoff_at), 1)
  OR COALESCE(NOT (
    strftime('%Y-%m-%dT%H:%M:%S', NEW.cutoff_at) = substr(NEW.cutoff_at, 1, 19)
    AND (
      NEW.cutoff_at = substr(NEW.cutoff_at, 1, 19) || 'Z'
      OR NEW.cutoff_at = substr(NEW.cutoff_at, 1, 19) || '.000Z'
    )
    AND substr(NEW.cutoff_at, 18, 2) = '00'
    AND CASE WHEN (
      CAST(strftime('%m', NEW.cutoff_at) AS INTEGER) BETWEEN 4 AND 10
      OR (
        strftime('%m', NEW.cutoff_at) = '03'
        AND CAST(strftime('%d', NEW.cutoff_at) AS INTEGER) > CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.cutoff_at), 'weekday 0', '+7 days')) AS INTEGER)
      )
      OR (
        strftime('%m', NEW.cutoff_at) = '11'
        AND CAST(strftime('%d', NEW.cutoff_at) AS INTEGER) <= CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.cutoff_at), 'weekday 0')) AS INTEGER)
      )
    ) THEN substr(NEW.cutoff_at, 12, 6) = '05:01:'
      ELSE substr(NEW.cutoff_at, 12, 6) = '06:01:'
    END
  ), 1)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid initial FOTM schedule');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_update_guard
BEFORE UPDATE ON profile_queue_fotm_schedules
FOR EACH ROW
WHEN (
  OLD.status <> 'DRAFT'
  OR NEW.revision <> OLD.revision + 1
  OR COALESCE(julianday(NEW.updated_at) >= julianday(NEW.cutoff_at), 1)
  OR NEW.status NOT IN ('DRAFT', 'PUBLISHED')
  OR COALESCE(NOT (
    strftime('%Y-%m-%dT%H:%M:%S', NEW.cutoff_at) = substr(NEW.cutoff_at, 1, 19)
    AND (
      NEW.cutoff_at = substr(NEW.cutoff_at, 1, 19) || 'Z'
      OR NEW.cutoff_at = substr(NEW.cutoff_at, 1, 19) || '.000Z'
    )
    AND substr(NEW.cutoff_at, 18, 2) = '00'
    AND CASE WHEN (
      CAST(strftime('%m', NEW.cutoff_at) AS INTEGER) BETWEEN 4 AND 10
      OR (
        strftime('%m', NEW.cutoff_at) = '03'
        AND CAST(strftime('%d', NEW.cutoff_at) AS INTEGER) > CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.cutoff_at), 'weekday 0', '+7 days')) AS INTEGER)
      )
      OR (
        strftime('%m', NEW.cutoff_at) = '11'
        AND CAST(strftime('%d', NEW.cutoff_at) AS INTEGER) <= CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.cutoff_at), 'weekday 0')) AS INTEGER)
      )
    ) THEN substr(NEW.cutoff_at, 12, 6) = '05:01:'
      ELSE substr(NEW.cutoff_at, 12, 6) = '06:01:'
    END
  ), 1)
)
BEGIN
  SELECT RAISE(ABORT, 'published FOTM schedules are immutable');
END;

CREATE TABLE IF NOT EXISTS profile_queue_fotm_schedule_audit (
  audit_id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_ref TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SCHEDULED', 'PUBLISHED')),
  expected_revision INTEGER,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 0),
  variant_id TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  merchant_timezone TEXT NOT NULL CHECK (merchant_timezone = 'America/Chicago'),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (ship_month)
    REFERENCES profile_queue_fotm_schedules (ship_month)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS profile_queue_fotm_schedule_audit_by_month
  ON profile_queue_fotm_schedule_audit (ship_month, occurred_at);

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_audit_insert_guard
BEFORE INSERT ON profile_queue_fotm_schedule_audit
FOR EACH ROW
WHEN (
  instr(NEW.actor_ref, '@') > 0
  OR NOT EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedules schedule
    WHERE schedule.ship_month = NEW.ship_month
      AND schedule.variant_id = NEW.variant_id
      AND schedule.cutoff_at = NEW.cutoff_at
      AND schedule.merchant_timezone = NEW.merchant_timezone
      AND schedule.revision = NEW.resulting_revision
      AND schedule.last_mutation_id = NEW.mutation_id
      AND (
        (NEW.action = 'SCHEDULED' AND schedule.status = 'DRAFT')
        OR (NEW.action = 'PUBLISHED' AND schedule.status = 'PUBLISHED')
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid FOTM schedule audit');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_audit_no_update
BEFORE UPDATE ON profile_queue_fotm_schedule_audit
BEGIN
  SELECT RAISE(ABORT, 'FOTM schedule audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_audit_no_delete
BEFORE DELETE ON profile_queue_fotm_schedule_audit
BEGIN
  SELECT RAISE(ABORT, 'FOTM schedule audit is append-only');
END;

-- Central Time is a product rule, while every durable cutoff remains a UTC
-- ISO instant. An open cycle may be unselected or member-selected. A closed
-- cycle must have either the saved member selection or its exact FOTM fallback.
CREATE TRIGGER IF NOT EXISTS profile_queue_member_choice_insert_guard
BEFORE INSERT ON profile_queue_cycles
FOR EACH ROW
WHEN (
  (NEW.fotm_status IN ('PUBLISHED', 'RESOLVED') AND NEW.merchant_timezone <> 'America/Chicago')
  OR (NEW.fotm_status IN ('PUBLISHED', 'RESOLVED') AND COALESCE(NOT (
    strftime('%Y-%m-%dT%H:%M:%S', NEW.fotm_cutoff_at) = substr(NEW.fotm_cutoff_at, 1, 19)
    AND (
      NEW.fotm_cutoff_at = substr(NEW.fotm_cutoff_at, 1, 19) || 'Z'
      OR NEW.fotm_cutoff_at = substr(NEW.fotm_cutoff_at, 1, 19) || '.000Z'
    )
    AND substr(NEW.fotm_cutoff_at, 18, 2) = '00'
    AND CASE WHEN (
      CAST(strftime('%m', NEW.fotm_cutoff_at) AS INTEGER) BETWEEN 4 AND 10
      OR (
        strftime('%m', NEW.fotm_cutoff_at) = '03'
        AND CAST(strftime('%d', NEW.fotm_cutoff_at) AS INTEGER) > CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.fotm_cutoff_at), 'weekday 0', '+7 days')) AS INTEGER)
      )
      OR (
        strftime('%m', NEW.fotm_cutoff_at) = '11'
        AND CAST(strftime('%d', NEW.fotm_cutoff_at) AS INTEGER) <= CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.fotm_cutoff_at), 'weekday 0')) AS INTEGER)
      )
    ) THEN substr(NEW.fotm_cutoff_at, 12, 6) = '05:01:'
      ELSE substr(NEW.fotm_cutoff_at, 12, 6) = '06:01:'
    END
  ), 1))
  OR (NEW.member_choice_source = 'UNSELECTED' AND (
    NEW.member_choice_variant_id IS NOT NULL
    OR NEW.member_choice_selected_at IS NOT NULL
    OR NEW.state <> 'OPEN'
  ))
  OR (NEW.member_choice_source = 'MEMBER_SELECTED' AND (
    NEW.member_choice_variant_id IS NULL OR NEW.member_choice_selected_at IS NULL
  ))
  OR (NEW.member_choice_source = 'FOTM_FALLBACK' AND (
    NEW.member_choice_variant_id IS NULL
    OR NEW.member_choice_selected_at IS NULL
    OR NEW.state = 'OPEN'
    OR NEW.fotm_status <> 'RESOLVED'
    OR NEW.member_choice_variant_id <> NEW.fotm_variant_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid member fragrance choice state');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_member_choice_update_guard
BEFORE UPDATE OF state, fotm_variant_id, fotm_status, fotm_cutoff_at, merchant_timezone,
  member_choice_source, member_choice_variant_id, member_choice_selected_at
ON profile_queue_cycles
FOR EACH ROW
WHEN (
  (NEW.fotm_status IN ('PUBLISHED', 'RESOLVED') AND NEW.merchant_timezone <> 'America/Chicago')
  OR (NEW.fotm_status IN ('PUBLISHED', 'RESOLVED') AND COALESCE(NOT (
    strftime('%Y-%m-%dT%H:%M:%S', NEW.fotm_cutoff_at) = substr(NEW.fotm_cutoff_at, 1, 19)
    AND (
      NEW.fotm_cutoff_at = substr(NEW.fotm_cutoff_at, 1, 19) || 'Z'
      OR NEW.fotm_cutoff_at = substr(NEW.fotm_cutoff_at, 1, 19) || '.000Z'
    )
    AND substr(NEW.fotm_cutoff_at, 18, 2) = '00'
    AND CASE WHEN (
      CAST(strftime('%m', NEW.fotm_cutoff_at) AS INTEGER) BETWEEN 4 AND 10
      OR (
        strftime('%m', NEW.fotm_cutoff_at) = '03'
        AND CAST(strftime('%d', NEW.fotm_cutoff_at) AS INTEGER) > CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.fotm_cutoff_at), 'weekday 0', '+7 days')) AS INTEGER)
      )
      OR (
        strftime('%m', NEW.fotm_cutoff_at) = '11'
        AND CAST(strftime('%d', NEW.fotm_cutoff_at) AS INTEGER) <= CAST(strftime('%d', date(strftime('%Y-%m-01', NEW.fotm_cutoff_at), 'weekday 0')) AS INTEGER)
      )
    ) THEN substr(NEW.fotm_cutoff_at, 12, 6) = '05:01:'
      ELSE substr(NEW.fotm_cutoff_at, 12, 6) = '06:01:'
    END
  ), 1))
  OR (NEW.member_choice_source = 'UNSELECTED' AND (
    NEW.member_choice_variant_id IS NOT NULL
    OR NEW.member_choice_selected_at IS NOT NULL
    OR NEW.state <> 'OPEN'
  ))
  OR (NEW.member_choice_source = 'MEMBER_SELECTED' AND (
    NEW.member_choice_variant_id IS NULL OR NEW.member_choice_selected_at IS NULL
  ))
  OR (NEW.member_choice_source = 'FOTM_FALLBACK' AND (
    NEW.member_choice_variant_id IS NULL
    OR NEW.member_choice_selected_at IS NULL
    OR NEW.state = 'OPEN'
    OR NEW.fotm_status <> 'RESOLVED'
    OR NEW.member_choice_variant_id <> NEW.fotm_variant_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid member fragrance choice state');
END;

-- This event pairs an append-only mutation audit with the exact resulting
-- member choice and ordered paid add-ons. The JSON snapshot is generated only
-- from validated ProductVariant GIDs in source. The database independently
-- requires its exact ordered contents to match the durable add-on rows, so an
-- audit record remains sufficient to reconcile a choice without PII.
CREATE TABLE IF NOT EXISTS profile_queue_selection_evidence (
  evidence_id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL UNIQUE,
  binding_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (
    event_kind IN (
      'CYCLE_CREATED',
      'MEMBER_CHOICE_SET',
      'MEMBER_CHOICE_CLEARED',
      'ADD_ONS_CHANGED',
      'FOTM_PUBLISHED',
      'CUTOFF_LOCKED'
    )
  ),
  member_choice_source TEXT NOT NULL CHECK (
    member_choice_source IN ('UNSELECTED', 'MEMBER_SELECTED', 'FOTM_FALLBACK')
  ),
  member_choice_variant_id TEXT,
  add_on_snapshot_json TEXT NOT NULL CHECK (length(add_on_snapshot_json) BETWEEN 2 AND 4096),
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (mutation_id)
    REFERENCES profile_queue_mutation_audit (mutation_id)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  FOREIGN KEY (binding_id, cycle_key)
    REFERENCES profile_queue_cycles (binding_id, cycle_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS profile_queue_selection_evidence_by_cycle
  ON profile_queue_selection_evidence (binding_id, cycle_key, resulting_revision, occurred_at);

CREATE TRIGGER IF NOT EXISTS profile_queue_selection_evidence_insert_guard
BEFORE INSERT ON profile_queue_selection_evidence
FOR EACH ROW
WHEN (
  instr(NEW.add_on_snapshot_json, '@') > 0
  OR instr(COALESCE(NEW.member_choice_variant_id, ''), '@') > 0
  OR (NEW.member_choice_source = 'UNSELECTED' AND NEW.member_choice_variant_id IS NOT NULL)
  OR (NEW.member_choice_source <> 'UNSELECTED' AND NEW.member_choice_variant_id IS NULL)
  OR json_valid(NEW.add_on_snapshot_json) = 0
  OR json_type(NEW.add_on_snapshot_json) <> 'array'
  OR json_array_length(NEW.add_on_snapshot_json) <> (
    SELECT COUNT(*)
    FROM profile_queue_add_ons add_on
    WHERE add_on.binding_id = NEW.binding_id
      AND add_on.cycle_key = NEW.cycle_key
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.add_on_snapshot_json) snapshot
    WHERE json_type(snapshot.value) IS NOT 'object'
      OR (SELECT COUNT(*) FROM json_each(snapshot.value)) <> 2
      OR json_type(snapshot.value, '$.position') IS NOT 'integer'
      OR json_type(snapshot.value, '$.variantId') IS NOT 'text'
      OR CAST(snapshot.key AS INTEGER) + 1 <> json_extract(snapshot.value, '$.position')
      OR NOT EXISTS (
        SELECT 1
        FROM profile_queue_add_ons add_on
        WHERE add_on.binding_id = NEW.binding_id
          AND add_on.cycle_key = NEW.cycle_key
          AND add_on.position = json_extract(snapshot.value, '$.position')
          AND add_on.variant_id = json_extract(snapshot.value, '$.variantId')
      )
  )
  OR EXISTS (
    SELECT 1
    FROM profile_queue_add_ons add_on
    WHERE add_on.binding_id = NEW.binding_id
      AND add_on.cycle_key = NEW.cycle_key
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(NEW.add_on_snapshot_json) snapshot
        WHERE json_extract(snapshot.value, '$.position') = add_on.position
          AND json_extract(snapshot.value, '$.variantId') = add_on.variant_id
      )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM profile_queue_mutation_audit audit
    WHERE audit.mutation_id = NEW.mutation_id
      AND audit.binding_id = NEW.binding_id
      AND audit.cycle_key = NEW.cycle_key
      AND audit.resulting_revision = NEW.resulting_revision
      AND audit.occurred_at = NEW.occurred_at
      AND (
        (audit.mutation_kind = 'CREATE_CYCLE' AND NEW.event_kind = 'CYCLE_CREATED')
        OR (audit.mutation_kind = 'SET_MEMBER_FRAGRANCE' AND NEW.event_kind = 'MEMBER_CHOICE_SET')
        OR (audit.mutation_kind = 'CLEAR_MEMBER_FRAGRANCE' AND NEW.event_kind = 'MEMBER_CHOICE_CLEARED')
        OR (audit.mutation_kind IN ('ADD_ADD_ON', 'CHANGE_ADD_ON', 'REMOVE_ADD_ON') AND NEW.event_kind = 'ADD_ONS_CHANGED')
        OR (audit.mutation_kind = 'PUBLISH_FOTM' AND NEW.event_kind = 'FOTM_PUBLISHED')
        OR (audit.mutation_kind IN ('RESOLVE_FOTM', 'LOCK_MEMBER_FRAGRANCE_CUTOFF') AND NEW.event_kind = 'CUTOFF_LOCKED')
      )
  )
  OR NOT EXISTS (
    SELECT 1
    FROM profile_queue_cycles cycle
    WHERE cycle.binding_id = NEW.binding_id
      AND cycle.cycle_key = NEW.cycle_key
      AND cycle.revision = NEW.resulting_revision
      AND cycle.member_choice_source = NEW.member_choice_source
      AND cycle.member_choice_variant_id IS NEW.member_choice_variant_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid profile queue selection evidence');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_selection_evidence_no_update
BEFORE UPDATE ON profile_queue_selection_evidence
BEGIN
  SELECT RAISE(ABORT, 'profile queue selection evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_selection_evidence_no_delete
BEFORE DELETE ON profile_queue_selection_evidence
BEGIN
  SELECT RAISE(ABORT, 'profile queue selection evidence is append-only');
END;
