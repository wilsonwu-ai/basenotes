import {
  StagingAdminIdTokenNotConfiguredError,
  StagingAdminIdTokenRejectedError,
  StagingAdminStaffDeniedError,
} from "./boundaries.js";
import type {
  StagingAdminIdTokenBoundary,
  StagingWorkerEnv,
  VerifiedStagingAdminIdentity,
} from "./contracts.js";
import { asProfileQueueActorRef } from "../profile-queue/contracts.js";

const MAX_ID_TOKEN_LENGTH = 8 * 1_024;
const MAX_ID_TOKEN_LIFETIME_SECONDS = 90;
const MAX_FUTURE_SKEW_SECONDS = 30;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{5,255}$/;
const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
/** Deliberately fixed disposable shop; production-shaped env values fail closed. */
const APPROVED_STAGING_SHOP_DOMAIN = "base-note-subscription-staging.myshopify.com";
const STAFF_SUBJECT = /^[1-9]\d{0,18}$/;
// Shopify documents this as a secure UUID. Accept any RFC-shaped UUID rather
// than freezing the verifier to historical UUID versions (for example v7),
// while still rejecting arbitrary application-controlled text.
const TOKEN_JTI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ShopifyIdTokenHeader {
  readonly alg: string;
  readonly typ?: string;
}

interface ShopifyIdTokenClaims {
  readonly aud: string;
  readonly dest: string;
  readonly exp: number;
  readonly iat: number;
  readonly iss: string;
  readonly jti: string;
  readonly nbf: number;
  readonly sub: string;
}

export interface WebCryptoShopifyAdminIdTokenVerifierOptions {
  readonly nowSeconds?: () => number;
}

/**
 * Verifies the short-lived embedded Shopify Admin ID token entirely at the
 * Worker boundary. It deliberately does not exchange a token, call Shopify,
 * retain the bearer JWT, or infer authorization from shop access alone.
 */
export class WebCryptoShopifyAdminIdTokenVerifier implements StagingAdminIdTokenBoundary {
  private readonly nowSeconds: () => number;

  constructor(options: WebCryptoShopifyAdminIdTokenVerifierOptions = {}) {
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verify(input: {
    readonly environment: StagingWorkerEnv;
    readonly request: Request;
  }): Promise<VerifiedStagingAdminIdentity> {
    const configuration = readRuntimeConfiguration(input.environment);
    const token = readBearerToken(input.request.headers.get("Authorization"));
    const [encodedHeader, encodedPayload, encodedSignature] = splitToken(token);
    const header = decodeJson<ShopifyIdTokenHeader>(encodedHeader);
    const claims = decodeJson<ShopifyIdTokenClaims>(encodedPayload);
    assertHeader(header);
    const signatureValid = await verifyHs256({
      encodedHeader,
      encodedPayload,
      encodedSignature,
      secret: configuration.clientSecret,
    });
    if (!signatureValid) throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token signature is invalid.");

    const nowSeconds = readNowSeconds(this.nowSeconds());
    const validated = validateClaims(claims, configuration, nowSeconds);
    if (!configuration.allowedStaffIds.has(validated.staffId)) {
      throw new StagingAdminStaffDeniedError("The Shopify Admin staff identity is not allowlisted for staging.");
    }
    return {
      actorRef: asProfileQueueActorRef(`staff_${validated.staffId}`),
    };
  }
}

/**
 * Validates the same staging-only configuration before returning the one
 * public value an embedded App Bridge bootstrap may render. The app secret and
 * staff allowlist never leave this Worker boundary.
 */
export function readStagingAdminEmbedShellConfiguration(environment: StagingWorkerEnv): {
  readonly clientId: string;
  readonly shopDomain: string;
} {
  const configuration = readRuntimeConfiguration(environment);
  return { clientId: configuration.clientId, shopDomain: configuration.expectedShopDomain };
}

function readRuntimeConfiguration(environment: StagingWorkerEnv): {
  readonly allowedStaffIds: ReadonlySet<string>;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly expectedShopDomain: string;
} {
  if (environment.BASENOTE_RUNTIME_STAGE !== "staging") {
    throw new StagingAdminIdTokenNotConfiguredError("Shopify Admin ID-token verification is staging-only.");
  }
  const clientId = environment.SHOPIFY_ADMIN_CLIENT_ID;
  if (!clientId || !CLIENT_ID.test(clientId) || isPlaceholder(clientId)) {
    throw new StagingAdminIdTokenNotConfiguredError("The Shopify Admin client ID is not configured safely.");
  }
  const clientSecret = environment.SHOPIFY_ADMIN_CLIENT_SECRET;
  if (!clientSecret || !clientSecret.trim() || isPlaceholder(clientSecret)) {
    throw new StagingAdminIdTokenNotConfiguredError("The Shopify Admin client secret is not configured safely.");
  }
  const expectedShopDomain = environment.STAGING_SHOP_DOMAIN;
  if (
    !expectedShopDomain
    || !SHOP_DOMAIN.test(expectedShopDomain)
    || isPlaceholder(expectedShopDomain)
    || expectedShopDomain !== APPROVED_STAGING_SHOP_DOMAIN
  ) {
    throw new StagingAdminIdTokenNotConfiguredError("The exact staging shop domain is not configured safely.");
  }
  return {
    allowedStaffIds: parseAllowedStaffIds(environment.STAGING_ADMIN_ALLOWED_STAFF_IDS),
    clientId,
    clientSecret,
    expectedShopDomain,
  };
}

function parseAllowedStaffIds(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim() || isPlaceholder(value)) {
    throw new StagingAdminIdTokenNotConfiguredError("At least one exact staging staff ID must be allowlisted.");
  }
  const values = value.split(",").map((entry) => entry.trim());
  if (values.some((entry) => !STAFF_SUBJECT.test(entry))) {
    throw new StagingAdminIdTokenNotConfiguredError("Staging staff allowlist entries must be opaque Shopify numeric subject IDs.");
  }
  const allowed = new Set(values);
  if (allowed.size !== values.length) {
    throw new StagingAdminIdTokenNotConfiguredError("Staging staff allowlist entries must not repeat.");
  }
  return allowed;
}

function isPlaceholder(value: string): boolean {
  return value.trim().toUpperCase().startsWith("REPLACE_");
}

function readBearerToken(value: string | null): string {
  const match = value?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!match?.[1] || match[1].length > MAX_ID_TOKEN_LENGTH) {
    throw new StagingAdminIdTokenRejectedError("A Shopify Admin bearer ID token is required.");
  }
  return match[1];
}

function splitToken(token: string): readonly [string, string, string] {
  const parts = token.split(".");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    parts.length !== 3
    || !encodedHeader
    || !encodedPayload
    || !encodedSignature
    || !BASE64URL.test(encodedHeader)
    || !BASE64URL.test(encodedPayload)
    || !BASE64URL.test(encodedSignature)
  ) {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token is malformed.");
  }
  return [encodedHeader, encodedPayload, encodedSignature];
}

function decodeJson<T>(encoded: string): T {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded));
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as T;
  } catch {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token payload is malformed.");
  }
}

function assertHeader(header: ShopifyIdTokenHeader): void {
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token algorithm is invalid.");
  }
}

function validateClaims(
  claims: ShopifyIdTokenClaims,
  configuration: {
    readonly clientId: string;
    readonly expectedShopDomain: string;
  },
  nowSeconds: number,
): { readonly staffId: string } {
  if (claims.aud !== configuration.clientId || !STAFF_SUBJECT.test(claims.sub) || !TOKEN_JTI.test(claims.jti)) {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token claims are invalid.");
  }
  const exp = readUnixSeconds(claims.exp, "exp");
  const nbf = readUnixSeconds(claims.nbf, "nbf");
  const iat = readUnixSeconds(claims.iat, "iat");
  if (
    exp <= nowSeconds
    || nbf > nowSeconds
    || iat > nowSeconds + MAX_FUTURE_SKEW_SECONDS
    || iat < nbf
    || exp <= iat
    || exp - iat > MAX_ID_TOKEN_LIFETIME_SECONDS
  ) {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token is not fresh.");
  }
  assertShopClaims(claims.iss, claims.dest, configuration.expectedShopDomain);
  return { staffId: claims.sub };
}

function readUnixSeconds(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StagingAdminIdTokenRejectedError(`The Shopify Admin ID token ${name} claim is invalid.`);
  }
  const date = new Date(value * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new StagingAdminIdTokenRejectedError(`The Shopify Admin ID token ${name} claim is invalid.`);
  }
  return value;
}

function readNowSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StagingAdminIdTokenNotConfiguredError("The staging Admin verifier clock is not configured safely.");
  }
  return value;
}

function assertShopClaims(issuerValue: string, destinationValue: string, expectedShopDomain: string): void {
  try {
    const issuer = new URL(issuerValue);
    const destination = new URL(destinationValue);
    if (
      issuer.protocol !== "https:"
      || destination.protocol !== "https:"
      || issuer.port !== ""
      || destination.port !== ""
      || issuer.hostname !== destination.hostname
      || issuer.hostname !== expectedShopDomain
      || issuer.pathname !== "/admin"
      || destination.pathname !== "/"
      || issuer.search
      || issuer.hash
      || destination.search
      || destination.hash
      || issuer.username
      || issuer.password
      || destination.username
      || destination.password
    ) {
      throw new Error("invalid shop claim");
    }
  } catch {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token is for another shop.");
  }
}

async function verifyHs256(input: {
  readonly encodedHeader: string;
  readonly encodedPayload: string;
  readonly encodedSignature: string;
  readonly secret: string;
}): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(input.encodedSignature).buffer as ArrayBuffer,
    new TextEncoder().encode(`${input.encodedHeader}.${input.encodedPayload}`),
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64URL.test(value) || value.length % 4 === 1) {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token is malformed.");
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  try {
    const decoded = atob(padded);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch {
    throw new StagingAdminIdTokenRejectedError("The Shopify Admin ID token is malformed.");
  }
}
