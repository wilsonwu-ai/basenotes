import type { StagingWorkerEnv } from "./contracts.js";

export class StagingConfigurationError extends Error {
  override name = "StagingConfigurationError";
}

export interface StagingHttpPolicy {
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function createStagingHttpPolicy(environment: StagingWorkerEnv): StagingHttpPolicy {
  return {
    allowedHosts: new Set(parseAllowedHosts(environment.STAGING_ALLOWED_HOSTS)),
    allowedOrigins: new Set(parseAllowedOrigins(environment.STAGING_ALLOWED_ORIGINS)),
  };
}

export function isAllowedHost(request: Request, policy: StagingHttpPolicy): boolean {
  return policy.allowedHosts.has(new URL(request.url).hostname.toLowerCase());
}

export function isAllowedOrigin(request: Request, policy: StagingHttpPolicy): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  try {
    return policy.allowedOrigins.has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

export function responseForJson(
  status: number,
  body: Record<string, unknown>,
  request: Request,
  policy: StagingHttpPolicy,
): Response {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
  appendCorsHeaders(headers, request, policy);
  return new Response(JSON.stringify(body), { headers, status });
}

export function responseForEmptyPreflight(
  request: Request,
  policy: StagingHttpPolicy,
): Response {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "300",
  });
  appendCorsHeaders(headers, request, policy);
  return new Response(null, { headers, status: 204 });
}

function appendCorsHeaders(headers: Headers, request: Request, policy: StagingHttpPolicy): void {
  const origin = request.headers.get("Origin");
  if (origin === null) return;
  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeOrigin(origin);
  } catch {
    return;
  }
  if (!policy.allowedOrigins.has(normalizedOrigin)) return;
  headers.set("Access-Control-Allow-Origin", normalizedOrigin);
  headers.set("Vary", "Origin");
}

function parseAllowedHosts(value: string | undefined): readonly string[] {
  return parseCommaSeparated(value).map((candidate) => {
    const normalized = candidate.toLowerCase();
    const parsed = new URL(`https://${normalized}`);
    if (parsed.hostname !== normalized || parsed.pathname !== "/" || parsed.username || parsed.password) {
      throw new StagingConfigurationError("STAGING_ALLOWED_HOSTS contains an invalid host.");
    }
    assertStagingHostname(parsed.hostname);
    return parsed.hostname;
  });
}

function parseAllowedOrigins(value: string | undefined): readonly string[] {
  return parseCommaSeparated(value).map((candidate) => {
    const normalized = normalizeOrigin(candidate);
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost(parsed.hostname))) {
      throw new StagingConfigurationError("STAGING_ALLOWED_ORIGINS must use HTTPS outside localhost.");
    }
    assertStagingHostname(parsed.hostname);
    return normalized;
  });
}

function parseCommaSeparated(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const values = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (values.length === 0) return [];
  return values;
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.origin === "null" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new StagingConfigurationError("Origin entries must be exact origins without paths.");
  }
  return parsed.origin;
}

function assertStagingHostname(hostname: string): void {
  if (isLocalhost(hostname)) return;
  if (!hostname.split(".").some((label) => label.includes("staging"))) {
    throw new StagingConfigurationError("Only staging or localhost hosts may be configured.");
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}
