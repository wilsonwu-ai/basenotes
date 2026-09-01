import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_QUERY_LENGTH = 16 * 1024;
const DEFAULT_MAX_PARAMETER_COUNT = 100;
const DEFAULT_MAX_AGE_SECONDS = 5 * 60;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 30;

const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const CUSTOMER_ID = /^[1-9]\d*$/;
const UNIX_TIMESTAMP = /^[1-9]\d*$/;
const SHA256_HEX = /^[a-fA-F0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export type AppProxyVerificationErrorCode =
  | "invalid_input"
  | "malformed_query"
  | "missing_signature"
  | "malformed_signature"
  | "invalid_signature"
  | "missing_identity"
  | "malformed_identity"
  | "stale_timestamp"
  | "future_timestamp"
  | "shop_mismatch"
  | "unauthenticated_customer";

/**
 * A deliberately narrow error type for app-proxy authentication failures.
 *
 * Route handlers should map every one of these errors to a generic 401/403
 * response. Do not return the reason or any parsed query data to a client.
 */
export class AppProxyVerificationError extends Error {
  override name = "AppProxyVerificationError";

  constructor(
    readonly code: AppProxyVerificationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ShopifyShopDomain = `${string}.myshopify.com`;

export interface VerifiedAppProxyCustomer {
  /** The numeric customer ID supplied by Shopify's signed app-proxy request. */
  readonly shopifyCustomerId: string;
}

export interface VerifiedAppProxyRequest {
  /** A validated `*.myshopify.com` domain from the signed request. */
  readonly shop: ShopifyShopDomain;
  /** Unix time in seconds supplied by Shopify's signed request. */
  readonly timestamp: number;
  /** Null only when Shopify says no storefront customer is logged in. */
  readonly customer: VerifiedAppProxyCustomer | null;
}

export interface VerifyAppProxyRequestInput {
  /** `request.url`'s raw query string, with or without its leading `?`. */
  readonly rawQuery: string;
  /** The app-proxy shared secret supplied at runtime, never browser input. */
  readonly sharedSecret: string;
  /**
   * Bind a route to its intended shop when the deployment is single-tenant.
   * This is optional because a future multi-store deployment can look up the
   * known shop only after signature verification.
   */
  readonly expectedShop?: string;
  /** Defaults to the current Unix time in seconds. Injectable for tests. */
  readonly nowSeconds?: number;
  /** Reject a request older than this many seconds. Defaults to five minutes. */
  readonly maxAgeSeconds?: number;
  /** Reject a timestamp this far ahead of `nowSeconds`. Defaults to 30 seconds. */
  readonly maxFutureSkewSeconds?: number;
  /** Require Shopify to attest that a storefront customer is logged in. */
  readonly requireLoggedInCustomer?: boolean;
}

interface ParsedParameter {
  readonly key: string;
  readonly rawKey: string;
  readonly rawValue: string;
  readonly value: string;
}

/**
 * Verifies a Shopify app-proxy request without trusting any identity field until
 * its signature has been checked. The canonicalization follows Shopify's
 * documented app-proxy format: group duplicate values by decoded key, join each
 * group's values with commas, sort `key=value` entries, then concatenate them
 * without separators before calculating the SHA-256 HMAC.
 */
export function verifyAppProxyRequest(
  input: VerifyAppProxyRequestInput,
): VerifiedAppProxyRequest {
  assertInput(input);

  const maxAgeSeconds = readNonNegativeInteger(
    input.maxAgeSeconds,
    DEFAULT_MAX_AGE_SECONDS,
    "maxAgeSeconds",
  );
  const maxFutureSkewSeconds = readNonNegativeInteger(
    input.maxFutureSkewSeconds,
    DEFAULT_MAX_FUTURE_SKEW_SECONDS,
    "maxFutureSkewSeconds",
  );
  const nowSeconds = readNonNegativeInteger(
    input.nowSeconds,
    Math.floor(Date.now() / 1000),
    "nowSeconds",
  );

  const parameters = parseRawQuery(input.rawQuery);
  const signature = extractSignature(parameters);
  const signedParameters = parameters.filter((parameter) => parameter.key !== "signature");

  const expectedDigest = createHmac("sha256", input.sharedSecret)
    .update(canonicalize(signedParameters), "utf8")
    .digest();
  const actualDigest = Buffer.from(signature, "hex");

  // `signature` is validated as exactly 64 hex characters above, so both
  // buffers are SHA-256 length before invoking the constant-time comparison.
  if (!timingSafeEqual(expectedDigest, actualDigest)) {
    throw new AppProxyVerificationError("invalid_signature", "The app-proxy signature is invalid.");
  }

  // Identity is intentionally derived only after the HMAC has been verified.
  const byKey = groupByKey(signedParameters);
  const shop = readShopDomain(readRequiredSingleValue(byKey, "shop"));
  const timestamp = readTimestamp(readRequiredSingleValue(byKey, "timestamp"));
  const customerValue = readRequiredSingleValue(byKey, "logged_in_customer_id");

  if (timestamp > nowSeconds + maxFutureSkewSeconds) {
    throw new AppProxyVerificationError("future_timestamp", "The app-proxy timestamp is too far ahead.");
  }
  if (nowSeconds - timestamp > maxAgeSeconds) {
    throw new AppProxyVerificationError("stale_timestamp", "The app-proxy timestamp is stale.");
  }

  if (input.expectedShop !== undefined && shop !== readShopDomain(input.expectedShop)) {
    throw new AppProxyVerificationError("shop_mismatch", "The app-proxy request is for another shop.");
  }

  const customer = deriveCustomerIdentity(customerValue);
  if (input.requireLoggedInCustomer && customer === null) {
    throw new AppProxyVerificationError(
      "unauthenticated_customer",
      "This app-proxy route requires a logged-in customer.",
    );
  }

  return { customer, shop, timestamp };
}

function assertInput(input: VerifyAppProxyRequestInput): void {
  if (typeof input.rawQuery !== "string" || typeof input.sharedSecret !== "string") {
    throw new AppProxyVerificationError("invalid_input", "App-proxy input must contain strings.");
  }
  if (input.sharedSecret.length === 0) {
    throw new AppProxyVerificationError("invalid_input", "An app-proxy shared secret is required.");
  }
}

function parseRawQuery(rawQuery: string): ParsedParameter[] {
  const query = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  if (query.length === 0) {
    throw new AppProxyVerificationError("malformed_query", "The app-proxy query string is empty.");
  }
  if (query.length > DEFAULT_MAX_QUERY_LENGTH || query.includes("#")) {
    throw new AppProxyVerificationError("malformed_query", "The app-proxy query string is malformed.");
  }

  const segments = query.split("&");
  if (segments.length > DEFAULT_MAX_PARAMETER_COUNT || segments.some((segment) => segment.length === 0)) {
    throw new AppProxyVerificationError("malformed_query", "The app-proxy query string is malformed.");
  }

  return segments.map((segment) => {
    const separator = segment.indexOf("=");
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? "" : segment.slice(separator + 1);
    const key = decodeFormComponent(rawKey);
    const value = decodeFormComponent(rawValue);

    if (key.length === 0 || CONTROL_CHARACTER.test(key) || CONTROL_CHARACTER.test(value)) {
      throw new AppProxyVerificationError("malformed_query", "The app-proxy query string is malformed.");
    }

    return { key, rawKey, rawValue, value };
  });
}

function decodeFormComponent(component: string): string {
  try {
    return decodeURIComponent(component.replace(/\+/g, " "));
  } catch {
    throw new AppProxyVerificationError("malformed_query", "The app-proxy query string is malformed.");
  }
}

function extractSignature(parameters: readonly ParsedParameter[]): string {
  const signatures = parameters.filter((parameter) => parameter.key === "signature");
  if (signatures.length === 0) {
    throw new AppProxyVerificationError("missing_signature", "The app-proxy signature is missing.");
  }
  if (signatures.length !== 1) {
    throw new AppProxyVerificationError("malformed_signature", "The app-proxy signature is ambiguous.");
  }

  const signature = signatures[0];
  if (
    signature === undefined ||
    signature.rawKey !== "signature" ||
    signature.rawValue !== signature.value ||
    !SHA256_HEX.test(signature.value)
  ) {
    throw new AppProxyVerificationError("malformed_signature", "The app-proxy signature is malformed.");
  }

  return signature.value;
}

function canonicalize(parameters: readonly ParsedParameter[]): string {
  const byKey = groupByKey(parameters);
  return [...byKey.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}

function groupByKey(parameters: readonly ParsedParameter[]): ReadonlyMap<string, readonly string[]> {
  const valuesByKey = new Map<string, string[]>();
  for (const parameter of parameters) {
    const values = valuesByKey.get(parameter.key);
    if (values === undefined) {
      valuesByKey.set(parameter.key, [parameter.value]);
    } else {
      values.push(parameter.value);
    }
  }
  return valuesByKey;
}

function readRequiredSingleValue(
  byKey: ReadonlyMap<string, readonly string[]>,
  key: string,
): string {
  const values = byKey.get(key);
  if (values === undefined || values.length === 0) {
    throw new AppProxyVerificationError("missing_identity", `The required ${key} parameter is missing.`);
  }
  if (values.length !== 1) {
    throw new AppProxyVerificationError("malformed_identity", `The ${key} parameter is ambiguous.`);
  }

  const value = values[0];
  if (value === undefined) {
    throw new AppProxyVerificationError("missing_identity", `The required ${key} parameter is missing.`);
  }
  return value;
}

function readShopDomain(value: string): ShopifyShopDomain {
  if (!SHOP_DOMAIN.test(value)) {
    throw new AppProxyVerificationError("malformed_identity", "The app-proxy shop is invalid.");
  }
  return value as ShopifyShopDomain;
}

function readTimestamp(value: string): number {
  if (!UNIX_TIMESTAMP.test(value)) {
    throw new AppProxyVerificationError("malformed_identity", "The app-proxy timestamp is invalid.");
  }

  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp)) {
    throw new AppProxyVerificationError("malformed_identity", "The app-proxy timestamp is invalid.");
  }
  return timestamp;
}

function deriveCustomerIdentity(value: string): VerifiedAppProxyCustomer | null {
  if (value.length === 0) return null;
  if (!CUSTOMER_ID.test(value)) {
    throw new AppProxyVerificationError(
      "malformed_identity",
      "The app-proxy logged-in customer ID is invalid.",
    );
  }
  return { shopifyCustomerId: value };
}

function readNonNegativeInteger(
  value: number | undefined,
  defaultValue: number,
  name: string,
): number {
  const resolved = value ?? defaultValue;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new AppProxyVerificationError("invalid_input", `${name} must be a non-negative integer.`);
  }
  return resolved;
}
