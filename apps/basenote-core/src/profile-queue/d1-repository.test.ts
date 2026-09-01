import assert from "node:assert/strict";
import test from "node:test";

import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import { D1ProfileQueueRepository } from "./d1-repository.js";
import { applyProfileQueueMutation } from "./service.js";
import { createProfileQueueSelectionEvidence } from "../cloudflare-staging-worker/cutoff-locker.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

test("D1 repository batches compare-and-swap, add-on replacement, and immutable audit writes", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueRepository(database);
  const initial = createCycle();
  const createAudit = auditFor(initial, null, "CREATE_CYCLE", "pqm_create001", "pqk_create001");
  await repository.persist({
    audit: createAudit,
    cycle: initial,
    expectedRevision: null,
    selectionEvidence: evidenceFor(initial, createAudit),
  });

  const changed = applyProfileQueueMutation(initial, {
    expectedRevision: 0,
    mutation: {
      addOnId: "pqa_addon001",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/501",
    },
    occurredAt: "2026-09-01T09:01:00.000Z",
  });
  const changedAudit = auditFor(changed, 0, "ADD_ADD_ON", "pqm_addon001", "pqk_addon001");
  await repository.persist({
    audit: changedAudit,
    cycle: changed,
    expectedRevision: 0,
    selectionEvidence: evidenceFor(changed, changedAudit),
  });

  assert.equal(database.batches.length, 2);
  const updateBatch = database.batches[1] ?? [];
  assert.match(updateBatch[0]?.query ?? "", /UPDATE profile_queue_cycles/);
  assert.ok(updateBatch.some((statement) => /DELETE FROM profile_queue_add_ons/.test(statement.query)));
  assert.ok(updateBatch.some((statement) => /INSERT INTO profile_queue_add_ons/.test(statement.query)));
  assert.ok(updateBatch.some((statement) => /INSERT INTO profile_queue_mutation_audit/.test(statement.query)));
  const auditStatement = updateBatch.find((statement) => /INSERT INTO profile_queue_mutation_audit/.test(statement.query));
  assert.doesNotMatch(
    auditStatement?.query ?? "",
    /NOT EXISTS\s*\(\s*SELECT 1 FROM profile_queue_mutation_audit/i,
    "an audit collision must surface as a UNIQUE error that rolls the D1 batch back, never a silent zero-row insert.",
  );
  const evidenceStatement = updateBatch.find((statement) => /INSERT INTO profile_queue_selection_evidence/.test(statement.query));
  assert.doesNotMatch(
    evidenceStatement?.query ?? "",
    /NOT EXISTS\s*\(\s*SELECT 1 FROM profile_queue_selection_evidence/i,
    "an evidence collision must surface as a UNIQUE error that rolls the D1 batch back, never a silent zero-row insert.",
  );
  assert.ok(updateBatch.some((statement) => statement.values.includes(1_800)));
  assert.ok(updateBatch.every((statement) => !/https?:\/\//.test(statement.query)));
});

test("D1 repository refuses a stale compare-and-swap result", async () => {
  const database = new RecordingD1Database();
  database.nextFirstChangeCount = 0;
  const repository = new D1ProfileQueueRepository(database);
  const initial = createCycle();
  const changed = applyProfileQueueMutation(initial, {
    expectedRevision: 0,
    mutation: {
      addOnId: "pqa_addon001",
      kind: "ADD_ADD_ON",
      variantId: "gid://shopify/ProductVariant/501",
    },
    occurredAt: "2026-09-01T09:01:00.000Z",
  });
  const changedAudit = auditFor(changed, 0, "ADD_ADD_ON", "pqm_addon002", "pqk_addon002");

  await assert.rejects(
    repository.persist({
      audit: changedAudit,
      cycle: changed,
      expectedRevision: 0,
      selectionEvidence: evidenceFor(changed, changedAudit),
    }),
    /changed; reload before saving/,
  );
});

test("D1 provisioning scan is exact-month, unpublished-only, and safely bounded", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueRepository(database);

  const cycles = await repository.findUnpublishedForProvisioning({
    limit: 5,
    shipMonth: "2026-10",
  });
  assert.deepEqual(cycles, []);
  const statement = database.prepared.find((candidate) => /SELECT_UNPUBLISHED_CYCLES_FOR_PROVISIONING/.test(candidate.query))
    ?? database.prepared.find((candidate) => /fotm_status = 'UNPUBLISHED'/.test(candidate.query));
  assert.ok(statement);
  assert.match(statement.query, /ship_month = \?/);
  assert.match(statement.query, /state = 'OPEN'/);
  assert.match(statement.query, /fotm_status = 'UNPUBLISHED'/);
  assert.match(statement.query, /LIMIT \?/);
  assert.deepEqual(statement.values, ["2026-10", 5]);

  await assert.rejects(
    repository.findUnpublishedForProvisioning({ limit: 11, shipMonth: "2026-10" }),
    /bounded limit between one and ten/i,
  );
});

test("D1 lifecycle guard detects an already provisioned FOTM for one exact ship month", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueRepository(database);
  database.nextFirstRow = { present: 1 };
  assert.equal(await repository.hasProvisionedFotmForShipMonth("2026-10"), true);
  const statement = database.prepared.at(-1);
  assert.match(statement?.query ?? "", /FROM profile_queue_cycles/);
  assert.match(statement?.query ?? "", /ship_month = \?/);
  assert.match(statement?.query ?? "", /fotm_status IN \('PUBLISHED', 'RESOLVED'\)/);
  assert.deepEqual(statement?.values, ["2026-10"]);

  database.nextFirstRow = null;
  assert.equal(await repository.hasProvisionedFotmForShipMonth("2026-10"), false);
});

function createCycle() {
  return createEmptyProfileQueueCycle({
    bindingId: "binding-profile-101",
    cycleKey: "appstle:delivery:2026-09-15",
    shipMonth: "2026-09",
    updatedAt: "2026-09-01T09:00:00.000Z",
  });
}

function auditFor(
  cycle: ReturnType<typeof createCycle>,
  expectedRevision: number | null,
  mutationKind: ProfileQueueMutationAuditRecord["mutationKind"],
  mutationId: string,
  idempotencyKey: string,
): ProfileQueueMutationAuditRecord {
  return {
    actorRef: asProfileQueueActorRef("profile_101"),
    bindingId: cycle.bindingId,
    cycleKey: cycle.cycleKey,
    expectedRevision,
    idempotencyKey: idempotencyKey as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: mutationId as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind,
    occurredAt: cycle.updatedAt,
    resultingRevision: cycle.revision,
  };
}

function evidenceFor(
  cycle: ReturnType<typeof createCycle>,
  audit: ProfileQueueMutationAuditRecord,
) {
  return createProfileQueueSelectionEvidence({
    audit,
    cycle,
    evidenceId: audit.mutationId.replace(/^pqm_/, "pqe_"),
  });
}

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  readonly prepared: RecordingD1Statement[] = [];
  nextFirstChangeCount = 1;
  nextFirstRow: Record<string, unknown> | null = null;

  prepare(query: string): D1PreparedStatement {
    const statement = new RecordingD1Statement(query, this);
    this.prepared.push(statement);
    return statement;
  }

  async batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]> {
    const recorded = statements.map((statement) => {
      if (!(statement instanceof RecordingD1Statement)) throw new Error("Unexpected statement implementation.");
      return { query: statement.query, values: [...statement.values] };
    });
    this.batches.push(recorded);
    return statements.map((_, index) => ({ meta: { changes: index === 0 ? this.nextFirstChangeCount : 1 } }));
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
