import assert from "node:assert/strict";
import test from "node:test";

import { D1ProfileQueueFotmScheduleRepository } from "./d1-fotm-schedule-repository.js";
import {
  asProfileQueueFotmScheduleAuditId,
  asProfileQueueFotmScheduleIdempotencyKey,
  asProfileQueueFotmScheduleMutationId,
  createDraftProfileQueueFotmSchedule,
  type ProfileQueueFotmScheduleAuditRecord,
} from "./fotm-schedule.js";
import { asBindingId, asCycleKey } from "../queue/types.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

test("D1 FOTM schedule repository atomically records one future-month schedule and immutable audit", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueFotmScheduleRepository(database);
  const schedule = createDraftProfileQueueFotmSchedule({
    cutoffAt: "2026-10-10T05:01:00.000Z",
    merchantTimezone: "America/Chicago",
    occurredAt: "2026-09-01T09:00:00.000Z",
    shipMonth: "2026-10",
    variantId: "gid://shopify/ProductVariant/902",
  });
  const audit: ProfileQueueFotmScheduleAuditRecord = {
    action: "SCHEDULED",
    actorRef: "staff_stage_101",
    auditId: asProfileQueueFotmScheduleAuditId("pfa_schedule001"),
    cutoffAt: schedule.cutoffAt,
    expectedRevision: null,
    idempotencyKey: asProfileQueueFotmScheduleIdempotencyKey("pfk_schedule001"),
    merchantTimezone: schedule.merchantTimezone,
    mutationId: asProfileQueueFotmScheduleMutationId("pfs_schedule001"),
    occurredAt: schedule.updatedAt,
    resultingRevision: schedule.revision,
    shipMonth: schedule.shipMonth,
    variantId: schedule.variantId,
  };

  await repository.persist({ audit, expectedRevision: null, schedule });

  assert.equal(database.batches.length, 1);
  const batch = database.batches[0] ?? [];
  assert.equal(batch.length, 2);
  assert.match(batch[0]?.query ?? "", /INSERT INTO profile_queue_fotm_schedules/);
  assert.match(batch[1]?.query ?? "", /INSERT INTO profile_queue_fotm_schedule_audit/);
  assert.doesNotMatch(
    batch[1]?.query ?? "",
    /NOT EXISTS\s*\(\s*SELECT 1 FROM profile_queue_fotm_schedule_audit/i,
    "an audit collision must surface as a UNIQUE error that rolls the D1 batch back, never a silent zero-row insert.",
  );
  assert.ok(batch.some((statement) => statement.values.includes("America/Chicago")));
  assert.ok(batch.every((statement) => !/https?:\/\//.test(statement.query)));
});

test("D1 FOTM schedule repository retrieves an exact durable idempotency audit for safe command replay", async () => {
  const database = new RecordingD1Database();
  database.nextFirstRow = {
    action: "SCHEDULED",
    actor_ref: "staff_stage_101",
    audit_id: "pfa_schedule001",
    cutoff_at: "2026-10-10T05:01:00.000Z",
    expected_revision: null,
    idempotency_key: "pfk_schedule001",
    merchant_timezone: "America/Chicago",
    mutation_id: "pfs_schedule001",
    occurred_at: "2026-09-01T09:00:00.000Z",
    resulting_revision: 0,
    ship_month: "2026-10",
    variant_id: "gid://shopify/ProductVariant/902",
  };
  const repository = new D1ProfileQueueFotmScheduleRepository(database);

  const audit = await repository.findAuditByIdempotency("pfk_schedule001");
  assert.equal(audit?.action, "SCHEDULED");
  assert.equal(audit?.actorRef, "staff_stage_101");
  assert.equal(audit?.resultingRevision, 0);
  assert.equal(audit?.shipMonth, "2026-10");
  const statement = database.prepared[0];
  assert.match(statement?.query ?? "", /FROM profile_queue_fotm_schedule_audit/);
  assert.deepEqual(statement?.values, ["pfk_schedule001"]);
});

test("D1 provision claims are atomic against the published schedule revision and recovery evidence is no-mutation", async () => {
  const database = new RecordingD1Database();
  // D1 reports the direct command insert plus its AFTER-triggered CLAIMED
  // audit insert as two changes. That is one logical command mutation.
  database.nextRunChangeCount = 2;
  const repository = new D1ProfileQueueFotmScheduleRepository(database);

  const command = await repository.claimProvisionCommand({
    actorRef: "staff_stage_101",
    createdAt: "2026-09-01T09:00:00.000Z",
    expectedScheduleRevision: 3,
    idempotencyKey: "pfk_provision_claim001",
    plan: [{ bindingId: asBindingId("binding-stage-001"), cycleKey: asCycleKey("cycle-stage-001"), expectedRevision: 2 }],
    shipMonth: "2026-10",
  });
  assert.equal(command.status, "PENDING");
  const claim = database.prepared[0];
  assert.match(claim?.query ?? "", /INSERT INTO profile_queue_fotm_provision_commands/i);
  assert.match(claim?.query ?? "", /SELECT \?, \?, \?, \?, \?, 'PENDING'/i);
  assert.match(claim?.query ?? "", /schedule\.status = 'PUBLISHED'/);
  assert.match(claim?.query ?? "", /schedule\.revision = \?/);
  assert.deepEqual(claim?.values.slice(-2), ["2026-10", 3]);

  database.nextRunChangeCount = 1;
  await repository.recordRecoveryException({
    actorRef: "staff_stage_101",
    expectedRevision: 3,
    idempotencyKey: "pfk_recovery_evidence001",
    occurredAt: "2026-09-01T09:01:00.000Z",
    shipMonth: "2026-10",
  });
  const exception = database.prepared[1];
  assert.match(exception?.query ?? "", /INSERT INTO profile_queue_fotm_schedule_recovery_exceptions/i);
  assert.match(exception?.query ?? "", /schedule\.status IN \('PUBLISHED', 'RETIRED'\)/);
  assert.match(exception?.query ?? "", /cycle\.fotm_status IN \('PUBLISHED', 'RESOLVED'\)/);
  assert.doesNotMatch(exception?.query ?? "", /UPDATE profile_queue_(?:fotm_schedules|cycles)/i);

  const staleDatabase = new RecordingD1Database();
  staleDatabase.nextRunChangeCount = 0;
  const staleRepository = new D1ProfileQueueFotmScheduleRepository(staleDatabase);
  await assert.rejects(
    staleRepository.claimProvisionCommand({
      actorRef: "staff_stage_101",
      createdAt: "2026-09-01T09:00:00.000Z",
      expectedScheduleRevision: 3,
      idempotencyKey: "pfk_provision_stale001",
      plan: [],
      shipMonth: "2026-10",
    }),
    /changed; reload before provisioning/i,
    "a stale/retired schedule must fail before any cycle fan-out is possible.",
  );

  const anomalousDatabase = new RecordingD1Database();
  anomalousDatabase.nextRunChangeCount = 3;
  const anomalousRepository = new D1ProfileQueueFotmScheduleRepository(anomalousDatabase);
  await assert.rejects(
    anomalousRepository.claimProvisionCommand({
      actorRef: "staff_stage_101",
      createdAt: "2026-09-01T09:00:00.000Z",
      expectedScheduleRevision: 3,
      idempotencyKey: "pfk_provision_anomalous001",
      plan: [],
      shipMonth: "2026-10",
    }),
    /changed; reload before provisioning/i,
    "a wider-than-one-command mutation must not weaken the claim CAS gate.",
  );
});

test("D1 provision completion accepts one command plus its append-only audit trigger", async () => {
  const database = new RecordingD1Database();
  database.nextFirstRow = {
    actor_ref: "staff_stage_101",
    attention_at: null,
    candidate_plan_json: JSON.stringify([{
      bindingId: "binding-stage-001",
      cycleKey: "cycle-stage-001",
      expectedRevision: 2,
    }]),
    completed_at: null,
    configured_count: null,
    conflicted_count: null,
    created_at: "2026-09-01T09:00:00.000Z",
    expected_schedule_revision: 3,
    idempotency_key: "pfk_provision_complete001",
    ship_month: "2026-10",
    status: "PENDING",
  };
  database.nextRunChangeCount = 2;
  const repository = new D1ProfileQueueFotmScheduleRepository(database);

  const command = await repository.completeProvisionCommand({
    completedAt: "2026-09-01T09:01:00.000Z",
    idempotencyKey: "pfk_provision_complete001",
    result: { configured: 1, conflicted: 0, mayHaveMore: false, scanned: 1 },
  });

  assert.equal(command.status, "COMPLETED");
  assert.equal(command.result?.configured, 1);
  const update = database.prepared[1];
  assert.match(update?.query ?? "", /SET status = 'COMPLETED'/);
});

test("D1 provision recovery terminalization is delayed, one-way, and carries no fan-out result", async () => {
  const database = new RecordingD1Database();
  database.nextRunChangeCount = 2;
  database.nextFirstRow = {
    actor_ref: "staff_stage_101",
    attention_at: null,
    candidate_plan_json: "[]",
    completed_at: null,
    configured_count: null,
    conflicted_count: null,
    created_at: "2026-09-01T09:00:00.000Z",
    expected_schedule_revision: 3,
    idempotency_key: "pfk_provision_attention001",
    ship_month: "2026-10",
    status: "PENDING",
  };
  const repository = new D1ProfileQueueFotmScheduleRepository(database);
  const command = await repository.markProvisionCommandNeedsAttention({
    actorRef: "staff_stage_101",
    attentionAt: "2026-09-01T09:15:00.000Z",
    expectedScheduleRevision: 3,
    idempotencyKey: "pfk_provision_attention001",
    notBefore: "2026-09-01T09:00:00.000Z",
    shipMonth: "2026-10",
  });
  assert.equal(command.status, "NEEDS_ATTENTION");
  assert.equal(command.result, null);
  const update = database.prepared[1];
  assert.match(update?.query ?? "", /SET status = 'NEEDS_ATTENTION', attention_at = \?/);
  assert.match(update?.query ?? "", /julianday\(created_at\) <= julianday\(\?\)/);
  assert.deepEqual(update?.values.slice(-1), ["2026-09-01T09:00:00.000Z"]);
});

test("D1 active pending provision discovery is schedule-scoped, not truncated recent history", async () => {
  const database = new RecordingD1Database();
  database.nextAllRows = [{
    actor_ref: "staff_stage_101",
    attention_at: null,
    candidate_plan_json: "[]",
    completed_at: null,
    configured_count: null,
    conflicted_count: null,
    created_at: "2026-09-01T09:00:00.000Z",
    expected_schedule_revision: 3,
    idempotency_key: "pfk_pending_discovery001",
    ship_month: "2026-10",
    status: "PENDING",
  }];
  const repository = new D1ProfileQueueFotmScheduleRepository(database);

  const commands = await repository.listPendingProvisionCommands();
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.idempotencyKey, "pfk_pending_discovery001");
  const statement = database.prepared[0];
  assert.match(statement?.query ?? "", /WHERE status = 'PENDING'/);
  assert.doesNotMatch(statement?.query ?? "", /LIMIT\s+\?/i);
  assert.match(statement?.query ?? "", /ORDER BY ship_month ASC/);
});

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  readonly prepared: RecordingD1Statement[] = [];
  nextAllRows: Record<string, unknown>[] = [];
  nextFirstRow: Record<string, unknown> | null = null;
  nextRunChangeCount = 1;

  prepare(query: string): D1PreparedStatement {
    const statement = new RecordingD1Statement(query, this);
    this.prepared.push(statement);
    return statement;
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]> {
    const batch = statements.map((statement) => {
      if (!(statement instanceof RecordingD1Statement)) throw new Error("Unexpected statement implementation.");
      return { query: statement.query, values: [...statement.values] };
    });
    this.batches.push(batch);
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

interface RecordedStatement {
  readonly query: string;
  readonly values: readonly unknown[];
}

class RecordingD1Statement implements D1PreparedStatement {
  readonly values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly database: RecordingD1Database,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatement {
    this.values.push(...values);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.database.nextFirstRow as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: this.database.nextAllRows as T[] };
  }

  async run(): Promise<D1Result> {
    return { meta: { changes: this.database.nextRunChangeCount } };
  }
}
