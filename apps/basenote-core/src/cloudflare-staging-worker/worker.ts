import {
  ProfileQueueFormNonceDeniedError,
  ProfileQueueOwnershipDeniedError,
  ProfileQueueOwnershipNotConfiguredError,
  SignedProxyBoundaryNotConfiguredError,
  SignedProxyRejectedError,
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
  StagingTestVariantConfigError,
  StagingTestVariantNotAllowedError,
  assertStagingMutationVariantAllowed,
  readStagingTestVariants,
} from "./staging-test-variants.js";
import { WebCryptoShopifyAppProxyVerifier } from "./webcrypto-app-proxy.js";
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
      if (request.method === "OPTIONS" && (url.pathname === HEALTH_PATH || url.pathname === PROFILE_QUEUE_PATH)) {
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
  await repository.persist({
    audit: {
      actorRef: context.actorRef,
      bindingId: context.bindingId,
      cycleKey: mutation.cycleKey,
      expectedRevision: current.revision,
      idempotencyKey: mutation.idempotencyKey,
      mutationId: asProfileQueueMutationId(input.createOpaqueId("pqm")),
      mutationKind: mutation.mutation.kind,
      occurredAt: updated.updatedAt,
      resultingRevision: updated.revision,
    },
    cycle: updated,
    expectedRevision: current.revision,
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
    revision: cycle.revision,
    shipMonth: cycle.shipMonth,
    state: cycle.state,
  };
}

function mapRouteError(error: unknown, request: Request, policy: StagingHttpPolicy): Response {
  return genericResponse(routeErrorStatus(error), routeErrorCode(error), request, policy);
}

function pageErrorResponse(error: unknown, request: Request, policy: StagingHttpPolicy): Response {
  return responseForHtml(routeErrorStatus(error), renderProfileQueueErrorPage(), request, policy);
}

function routeErrorStatus(error: unknown): number {
  if (error instanceof ProfileQueueRequestValidationError) {
    return 400;
  }
  if (error instanceof SignedProxyRejectedError) {
    return 401;
  }
  if (
    error instanceof ProfileQueueOwnershipDeniedError
    || error instanceof ProfileQueueFormNonceDeniedError
    || error instanceof StagingTestVariantNotAllowedError
  ) {
    return 403;
  }
  if (
    error instanceof SignedProxyBoundaryNotConfiguredError
    || error instanceof ProfileQueueOwnershipNotConfiguredError
    || error instanceof StagingD1NotConfiguredError
    || error instanceof StagingTestVariantConfigError
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
  if (error instanceof ProfileQueueRequestValidationError) return "invalid_request";
  if (error instanceof SignedProxyRejectedError) return "unauthorized";
  if (
    error instanceof ProfileQueueOwnershipDeniedError
    || error instanceof ProfileQueueFormNonceDeniedError
    || error instanceof StagingTestVariantNotAllowedError
  ) {
    return "forbidden";
  }
  if (
    error instanceof SignedProxyBoundaryNotConfiguredError
    || error instanceof ProfileQueueOwnershipNotConfiguredError
    || error instanceof StagingD1NotConfiguredError
    || error instanceof StagingTestVariantConfigError
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

function defaultOpaqueId(prefix: "pqa" | "pqm" | "pqk" | "pqf"): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return `${prefix}_${Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
