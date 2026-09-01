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

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  readonly prepared: RecordingD1Statement[] = [];
  nextFirstRow: Record<string, unknown> | null = null;

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
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    return { meta: { changes: 1 } };
  }
}
