import assert from "node:assert/strict";
import test from "node:test";

import { SignedProxyRejectedError } from "./boundaries.js";
import type {
  ProfileQueueOwnershipResolver,
  SignedProxyBoundary,
  StagingWorkerEnv,
  WorkerExecutionContext,
} from "./contracts.js";
import { createStagingProfileQueueWorker } from "./worker.js";
import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "../profile-queue/contracts.js";
import { InMemoryProfileQueueRepository } from "../profile-queue/repository.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";
import { asIsoTimestamp } from "../queue/types.js";

const cycleKey = "appstle:delivery:2026-09-15";
const shipMonth = "2026-09";
const bindingId = "binding-profile-101";
const occurredAt = asIsoTimestamp("2026-09-01T09:00:00.000Z");
const context: WorkerExecutionContext = { waitUntil() {} };

test("health is staging-only and constrained to the configured host", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(
    new Request("https://app-staging.basenotescent.com/healthz"),
    stagingEnvironment(),
    context,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    customerMutations: "signed_boundary_required",
    emailDelivery: "disabled",
    environment: "staging",
    shopifyOAuth: "disabled",
    status: "ok",
  });

  const rejectedHost = await worker.fetch(
    new Request("https://basenotescent.com/healthz"),
    stagingEnvironment(),
    context,
  );
  assert.equal(rejectedHost.status, 404);
});

test("default Worker refuses queue writes until the signed boundary is configured", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(mutationRequest(), stagingEnvironment(), context);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "staging_not_configured" });
});

test("a test-injected signed boundary and ownership resolver can mutate only the resolved durable cycle", async () => {
  const repository = await repositoryWithCycle();
  const worker = configuredWorker(repository);

  const response = await worker.fetch(mutationRequest(), stagingEnvironment(), context);
  assert.equal(response.status, 200);
  const body = await response.json() as { readonly queue: { readonly addOns: readonly { readonly id: string; readonly unitPriceCents: number }[] } };
  assert.equal(body.queue.addOns.length, 1);
  assert.equal(body.queue.addOns[0]?.id, "pqa_servergenerated001");
  assert.equal(body.queue.addOns[0]?.unitPriceCents, 1_800);
  assert.doesNotMatch(JSON.stringify(body), /binding-profile-101/);

  const stored = await repository.findCycle(bindingId, cycleKey);
  assert.equal(stored?.addOns.length, 1);
  assert.equal(stored?.addOns[0]?.variantId, "gid://shopify/ProductVariant/501");

  const unsafeRetry = await worker.fetch(mutationRequest(), stagingEnvironment(), context);
  assert.equal(unsafeRetry.status, 409);
  assert.equal((await repository.findCycle(bindingId, cycleKey))?.addOns.length, 1);
});

test("request validation rejects client-selected binding IDs and does not echo raw input", async () => {
  const repository = await repositoryWithCycle();
  const worker = configuredWorker(repository);
  const email = "person@example.test";
  const response = await worker.fetch(
    mutationRequest({ bindingId, email }),
    stagingEnvironment(),
    context,
  );

  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(text, '{"error":"invalid_request"}');
  assert.doesNotMatch(text, /person@example\.test/);
  assert.doesNotMatch(text, /binding-profile-101/);
});

test("cross-origin browser calls fail closed and do not receive CORS approval", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(
    new Request("https://app-staging.basenotescent.com/healthz", {
      headers: { Origin: "https://evil.example" },
    }),
    stagingEnvironment(),
    context,
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);

  const malformedOrigin = await worker.fetch(
    new Request("https://app-staging.basenotescent.com/healthz", {
      headers: { Origin: "not a valid origin" },
    }),
    stagingEnvironment(),
    context,
  );
  assert.equal(malformedOrigin.status, 403);
});

test("a future invalid signed request maps to a generic unauthorized response", async () => {
  const repository = await repositoryWithCycle();
  const worker = createStagingProfileQueueWorker({
    ownershipResolver: acceptingOwnershipResolver,
    repositoryFactory: () => repository,
    signedProxyBoundary: {
      async verify() {
        throw new SignedProxyRejectedError("intentionally not exposed");
      },
    },
  });
  const response = await worker.fetch(mutationRequest(), stagingEnvironment(), context);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

function configuredWorker(repository: InMemoryProfileQueueRepository) {
  let serial = 0;
  return createStagingProfileQueueWorker({
    createOpaqueId(prefix) {
      serial += 1;
      return prefix === "pqa" ? "pqa_servergenerated001" : `pqm_servergenerated00${serial}`;
    },
    now: () => new Date("2026-09-01T09:01:00.000Z"),
    ownershipResolver: acceptingOwnershipResolver,
    repositoryFactory: () => repository,
    signedProxyBoundary: acceptingSignedProxyBoundary,
  });
}

const acceptingSignedProxyBoundary: SignedProxyBoundary = {
  async verify() {
    return { shopDomain: "base-note.myshopify.com", shopifyCustomerId: "101" };
  },
};

const acceptingOwnershipResolver: ProfileQueueOwnershipResolver = {
  async resolve(input) {
    assert.equal(input.cycleKey, cycleKey);
    assert.equal(input.shipMonth, shipMonth);
    assert.equal(input.identity.shopifyCustomerId, "101");
    return { actorRef: "profile_101", bindingId };
  },
};

async function repositoryWithCycle(): Promise<InMemoryProfileQueueRepository> {
  const repository = new InMemoryProfileQueueRepository();
  const cycle = createEmptyProfileQueueCycle({ bindingId, cycleKey, shipMonth, updatedAt: occurredAt });
  const audit: ProfileQueueMutationAuditRecord = {
    actorRef: asProfileQueueActorRef("profile_101"),
    bindingId: cycle.bindingId,
    cycleKey: cycle.cycleKey,
    expectedRevision: null,
    idempotencyKey: "pqk_create001" as ProfileQueueMutationAuditRecord["idempotencyKey"],
    mutationId: "pqm_create001" as ProfileQueueMutationAuditRecord["mutationId"],
    mutationKind: "CREATE_CYCLE",
    occurredAt,
    resultingRevision: cycle.revision,
  };
  await repository.persist({ audit, cycle, expectedRevision: null });
  return repository;
}

function stagingEnvironment(): StagingWorkerEnv {
  return {
    BASENOTE_RUNTIME_STAGE: "staging",
    BASENOTE_STAGING_D1: inertD1,
    STAGING_ALLOWED_HOSTS: "app-staging.basenotescent.com,localhost",
    STAGING_ALLOWED_ORIGINS: "https://app-staging.basenotescent.com,http://localhost:8787",
  };
}

function mutationRequest(extraBody: Record<string, unknown> = {}): Request {
  return new Request("https://app-staging.basenotescent.com/apps/basenote/profile-queue", {
    body: JSON.stringify({
      cycleKey,
      expectedRevision: 0,
      idempotencyKey: "pqk_mutation001",
      mutation: { kind: "ADD_ADD_ON", variantId: "gid://shopify/ProductVariant/501" },
      shipMonth,
      ...extraBody,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "pqk_mutation001",
    },
    method: "POST",
  });
}

const inertD1: D1DatabasePort = {
  async batch(): Promise<readonly D1Result[]> {
    throw new Error("The repository factory must be injected in this unit test.");
  },
  prepare(): D1PreparedStatement {
    throw new Error("The repository factory must be injected in this unit test.");
  },
};
