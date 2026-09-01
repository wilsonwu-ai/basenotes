import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  ProfileQueueFormNonceDeniedError,
  SignedProxyRejectedError,
  StagingAdminIdTokenRejectedError,
  StagingAdminStaffDeniedError,
} from "./boundaries.js";
import type {
  ProfileQueueOwnershipResolver,
  SignedProxyBoundary,
  StagingAdminIdTokenBoundary,
  StagingWorkerEnv,
  WorkerScheduledEvent,
  WorkerExecutionContext,
} from "./contracts.js";
import type {
  ConsumeStagingProfileQueueFormNonceInput,
  IssueStagingProfileQueueFormNonceInput,
  StagingProfileQueueFormNonceRepository,
} from "./form-nonce.js";
import { createStagingProfileQueueWorker } from "./worker.js";
import {
  STAGING_CUTOFF_LOCK_BATCH_SIZE,
  createProfileQueueSelectionEvidence,
} from "./cutoff-locker.js";
import {
  asProfileQueueActorRef,
  createEmptyProfileQueueCycle,
  type ProfileQueueMutationAuditRecord,
} from "../profile-queue/contracts.js";
import { InMemoryProfileQueueRepository } from "../profile-queue/repository.js";
import { InMemoryProfileQueueFotmScheduleRepository } from "../profile-queue/fotm-schedule.js";
import type { D1DatabasePort, D1PreparedStatement, D1Result } from "../staging-runtime/d1.js";
import { asIsoTimestamp, compareIsoTimestamps } from "../queue/types.js";

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

test("scheduled cutoff locking is inert until its explicit staging-only opt-in is enabled", async () => {
  const repository = new CountingCutoffRepository();
  const worker = createStagingProfileQueueWorker({
    now: () => defaultGateNow,
    repositoryFactory: () => repository,
  });
  const waiting: Promise<unknown>[] = [];
  const event: WorkerScheduledEvent = {
    cron: "*/5 * * * *",
    scheduledTime: defaultGateNow.getTime(),
    waitUntil(promise) { waiting.push(promise); },
  };

  await worker.scheduled(event, stagingEnvironment(), context);
  assert.equal(repository.findDueCalls, 0);
  assert.equal(waiting.length, 1);

  await worker.scheduled(event, {
    ...stagingEnvironment(),
    STAGING_CUTOFF_AUTOMATION_ENABLED: "true",
  }, context);
  assert.equal(repository.findDueCalls, 1);
  assert.equal(repository.lastCutoffLimit, STAGING_CUTOFF_LOCK_BATCH_SIZE);
  assert.equal(STAGING_CUTOFF_LOCK_BATCH_SIZE, 10);
  assert.equal(waiting.length, 2);
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
      if (prefix === "pqe") return "pqe_evidence_server_generated_000001";
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
  assert.match(markup, /Published Fragrance of the Month fallback/);
  assert.match(markup, /Included by default/);
  assert.match(markup, /pre-selected/i);
  assert.match(markup, /Override included fragrance/);
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

test("the staging embedded Admin shell is frameable only by Shopify and exposes no scheduler data before authentication", async () => {
  const worker = createStagingProfileQueueWorker();
  const response = await worker.fetch(
    new Request(`${workerOrigin}/admin/fotm-scheduler`),
    schedulerEnvironment(),
    context,
  );
  const markup = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /frame-ancestors https:\/\/admin\.shopify\.com https:\/\/base-note-subscription-staging\.myshopify\.com/);
  assert.equal(response.headers.get("X-Frame-Options"), null);
  assert.match(markup, /shopify-api-key/);
  assert.match(markup, /visibly pre-selected, one included fragrance/i);
  assert.doesNotMatch(markup, /scheduler-runtime-secret/);
  assert.doesNotMatch(markup, /gid:\/\/shopify\/ProductVariant/);
});

test("Admin scheduler API rejects missing or denied embedded Admin authentication without exposing schedule data", async () => {
  const missing = await createStagingProfileQueueWorker().fetch(
    new Request(`${workerOrigin}/api/admin/fotm-schedules`),
    schedulerEnvironment(),
    context,
  );
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "unauthorized" });
  assert.equal(missing.headers.get("X-Shopify-Retry-Invalid-Session-Request"), "1");

  const rejected = await createStagingProfileQueueWorker({
    adminIdTokenBoundary: { async verify() { throw new StagingAdminIdTokenRejectedError("not exposed"); } },
  }).fetch(new Request(`${workerOrigin}/api/admin/fotm-schedules`), schedulerEnvironment(), context);
  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { error: "unauthorized" });

  const denied = await createStagingProfileQueueWorker({
    adminIdTokenBoundary: { async verify() { throw new StagingAdminStaffDeniedError("not exposed"); } },
  }).fetch(new Request(`${workerOrigin}/api/admin/fotm-schedules`), schedulerEnvironment(), context);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "forbidden" });

  const noAppProxyWriter = await createStagingProfileQueueWorker().fetch(
    adminCommandRequest({ action: "PUBLISH", expectedRevision: 0, shipMonth: "2026-09" }, "pfk_no_proxy_writer001", `${workerOrigin}/api/shopify/app-proxy/fotm-schedules`),
    schedulerEnvironment(),
    context,
  );
  assert.equal(noAppProxyWriter.status, 404);
});

test("authenticated scheduler API uses request verification, command idempotency, schedule CAS, and bounded D1-only provisioning", async () => {
  const cycles = await repositoryWithCycle();
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const worker = configuredAdminSchedulerWorker({ cycles, schedules });

  const unallowed = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/999",
    }, "pfk_scheduler_unallowed001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(unallowed.status, 403);
  assert.deepEqual(await unallowed.json(), { error: "forbidden" });
  assert.equal(await schedules.findSchedule(shipMonth), null);

  const saved = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_draft001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), {
    replayed: false,
    schedule: {
      cutoffAt: "2026-09-10T05:01:00.000Z",
      merchantTimezone: "America/Chicago",
      revision: 0,
      shipMonth,
      status: "DRAFT",
      updatedAt: defaultGateNow.toISOString(),
      variantId: "gid://shopify/ProductVariant/501",
    },
  });

  const duplicate = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_draft001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { readonly replayed: boolean }).replayed, true);

  const stale = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_stale001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: "schedule_conflict" });

  const published = await worker.fetch(
    adminCommandRequest({ action: "PUBLISH", expectedRevision: 0, shipMonth }, "pfk_scheduler_publish001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(published.status, 200);
  assert.equal((await published.json() as { readonly schedule: { readonly status: string; readonly revision: number } }).schedule.status, "PUBLISHED");

  const provisioned = await worker.fetch(
    adminCommandRequest({ action: "PROVISION", expectedScheduleRevision: 1, shipMonth }, "pfk_scheduler_provision001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(provisioned.status, 200);
  assert.deepEqual((await provisioned.json() as { readonly provisioning: unknown }).provisioning, {
    configured: 1,
    conflicted: 0,
    mayHaveMore: false,
    replayed: false,
    scanned: 1,
  });
  const cycle = await cycles.findCycle(bindingId, cycleKey);
  assert.equal(cycle?.fotm.status, "PUBLISHED");
  assert.equal(cycle?.memberChoice.source, "UNSELECTED", "FOTM is a visible default, not a persisted member override.");
  assert.equal(cycle?.addOns.length, 0, "scheduler provisioning must not create paid add-ons or contact a provider.");

  const blockedRetire = await worker.fetch(
    adminCommandRequest({ action: "RETIRE", expectedRevision: 1, shipMonth }, "pfk_scheduler_retire_blocked001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(blockedRetire.status, 409);
  assert.deepEqual(await blockedRetire.json(), { error: "schedule_needs_attention" });
  assert.equal((await schedules.findSchedule(shipMonth))?.status, "PUBLISHED");

  const exception = await worker.fetch(
    adminCommandRequest({ action: "RECORD_RECOVERY_EXCEPTION", expectedRevision: 1, shipMonth }, "pfk_scheduler_exception001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(exception.status, 200);
  assert.deepEqual(await exception.json(), { attention: "RECOVERY_EXCEPTION_RECORDED", replayed: false });
  const replayedException = await worker.fetch(
    adminCommandRequest({ action: "RECORD_RECOVERY_EXCEPTION", expectedRevision: 1, shipMonth }, "pfk_scheduler_exception001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(replayedException.status, 200);
  assert.deepEqual(await replayedException.json(), { attention: "RECOVERY_EXCEPTION_RECORDED", replayed: true });
});

test("authenticated scheduler canonicalizes every durable Admin timestamp to D1 whole-second precision", async () => {
  const cycles = await repositoryWithCycle();
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const worker = configuredAdminSchedulerWorker({
    cycles,
    now: () => new Date("2026-09-01T09:01:00.987Z"),
    schedules,
  });

  const saved = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_precision_draft001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(saved.status, 200);

  const published = await worker.fetch(
    adminCommandRequest(
      { action: "PUBLISH", expectedRevision: 0, shipMonth },
      "pfk_scheduler_precision_publish001",
    ),
    schedulerEnvironment(),
    context,
  );
  assert.equal(published.status, 200);

  const provisioned = await worker.fetch(
    adminCommandRequest(
      { action: "PROVISION", expectedScheduleRevision: 1, shipMonth },
      "pfk_scheduler_precision_provision001",
    ),
    schedulerEnvironment(),
    context,
  );
  assert.equal(provisioned.status, 200);

  const listed = await worker.fetch(adminSchedulerListRequest(), schedulerEnvironment(), context);
  assert.equal(listed.status, 200);
  const body = await listed.json() as {
    readonly provisionCommands: readonly { readonly completedAt: string; readonly createdAt: string }[];
    readonly schedules: readonly { readonly updatedAt: string }[];
  };
  assert.equal(body.schedules[0]?.updatedAt, "2026-09-01T09:01:00.000Z");
  assert.equal(body.provisionCommands[0]?.createdAt, "2026-09-01T09:01:00.000Z");
  assert.equal(body.provisionCommands[0]?.completedAt, "2026-09-01T09:01:00.000Z");
  assert.equal((await cycles.findCycle(bindingId, cycleKey))?.updatedAt, "2026-09-01T09:01:00.000Z");
});

test("authenticated scheduler API exposes an explicit RETIRED-to-draft recovery path before any FOTM cycle exists", async () => {
  const cycles = await repositoryWithCycle();
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const worker = configuredAdminSchedulerWorker({ cycles, schedules });

  const saved = await worker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_lifecycle_draft001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(saved.status, 200);
  const retired = await worker.fetch(
    adminCommandRequest({ action: "RETIRE", expectedRevision: 0, shipMonth }, "pfk_scheduler_lifecycle_retire001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(retired.status, 200);
  const retiredBody = await retired.json() as { readonly schedule: { readonly revision: number; readonly status: string } };
  assert.equal(retiredBody.schedule.revision, 1);
  assert.equal(retiredBody.schedule.status, "RETIRED");
  const listed = await worker.fetch(adminSchedulerListRequest(), schedulerEnvironment(), context);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json() as { readonly schedules: readonly { readonly status: string }[] }).schedules[0]?.status, "RETIRED");

  const recovered = await worker.fetch(
    adminCommandRequest({
      action: "RECOVER_DRAFT",
      cutoffAt: "2026-09-11T05:01:00.000Z",
      expectedRevision: 1,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_lifecycle_recover001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json() as { readonly schedule: { readonly revision: number; readonly status: string } }).schedule.status, "DRAFT");
  assert.equal((await schedules.findSchedule(shipMonth))?.revision, 2);
});

test("authenticated scheduler API terminalizes only an aged pending provision claim without fan-out", async () => {
  const cycles = await repositoryWithCycle();
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const fractionalClaimNow = new Date("2026-09-01T09:01:00.987Z");
  const persistedClaimAt = "2026-09-01T09:01:00.000Z";
  const firstWorker = configuredAdminSchedulerWorker({ cycles, now: () => fractionalClaimNow, schedules });
  const saved = await firstWorker.fetch(
    adminCommandRequest({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_attention_draft001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(saved.status, 200);
  const published = await firstWorker.fetch(
    adminCommandRequest({ action: "PUBLISH", expectedRevision: 0, shipMonth }, "pfk_scheduler_attention_publish001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(published.status, 200);
  await schedules.claimProvisionCommand({
    actorRef: "staff_101",
    // The preceding precision regression proves a real .987Z provision claim
    // is floored to this whole-second value before D1 persistence.
    createdAt: persistedClaimAt,
    expectedScheduleRevision: 1,
    idempotencyKey: "pfk_scheduler_attention_provision001",
    plan: [],
    shipMonth,
  });
  const listedBeforeTerminalization = await firstWorker.fetch(adminSchedulerListRequest(), schedulerEnvironment(), context);
  assert.equal(listedBeforeTerminalization.status, 200);
  assert.deepEqual(
    (await listedBeforeTerminalization.json() as {
      readonly pendingProvisionCommands: readonly { readonly idempotencyKey: string; readonly status: string }[];
    }).pendingProvisionCommands,
    [{
      attentionAt: null,
      completedAt: null,
      createdAt: persistedClaimAt,
      expectedScheduleRevision: 1,
      idempotencyKey: "pfk_scheduler_attention_provision001",
      shipMonth,
      status: "PENDING",
    }],
    "active recovery handles are returned separately from bounded command history.",
  );

  const quantizedTooSoonWorker = configuredAdminSchedulerWorker({
    cycles,
    // Exactly 900 real seconds after the fractional claim is still rejected:
    // persisted seconds cannot prove the full duration without one quantum.
    now: () => new Date("2026-09-01T09:16:00.987Z"),
    schedules,
  });
  const tooSoon = await quantizedTooSoonWorker.fetch(
    adminCommandRequest({
      action: "MARK_PROVISION_NEEDS_ATTENTION",
      expectedScheduleRevision: 1,
      shipMonth,
    }, "pfk_scheduler_attention_provision001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(tooSoon.status, 409);
  assert.deepEqual(await tooSoon.json(), { error: "provision_recovery_not_ready" });

  const delayedWorker = configuredAdminSchedulerWorker({
    cycles,
    now: () => new Date("2026-09-01T09:16:01.000Z"),
    schedules,
  });
  const marked = await delayedWorker.fetch(
    adminCommandRequest({
      action: "MARK_PROVISION_NEEDS_ATTENTION",
      expectedScheduleRevision: 1,
      shipMonth,
    }, "pfk_scheduler_attention_provision001"),
    schedulerEnvironment(),
    context,
  );
  assert.equal(marked.status, 200);
  assert.deepEqual(await marked.json(), { attention: "PROVISION_NEEDS_ATTENTION_RECORDED", replayed: false });
  const command = await schedules.findProvisionCommandByIdempotency("pfk_scheduler_attention_provision001");
  assert.equal(command?.status, "NEEDS_ATTENTION");
  assert.equal(command?.result, null);
  const cycle = await cycles.findCycle(bindingId, cycleKey);
  assert.equal(cycle?.fotm.status, "UNPUBLISHED", "terminalization must not mutate a future cycle.");
});

test("one cached valid signed embedded Admin JWT can authorize distinct rapid idempotent commands", async () => {
  const schedules = new InMemoryProfileQueueFotmScheduleRepository();
  const cycles = await repositoryWithCycle();
  let serial = 0;
  const worker = createStagingProfileQueueWorker({
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_cached_jwt_${serial.toString().padStart(10, "0")}`;
    },
    now: () => defaultGateNow,
    repositoryFactory: () => cycles,
    scheduleRepositoryFactory: () => schedules,
  });
  const cachedJwt = signSchedulerAdminToken();
  const first = await worker.fetch(
    adminCommandRequestWithBearer({
      action: "SAVE_DRAFT",
      cutoffAt: "2026-09-10T05:01:00.000Z",
      expectedRevision: null,
      merchantTimezone: "America/Chicago",
      shipMonth,
      variantId: "gid://shopify/ProductVariant/501",
    }, "pfk_scheduler_nonce001", cachedJwt),
    schedulerEnvironment(),
    context,
  );
  assert.equal(first.status, 200);
  const published = await worker.fetch(
    adminCommandRequestWithBearer(
      { action: "PUBLISH", expectedRevision: 0, shipMonth },
      "pfk_scheduler_nonce002",
      cachedJwt,
    ),
    schedulerEnvironment(),
    context,
  );
  assert.equal(published.status, 200);
  assert.equal(published.headers.get("X-Shopify-Retry-Invalid-Session-Request"), null);
  assert.equal((await schedules.findSchedule(shipMonth))?.status, "PUBLISHED");

  const exactReplay = await worker.fetch(
    adminCommandRequestWithBearer(
      { action: "PUBLISH", expectedRevision: 0, shipMonth },
      "pfk_scheduler_nonce002",
      cachedJwt,
    ),
    schedulerEnvironment(),
    context,
  );
  assert.equal(exactReplay.status, 200);
  assert.equal((await exactReplay.json() as { readonly replayed: boolean }).replayed, true);
  assert.equal((await schedules.findSchedule(shipMonth))?.revision, 1, "an exact command replay must not mutate again.");

  const retargetedKey = await worker.fetch(
    adminCommandRequestWithBearer(
      { action: "RETIRE", expectedRevision: 1, shipMonth },
      "pfk_scheduler_nonce002",
      cachedJwt,
    ),
    schedulerEnvironment(),
    context,
  );
  assert.equal(retargetedKey.status, 409);
  assert.deepEqual(await retargetedKey.json(), { error: "schedule_conflict" });
  assert.equal((await schedules.findSchedule(shipMonth))?.status, "PUBLISHED");
});

function configuredWorker(repository: InMemoryProfileQueueRepository) {
  let serial = 0;
  return createStagingProfileQueueWorker({
    createOpaqueId(prefix) {
      serial += 1;
      if (prefix === "pqa") return `pqa_servergenerated00${serial}`;
      if (prefix === "pqk") return `pqk_servergenerated00${serial}`;
      if (prefix === "pqf") return `pqf_nonce_server_generated_000000000000${serial}`;
      if (prefix === "pqe") return `pqe_evidence_server_generated_000000000000${serial}`;
      return `pqm_servergenerated00${serial}`;
    },
    formNonceRepository: new TestFormNonceRepository(),
    now: () => new Date("2026-09-01T09:01:00.000Z"),
    ownershipResolver: acceptingOwnershipResolver,
    repositoryFactory: () => repository,
    signedProxyBoundary: acceptingSignedProxyBoundary,
  });
}

function configuredAdminSchedulerWorker(input: {
  readonly adminIdTokenBoundary?: StagingAdminIdTokenBoundary;
  readonly cycles: InMemoryProfileQueueRepository;
  readonly now?: () => Date;
  readonly schedules: InMemoryProfileQueueFotmScheduleRepository;
}): ReturnType<typeof createStagingProfileQueueWorker> {
  let serial = 0;
  const now = input.now ?? (() => defaultGateNow);
  const boundary = input.adminIdTokenBoundary ?? {
    async verify() {
      serial += 1;
      return {
        actorRef: "staff_101",
      };
    },
  } satisfies StagingAdminIdTokenBoundary;
  return createStagingProfileQueueWorker({
    adminIdTokenBoundary: boundary,
    createOpaqueId(prefix) {
      serial += 1;
      return `${prefix}_admin_scheduler_${serial.toString().padStart(6, "0")}`;
    },
    now,
    repositoryFactory: () => input.cycles,
    scheduleRepositoryFactory: () => input.schedules,
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
  await repository.persist({
    audit,
    cycle,
    expectedRevision: null,
    selectionEvidence: createProfileQueueSelectionEvidence({
      audit,
      cycle,
      evidenceId: "pqe_create001",
    }),
  });
  return repository;
}

function stagingEnvironment(): StagingWorkerEnv {
  return {
    BASENOTE_RUNTIME_STAGE: "staging",
    BASENOTE_STAGING_D1: inertD1,
    STAGING_ALLOWED_HOSTS: "basenote-profile-queue-staging.wilson-af8.workers.dev,localhost",
    STAGING_ALLOWED_ORIGINS: `${storefrontOrigin},${workerOrigin},http://localhost:8787`,
    STAGING_TEST_VARIANT_IDS: "gid://shopify/ProductVariant/501",
  };
}

function schedulerEnvironment(): StagingWorkerEnv {
  return {
    ...stagingEnvironment(),
    SHOPIFY_ADMIN_CLIENT_ID: "staging-client-id-123456",
    SHOPIFY_ADMIN_CLIENT_SECRET: "scheduler-runtime-secret-not-checked-in",
    STAGING_ADMIN_ALLOWED_STAFF_IDS: "101",
    STAGING_SHOP_DOMAIN: defaultGateShop,
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

function adminCommandRequest(
  body: Record<string, unknown>,
  idempotencyKey: string,
  url = `${workerOrigin}/api/admin/fotm-schedules`,
): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      Authorization: "Bearer injected-test-token",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      Origin: workerOrigin,
    },
    method: "POST",
  });
}

function adminCommandRequestWithBearer(
  body: Record<string, unknown>,
  idempotencyKey: string,
  bearerToken: string,
): Request {
  const request = adminCommandRequest(body, idempotencyKey);
  request.headers.set("Authorization", `Bearer ${bearerToken}`);
  return request;
}

function signSchedulerAdminToken(): string {
  const nowSeconds = Math.floor(defaultGateNow.getTime() / 1_000);
  const encode = (value: Record<string, string | number>) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    aud: "staging-client-id-123456",
    dest: `https://${defaultGateShop}`,
    exp: nowSeconds + 60,
    iat: nowSeconds - 1,
    iss: `https://${defaultGateShop}/admin`,
    jti: "f8912129-1af6-4cad-9ca3-76b0f7621087",
    nbf: nowSeconds - 1,
    sub: "101",
  });
  const signature = createHmac("sha256", "scheduler-runtime-secret-not-checked-in")
    .update(`${header}.${payload}`, "utf8")
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function adminSchedulerListRequest(): Request {
  return new Request(`${workerOrigin}/api/admin/fotm-schedules`, {
    headers: {
      Authorization: "Bearer injected-test-token",
      Origin: workerOrigin,
    },
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
      || compareIsoTimestamps(issued.expiresAt, input.consumedAt) <= 0
      || issued.shipMonth !== input.shipMonth
      || issued.shopDomain !== input.shopDomain
      || issued.shopifyCustomerId !== input.shopifyCustomerId
    ) {
      throw new ProfileQueueFormNonceDeniedError("The test form nonce is not valid.");
    }
    this.active.delete(input.nonce);
  }
}

class CountingCutoffRepository extends InMemoryProfileQueueRepository {
  findDueCalls = 0;
  lastCutoffLimit: number | null = null;

  override async findDueForCutoff(input: { readonly asOf: string; readonly limit: number }) {
    this.findDueCalls += 1;
    this.lastCutoffLimit = input.limit;
    return super.findDueForCutoff(input);
  }
}
