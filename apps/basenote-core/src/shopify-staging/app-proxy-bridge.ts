import {
  AppProxyVerificationError,
  verifyAppProxyRequest,
} from "../auth/app-proxy.js";

const STAGING_PROFILE_QUEUE_PATH = "/profile-queue";

export interface StagingAppProxyBridgeInput {
  /** Request path relative to the configured App Proxy root. */
  readonly relativePath: string;
  /** Raw query string as received from Shopify, including its signature. */
  readonly rawQuery: string;
  /** Secret-manager supplied app-proxy secret. */
  readonly appProxySharedSecret: string;
  /** Exact Shopify development-store permanent domain, not browser input. */
  readonly expectedStagingShop: string;
  /** Server clock injection for deterministic test coverage. */
  readonly nowSeconds?: number;
}

export interface StagingAppProxyBridgeResponse {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: 200 | 401 | 404;
}

/**
 * A no-write staging bridge for the Profile Queue mount.
 *
 * It verifies Shopify's signed App Proxy query, requires a logged-in customer,
 * and returns only static preview markup. It imports no HTTP, database,
 * Shopify Admin, Appstle, messaging, or browser APIs, so it cannot contact or
 * alter any production system. A future authenticated queue route must be a
 * separate adapter with its own threat model and staging approval.
 */
export function handleStagingProfileQueueProxy(
  input: StagingAppProxyBridgeInput,
): StagingAppProxyBridgeResponse {
  if (input.relativePath !== STAGING_PROFILE_QUEUE_PATH) return notFound();

  try {
    verifyAppProxyRequest({
      expectedShop: input.expectedStagingShop,
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 30,
      nowSeconds: input.nowSeconds,
      rawQuery: input.rawQuery,
      requireLoggedInCustomer: true,
      sharedSecret: input.appProxySharedSecret,
    });
  } catch (error) {
    if (error instanceof AppProxyVerificationError) return unauthorized();
    throw error;
  }

  return {
    body: staticProfileQueuePreview(),
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  };
}

function staticProfileQueuePreview(): string {
  return [
    '<section class="bn-profile-queue" data-basenote-staging-queue="static-preview">',
    "<h2>Profile Queue</h2>",
    "<p>This is a staging-only preview. No fragrances, customer details, or subscription changes are loaded or saved.</p>",
    "<p>After the durable queue route is separately approved, this surface will show one automatic FOTM and up to four $18.00 add-ons.</p>",
    "</section>",
  ].join("");
}

function unauthorized(): StagingAppProxyBridgeResponse {
  return {
    body: "Unauthorized",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    status: 401,
  };
}

function notFound(): StagingAppProxyBridgeResponse {
  return {
    body: "Not found",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    status: 404,
  };
}
