import assert from "node:assert/strict";
import test from "node:test";

import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "./contracts.js";
import { D1ProfileQueueRepository } from "./d1-repository.js";
import { applyProfileQueueMutation } from "./service.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

test("D1 repository batches compare-and-swap, add-on replacement, and immutable audit writes", async () => {
  const database = new RecordingD1Database();
  const repository = new D1ProfileQueueRepository(database);
  const initial = createCycle();
  await repository.persist({
    audit: auditFor(initial, null, "CREATE_CYCLE", "pqm_create001", "pqk_create001"),
    cycle: initial,
    expectedRevision: null,
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
  await repository.persist({
    audit: auditFor(changed, 0, "ADD_ADD_ON", "pqm_addon001", "pqk_addon001"),
    cycle: changed,
    expectedRevision: 0,
  });

  assert.equal(database.batches.length, 2);
  const updateBatch = database.batches[1] ?? [];
  assert.match(updateBatch[0]?.query ?? "", /UPDATE profile_queue_cycles/);
  assert.ok(updateBatch.some((statement) => /DELETE FROM profile_queue_add_ons/.test(statement.query)));
  assert.ok(updateBatch.some((statement) => /INSERT INTO profile_queue_add_ons/.test(statement.query)));
  assert.ok(updateBatch.some((statement) => /INSERT INTO profile_queue_mutation_audit/.test(statement.query)));
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

  await assert.rejects(
    repository.persist({
      audit: auditFor(changed, 0, "ADD_ADD_ON", "pqm_addon001", "pqk_addon001"),
      cycle: changed,
      expectedRevision: 0,
    }),
    /changed; reload before saving/,
  );
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

class RecordingD1Database implements D1DatabasePort {
  readonly batches: RecordedStatement[][] = [];
  nextFirstChangeCount = 1;

  prepare(query: string): D1PreparedStatement {
    return new RecordingD1Statement(query);
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

  constructor(readonly query: string) {}

  bind(...values: readonly unknown[]): D1PreparedStatement {
    this.values.push(...values);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    return { meta: { changes: 1 } };
  }
}
