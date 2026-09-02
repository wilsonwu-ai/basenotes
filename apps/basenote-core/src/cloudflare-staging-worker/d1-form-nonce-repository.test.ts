import assert from "node:assert/strict";
import test from "node:test";

import { ProfileQueueFormNonceDeniedError } from "./boundaries.js";
import { D1StagingProfileQueueFormNonceRepository } from "./d1-form-nonce-repository.js";
import { asStagingProfileQueueFormNonce } from "./form-nonce.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";

const nonce = asStagingProfileQueueFormNonce("pqf_nonce_server_generated_000000000001");
const issueInput = {
  bindingId: "binding-profile-101",
  cycleKey: "appstle:delivery:2026-09-15",
  expectedRevision: 4,
  expiresAt: "2026-09-01T09:10:00.000Z",
  issuedAt: "2026-09-01T09:00:00.000Z",
  nonce,
  shipMonth: "2026-09",
  shopDomain: "base-note-subscription-staging.myshopify.com",
  shopifyCustomerId: "101",
};

test("D1 form nonce repository issues and consumes one exact staging form scope", async () => {
  const database = new RecordingD1Database([1, 1]);
  const repository = new D1StagingProfileQueueFormNonceRepository(database);

  await repository.issue(issueInput);
  await repository.consume({ ...issueInput, consumedAt: "2026-09-01T09:01:00.000Z" });

  assert.equal(database.statements.length, 2);
  const issued = database.statements[0];
  assert.match(issued?.query ?? "", /INSERT INTO staging_profile_queue_form_nonces/);
  assert.deepEqual(issued?.values, [
    nonce,
    issueInput.shopDomain,
    issueInput.shopifyCustomerId,
    issueInput.bindingId,
    issueInput.cycleKey,
    issueInput.shipMonth,
    issueInput.expectedRevision,
    issueInput.issuedAt,
    issueInput.expiresAt,
  ]);

  const consumed = database.statements[1];
  assert.match(consumed?.query ?? "", /consumed_at IS NULL/);
  assert.match(consumed?.query ?? "", /julianday\(expires_at\) > julianday\(\?\)/);
  assert.deepEqual(consumed?.values, [
    "2026-09-01T09:01:00.000Z",
    nonce,
    issueInput.shopDomain,
    issueInput.shopifyCustomerId,
    issueInput.bindingId,
    issueInput.cycleKey,
    issueInput.shipMonth,
    issueInput.expectedRevision,
    "2026-09-01T09:01:00.000Z",
  ]);
});

test("D1 form nonce repository fails closed for a stale, reused, or unbound form", async () => {
  const repository = new D1StagingProfileQueueFormNonceRepository(new RecordingD1Database([0]));

  await assert.rejects(
    repository.issue({ ...issueInput, expiresAt: "2026-09-01T09:00:00Z" }),
    /expiry must be after issuance/,
  );

  await assert.rejects(
    repository.consume({ ...issueInput, consumedAt: "2026-09-01T09:01:00.000Z" }),
    ProfileQueueFormNonceDeniedError,
  );
  await assert.rejects(
    repository.consume({ ...issueInput, expectedRevision: -1, consumedAt: "2026-09-01T09:01:00.000Z" }),
    ProfileQueueFormNonceDeniedError,
  );
});

class RecordingD1Database implements D1DatabasePort {
  readonly statements: RecordingD1Statement[] = [];

  constructor(private readonly changes: readonly number[]) {}

  async batch(): Promise<readonly D1Result[]> {
    throw new Error("No batch is expected for a form nonce operation.");
  }

  prepare(query: string): D1PreparedStatement {
    const statement = new RecordingD1Statement(query, this.changes[this.statements.length] ?? 0);
    this.statements.push(statement);
    return statement;
  }
}

class RecordingD1Statement implements D1PreparedStatement {
  readonly values: unknown[] = [];

  constructor(readonly query: string, private readonly changes: number) {}

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
    return { meta: { changes: this.changes } };
  }
}
