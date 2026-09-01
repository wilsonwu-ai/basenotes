import assert from "node:assert/strict";
import test from "node:test";

import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import { D1ProfileQueueRepository } from "./d1-repository.js";
import { applyProfileQueueMutation, publishProfileQueueFotm } from "./service.js";
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

test("D1 repository persists an exact zero-add-on PUBLISH_FOTM batch with ordered audit evidence", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueRepository(database);
  const initial = createEmptyProfileQueueCycle({
    bindingId: "binding-profile-220",
    cycleKey: "staging:delivery:2026-10-15",
    shipMonth: "2026-10",
    updatedAt: "2026-09-01T22:14:48.000Z",
  });
  const published = publishProfileQueueFotm(initial, {
    cutoffAt: "2026-10-10T05:01:00.000Z",
    merchantTimezone: "America/Chicago",
    occurredAt: "2026-09-01T22:14:49.000Z",
    variantId: "gid://shopify/ProductVariant/902",
  });
  const audit: ProfileQueueMutationAuditRecord = {
    actorRef: asProfileQueueActorRef("staff_stage_101"),
    bindingId: published.bindingId,
    cycleKey: published.cycleKey,
    expectedRevision: 0,
    idempotencyKey: "pqk_publish001" as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: "pqm_publish001" as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind: "PUBLISH_FOTM",
    occurredAt: published.updatedAt,
    resultingRevision: published.revision,
  };

  await repository.persist({
    audit,
    cycle: published,
    expectedRevision: 0,
    selectionEvidence: evidenceFor(published, audit),
  });

  assert.equal(published.addOns.length, 0);
  assert.equal(database.batches.length, 1);
  const batch = database.batches[0] ?? [];
  assert.equal(batch.length, 4, "zero add-ons must not create any add-on INSERT statements.");
  const [cycleUpdate, addOnDelete, auditInsert, evidenceInsert] = batch;
  assert.match(cycleUpdate?.query ?? "", /UPDATE profile_queue_cycles/);
  assert.match(addOnDelete?.query ?? "", /DELETE FROM profile_queue_add_ons/);
  assert.match(auditInsert?.query ?? "", /INSERT INTO profile_queue_mutation_audit/);
  assert.match(evidenceInsert?.query ?? "", /INSERT INTO profile_queue_selection_evidence/);
  assert.ok(batch.every((statement) => !/INSERT INTO profile_queue_add_ons/.test(statement.query)));

  assert.deepEqual(cycleUpdate?.values, [
    "OPEN",
    1,
    "gid://shopify/ProductVariant/902",
    "PUBLISHED",
    "2026-10-10T05:01:00.000Z",
    "America/Chicago",
    "UNSELECTED",
    null,
    null,
    "pqm_publish001",
    "2026-09-01T22:14:49.000Z",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    "2026-10",
    0,
  ]);
  assert.deepEqual(addOnDelete?.values, [
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    1,
    "pqm_publish001",
    "pqm_publish001",
  ]);
  assert.deepEqual(auditInsert?.values, [
    "pqm_publish001",
    "pqk_publish001",
    "staff_stage_101",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    "PUBLISH_FOTM",
    0,
    1,
    "2026-09-01T22:14:49.000Z",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    1,
    "pqm_publish001",
  ]);
  assert.deepEqual(evidenceInsert?.values, [
    "pqe_publish001",
    "pqm_publish001",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    "FOTM_PUBLISHED",
    "UNSELECTED",
    null,
    "[]",
    1,
    "2026-09-01T22:14:49.000Z",
    "pqm_publish001",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    1,
    "2026-09-01T22:14:49.000Z",
    "binding-profile-220",
    "staging:delivery:2026-10-15",
    1,
    "pqm_publish001",
  ]);
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
      statement.assertPlaceholderBindings();
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
    this.assertPlaceholderBindings();
    return this.database.nextFirstRow as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.assertPlaceholderBindings();
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    this.assertPlaceholderBindings();
    return { meta: { changes: 1 } };
  }

  assertPlaceholderBindings(): void {
    assert.equal(
      this.values.length,
      countSqlPlaceholders(this.query),
      "Every prepared D1 statement must bind exactly one value per SQL placeholder.",
    );
  }
}

function countSqlPlaceholders(query: string): number {
  let count = 0;
  let index = 0;
  let mode: "normal" | "single" | "double" | "backtick" | "bracket" | "line-comment" | "block-comment" = "normal";
  while (index < query.length) {
    const character = query[index];
    const next = query[index + 1];
    if (mode === "line-comment") {
      if (character === "\n") mode = "normal";
    } else if (mode === "block-comment") {
      if (character === "*" && next === "/") {
        mode = "normal";
        index += 1;
      }
    } else if (mode === "single" || mode === "double" || mode === "backtick") {
      const delimiter = mode === "single" ? "'" : mode === "double" ? '"' : "`";
      if (character === delimiter) {
        if (next === delimiter) index += 1;
        else mode = "normal";
      }
    } else if (mode === "bracket") {
      if (character === "]") mode = "normal";
    } else if (character === "-" && next === "-") {
      mode = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      mode = "block-comment";
      index += 1;
    } else if (character === "'") mode = "single";
    else if (character === '"') mode = "double";
    else if (character === "`") mode = "backtick";
    else if (character === "[") mode = "bracket";
    else if (character === "?") count += 1;
    index += 1;
  }
  return count;
}
