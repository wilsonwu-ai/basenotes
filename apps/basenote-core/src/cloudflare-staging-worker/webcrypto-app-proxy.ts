import {
  SignedProxyBoundaryNotConfiguredError,
  SignedProxyRejectedError,
} from "./boundaries.js";
import type {
  SignedProxyBoundary,
  StagingWorkerEnv,
  VerifiedSignedProxyIdentity,
} from "./contracts.js";
import { isHttpsRequest } from "./http.js";

const DEFAULT_MAX_AGE_SECONDS = 5 * 60;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_QUERY_LENGTH = 16 * 1024;
const MAX_PARAMETER_COUNT = 100;

const SHOP_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const CUSTOMER_ID = /^[1-9]\d*$/;
const UNIX_TIMESTAMP = /^[1-9]\d*$/;
const SHA256_HEX = /^[a-fA-F0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export interface WebCryptoShopifyAppProxyVerifierOptions {
  readonly maxAgeSeconds?: number;
  readonly maxFutureSkewSeconds?: number;
  readonly nowSeconds?: () => number;
}

interface ParsedParameter {
  readonly key: string;
  readonly rawKey: string;
  readonly rawValue: string;
  readonly value: string;
}

/**
 * Cloudflare-Worker-safe implementation of Shopify App Proxy HMAC validation.
 * It uses only Web Crypto and reads the exact raw query string; no Node crypto,
 * OAuth, Admin API, token, cookie, or browser-supplied identity is involved.
 */
export class WebCryptoShopifyAppProxyVerifier implements SignedProxyBoundary {
  private readonly maxAgeSeconds: number;
  private readonly maxFutureSkewSeconds: number;
  private readonly nowSeconds: () => number;

  constructor(options: WebCryptoShopifyAppProxyVerifierOptions = {}) {
    this.maxAgeSeconds = readNonNegativeInteger(options.maxAgeSeconds, DEFAULT_MAX_AGE_SECONDS);
    this.maxFutureSkewSeconds = readNonNegativeInteger(
      options.maxFutureSkewSeconds,
      DEFAULT_MAX_FUTURE_SKEW_SECONDS,
    );
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  async verify(input: {
    readonly environment: StagingWorkerEnv;
    readonly request: Request;
  }): Promise<VerifiedSignedProxyIdentity> {
    const configuration = readRuntimeConfiguration(input.environment);
    if (!isHttpsRequest(input.request)) {
      throw new SignedProxyRejectedError("Signed App Proxy requests must use HTTPS.");
    }

    const parameters = parseRawQuery(rawQueryFromRequestUrl(input.request.url));
    const signature = extractSignature(parameters);
    const signedParameters = parameters.filter((parameter) => parameter.key !== "signature");
    const verified = await verifySignature({
      canonicalMessage: canonicalize(signedParameters),
      secret: configuration.sharedSecret,
      signature,
    });
    if (!verified) {
      throw new SignedProxyRejectedError("The App Proxy signature is invalid.");
    }

    const byKey = groupByKey(signedParameters);
    const shopDomain = readShopDomain(readRequiredSingleValue(byKey, "shop"));
    if (shopDomain !== configuration.expectedShopDomain) {
      throw new SignedProxyRejectedError("The App Proxy request is for another shop.");
    }

    const timestamp = readTimestamp(readRequiredSingleValue(byKey, "timestamp"));
    const nowSeconds = this.nowSeconds();
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new SignedProxyBoundaryNotConfiguredError("The staging verifier clock is not configured safely.");
    }
    if (timestamp > nowSeconds + this.maxFutureSkewSeconds || nowSeconds - timestamp > this.maxAgeSeconds) {
      throw new SignedProxyRejectedError("The App Proxy timestamp is outside its accepted window.");
    }

    // Shopify adds this field to an App Proxy request. It is not compared to a
    // fixed value because storefront prefix/subpath can be merchant-customized.
    const storefrontPathPrefix = readStorefrontPathPrefix(readRequiredSingleValue(byKey, "path_prefix"));
    const shopifyCustomerId = readRequiredSingleValue(byKey, "logged_in_customer_id");
    if (!CUSTOMER_ID.test(shopifyCustomerId)) {
      throw new SignedProxyRejectedError("The App Proxy request requires a logged-in customer.");
    }
    return { shopDomain, shopifyCustomerId, storefrontPathPrefix };
  }
}

function readRuntimeConfiguration(environment: StagingWorkerEnv): {
  readonly expectedShopDomain: string;
  readonly sharedSecret: string;
} {
  if (environment.BASENOTE_RUNTIME_STAGE !== "staging") {
    throw new SignedProxyBoundaryNotConfiguredError("The App Proxy verifier is staging-only.");
  }
  const sharedSecret = environment.SHOPIFY_APP_PROXY_SHARED_SECRET;
  if (!sharedSecret || !sharedSecret.trim() || isPlaceholder(sharedSecret)) {
    throw new SignedProxyBoundaryNotConfiguredError("The App Proxy runtime secret is not configured.");
  }
  const expectedShopDomain = environment.STAGING_SHOP_DOMAIN;
  if (!expectedShopDomain || isPlaceholder(expectedShopDomain) || !SHOP_DOMAIN.test(expectedShopDomain)) {
    throw new SignedProxyBoundaryNotConfiguredError("The exact staging shop domain is not configured.");
  }
  return { expectedShopDomain, sharedSecret };
}

function isPlaceholder(value: string): boolean {
  return value.trim().toUpperCase().startsWith("REPLACE_");
}

function rawQueryFromRequestUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) {
    throw new SignedProxyRejectedError("The App Proxy query string is missing.");
  }
  const fragmentStart = url.indexOf("#", queryStart);
  return fragmentStart === -1 ? url.slice(queryStart + 1) : url.slice(queryStart + 1, fragmentStart);
}

function parseRawQuery(rawQuery: string): ParsedParameter[] {
  if (!rawQuery || rawQuery.length > MAX_QUERY_LENGTH || rawQuery.includes("#")) {
    throw new SignedProxyRejectedError("The App Proxy query string is invalid.");
  }
  const segments = rawQuery.split("&");
  if (segments.length > MAX_PARAMETER_COUNT || segments.some((segment) => segment.length === 0)) {
    throw new SignedProxyRejectedError("The App Proxy query string is invalid.");
  }
  return segments.map((segment) => {
    const separator = segment.indexOf("=");
    const rawKey = separator === -1 ? segment : segment.slice(0, separator);
    const rawValue = separator === -1 ? "" : segment.slice(separator + 1);
    const key = decodeFormComponent(rawKey);
    const value = decodeFormComponent(rawValue);
    if (!key || CONTROL_CHARACTER.test(key) || CONTROL_CHARACTER.test(value)) {
      throw new SignedProxyRejectedError("The App Proxy query string is invalid.");
    }
    return { key, rawKey, rawValue, value };
  });
}

function decodeFormComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    throw new SignedProxyRejectedError("The App Proxy query string is invalid.");
  }
}

function extractSignature(parameters: readonly ParsedParameter[]): string {
  const signatures = parameters.filter((parameter) => parameter.key === "signature");
  if (signatures.length !== 1) {
    throw new SignedProxyRejectedError("The App Proxy signature is invalid.");
  }
  const signature = signatures[0];
  if (
    !signature
    || signature.rawKey !== "signature"
    || signature.rawValue !== signature.value
    || !SHA256_HEX.test(signature.value)
  ) {
    throw new SignedProxyRejectedError("The App Proxy signature is invalid.");
  }
  return signature.value;
}

function canonicalize(parameters: readonly ParsedParameter[]): string {
  const grouped = groupByKey(parameters);
  return [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .sort()
    .join("");
}

function groupByKey(parameters: readonly ParsedParameter[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const parameter of parameters) {
    const values = grouped.get(parameter.key);
    if (values) values.push(parameter.value);
    else grouped.set(parameter.key, [parameter.value]);
  }
  return grouped;
}

function readRequiredSingleValue(byKey: ReadonlyMap<string, readonly string[]>, key: string): string {
  const values = byKey.get(key);
  if (!values || values.length !== 1 || values[0] === undefined) {
    throw new SignedProxyRejectedError("The App Proxy identity is invalid.");
  }
  return values[0];
}

function readShopDomain(value: string): string {
  if (!SHOP_DOMAIN.test(value)) {
    throw new SignedProxyRejectedError("The App Proxy shop is invalid.");
  }
  return value;
}

function readTimestamp(value: string): number {
  if (!UNIX_TIMESTAMP.test(value)) {
    throw new SignedProxyRejectedError("The App Proxy timestamp is invalid.");
  }
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp)) {
    throw new SignedProxyRejectedError("The App Proxy timestamp is invalid.");
  }
  return timestamp;
}

function readStorefrontPathPrefix(value: string): string {
  // Shopify signs this field and allows merchants to customize the storefront
  // prefix/subpath. Keep it path-only before embedding it in a form action.
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) || CONTROL_CHARACTER.test(value)) {
    throw new SignedProxyRejectedError("The App Proxy path prefix is invalid.");
  }
  return value;
}

function readNonNegativeInteger(value: number | undefined, fallback: number): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error("Verifier timing limits must be non-negative safe integers.");
  }
  return normalized;
}

async function verifySignature(input: {
  readonly canonicalMessage: string;
  readonly secret: string;
  readonly signature: string;
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
    hexToArrayBuffer(input.signature),
    new TextEncoder().encode(input.canonicalMessage),
  );
}

function hexToArrayBuffer(value: string): ArrayBuffer {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16);
    if (!Number.isSafeInteger(byte)) {
      throw new SignedProxyRejectedError("The App Proxy signature is invalid.");
    }
    bytes[index / 2] = byte;
  }
  // `bytes` is allocated locally, so its backing store cannot be a shared
  // buffer. The explicit type narrows newer TypeScript's generic view type to
  // the exact `ArrayBuffer` required by Web Crypto's BufferSource overload.
  return bytes.buffer as ArrayBuffer;
}
