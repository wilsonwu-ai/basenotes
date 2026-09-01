import {
  ProfileQueueFormNonceDeniedError,
  ProfileQueueOwnershipDeniedError,
  ProfileQueueOwnershipNotConfiguredError,
  SignedProxyBoundaryNotConfiguredError,
  SignedProxyRejectedError,
  StagingAdminIdTokenNotConfiguredError,
  StagingAdminIdTokenRejectedError,
  StagingAdminStaffDeniedError,
} from "./boundaries.js";
import type {
  StagingWorkerDependencies,
  StagingWorkerEntrypoint,
  StagingWorkerEnv,
  VerifiedSignedProxyIdentity,
} from "./contracts.js";
import {
  StagingConfigurationError,
  createStagingHttpPolicy,
  isAllowedHost,
  isAllowedOrigin,
  responseForEmptyPreflight,
  responseForEmbeddedAdminHtml,
  responseForHtml,
  responseForJson,
  type StagingHttpPolicy,
} from "./http.js";
import {
  ProfileQueueRequestValidationError,
  parseProfileQueueMutationFormRequest,
  parseProfileQueueMutationHttpRequest,
  parseProfileQueueReadHttpRequest,
} from "./request-validation.js";
import { D1StagingTestBindingOwnershipResolver } from "./d1-test-binding-resolver.js";
import { D1StagingProfileQueueFormNonceRepository } from "./d1-form-nonce-repository.js";
import {
  asStagingProfileQueueFormNonce,
  type StagingProfileQueueFormNonce,
} from "./form-nonce.js";
import { renderProfileQueueErrorPage, renderProfileQueuePage } from "./profile-queue-page.js";
import {
  createProfileQueueSelectionEvidence,
  runStagingCutoffLock,
} from "./cutoff-locker.js";
import {
  StagingTestVariantConfigError,
  StagingTestVariantNotAllowedError,
  assertStagingVariantAllowed,
  assertStagingMutationVariantAllowed,
  readStagingTestVariants,
} from "./staging-test-variants.js";
import { WebCryptoShopifyAppProxyVerifier } from "./webcrypto-app-proxy.js";
import {
  WebCryptoShopifyAdminIdTokenVerifier,
  readStagingAdminEmbedShellConfiguration,
} from "./webcrypto-shopify-admin-id-token.js";
import {
  StagingAdminSchedulerRequestValidationError,
  parseStagingAdminSchedulerCommand,
} from "./admin-scheduler-request-validation.js";
import { renderStagingAdminSchedulerShell } from "./admin-scheduler-page.js";
import {
  StagingFotmProvisioningNotConfiguredError,
  StagingFotmProvisioningRecoveryNotReadyError,
  StagingFotmProvisioningRecoveryRequiredError,
  StagingFotmScheduleAdminBoundary,
  StagingFotmScheduleConflictError,
  StagingFotmScheduleNeedsAttentionError,
} from "./fotm-schedule-admin.js";
import {
  asProfileQueueIdempotencyKey,
  asProfileQueueMutationId,
  normalizeAuthenticatedProfileQueueRouteContext,
  type NormalizedProfileQueueApiRequest,
  type ProfileQueueCycle,
} from "../profile-queue/contracts.js";
import {
  D1ProfileQueueRepository,
} from "../profile-queue/d1-repository.js";
import { D1ProfileQueueFotmScheduleRepository } from "../profile-queue/d1-fotm-schedule-repository.js";
import type {
  ProfileQueueFotmProvisionCommand,
  ProfileQueueFotmSchedule,
} from "../profile-queue/fotm-schedule.js";
import {
  ProfileQueueRepositoryConflictError,
  ProfileQueueRepositoryIdempotencyConflictError,
  type ProfileQueueRepository,
} from "../profile-queue/repository.js";
import {
  ProfileQueueCapacityError,
  ProfileQueueCutoffError,
  ProfileQueueLockedError,
  ProfileQueueRevisionConflictError,
  applyProfileQueueMutation,
} from "../profile-queue/service.js";

const HEALTH_PATH = "/healthz";
/**
 * Shopify App Proxy root destination configured for staging. Storefront child
 * paths are appended by Shopify, so Profile Queue lands at this exact target
 * plus `/profile-queue`.
 */
const APP_PROXY_TARGET_PATH = "/api/shopify/app-proxy";
const PROFILE_QUEUE_PATH = `${APP_PROXY_TARGET_PATH}/profile-queue`;
/** An embedded Admin shell, never an App Proxy destination or storefront route. */
const ADMIN_FOTM_SCHEDULER_PATH = "/admin/fotm-scheduler";
/** Same-origin API; all schedule reads/writes server-verify an Admin ID token. */
const ADMIN_FOTM_SCHEDULER_API_PATH = "/api/admin/fotm-schedules";
const FORM_NONCE_TTL_MILLISECONDS = 10 * 60 * 1_000;

class StagingD1NotConfiguredError extends Error {
  override name = "StagingD1NotConfiguredError";
}

class ProfileQueueIdempotencyReuseError extends Error {
  override name = "ProfileQueueIdempotencyReuseError";
}

class ProfileQueueCycleNotFoundError extends Error {
  override name = "ProfileQueueCycleNotFoundError";
}

/**
 * Cloudflare Worker adapter for a separately provisioned staging database.
 *
 * It intentionally has no Shopify OAuth, sender, webhook, queue consumer,
 * token storage, or deployed configuration. The default boundary verifies an
 * App Proxy request only when a runtime-only secret, exact staging shop,
 * separately seeded test binding, and one-use D1 form nonce are present;
 * otherwise it fails closed.
 * Unit tests inject safe doubles to exercise orchestration without network or
 * Cloudflare account access.
 */
export function createStagingProfileQueueWorker(
  dependencies: StagingWorkerDependencies = {},
): StagingWorkerEntrypoint {
  const now = dependencies.now ?? (() => new Date());
  const signedProxyBoundary = dependencies.signedProxyBoundary
    ?? new WebCryptoShopifyAppProxyVerifier({ nowSeconds: () => Math.floor(now().getTime() / 1_000) });
  const formNonceRepository = dependencies.formNonceRepository;
  const ownershipResolver = dependencies.ownershipResolver;
  const repositoryFactory = dependencies.repositoryFactory ?? ((database) => new D1ProfileQueueRepository(database));
  const scheduleRepositoryFactory = dependencies.scheduleRepositoryFactory
    ?? ((database) => new D1ProfileQueueFotmScheduleRepository(database));
  const adminIdTokenBoundary = dependencies.adminIdTokenBoundary ?? new WebCryptoShopifyAdminIdTokenVerifier({
    nowSeconds: () => Math.floor(now().getTime() / 1_000),
  });
  const createOpaqueId = dependencies.createOpaqueId ?? defaultOpaqueId;

  return {
    async fetch(request, environment, executionContext) {
      // The current adapter intentionally does not schedule background work.
      // Keeping the context referenced avoids accidental future fire-and-forget
      // writes without an idempotency and audit review.
      void executionContext;

      let policy: StagingHttpPolicy;
      try {
        policy = createStagingHttpPolicy(environment);
      } catch (error) {
        if (error instanceof StagingConfigurationError) {
          return genericResponse(503, "staging_not_configured", request, emptyPolicy());
        }
        return genericResponse(503, "temporarily_unavailable", request, emptyPolicy());
      }

      if (!isAllowedHost(request, policy)) {
        return genericResponse(404, "not_found", request, policy);
      }
      if (environment.BASENOTE_RUNTIME_STAGE !== "staging") {
        return genericResponse(503, "staging_not_configured", request, policy);
      }
      if (!isAllowedOrigin(request, policy)) {
        return genericResponse(403, "forbidden", request, policy);
      }

      const url = new URL(request.url);
      if (
        request.method === "OPTIONS"
        && (url.pathname === HEALTH_PATH || url.pathname === PROFILE_QUEUE_PATH || url.pathname === ADMIN_FOTM_SCHEDULER_API_PATH)
      ) {
        return responseForEmptyPreflight(request, policy);
      }
      if (request.method === "GET" && url.pathname === HEALTH_PATH) {
        return responseForJson(200, {
          customerMutations: "signed_boundary_required",
          emailDelivery: "disabled",
          environment: "staging",
          shopifyOAuth: "disabled",
          status: "ok",
        }, request, policy);
      }

      try {
        if (url.pathname === ADMIN_FOTM_SCHEDULER_PATH && request.method === "GET") {
          return handleAdminSchedulerShell({ environment, policy, request });
        }
        if (url.pathname === ADMIN_FOTM_SCHEDULER_API_PATH && request.method === "GET") {
          return await handleAdminSchedulerList({
            adminIdTokenBoundary,
            environment,
            now,
            policy,
            request,
            scheduleRepositoryFactory,
          });
        }
        if (url.pathname === ADMIN_FOTM_SCHEDULER_API_PATH && request.method === "POST") {
          return await handleAdminSchedulerCommand({
            adminIdTokenBoundary,
            createOpaqueId,
            environment,
            now,
            policy,
            repositoryFactory,
            request,
            scheduleRepositoryFactory,
          });
        }
        if (url.pathname === PROFILE_QUEUE_PATH && request.method === "GET") {
          return await handleRead({
            createOpaqueId,
            environment,
            formNonceRepository,
            now,
            ownershipResolver,
            policy,
            repositoryFactory,
            request,
            signedProxyBoundary,
            url,
          });
        }
        if (url.pathname === PROFILE_QUEUE_PATH && request.method === "POST") {
          if (isFormUrlEncodedRequest(request)) {
            return await handleFormMutation({
              createOpaqueId,
              environment,
              formNonceRepository,
              now,
              ownershipResolver,
              policy,
              repositoryFactory,
              request,
              signedProxyBoundary,
            });
          }
          return await handleMutation({
            createOpaqueId,
            environment,
            formNonceRepository,
            now,
            ownershipResolver,
            policy,
            repositoryFactory,
            request,
            signedProxyBoundary,
          });
        }
        return genericResponse(404, "not_found", request, policy);
      } catch (error) {
        return mapRouteError(error, request, policy);
      }
    },
    async scheduled(event, environment, executionContext) {
      const run = runScheduledCutoffLock({
        createOpaqueId,
        environment,
        now,
        repositoryFactory,
      });
      event.waitUntil(run);
      // Awaiting the same promise keeps offline tests deterministic while
      // Cloudflare retains it through waitUntil in a real cron invocation.
      await run;
      void executionContext;
    },
  };
}

export default createStagingProfileQueueWorker();

interface SharedRouteInput {
  readonly environment: StagingWorkerEnv;
  readonly formNonceRepository: StagingWorkerDependencies["formNonceRepository"];
  readonly now: () => Date;
  readonly ownershipResolver: StagingWorkerDependencies["ownershipResolver"];
  readonly policy: StagingHttpPolicy;
  readonly repositoryFactory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>;
  readonly request: Request;
  readonly signedProxyBoundary: NonNullable<StagingWorkerDependencies["signedProxyBoundary"]>;
}

interface AdminSchedulerSharedRouteInput {
  readonly adminIdTokenBoundary: NonNullable<StagingWorkerDependencies["adminIdTokenBoundary"]>;
  readonly environment: StagingWorkerEnv;
  readonly now: () => Date;
  readonly policy: StagingHttpPolicy;
  readonly request: Request;
  readonly scheduleRepositoryFactory: NonNullable<StagingWorkerDependencies["scheduleRepositoryFactory"]>;
}

/**
 * This shell is deliberately unprivileged: it contains only App Bridge setup
 * and copy describing the included-default rule. It cannot list or mutate a
 * schedule until a fresh server-verified Shopify Admin ID token is presented
 * to the separate same-origin API.
 */
function handleAdminSchedulerShell(input: {
  readonly environment: StagingWorkerEnv;
  readonly policy: StagingHttpPolicy;
  readonly request: Request;
}): Response {
  const configuration = readStagingAdminEmbedShellConfiguration(input.environment);
  return responseForEmbeddedAdminHtml(
    200,
    renderStagingAdminSchedulerShell({
      apiPath: ADMIN_FOTM_SCHEDULER_API_PATH,
      clientId: configuration.clientId,
    }),
    configuration.shopDomain,
    input.request,
    input.policy,
  );
}

async function handleAdminSchedulerList(input: AdminSchedulerSharedRouteInput): Promise<Response> {
  const identity = await input.adminIdTokenBoundary.verify({
    environment: input.environment,
    request: input.request,
  });
  const boundary = createAdminSchedulerBoundary({
    createOpaqueId: defaultOpaqueId,
    cycleRepository: undefined,
    environment: input.environment,
    now: input.now,
    scheduleRepositoryFactory: input.scheduleRepositoryFactory,
  });
  const [schedules, provisionCommands, pendingProvisionCommands] = await Promise.all([
    boundary.list(adminStaffContext(identity.actorRef)),
    boundary.listProvisionCommands(adminStaffContext(identity.actorRef)),
    boundary.listPendingProvisionCommands(adminStaffContext(identity.actorRef)),
  ]);
  const variants = readStagingTestVariants(input.environment);
  return responseForJson(200, {
    provisionCommands: provisionCommands.map(serializeFotmProvisionCommand),
    pendingProvisionCommands: pendingProvisionCommands.map(serializeFotmProvisionCommand),
    schedules: schedules.map(serializeFotmSchedule),
    variants: variants.map((variant) => ({ label: variant.label, variantId: variant.variantId })),
  }, input.request, input.policy);
}

async function handleAdminSchedulerCommand(
  input: AdminSchedulerSharedRouteInput
    & {
      readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]>;
      readonly repositoryFactory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>;
    },
): Promise<Response> {
  const identity = await input.adminIdTokenBoundary.verify({
    environment: input.environment,
    request: input.request,
  });
  const command = await parseStagingAdminSchedulerCommand(input.request);
  const variants = readStagingTestVariants(input.environment);
  if (command.action === "SAVE_DRAFT" || command.action === "RECOVER_DRAFT") {
    assertStagingVariantAllowed(command.variantId, variants);
  } else {
    // A schedule created outside this Worker must not become a way around the
    // disposable test-variant boundary when an authenticated staff member
    // later publishes or provisions it. The later CAS still protects a race.
    const existing = await input.scheduleRepositoryFactory(requireStagingD1(input.environment))
      .findSchedule(command.shipMonth);
    if (existing) assertStagingVariantAllowed(existing.variantId, variants);
  }

  // Shopify App Bridge may cache and reuse the same valid ID token during its
  // roughly one-minute lifetime. Verify it on every request, then let the
  // command's mandatory idempotency key and schedule revision protect effects.
  // Treating `jti` as a one-command nonce would reject legitimate rapid writes.
  const boundary = createAdminSchedulerBoundary({
    createOpaqueId: input.createOpaqueId,
    cycleRepository: createRepository(input.environment, input.repositoryFactory),
    environment: input.environment,
    now: input.now,
    scheduleRepositoryFactory: input.scheduleRepositoryFactory,
  });
  const context = adminStaffContext(identity.actorRef);
  if (command.action === "SAVE_DRAFT") {
    const result = await boundary.submitDraft({
      context,
      cutoffAt: command.cutoffAt,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      merchantTimezone: command.merchantTimezone,
      shipMonth: command.shipMonth,
      variantId: command.variantId,
    });
    return responseForJson(200, {
      replayed: result.replayed,
      schedule: serializeFotmSchedule(result.schedule),
    }, input.request, input.policy);
  }
  if (command.action === "PUBLISH") {
    const result = await boundary.submitPublish({
      context,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      shipMonth: command.shipMonth,
    });
    return responseForJson(200, {
      replayed: result.replayed,
      schedule: serializeFotmSchedule(result.schedule),
    }, input.request, input.policy);
  }
  if (command.action === "RETIRE") {
    const result = await boundary.submitRetire({
      context,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      shipMonth: command.shipMonth,
    });
    return responseForJson(200, {
      replayed: result.replayed,
      schedule: serializeFotmSchedule(result.schedule),
    }, input.request, input.policy);
  }
  if (command.action === "RECOVER_DRAFT") {
    const result = await boundary.submitRecoverDraft({
      context,
      cutoffAt: command.cutoffAt,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      merchantTimezone: command.merchantTimezone,
      shipMonth: command.shipMonth,
      variantId: command.variantId,
    });
    return responseForJson(200, {
      replayed: result.replayed,
      schedule: serializeFotmSchedule(result.schedule),
    }, input.request, input.policy);
  }
  if (command.action === "RECORD_RECOVERY_EXCEPTION") {
    const result = await boundary.recordRecoveryException({
      context,
      expectedRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      shipMonth: command.shipMonth,
    });
    return responseForJson(200, {
      attention: "RECOVERY_EXCEPTION_RECORDED",
      replayed: result.replayed,
    }, input.request, input.policy);
  }
  if (command.action === "MARK_PROVISION_NEEDS_ATTENTION") {
    const result = await boundary.markProvisionNeedsAttention({
      context,
      expectedScheduleRevision: command.expectedScheduleRevision,
      idempotencyKey: command.idempotencyKey,
      shipMonth: command.shipMonth,
    });
    return responseForJson(200, {
      attention: "PROVISION_NEEDS_ATTENTION_RECORDED",
      replayed: result.replayed,
    }, input.request, input.policy);
  }

  // A provision key is first claimed durably with its exact five-or-fewer
  // cycle plan. A completed same-key retry returns that stored result; a
  // pending command fails closed and never advances to another batch.
  const provisioning = await boundary.provisionPublishedMonth({
    context,
    expectedScheduleRevision: command.expectedScheduleRevision,
    idempotencyKey: command.idempotencyKey,
    shipMonth: command.shipMonth,
  });
  return responseForJson(200, {
    replayed: provisioning.replayed,
    provisioning,
  }, input.request, input.policy);
}

function createAdminSchedulerBoundary(input: {
  readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]>;
  readonly cycleRepository: ProfileQueueRepository | undefined;
  readonly environment: StagingWorkerEnv;
  readonly now: () => Date;
  readonly scheduleRepositoryFactory: NonNullable<StagingWorkerDependencies["scheduleRepositoryFactory"]>;
}): StagingFotmScheduleAdminBoundary {
  return new StagingFotmScheduleAdminBoundary({
    createOpaqueId: input.createOpaqueId,
    cycleRepository: input.cycleRepository,
    // Migration 0006 deliberately stores command lifecycle evidence at whole-
    // second precision, matching Shopify's integer JWT instants and avoiding
    // multiple equivalent timestamp encodings in immutable audit rows. Worker
    // clocks include milliseconds, so normalize every Admin write at the
    // boundary rather than relying on zero-millisecond test fixtures. Floor
    // audit instants so evidence never appears later than the actual event;
    // the recovery gate adds one full precision quantum before terminalizing.
    now: () => new Date(Math.floor(input.now().getTime() / 1_000) * 1_000),
    repository: input.scheduleRepositoryFactory(requireStagingD1(input.environment)),
  });
}

function adminStaffContext(actorRef: string): { readonly actorRef: string; readonly authorization: "SERVER_VERIFIED_STAGING_STAFF" } {
  return { actorRef, authorization: "SERVER_VERIFIED_STAGING_STAFF" };
}

function serializeFotmSchedule(schedule: ProfileQueueFotmSchedule): Record<string, unknown> {
  return {
    cutoffAt: schedule.cutoffAt,
    merchantTimezone: schedule.merchantTimezone,
    revision: schedule.revision,
    shipMonth: schedule.shipMonth,
    status: schedule.status,
    updatedAt: schedule.updatedAt,
    variantId: schedule.variantId,
  };
}

/** Deliberately omits plan targets and actor references from the browser. */
function serializeFotmProvisionCommand(command: ProfileQueueFotmProvisionCommand): Record<string, unknown> {
  return {
    attentionAt: command.attentionAt,
    completedAt: command.completedAt,
    createdAt: command.createdAt,
    expectedScheduleRevision: command.expectedScheduleRevision,
    idempotencyKey: command.idempotencyKey,
    shipMonth: command.shipMonth,
    status: command.status,
  };
}

async function handleRead(
  input: SharedRouteInput
    & { readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]>; readonly url: URL },
): Promise<Response> {
  try {
    const query = parseProfileQueueReadHttpRequest(input.url);
    const identity = await input.signedProxyBoundary.verify({
      environment: input.environment,
      request: input.request,
    });
    const context = await resolveRouteContext({
      cycleKey: query.cycleKey,
      environment: input.environment,
      identity,
      now: input.now,
      resolver: input.ownershipResolver,
      shipMonth: query.shipMonth,
    });
    const repository = createRepository(input.environment, input.repositoryFactory);
    const cycle = await findExactCycle(repository, context.bindingId, query.cycleKey, query.shipMonth);
    const variants = readStagingTestVariants(input.environment);
    const formNonce = await issueFormNonce({
      createOpaqueId: input.createOpaqueId,
      cycle,
      environment: input.environment,
      identity,
      now: input.now,
      repository: input.formNonceRepository,
    });
    return responseForHtml(200, renderProfileQueuePage({
      createIdempotencyKey: () => asProfileQueueIdempotencyKey(input.createOpaqueId("pqk")),
      cycle,
      formNonce,
      formAction: profileQueueStorefrontAction(identity.storefrontPathPrefix),
      now: input.now().toISOString(),
      variants,
    }), input.request, input.policy);
  } catch (error) {
    return pageErrorResponse(error, input.request, input.policy);
  }
}

async function handleMutation(
  input: SharedRouteInput & { readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]> },
): Promise<Response> {
  const result = await mutateProfileQueue(input, async () => ({
    mutation: await parseProfileQueueMutationHttpRequest(
      input.request,
      (prefix) => input.createOpaqueId(prefix),
    ),
  }));
  return responseForJson(200, { queue: serializeCycle(result.cycle) }, input.request, input.policy);
}

async function handleFormMutation(
  input: SharedRouteInput & { readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]> },
): Promise<Response> {
  try {
    const result = await mutateProfileQueue(input, async () => {
      const parsed = await parseProfileQueueMutationFormRequest(
        input.request,
        (prefix) => input.createOpaqueId(prefix),
      );
      return { formNonce: parsed.formNonce, mutation: parsed.mutation };
    });
    const formNonce = await issueFormNonce({
      createOpaqueId: input.createOpaqueId,
      cycle: result.cycle,
      environment: input.environment,
      identity: result.identity,
      now: input.now,
      repository: input.formNonceRepository,
    });
    return responseForHtml(200, renderProfileQueuePage({
      createIdempotencyKey: () => asProfileQueueIdempotencyKey(input.createOpaqueId("pqk")),
      cycle: result.cycle,
      formNonce,
      formAction: profileQueueStorefrontAction(result.identity.storefrontPathPrefix),
      now: input.now().toISOString(),
      status: "success",
      variants: result.variants,
    }), input.request, input.policy);
  } catch (error) {
    return pageErrorResponse(error, input.request, input.policy);
  }
}

async function mutateProfileQueue(
  input: SharedRouteInput & { readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]> },
  parseMutation: () => Promise<ParsedWorkerMutation>,
): Promise<{
  readonly cycle: ProfileQueueCycle;
  readonly identity: VerifiedSignedProxyIdentity;
  readonly variants: ReturnType<typeof readStagingTestVariants>;
}> {
  const identity = await input.signedProxyBoundary.verify({
    environment: input.environment,
    request: input.request,
  });
  const parsed = await parseMutation();
  const mutation = parsed.mutation;
  const variants = readStagingTestVariants(input.environment);
  assertStagingMutationVariantAllowed(mutation.mutation, variants);
  const context = await resolveRouteContext({
    cycleKey: mutation.cycleKey,
    environment: input.environment,
    identity,
    now: input.now,
    resolver: input.ownershipResolver,
    shipMonth: mutation.shipMonth,
  });
  const repository = createRepository(input.environment, input.repositoryFactory);

  // The current D1 audit contains no request fingerprint or response snapshot.
  // Treat every key reuse as a conflict instead of guessing whether a different
  // body is a safe replay. A later HTTP idempotency envelope can add replay.
  if (await repository.findMutation(mutation.idempotencyKey)) {
    throw new ProfileQueueIdempotencyReuseError("An idempotency key cannot be replayed yet.");
  }

  const current = await findExactCycle(
    repository,
    context.bindingId,
    mutation.cycleKey,
    mutation.shipMonth,
  );
  const occurredAt = input.now().toISOString();
  const updated = applyProfileQueueMutation(current, {
    expectedRevision: mutation.expectedRevision,
    mutation: mutation.mutation,
    occurredAt,
  });
  if (parsed.formNonce) {
    await consumeFormNonce({
      bindingId: context.bindingId,
      environment: input.environment,
      expectedRevision: mutation.expectedRevision,
      identity,
      nonce: parsed.formNonce,
      now: input.now,
      repository: input.formNonceRepository,
      shipMonth: mutation.shipMonth,
      cycleKey: mutation.cycleKey,
    });
  }
  const audit = {
    actorRef: context.actorRef,
    bindingId: context.bindingId,
    cycleKey: mutation.cycleKey,
    expectedRevision: current.revision,
    idempotencyKey: mutation.idempotencyKey,
    mutationId: asProfileQueueMutationId(input.createOpaqueId("pqm")),
    mutationKind: mutation.mutation.kind,
    occurredAt: updated.updatedAt,
    resultingRevision: updated.revision,
  } as const;
  await repository.persist({
    audit,
    cycle: updated,
    expectedRevision: current.revision,
    selectionEvidence: createProfileQueueSelectionEvidence({
      audit,
      cycle: updated,
      evidenceId: input.createOpaqueId("pqe"),
    }),
  });
  return { cycle: updated, identity, variants };
}

interface ParsedWorkerMutation {
  readonly formNonce?: StagingProfileQueueFormNonce;
  readonly mutation: NormalizedProfileQueueApiRequest;
}

async function resolveRouteContext(input: {
  readonly cycleKey: string;
  readonly environment: StagingWorkerEnv;
  readonly identity: VerifiedSignedProxyIdentity;
  readonly now: () => Date;
  readonly resolver: StagingWorkerDependencies["ownershipResolver"];
  readonly shipMonth: string;
}) {
  const authorized = await resolveOwnership(input);
  return normalizeAuthenticatedProfileQueueRouteContext(authorized);
}

async function findExactCycle(
  repository: ProfileQueueRepository,
  bindingId: string,
  cycleKey: string,
  shipMonth: string,
): Promise<ProfileQueueCycle> {
  const cycle = await repository.findCycle(bindingId, cycleKey);
  if (!cycle || cycle.shipMonth !== shipMonth) {
    throw new ProfileQueueCycleNotFoundError("The exact authorized queue cycle was not found.");
  }
  return cycle;
}

function profileQueueStorefrontAction(storefrontPathPrefix: string): string {
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(storefrontPathPrefix)) {
    throw new SignedProxyRejectedError("The signed storefront path prefix is invalid.");
  }
  return `${storefrontPathPrefix}/profile-queue`;
}

function isFormUrlEncodedRequest(request: Request): boolean {
  return request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "application/x-www-form-urlencoded";
}

function createRepository(
  environment: StagingWorkerEnv,
  factory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>,
): ProfileQueueRepository {
  return factory(requireStagingD1(environment));
}

async function resolveOwnership(input: {
  readonly cycleKey: string;
  readonly environment: StagingWorkerEnv;
  readonly identity: VerifiedSignedProxyIdentity;
  readonly now: () => Date;
  readonly resolver: StagingWorkerDependencies["ownershipResolver"];
  readonly shipMonth: string;
}) {
  const resolver = input.resolver ?? new D1StagingTestBindingOwnershipResolver(
    requireStagingD1(input.environment),
    { now: input.now },
  );
  return resolver.resolve({
    cycleKey: input.cycleKey,
    identity: input.identity,
    shipMonth: input.shipMonth,
  });
}

async function issueFormNonce(input: {
  readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]>;
  readonly cycle: ProfileQueueCycle;
  readonly environment: StagingWorkerEnv;
  readonly identity: VerifiedSignedProxyIdentity;
  readonly now: () => Date;
  readonly repository: StagingWorkerDependencies["formNonceRepository"];
}): Promise<StagingProfileQueueFormNonce> {
  const issuedAt = input.now();
  const nonce = asStagingProfileQueueFormNonce(input.createOpaqueId("pqf"));
  const repository = input.repository ?? new D1StagingProfileQueueFormNonceRepository(
    requireStagingD1(input.environment),
  );
  await repository.issue({
    bindingId: input.cycle.bindingId,
    cycleKey: input.cycle.cycleKey,
    expectedRevision: input.cycle.revision,
    expiresAt: new Date(issuedAt.getTime() + FORM_NONCE_TTL_MILLISECONDS).toISOString(),
    issuedAt: issuedAt.toISOString(),
    nonce,
    shipMonth: input.cycle.shipMonth,
    shopDomain: input.identity.shopDomain,
    shopifyCustomerId: input.identity.shopifyCustomerId,
  });
  return nonce;
}

async function consumeFormNonce(input: {
  readonly bindingId: string;
  readonly cycleKey: string;
  readonly environment: StagingWorkerEnv;
  readonly expectedRevision: number;
  readonly identity: VerifiedSignedProxyIdentity;
  readonly nonce: StagingProfileQueueFormNonce;
  readonly now: () => Date;
  readonly repository: StagingWorkerDependencies["formNonceRepository"];
  readonly shipMonth: string;
}): Promise<void> {
  const repository = input.repository ?? new D1StagingProfileQueueFormNonceRepository(
    requireStagingD1(input.environment),
  );
  await repository.consume({
    bindingId: input.bindingId,
    consumedAt: input.now().toISOString(),
    cycleKey: input.cycleKey,
    expectedRevision: input.expectedRevision,
    nonce: input.nonce,
    shipMonth: input.shipMonth,
    shopDomain: input.identity.shopDomain,
    shopifyCustomerId: input.identity.shopifyCustomerId,
  });
}

function requireStagingD1(environment: StagingWorkerEnv) {
  if (!environment.BASENOTE_STAGING_D1) {
    throw new StagingD1NotConfiguredError("The separately provisioned staging D1 binding is unavailable.");
  }
  return environment.BASENOTE_STAGING_D1;
}

function serializeCycle(cycle: ProfileQueueCycle): Record<string, unknown> {
  return {
    addOns: cycle.addOns.map((addOn) => ({
      id: addOn.id,
      position: addOn.position,
      unitPriceCents: addOn.unitPriceCents,
      variantId: addOn.variantId,
    })),
    cycleKey: cycle.cycleKey,
    fotm: {
      cutoffAt: cycle.fotm.cutoffAt,
      merchantTimezone: cycle.fotm.merchantTimezone,
      status: cycle.fotm.status,
      variantId: cycle.fotm.variantId,
    },
    memberChoice: {
      source: cycle.memberChoice.source,
      variantId: cycle.memberChoice.variantId,
    },
    revision: cycle.revision,
    shipMonth: cycle.shipMonth,
    state: cycle.state,
  };
}

function mapRouteError(error: unknown, request: Request, policy: StagingHttpPolicy): Response {
  const response = genericResponse(routeErrorStatus(error), routeErrorCode(error), request, policy);
  // Shopify's embedded-app guidance asks clients to obtain a fresh ID token
  // after an invalid or expired bearer token. Never add this hint for a
  // staff authorization denial: a new token cannot grant missing authority.
  if (error instanceof StagingAdminIdTokenRejectedError) {
    response.headers.set("X-Shopify-Retry-Invalid-Session-Request", "1");
  }
  return response;
}

function pageErrorResponse(error: unknown, request: Request, policy: StagingHttpPolicy): Response {
  return responseForHtml(routeErrorStatus(error), renderProfileQueueErrorPage(), request, policy);
}

function routeErrorStatus(error: unknown): number {
  if (
    error instanceof ProfileQueueRequestValidationError
    || error instanceof StagingAdminSchedulerRequestValidationError
  ) {
    return 400;
  }
  if (
    error instanceof SignedProxyRejectedError
    || error instanceof StagingAdminIdTokenRejectedError
  ) {
    return 401;
  }
  if (
    error instanceof ProfileQueueOwnershipDeniedError
    || error instanceof ProfileQueueFormNonceDeniedError
    || error instanceof StagingTestVariantNotAllowedError
    || error instanceof StagingAdminStaffDeniedError
  ) {
    return 403;
  }
  if (
    error instanceof SignedProxyBoundaryNotConfiguredError
    || error instanceof ProfileQueueOwnershipNotConfiguredError
    || error instanceof StagingD1NotConfiguredError
    || error instanceof StagingTestVariantConfigError
    || error instanceof StagingAdminIdTokenNotConfiguredError
    || error instanceof StagingFotmProvisioningNotConfiguredError
  ) {
    return 503;
  }
  if (
    error instanceof ProfileQueueCapacityError
    || error instanceof ProfileQueueCutoffError
    || error instanceof ProfileQueueLockedError
    || error instanceof ProfileQueueRevisionConflictError
    || error instanceof ProfileQueueRepositoryConflictError
    || error instanceof ProfileQueueRepositoryIdempotencyConflictError
    || error instanceof ProfileQueueIdempotencyReuseError
    || error instanceof StagingFotmScheduleConflictError
    || error instanceof StagingFotmProvisioningRecoveryRequiredError
    || error instanceof StagingFotmProvisioningRecoveryNotReadyError
    || error instanceof StagingFotmScheduleNeedsAttentionError
  ) {
    return 409;
  }
  if (error instanceof ProfileQueueCycleNotFoundError) return 404;
  // Never serialize database errors, request data, identity fields, or stack
  // traces. The Worker intentionally has no console logging for the same
  // reason: staging exports and customer data must not leak into observability.
  return 503;
}

function routeErrorCode(error: unknown): string {
  if (
    error instanceof ProfileQueueRequestValidationError
    || error instanceof StagingAdminSchedulerRequestValidationError
  ) return "invalid_request";
  if (
    error instanceof SignedProxyRejectedError
    || error instanceof StagingAdminIdTokenRejectedError
  ) return "unauthorized";
  if (
    error instanceof ProfileQueueOwnershipDeniedError
    || error instanceof ProfileQueueFormNonceDeniedError
    || error instanceof StagingTestVariantNotAllowedError
    || error instanceof StagingAdminStaffDeniedError
  ) {
    return "forbidden";
  }
  if (
    error instanceof SignedProxyBoundaryNotConfiguredError
    || error instanceof ProfileQueueOwnershipNotConfiguredError
    || error instanceof StagingD1NotConfiguredError
    || error instanceof StagingTestVariantConfigError
    || error instanceof StagingAdminIdTokenNotConfiguredError
    || error instanceof StagingFotmProvisioningNotConfiguredError
  ) {
    return "staging_not_configured";
  }
  if (
    error instanceof ProfileQueueCapacityError
    || error instanceof ProfileQueueCutoffError
    || error instanceof ProfileQueueLockedError
    || error instanceof ProfileQueueRevisionConflictError
    || error instanceof ProfileQueueRepositoryConflictError
    || error instanceof ProfileQueueRepositoryIdempotencyConflictError
    || error instanceof ProfileQueueIdempotencyReuseError
  ) {
    return "queue_conflict";
  }
  if (error instanceof StagingFotmScheduleConflictError) return "schedule_conflict";
  if (error instanceof StagingFotmProvisioningRecoveryRequiredError) return "provision_recovery_required";
  if (error instanceof StagingFotmProvisioningRecoveryNotReadyError) return "provision_recovery_not_ready";
  if (error instanceof StagingFotmScheduleNeedsAttentionError) return "schedule_needs_attention";
  if (error instanceof ProfileQueueCycleNotFoundError) return "not_found";
  return "temporarily_unavailable";
}

function genericResponse(
  status: number,
  error: string,
  request: Request,
  policy: StagingHttpPolicy,
): Response {
  return responseForJson(status, { error }, request, policy);
}

function emptyPolicy(): StagingHttpPolicy {
  return { allowedHosts: new Set(), allowedOrigins: new Set() };
}

async function runScheduledCutoffLock(input: {
  readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]>;
  readonly environment: StagingWorkerEnv;
  readonly now: () => Date;
  readonly repositoryFactory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>;
}): Promise<void> {
  // This explicit opt-in means an existing staging Worker version has no
  // scheduled behavior until the reviewed migration, config, and E2E gate are
  // all intentionally enabled. It never falls through to production.
  if (
    input.environment.BASENOTE_RUNTIME_STAGE !== "staging"
    || input.environment.STAGING_CUTOFF_AUTOMATION_ENABLED !== "true"
    || !input.environment.BASENOTE_STAGING_D1
  ) {
    return;
  }
  await runStagingCutoffLock({
    asOf: input.now().toISOString(),
    createOpaqueId: input.createOpaqueId,
    repository: input.repositoryFactory(input.environment.BASENOTE_STAGING_D1),
  });
}

function defaultOpaqueId(prefix: "pqa" | "pqm" | "pqk" | "pqf" | "pqe" | "pfs" | "pfa" | "pfk"): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return `${prefix}_${Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
