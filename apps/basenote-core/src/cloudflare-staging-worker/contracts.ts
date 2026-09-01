import type { D1DatabasePort } from "../staging-runtime/d1.js";
import type { ProfileQueueRepository } from "../profile-queue/repository.js";
import type { StagingProfileQueueFormNonceRepository } from "./form-nonce.js";

/**
 * The only bindings the staging Worker is allowed to observe. This is a
 * structural type so unit tests cannot accidentally contact Cloudflare.
 */
export interface StagingWorkerEnv {
  readonly BASENOTE_RUNTIME_STAGE?: string;
  readonly BASENOTE_STAGING_D1?: D1DatabasePort;
  /** Runtime secret only; never place a value in Wrangler configuration or git. */
  readonly SHOPIFY_APP_PROXY_SHARED_SECRET?: string;
  /** Exact disposable development-store `*.myshopify.com` domain. */
  readonly STAGING_SHOP_DOMAIN?: string;
  /** Comma-separated exact Shopify variant GIDs eligible in disposable tests. */
  readonly STAGING_TEST_VARIANT_IDS?: string;
  /** Exact literal `true` enables bounded D1-only cutoff locking in staging. */
  readonly STAGING_CUTOFF_AUTOMATION_ENABLED?: string;
  readonly STAGING_ALLOWED_HOSTS?: string;
  readonly STAGING_ALLOWED_ORIGINS?: string;
}

/**
 * Identity returned only after the App Proxy verifier has checked the
 * complete signed request. Do not log or return either field to a client.
 */
export interface VerifiedSignedProxyIdentity {
  readonly shopDomain: string;
  readonly shopifyCustomerId: string;
  /** Signed storefront App Proxy root used for no-JavaScript form actions. */
  readonly storefrontPathPrefix: string;
}

/**
 * The default staging implementation verifies Shopify's raw App Proxy HMAC,
 * timestamp, exact shop, and logged-in customer using runtime-only config.
 */
export interface SignedProxyBoundary {
  verify(input: {
    readonly environment: StagingWorkerEnv;
    readonly request: Request;
  }): Promise<VerifiedSignedProxyIdentity>;
}

/**
 * Separates signed customer identity from contract ownership. The staging
 * resolver proves an exact seeded disposable cycle belongs to that customer
 * before returning a server-side binding.
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
  readonly createOpaqueId?: (prefix: "pqa" | "pqm" | "pqk" | "pqf" | "pqe") => string;
  /** Test-only injection; production defaults to a D1-backed nonce repository. */
  readonly formNonceRepository?: StagingProfileQueueFormNonceRepository;
  readonly now?: () => Date;
  readonly ownershipResolver?: ProfileQueueOwnershipResolver;
  readonly repositoryFactory?: (database: D1DatabasePort) => ProfileQueueRepository;
  readonly signedProxyBoundary?: SignedProxyBoundary;
}

/** Minimal shape used by Cloudflare and by the offline Node test suite. */
export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Minimal ScheduledEvent shape; it remains structural for offline tests. */
export interface WorkerScheduledEvent {
  readonly cron: string;
  readonly scheduledTime: number;
  waitUntil(promise: Promise<unknown>): void;
}

export interface StagingWorkerEntrypoint {
  fetch(
    request: Request,
    environment: StagingWorkerEnv,
    executionContext: WorkerExecutionContext,
  ): Response | Promise<Response>;
  scheduled(
    event: WorkerScheduledEvent,
    environment: StagingWorkerEnv,
    executionContext: WorkerExecutionContext,
  ): void | Promise<void>;
}
