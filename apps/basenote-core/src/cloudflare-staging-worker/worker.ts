import {
  ProfileQueueOwnershipDeniedError,
  ProfileQueueOwnershipNotConfiguredError,
  SignedProxyBoundaryNotConfiguredError,
  SignedProxyRejectedError,
  unconfiguredProfileQueueOwnershipResolver,
  unconfiguredSignedProxyBoundary,
} from "./boundaries.js";
import type {
  StagingWorkerDependencies,
  StagingWorkerEntrypoint,
  StagingWorkerEnv,
} from "./contracts.js";
import {
  StagingConfigurationError,
  createStagingHttpPolicy,
  isAllowedHost,
  isAllowedOrigin,
  responseForEmptyPreflight,
  responseForJson,
  type StagingHttpPolicy,
} from "./http.js";
import {
  ProfileQueueRequestValidationError,
  parseProfileQueueMutationHttpRequest,
  parseProfileQueueReadHttpRequest,
} from "./request-validation.js";
import {
  asProfileQueueMutationId,
  normalizeAuthenticatedProfileQueueRouteContext,
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
const PROFILE_QUEUE_PATH = "/apps/basenote/profile-queue";

class StagingD1NotConfiguredError extends Error {
  override name = "StagingD1NotConfiguredError";
}

class ProfileQueueIdempotencyReuseError extends Error {
  override name = "ProfileQueueIdempotencyReuseError";
}

/**
 * Cloudflare Worker adapter for a separately provisioned staging database.
 *
 * It intentionally has no Shopify OAuth, App Proxy secret, sender, webhook,
 * queue consumer, token storage, or deployed configuration. The default
 * boundaries reject every customer queue operation until reviewed adapters are
 * supplied. Unit tests inject in-memory safe doubles to exercise the route
 * orchestration without network or Cloudflare account access.
 */
export function createStagingProfileQueueWorker(
  dependencies: StagingWorkerDependencies = {},
): StagingWorkerEntrypoint {
  const signedProxyBoundary = dependencies.signedProxyBoundary ?? unconfiguredSignedProxyBoundary;
  const ownershipResolver = dependencies.ownershipResolver ?? unconfiguredProfileQueueOwnershipResolver;
  const repositoryFactory = dependencies.repositoryFactory ?? ((database) => new D1ProfileQueueRepository(database));
  const now = dependencies.now ?? (() => new Date());
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
            environment,
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
          return await handleMutation({
            createOpaqueId,
            environment,
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
  readonly now: () => Date;
  readonly ownershipResolver: NonNullable<StagingWorkerDependencies["ownershipResolver"]>;
  readonly policy: StagingHttpPolicy;
  readonly repositoryFactory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>;
  readonly request: Request;
  readonly signedProxyBoundary: NonNullable<StagingWorkerDependencies["signedProxyBoundary"]>;
}

async function handleRead(input: SharedRouteInput & { readonly url: URL }): Promise<Response> {
  const query = parseProfileQueueReadHttpRequest(input.url);
  const identity = await input.signedProxyBoundary.verify({
    environment: input.environment,
    request: input.request,
  });
  const authorized = await input.ownershipResolver.resolve({
    cycleKey: query.cycleKey,
    identity,
    shipMonth: query.shipMonth,
  });
  const context = normalizeAuthenticatedProfileQueueRouteContext(authorized);
  const repository = createRepository(input.environment, input.repositoryFactory);
  const cycle = await repository.findCycle(context.bindingId, query.cycleKey);
  if (!cycle || cycle.shipMonth !== query.shipMonth) {
    return genericResponse(404, "not_found", input.request, input.policy);
  }
  return responseForJson(200, { queue: serializeCycle(cycle) }, input.request, input.policy);
}

async function handleMutation(
  input: SharedRouteInput & { readonly createOpaqueId: NonNullable<StagingWorkerDependencies["createOpaqueId"]> },
): Promise<Response> {
  const mutation = await parseProfileQueueMutationHttpRequest(input.request, (prefix) => input.createOpaqueId(prefix));
  const identity = await input.signedProxyBoundary.verify({
    environment: input.environment,
    request: input.request,
  });
  const authorized = await input.ownershipResolver.resolve({
    cycleKey: mutation.cycleKey,
    identity,
    shipMonth: mutation.shipMonth,
  });
  const context = normalizeAuthenticatedProfileQueueRouteContext(authorized);
  const repository = createRepository(input.environment, input.repositoryFactory);

  // The current D1 audit contains no request fingerprint or response snapshot.
  // Treat every key reuse as a conflict instead of guessing whether a different
  // body is a safe replay. A later HTTP idempotency envelope can add replay.
  if (await repository.findMutation(mutation.idempotencyKey)) {
    throw new ProfileQueueIdempotencyReuseError("An idempotency key cannot be replayed yet.");
  }

  const current = await repository.findCycle(context.bindingId, mutation.cycleKey);
  if (!current || current.shipMonth !== mutation.shipMonth) {
    return genericResponse(404, "not_found", input.request, input.policy);
  }

  const occurredAt = input.now().toISOString();
  const updated = applyProfileQueueMutation(current, {
    expectedRevision: mutation.expectedRevision,
    mutation: mutation.mutation,
    occurredAt,
  });
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
  return responseForJson(200, { queue: serializeCycle(updated) }, input.request, input.policy);
}

function createRepository(
  environment: StagingWorkerEnv,
  factory: NonNullable<StagingWorkerDependencies["repositoryFactory"]>,
): ProfileQueueRepository {
  if (!environment.BASENOTE_STAGING_D1) {
    throw new StagingD1NotConfiguredError("The separately provisioned staging D1 binding is unavailable.");
  }
  return factory(environment.BASENOTE_STAGING_D1);
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
  if (error instanceof ProfileQueueRequestValidationError) {
    return genericResponse(400, "invalid_request", request, policy);
  }
  if (error instanceof SignedProxyRejectedError) {
    return genericResponse(401, "unauthorized", request, policy);
  }
  if (error instanceof ProfileQueueOwnershipDeniedError) {
    return genericResponse(403, "forbidden", request, policy);
  }
  if (
    error instanceof SignedProxyBoundaryNotConfiguredError
    || error instanceof ProfileQueueOwnershipNotConfiguredError
    || error instanceof StagingD1NotConfiguredError
  ) {
    return genericResponse(503, "staging_not_configured", request, policy);
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
    return genericResponse(409, "queue_conflict", request, policy);
  }
  // Never serialize database errors, request data, identity fields, or stack
  // traces. The Worker intentionally has no console logging for the same
  // reason: staging exports and customer data must not leak into observability.
  return genericResponse(503, "temporarily_unavailable", request, policy);
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

function defaultOpaqueId(prefix: "pqa" | "pqm"): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return `${prefix}_${Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
