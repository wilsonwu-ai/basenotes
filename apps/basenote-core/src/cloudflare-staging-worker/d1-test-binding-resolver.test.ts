import assert from "node:assert/strict";
import test from "node:test";

import { ProfileQueueOwnershipDeniedError } from "./boundaries.js";
import { D1StagingTestBindingOwnershipResolver } from "./d1-test-binding-resolver.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

const now = "2026-09-01T09:00:00.000Z";
const identity = { shopDomain: "base-note-subscription-staging.myshopify.com", shopifyCustomerId: "101" };
const cycleKey = "appstle:delivery:2026-09-15";
const shipMonth = "2026-09";

test("D1 test-binding resolver authorizes only one exact active disposable-store cycle", async () => {
  const database = new RecordingD1Database({
    actor_ref: "profile_101",
    binding_id: "binding-profile-101",
    cycle_key: cycleKey,
    expires_at: "2026-09-02T09:00:00.000Z",
    shop_domain: identity.shopDomain,
    shopify_customer_id: identity.shopifyCustomerId,
    ship_month: shipMonth,
    status: "ACTIVE",
  });
  const resolver = new D1StagingTestBindingOwnershipResolver(database, { now: () => new Date(now) });

  const result = await resolver.resolve({ cycleKey, identity, shipMonth });

  assert.deepEqual(result, { actorRef: "profile_101", bindingId: "binding-profile-101" });
  assert.match(database.statement?.query ?? "", /staging_profile_queue_test_bindings/);
  assert.deepEqual(database.statement?.values, [
    identity.shopDomain,
    identity.shopifyCustomerId,
    cycleKey,
    shipMonth,
    now,
  ]);
});

test("D1 test-binding resolver denies absent, expired, or mismatched seed rows", async () => {
  const absent = new D1StagingTestBindingOwnershipResolver(new RecordingD1Database(null), {
    now: () => new Date(now),
  });
  await assert.rejects(absent.resolve({ cycleKey, identity, shipMonth }), ProfileQueueOwnershipDeniedError);

  const expired = new D1StagingTestBindingOwnershipResolver(new RecordingD1Database({
    actor_ref: "profile_101",
    binding_id: "binding-profile-101",
    cycle_key: cycleKey,
    expires_at: now,
    shop_domain: identity.shopDomain,
    shopify_customer_id: identity.shopifyCustomerId,
    ship_month: shipMonth,
    status: "ACTIVE",
  }), { now: () => new Date(now) });
  await assert.rejects(expired.resolve({ cycleKey, identity, shipMonth }), ProfileQueueOwnershipDeniedError);

  const mismatched = new D1StagingTestBindingOwnershipResolver(new RecordingD1Database({
    actor_ref: "profile_101",
    binding_id: "binding-profile-101",
    cycle_key: "appstle:delivery:2026-09-16",
    expires_at: "2026-09-02T09:00:00.000Z",
    shop_domain: identity.shopDomain,
    shopify_customer_id: identity.shopifyCustomerId,
    ship_month: shipMonth,
    status: "ACTIVE",
  }), { now: () => new Date(now) });
  await assert.rejects(mismatched.resolve({ cycleKey, identity, shipMonth }), ProfileQueueOwnershipDeniedError);
});

class RecordingD1Database implements D1DatabasePort {
  statement: RecordingD1Statement | null = null;

  constructor(private readonly row: Record<string, unknown> | null) {}

  async batch(): Promise<readonly D1Result[]> {
    throw new Error("batch is not expected for an ownership lookup");
  }

  prepare(query: string): D1PreparedStatement {
    this.statement = new RecordingD1Statement(query, this.row);
    return this.statement;
  }
}

class RecordingD1Statement implements D1PreparedStatement {
  readonly values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly row: Record<string, unknown> | null,
  ) {}

  bind(...values: readonly unknown[]): D1PreparedStatement {
    this.values.push(...values);
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.row as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: [] };
  }

  async run(): Promise<D1Result> {
    return { meta: { changes: 0 } };
  }
}
