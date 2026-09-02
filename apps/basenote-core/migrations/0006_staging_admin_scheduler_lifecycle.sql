-- Staging-only FOTM scheduler lifecycle and provision-command replay schema.
--
-- Apply only after 0001–0005 through `wrangler d1 migrations apply` to the
-- isolated disposable staging D1 database. Never apply it to production or by
-- raw `sqlite3 < file` redirection. The migration runner must stop/roll back
-- on an error; the local smoke uses sqlite3 -bail.
--
-- This forward migration deliberately leaves 0003 and 0005 unchanged. It
-- rebuilds the durable schedule/audit tables to add RETIRED/RECOVERED without
-- dropping historical rows, then adds non-PII provision-command evidence.

PRAGMA foreign_keys = ON;

-- Preserve every existing schedule/audit row before rebuilding the old
-- DRAFT/PUBLISHED CHECK constraints. The preserved tables have no foreign
-- keys, allowing the parent table to be rebuilt while foreign keys stay on.
DROP TRIGGER IF EXISTS profile_queue_fotm_schedule_audit_no_update;
DROP TRIGGER IF EXISTS profile_queue_fotm_schedule_audit_no_delete;
DROP TRIGGER IF EXISTS profile_queue_fotm_schedule_audit_insert_guard;
DROP TRIGGER IF EXISTS profile_queue_fotm_schedule_insert_guard;
DROP TRIGGER IF EXISTS profile_queue_fotm_schedule_update_guard;

CREATE TABLE profile_queue_fotm_schedules_0006_preserved AS
SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision,
  last_mutation_id, updated_at
FROM profile_queue_fotm_schedules;

CREATE TABLE profile_queue_fotm_schedule_audit_0006_preserved AS
SELECT audit_id, mutation_id, idempotency_key, actor_ref, ship_month, action,
  expected_revision, resulting_revision, variant_id, cutoff_at,
  merchant_timezone, occurred_at
FROM profile_queue_fotm_schedule_audit;

DROP TABLE profile_queue_fotm_schedule_audit;
DROP TABLE profile_queue_fotm_schedules;

CREATE TABLE profile_queue_fotm_schedules (
  ship_month TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,
  merchant_timezone TEXT NOT NULL CHECK (merchant_timezone = 'America/Chicago'),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  last_mutation_id TEXT NOT NULL UNIQUE,
  last_action TEXT NOT NULL CHECK (last_action IN ('SCHEDULED', 'PUBLISHED', 'RETIRED', 'RECOVERED')),
  updated_at TEXT NOT NULL
);

-- Legacy rows had no action column. Their current state provides the only
-- defensible transition label; original immutable audit rows are preserved
-- unchanged below.
INSERT INTO profile_queue_fotm_schedules (
  ship_month, variant_id, cutoff_at, merchant_timezone, status, revision,
  last_mutation_id, last_action, updated_at
)
SELECT ship_month, variant_id, cutoff_at, merchant_timezone, status, revision,
  last_mutation_id,
  CASE status WHEN 'PUBLISHED' THEN 'PUBLISHED' ELSE 'SCHEDULED' END,
  updated_at
FROM profile_queue_fotm_schedules_0006_preserved;

CREATE TABLE profile_queue_fotm_schedule_audit (
  audit_id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_ref TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('SCHEDULED', 'PUBLISHED', 'RETIRED', 'RECOVERED')),
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

INSERT INTO profile_queue_fotm_schedule_audit (
  audit_id, mutation_id, idempotency_key, actor_ref, ship_month, action,
  expected_revision, resulting_revision, variant_id, cutoff_at,
  merchant_timezone, occurred_at
)
SELECT audit_id, mutation_id, idempotency_key, actor_ref, ship_month, action,
  expected_revision, resulting_revision, variant_id, cutoff_at,
  merchant_timezone, occurred_at
FROM profile_queue_fotm_schedule_audit_0006_preserved;

DROP TABLE profile_queue_fotm_schedule_audit_0006_preserved;
DROP TABLE profile_queue_fotm_schedules_0006_preserved;

CREATE INDEX IF NOT EXISTS profile_queue_fotm_schedule_audit_by_month
  ON profile_queue_fotm_schedule_audit (ship_month, occurred_at);

-- A provision key is claimed before any bounded fan-out. It stores only
-- opaque queue binding/cycle IDs and revisions, never customer data, JWTs,
-- staff names, email, Shopify tokens, Appstle data, or provider payloads.
CREATE TABLE IF NOT EXISTS profile_queue_fotm_provision_commands (
  idempotency_key TEXT PRIMARY KEY CHECK (
    length(idempotency_key) BETWEEN 12 AND 195
    AND substr(idempotency_key, 1, 4) = 'pfk_'
    AND instr(idempotency_key, '@') = 0
  ),
  actor_ref TEXT NOT NULL CHECK (instr(actor_ref, '@') = 0),
  ship_month TEXT NOT NULL,
  expected_schedule_revision INTEGER NOT NULL CHECK (expected_schedule_revision >= 0),
  candidate_plan_json TEXT NOT NULL CHECK (
    length(candidate_plan_json) BETWEEN 2 AND 8192
    AND instr(candidate_plan_json, '@') = 0
    AND json_valid(candidate_plan_json) = 1
    AND json_type(candidate_plan_json) = 'array'
    AND json_array_length(candidate_plan_json) BETWEEN 0 AND 5
  ),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'NEEDS_ATTENTION')),
  configured_count INTEGER,
  conflicted_count INTEGER,
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%S', created_at) = substr(created_at, 1, 19)
    AND substr(created_at, 12, 2) BETWEEN '00' AND '23'
    AND (
      created_at = substr(created_at, 1, 19) || 'Z'
      OR created_at = substr(created_at, 1, 19) || '.000Z'
    )
  ),
  completed_at TEXT CHECK (
    completed_at IS NULL OR (
      strftime('%Y-%m-%dT%H:%M:%S', completed_at) = substr(completed_at, 1, 19)
      AND substr(completed_at, 12, 2) BETWEEN '00' AND '23'
      AND (
        completed_at = substr(completed_at, 1, 19) || 'Z'
        OR completed_at = substr(completed_at, 1, 19) || '.000Z'
      )
    )
  ),
  attention_at TEXT CHECK (
    attention_at IS NULL OR (
      strftime('%Y-%m-%dT%H:%M:%S', attention_at) = substr(attention_at, 1, 19)
      AND substr(attention_at, 12, 2) BETWEEN '00' AND '23'
      AND (
        attention_at = substr(attention_at, 1, 19) || 'Z'
        OR attention_at = substr(attention_at, 1, 19) || '.000Z'
      )
    )
  ),
  CHECK (
    (status = 'PENDING'
      AND configured_count IS NULL
      AND conflicted_count IS NULL
      AND completed_at IS NULL
      AND attention_at IS NULL)
    OR
    (status = 'COMPLETED'
      AND configured_count IS NOT NULL AND configured_count >= 0
      AND conflicted_count IS NOT NULL AND conflicted_count >= 0
      AND configured_count + conflicted_count = json_array_length(candidate_plan_json)
      AND completed_at IS NOT NULL
      AND attention_at IS NULL
      AND julianday(completed_at) >= julianday(created_at))
    OR
    (status = 'NEEDS_ATTENTION'
      AND configured_count IS NULL
      AND conflicted_count IS NULL
      AND completed_at IS NULL
      AND attention_at IS NOT NULL
      AND julianday(attention_at) >= julianday(created_at))
  ),
  FOREIGN KEY (ship_month)
    REFERENCES profile_queue_fotm_schedules (ship_month)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS profile_queue_fotm_provision_commands_by_month
  ON profile_queue_fotm_provision_commands (ship_month, status, created_at);

-- A schedule may have extensive completed command history, but exactly one
-- active unknown-outcome claim. This keeps the per-month recovery handle
-- discoverable without relying on a globally truncated history list.
CREATE UNIQUE INDEX IF NOT EXISTS profile_queue_fotm_provision_commands_one_pending_per_month
  ON profile_queue_fotm_provision_commands (ship_month)
  WHERE status = 'PENDING';

-- Every claimed/completed command has an append-only audit event generated by
-- its own durable row. A command can never be silently edited or deleted.
CREATE TABLE IF NOT EXISTS profile_queue_fotm_provision_command_audit (
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CLAIMED', 'COMPLETED', 'NEEDS_ATTENTION')),
  actor_ref TEXT NOT NULL,
  ship_month TEXT NOT NULL,
  expected_schedule_revision INTEGER NOT NULL CHECK (expected_schedule_revision >= 0),
  candidate_plan_json TEXT NOT NULL,
  configured_count INTEGER,
  conflicted_count INTEGER,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, action),
  FOREIGN KEY (idempotency_key)
    REFERENCES profile_queue_fotm_provision_commands (idempotency_key)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_insert_guard
BEFORE INSERT ON profile_queue_fotm_provision_commands
FOR EACH ROW
WHEN (
  NEW.status <> 'PENDING'
  OR NEW.configured_count IS NOT NULL
  OR NEW.conflicted_count IS NOT NULL
  OR NEW.completed_at IS NOT NULL
  OR NEW.attention_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedule_audit audit
    WHERE audit.idempotency_key = NEW.idempotency_key
  )
  OR EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedule_recovery_exceptions exception
    WHERE exception.idempotency_key = NEW.idempotency_key
  )
  OR NOT EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedules schedule
    WHERE schedule.ship_month = NEW.ship_month
      AND schedule.status = 'PUBLISHED'
      AND schedule.revision = NEW.expected_schedule_revision
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.candidate_plan_json)
    WHERE json_type(value) <> 'object'
      OR json_type(value, '$.bindingId') <> 'text'
      OR json_type(value, '$.cycleKey') <> 'text'
      OR json_type(value, '$.expectedRevision') <> 'integer'
      OR length(json_extract(value, '$.bindingId')) NOT BETWEEN 3 AND 160
      OR length(json_extract(value, '$.cycleKey')) NOT BETWEEN 3 AND 160
      OR json_extract(value, '$.expectedRevision') < 0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid staging FOTM provision command claim');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_update_guard
BEFORE UPDATE ON profile_queue_fotm_provision_commands
FOR EACH ROW
WHEN (
  OLD.status <> 'PENDING'
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.actor_ref <> OLD.actor_ref
  OR NEW.ship_month <> OLD.ship_month
  OR NEW.expected_schedule_revision <> OLD.expected_schedule_revision
  OR NEW.candidate_plan_json <> OLD.candidate_plan_json
  OR NEW.created_at <> OLD.created_at
  OR COALESCE(NOT (
    (NEW.status = 'COMPLETED'
      AND NEW.configured_count IS NOT NULL AND NEW.configured_count >= 0
      AND NEW.conflicted_count IS NOT NULL AND NEW.conflicted_count >= 0
      AND NEW.configured_count + NEW.conflicted_count = json_array_length(OLD.candidate_plan_json)
      AND NEW.completed_at IS NOT NULL
      AND NEW.attention_at IS NULL
      AND julianday(NEW.completed_at) >= julianday(OLD.created_at))
    OR
    (NEW.status = 'NEEDS_ATTENTION'
      AND NEW.configured_count IS NULL
      AND NEW.conflicted_count IS NULL
      AND NEW.completed_at IS NULL
      AND NEW.attention_at IS NOT NULL
      AND julianday(NEW.attention_at) >= julianday(OLD.created_at, '+900 seconds'))
  ), 1)
)
BEGIN
  SELECT RAISE(ABORT, 'staging FOTM provision command is one-way and recovery-delayed');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_no_delete
BEFORE DELETE ON profile_queue_fotm_provision_commands
BEGIN
  SELECT RAISE(ABORT, 'staging FOTM provision commands are append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_audit_insert_guard
BEFORE INSERT ON profile_queue_fotm_provision_command_audit
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM profile_queue_fotm_provision_commands command
  WHERE command.idempotency_key = NEW.idempotency_key
    AND command.actor_ref = NEW.actor_ref
    AND command.ship_month = NEW.ship_month
    AND command.expected_schedule_revision = NEW.expected_schedule_revision
    AND command.candidate_plan_json = NEW.candidate_plan_json
    AND (
      (NEW.action = 'CLAIMED'
        AND NEW.configured_count IS NULL
        AND NEW.conflicted_count IS NULL
        AND NEW.occurred_at = command.created_at)
      OR
      (NEW.action = 'COMPLETED'
        AND command.status = 'COMPLETED'
        AND NEW.configured_count = command.configured_count
        AND NEW.conflicted_count = command.conflicted_count
        AND NEW.occurred_at = command.completed_at)
      OR
      (NEW.action = 'NEEDS_ATTENTION'
        AND command.status = 'NEEDS_ATTENTION'
        AND NEW.configured_count IS NULL
        AND NEW.conflicted_count IS NULL
        AND NEW.occurred_at = command.attention_at)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid staging FOTM provision command audit');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_audit_no_update
BEFORE UPDATE ON profile_queue_fotm_provision_command_audit
BEGIN
  SELECT RAISE(ABORT, 'staging FOTM provision command audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_audit_no_delete
BEFORE DELETE ON profile_queue_fotm_provision_command_audit
BEGIN
  SELECT RAISE(ABORT, 'staging FOTM provision command audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_claim_audit
AFTER INSERT ON profile_queue_fotm_provision_commands
FOR EACH ROW
BEGIN
  INSERT INTO profile_queue_fotm_provision_command_audit (
    idempotency_key, action, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, configured_count, conflicted_count, occurred_at
  ) VALUES (
    NEW.idempotency_key, 'CLAIMED', NEW.actor_ref, NEW.ship_month,
    NEW.expected_schedule_revision, NEW.candidate_plan_json, NULL, NULL,
    NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_complete_audit
AFTER UPDATE OF status ON profile_queue_fotm_provision_commands
FOR EACH ROW
WHEN OLD.status = 'PENDING' AND NEW.status = 'COMPLETED'
BEGIN
  INSERT INTO profile_queue_fotm_provision_command_audit (
    idempotency_key, action, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, configured_count, conflicted_count, occurred_at
  ) VALUES (
    NEW.idempotency_key, 'COMPLETED', NEW.actor_ref, NEW.ship_month,
    NEW.expected_schedule_revision, NEW.candidate_plan_json,
    NEW.configured_count, NEW.conflicted_count, NEW.completed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_provision_command_needs_attention_audit
AFTER UPDATE OF status ON profile_queue_fotm_provision_commands
FOR EACH ROW
WHEN OLD.status = 'PENDING' AND NEW.status = 'NEEDS_ATTENTION'
BEGIN
  INSERT INTO profile_queue_fotm_provision_command_audit (
    idempotency_key, action, actor_ref, ship_month, expected_schedule_revision,
    candidate_plan_json, configured_count, conflicted_count, occurred_at
  ) VALUES (
    NEW.idempotency_key, 'NEEDS_ATTENTION', NEW.actor_ref, NEW.ship_month,
    NEW.expected_schedule_revision, NEW.candidate_plan_json, NULL, NULL,
    NEW.attention_at
  );
END;

-- This explicit no-mutation exception records why a staff member cannot
-- retire/recover a month after any cycle has received the old FOTM default.
-- It deliberately does not alter the schedule, a cycle, a member choice, or
-- any provider state. Operators must use its immutable evidence for review.
CREATE TABLE IF NOT EXISTS profile_queue_fotm_schedule_recovery_exceptions (
  idempotency_key TEXT PRIMARY KEY CHECK (
    length(idempotency_key) BETWEEN 12 AND 195
    AND substr(idempotency_key, 1, 4) = 'pfk_'
    AND instr(idempotency_key, '@') = 0
  ),
  actor_ref TEXT NOT NULL CHECK (instr(actor_ref, '@') = 0),
  ship_month TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  reason TEXT NOT NULL CHECK (reason = 'PROVISIONED_CYCLES'),
  occurred_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%S', occurred_at) = substr(occurred_at, 1, 19)
    AND substr(occurred_at, 12, 2) BETWEEN '00' AND '23'
    AND (
      occurred_at = substr(occurred_at, 1, 19) || 'Z'
      OR occurred_at = substr(occurred_at, 1, 19) || '.000Z'
    )
  ),
  FOREIGN KEY (ship_month)
    REFERENCES profile_queue_fotm_schedules (ship_month)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS profile_queue_fotm_schedule_recovery_exceptions_by_month
  ON profile_queue_fotm_schedule_recovery_exceptions (ship_month, occurred_at);

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_recovery_exception_insert_guard
BEFORE INSERT ON profile_queue_fotm_schedule_recovery_exceptions
FOR EACH ROW
WHEN (
  EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedule_audit audit
    WHERE audit.idempotency_key = NEW.idempotency_key
  )
  OR EXISTS (
    SELECT 1 FROM profile_queue_fotm_provision_commands command
    WHERE command.idempotency_key = NEW.idempotency_key
  )
  OR EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedule_recovery_exceptions exception
    WHERE exception.idempotency_key = NEW.idempotency_key
  )
  OR NOT EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedules schedule
    WHERE schedule.ship_month = NEW.ship_month
      AND schedule.revision = NEW.expected_revision
      AND schedule.status IN ('PUBLISHED', 'RETIRED')
  )
  OR NOT EXISTS (
    SELECT 1 FROM profile_queue_cycles cycle
    WHERE cycle.ship_month = NEW.ship_month
      AND cycle.fotm_status IN ('PUBLISHED', 'RESOLVED')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid FOTM schedule recovery exception');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_recovery_exception_no_update
BEFORE UPDATE ON profile_queue_fotm_schedule_recovery_exceptions
BEGIN
  SELECT RAISE(ABORT, 'FOTM schedule recovery exceptions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_recovery_exception_no_delete
BEFORE DELETE ON profile_queue_fotm_schedule_recovery_exceptions
BEGIN
  SELECT RAISE(ABORT, 'FOTM schedule recovery exceptions are append-only');
END;

-- A new row starts as a DRAFT. Retiring and recovering are explicit state
-- transitions; they remain before the Central cutoff and never mutate queue
-- cycles. A PENDING provision claim temporarily prevents retirement, closing
-- the schedule/command race before a fan-out is completed. An authenticated
-- operator can terminalize only an aged unknown-outcome claim as
-- NEEDS_ATTENTION; that transition never retries or edits a cycle.
CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_insert_guard
BEFORE INSERT ON profile_queue_fotm_schedules
FOR EACH ROW
WHEN (
  NEW.status <> 'DRAFT'
  OR NEW.revision <> 0
  OR NEW.last_action <> 'SCHEDULED'
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
  NEW.revision <> OLD.revision + 1
  OR NEW.last_mutation_id = OLD.last_mutation_id
  OR COALESCE(julianday(NEW.updated_at) >= julianday(NEW.cutoff_at), 1)
  OR (OLD.status = 'RETIRED' AND COALESCE(julianday(NEW.updated_at) >= julianday(OLD.cutoff_at), 1))
  OR NEW.status NOT IN ('DRAFT', 'PUBLISHED', 'RETIRED')
  OR NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'DRAFT' AND NEW.last_action = 'SCHEDULED')
    OR (OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' AND NEW.last_action = 'PUBLISHED')
    OR (OLD.status = 'DRAFT' AND NEW.status = 'RETIRED' AND NEW.last_action = 'RETIRED')
    OR (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED' AND NEW.last_action = 'RETIRED')
    OR (OLD.status = 'RETIRED' AND NEW.status = 'DRAFT' AND NEW.last_action = 'RECOVERED')
  )
  OR (
    NEW.status <> 'DRAFT'
    AND (
      NEW.variant_id <> OLD.variant_id
      OR NEW.cutoff_at <> OLD.cutoff_at
      OR NEW.merchant_timezone <> OLD.merchant_timezone
    )
  )
  OR (NEW.status = 'RETIRED' AND EXISTS (
    SELECT 1 FROM profile_queue_fotm_provision_commands command
    WHERE command.ship_month = NEW.ship_month AND command.status = 'PENDING'
  ))
  OR (
    (NEW.status = 'RETIRED' OR (OLD.status = 'RETIRED' AND NEW.status = 'DRAFT'))
    AND EXISTS (
      SELECT 1 FROM profile_queue_cycles cycle
      WHERE cycle.ship_month = NEW.ship_month
        AND cycle.fotm_status IN ('PUBLISHED', 'RESOLVED')
    )
  )
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
  SELECT RAISE(ABORT, 'invalid or silent FOTM schedule transition');
END;

CREATE TRIGGER IF NOT EXISTS profile_queue_fotm_schedule_audit_insert_guard
BEFORE INSERT ON profile_queue_fotm_schedule_audit
FOR EACH ROW
WHEN (
  instr(NEW.actor_ref, '@') > 0
  OR EXISTS (
    SELECT 1 FROM profile_queue_fotm_provision_commands command
    WHERE command.idempotency_key = NEW.idempotency_key
  )
  OR NOT EXISTS (
    SELECT 1 FROM profile_queue_fotm_schedules schedule
    WHERE schedule.ship_month = NEW.ship_month
      AND schedule.variant_id = NEW.variant_id
      AND schedule.cutoff_at = NEW.cutoff_at
      AND schedule.merchant_timezone = NEW.merchant_timezone
      AND schedule.revision = NEW.resulting_revision
      AND schedule.last_mutation_id = NEW.mutation_id
      AND schedule.last_action = NEW.action
      AND (
        (NEW.action IN ('SCHEDULED', 'RECOVERED') AND schedule.status = 'DRAFT')
        OR (NEW.action = 'PUBLISHED' AND schedule.status = 'PUBLISHED')
        OR (NEW.action = 'RETIRED' AND schedule.status = 'RETIRED')
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
