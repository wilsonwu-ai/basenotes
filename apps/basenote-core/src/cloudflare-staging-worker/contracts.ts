import type { D1DatabasePort } from "../staging-runtime/d1.js";
import type { ProfileQueueRepository } from "../profile-queue/repository.js";

/**
 * The only bindings the staging Worker is allowed to observe. This is a
 * structural type so unit tests cannot accidentally contact Cloudflare.
 */
export interface StagingWorkerEnv {
  readonly BASENOTE_RUNTIME_STAGE?: string;
  readonly BASENOTE_STAGING_D1?: D1DatabasePort;
  readonly STAGING_ALLOWED_HOSTS?: string;
  readonly STAGING_ALLOWED_ORIGINS?: string;
}

/**
 * Identity returned only after a future App Proxy verifier has checked the
 * complete signed request. Do not log or return either field to a client.
 */
export interface VerifiedSignedProxyIdentity {
  readonly shopDomain: string;
  readonly shopifyCustomerId: string;
}

/**
 * This boundary deliberately has no default implementation that accepts a
 * request. A future implementation must verify Shopify's raw App Proxy HMAC,
 * timestamp, shop, and logged-in customer before returning an identity.
 */
export interface SignedProxyBoundary {
  verify(input: {
    readonly environment: StagingWorkerEnv;
    readonly request: Request;
  }): Promise<VerifiedSignedProxyIdentity>;
}

/**
 * Separates signed customer identity from contract ownership. A future
 * resolver must prove that the requested exact cycle is owned by that customer
 * and is eligible for editing before it returns a server-side binding.
 */
export interface ProfileQueueOwnershipResolver {
  resolve(input: {
    readonly cycleKey: string;
    readonly identity: VerifiedSignedProxyIdentity;
    readonly shipMonth: string;
  }): Promise<AuthorizedProfileQueueBinding>;
}

export interface AuthorizedProfileQueueBinding {
  /** Opaque audit actor reference; never an email address or display name. */
  readonly actorRef: string;
  /** Exact server-resolved contract binding; never supplied by the browser. */
  readonly bindingId: string;
}

export interface StagingWorkerDependencies {
  readonly createOpaqueId?: (prefix: "pqa" | "pqm") => string;
  readonly now?: () => Date;
  readonly ownershipResolver?: ProfileQueueOwnershipResolver;
  readonly repositoryFactory?: (database: D1DatabasePort) => ProfileQueueRepository;
  readonly signedProxyBoundary?: SignedProxyBoundary;
}

/** Minimal shape used by Cloudflare and by the offline Node test suite. */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface StagingWorkerEntrypoint {
  fetch(
    request: Request,
    environment: StagingWorkerEnv,
    executionContext: WorkerExecutionContext,
  ): Response | Promise<Response>;
}
