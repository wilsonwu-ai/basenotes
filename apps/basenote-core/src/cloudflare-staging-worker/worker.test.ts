import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { ProfileQueueFormNonceDeniedError, SignedProxyRejectedError } from "./boundaries.js";
import type {
  ProfileQueueOwnershipResolver,
  SignedProxyBoundary,
  StagingWorkerEnv,
  WorkerExecutionContext,
} from "./contracts.js";
import type {
  ConsumeStagingProfileQueueFormNonceInput,
  IssueStagingProfileQueueFormNonceInput,
  StagingProfileQueueFormNonceRepository,
} from "./form-nonce.js";
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
const defaultGateNow = new Date("2026-09-01T09:01:00.000Z");
const defaultGateSecret = "unit-test-staging-app-proxy-secret";
const workerOrigin = "https://basenote-profile-queue-staging.wilson-af8.workers.dev";
const storefrontOrigin = "https://base-note-subscription-staging.myshopify.com";
const defaultGateShop = "base-note-subscription-staging.myshopify.com";

test("health is staging-only and constrained to the configured host", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(
    new Request(`${workerOrigin}/healthz`),
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

  const insecureTransport = await worker.fetch(
    new Request("http://basenote-profile-queue-staging.wilson-af8.workers.dev/healthz"),
    stagingEnvironment(),
    context,
  );
  assert.equal(insecureTransport.status, 404);

  const insecureForwardedTransport = await worker.fetch(
    new Request(`${workerOrigin}/healthz`, {
      headers: { "X-Forwarded-Proto": "http" },
    }),
    stagingEnvironment(),
    context,
  );
  assert.equal(insecureForwardedTransport.status, 404);
});

test("only the configured App Proxy target path reaches Profile Queue", async () => {
  const worker = createStagingProfileQueueWorker();
  const legacyRoute = await worker.fetch(
    mutationRequest({}, `${workerOrigin}/apps/basenote-staging/profile-queue`),
    stagingEnvironment(),
    context,
  );
  assert.equal(legacyRoute.status, 404);
});

test("default Worker refuses queue writes until the signed boundary is configured", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(mutationRequest(), stagingEnvironment(), context);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "staging_not_configured" });
});

test("default Worker requires a verified App Proxy request and exact seeded staging binding", async () => {
  const repository = await repositoryWithCycle();
  const worker = createStagingProfileQueueWorker({
    createOpaqueId(prefix) {
      if (prefix === "pqk") return "pqk_pagegenerated001";
      if (prefix === "pqf") return "pqf_nonce_server_generated_000000000001";
      return `${prefix}_servergenerated001`;
    },
    formNonceRepository: new TestFormNonceRepository(),
    now: () => defaultGateNow,
    repositoryFactory: () => repository,
  });
  const request = signedProfileQueueReadRequest();
  const authorized = await worker.fetch(request, seededDefaultGateEnvironment(), context);

  assert.equal(authorized.status, 200);
  const markup = await authorized.text();
  assert.match(markup, /Profile Queue/);
  const formNonce = markup.match(/name="formNonce" value="([^"]+)"/)?.[1];
  const idempotencyKey = markup.match(/name="idempotencyKey" value="([^"]+)"/)?.[1];
  assert.ok(formNonce);
  assert.ok(idempotencyKey);

  const formResponse = await worker.fetch(
    signedProfileQueueFormRequest({ formNonce, idempotencyKey }),
    seededDefaultGateEnvironment(),
    context,
  );
  assert.equal(formResponse.status, 200);
  assert.match(await formResponse.text(), /Queue updated\./);

  const denied = await worker.fetch(request, seededDefaultGateEnvironment(null), context);
  assert.equal(denied.status, 403);
  assert.match(await denied.text(), /Profile Queue unavailable/);
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

test("server-rendered Profile Queue uses signed App Proxy form posts and runtime-only eligible variants", async () => {
  const repository = await repositoryWithCycle();
  const worker = configuredWorker(repository);
  const page = await worker.fetch(
    new Request(`${workerOrigin}/api/shopify/app-proxy/profile-queue?cycleKey=${cycleKey}&shipMonth=${shipMonth}`),
    stagingEnvironment(),
    context,
  );
  const markup = await page.text();
  assert.equal(page.status, 200);
  assert.match(page.headers.get("Content-Type") ?? "", /^text\/html/);
  assert.match(page.headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(page.headers.get("X-Frame-Options"), "DENY");
  assert.match(markup, /Automatic Fragrance of the Month/);
  assert.match(markup, /read-only/i);
  assert.match(markup, /action="\/apps\/basenote-staging\/profile-queue"/);
  assert.match(markup, /method="post"/i);
  const formNonce = markup.match(/name="formNonce" value="([^"]+)"/)?.[1];
  assert.ok(formNonce);
  assert.match(markup, /Eligible test fragrance 1/);
  assert.match(markup, /Add for \$18\.00/);
  assert.doesNotMatch(markup, /<script\b/i);
  assert.doesNotMatch(markup, /binding-profile-101/);

  const forgedNonce = await worker.fetch(
    formMutationRequest({
      formNonce: "pqf_nonce_server_generated_000000000099",
      idempotencyKey: "pqk_formmutation000",
    }),
    stagingEnvironment(),
    context,
  );
  assert.equal(forgedNonce.status, 403);
  assert.equal((await repository.findCycle(bindingId, cycleKey))?.addOns.length, 0);

  const submitted = await worker.fetch(formMutationRequest({ formNonce }), stagingEnvironment(), context);
  const submittedMarkup = await submitted.text();
  assert.equal(submitted.status, 200);
  assert.match(submittedMarkup, /Queue updated\./);
  assert.equal((await repository.findCycle(bindingId, cycleKey))?.addOns.length, 1);

  const reusedNonce = await worker.fetch(
    formMutationRequest({
      expectedRevision: "1",
      formNonce,
      idempotencyKey: "pqk_formmutation002",
    }),
    stagingEnvironment(),
    context,
  );
  assert.equal(reusedNonce.status, 403);
  assert.match(await reusedNonce.text(), /Profile Queue unavailable/);

  const notAllowlisted = await worker.fetch(
    formMutationRequest({
      expectedRevision: "1",
      formNonce: submittedMarkup.match(/name="formNonce" value="([^"]+)"/)?.[1] ?? "",
      idempotencyKey: "pqk_formmutation003",
      variantId: "gid://shopify/ProductVariant/999",
    }),
    stagingEnvironment(),
    context,
  );
  assert.equal(notAllowlisted.status, 403);
  assert.match(await notAllowlisted.text(), /Profile Queue unavailable/);
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

test("the disposable storefront origin is allowed while cross-origin calls fail closed", async () => {
  const worker = createStagingProfileQueueWorker();
  const allowed = await worker.fetch(
    new Request(`${workerOrigin}/healthz`, { headers: { Origin: storefrontOrigin } }),
    stagingEnvironment(),
    context,
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), storefrontOrigin);

  const response = await worker.fetch(
    new Request(`${workerOrigin}/healthz`, {
      headers: { Origin: "https://evil.example" },
    }),
    stagingEnvironment(),
    context,
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);

  const malformedOrigin = await worker.fetch(
    new Request(`${workerOrigin}/healthz`, {
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
      if (prefix === "pqa") return `pqa_servergenerated00${serial}`;
      if (prefix === "pqk") return `pqk_servergenerated00${serial}`;
      if (prefix === "pqf") return `pqf_nonce_server_generated_000000000000${serial}`;
      return `pqm_servergenerated00${serial}`;
    },
    formNonceRepository: new TestFormNonceRepository(),
    now: () => new Date("2026-09-01T09:01:00.000Z"),
    ownershipResolver: acceptingOwnershipResolver,
    repositoryFactory: () => repository,
    signedProxyBoundary: acceptingSignedProxyBoundary,
  });
}

const acceptingSignedProxyBoundary: SignedProxyBoundary = {
  async verify() {
    return {
      shopDomain: "base-note.myshopify.com",
      shopifyCustomerId: "101",
      storefrontPathPrefix: "/apps/basenote-staging",
    };
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
    STAGING_ALLOWED_HOSTS: "basenote-profile-queue-staging.wilson-af8.workers.dev,localhost",
    STAGING_ALLOWED_ORIGINS: "https://base-note-subscription-staging.myshopify.com,http://localhost:8787",
    STAGING_TEST_VARIANT_IDS: "gid://shopify/ProductVariant/501",
  };
}

function seededDefaultGateEnvironment(
  row: Record<string, unknown> | null = {
    actor_ref: "profile_101",
    binding_id: bindingId,
    cycle_key: cycleKey,
    expires_at: "2026-09-02T09:00:00.000Z",
    shop_domain: defaultGateShop,
    shopify_customer_id: "101",
    ship_month: shipMonth,
    status: "ACTIVE",
  },
): StagingWorkerEnv {
  return {
    ...stagingEnvironment(),
    BASENOTE_STAGING_D1: new TestBindingD1(row),
    SHOPIFY_APP_PROXY_SHARED_SECRET: defaultGateSecret,
    STAGING_SHOP_DOMAIN: defaultGateShop,
  };
}

function signedProfileQueueReadRequest(): Request {
  return new Request(signedProfileQueueUrl({ cycleKey, shipMonth }));
}

function signedProfileQueueFormRequest(input: {
  readonly formNonce: string;
  readonly idempotencyKey: string;
}): Request {
  return new Request(signedProfileQueueUrl(), {
    body: new URLSearchParams({
      action: "ADD_ADD_ON",
      cycleKey,
      expectedRevision: "0",
      formNonce: input.formNonce,
      idempotencyKey: input.idempotencyKey,
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function signedProfileQueueUrl(extra: Record<string, string> = {}): string {
  const values = {
    logged_in_customer_id: "101",
    path_prefix: "/apps/basenote-staging",
    shop: defaultGateShop,
    timestamp: String(Math.floor(defaultGateNow.getTime() / 1_000)),
    ...extra,
  };
  const unsigned = Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const signature = createHmac("sha256", defaultGateSecret)
    .update(canonicalizeProxyQuery(unsigned), "utf8")
    .digest("hex");
  return `${workerOrigin}/api/shopify/app-proxy/profile-queue?${unsigned}&signature=${signature}`;
}

function canonicalizeProxyQuery(rawQuery: string): string {
  const grouped = new Map<string, string[]>();
  for (const segment of rawQuery.split("&")) {
    const separator = segment.indexOf("=");
    const key = decodeURIComponent(segment.slice(0, separator).replace(/\+/g, " "));
    const value = decodeURIComponent(segment.slice(separator + 1).replace(/\+/g, " "));
    const values = grouped.get(key);
    if (values) values.push(value);
    else grouped.set(key, [value]);
  }
  return [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}

function mutationRequest(
  extraBody: Record<string, unknown> = {},
  url = `${workerOrigin}/api/shopify/app-proxy/profile-queue`,
): Request {
  return new Request(url, {
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

function formMutationRequest(extraFields: Record<string, string> = {}): Request {
  const fields = new URLSearchParams({
    action: "ADD_ADD_ON",
    cycleKey,
    expectedRevision: "0",
    formNonce: "pqf_nonce_server_generated_000000000001",
    idempotencyKey: "pqk_formmutation001",
    shipMonth,
    variantId: "gid://shopify/ProductVariant/501",
    ...extraFields,
  });
  return new Request(`${workerOrigin}/api/shopify/app-proxy/profile-queue`, {
    body: fields,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

class TestBindingD1 implements D1DatabasePort {
  constructor(private readonly row: Record<string, unknown> | null) {}

  async batch(): Promise<readonly D1Result[]> {
    throw new Error("No D1 batch is expected while the repository is injected.");
  }

  prepare(): D1PreparedStatement {
    return new TestBindingStatement(this.row);
  }
}

class TestBindingStatement implements D1PreparedStatement {
  constructor(private readonly row: Record<string, unknown> | null) {}

  bind(): D1PreparedStatement {
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

class TestFormNonceRepository implements StagingProfileQueueFormNonceRepository {
  private readonly active = new Map<string, IssueStagingProfileQueueFormNonceInput>();

  async issue(input: IssueStagingProfileQueueFormNonceInput): Promise<void> {
    if (this.active.has(input.nonce)) throw new Error("Test form nonce collision.");
    this.active.set(input.nonce, { ...input });
  }

  async consume(input: ConsumeStagingProfileQueueFormNonceInput): Promise<void> {
    const issued = this.active.get(input.nonce);
    if (
      !issued
      || issued.bindingId !== input.bindingId
      || issued.cycleKey !== input.cycleKey
      || issued.expectedRevision !== input.expectedRevision
      || issued.expiresAt <= input.consumedAt
      || issued.shipMonth !== input.shipMonth
      || issued.shopDomain !== input.shopDomain
      || issued.shopifyCustomerId !== input.shopifyCustomerId
    ) {
      throw new ProfileQueueFormNonceDeniedError("The test form nonce is not valid.");
    }
    this.active.delete(input.nonce);
  }
}
