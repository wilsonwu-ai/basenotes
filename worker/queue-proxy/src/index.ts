/**
 * Base Note — Queue Proxy Worker
 * --------------------------------
 * Cloudflare Worker that backs the customer-queue persistence layer + the
 * subscription-sync bridge into Appstle (PRD 2026-05-11).
 *
 * Mounted via Shopify App Proxy at /apps/basenote/* on the storefront.
 *
 * Routes (App Proxy verifies signature on every call):
 *   GET  /apps/basenote/queue              → { queue }
 *   POST /apps/basenote/queue              → write queue
 *   POST /apps/basenote/sync-subscription  → swap Appstle contract line item
 *                                             to the variant in body { variantId }
 *
 * Env (configured via `wrangler secret put` — never check secrets into the repo):
 *   SHOPIFY_APP_PROXY_SECRET   – shared secret from the Shopify private app's App Proxy config
 *   SHOPIFY_ADMIN_TOKEN        – Admin API access token (custom app, scopes: read_customers + write_customers)
 *   SHOPIFY_SHOP               – e.g. "base-note.myshopify.com" (in [vars])
 *   APPSTLE_API_KEY            – Appstle Admin API key (Configurations → API)
 *   APPSTLE_API_BASE           – e.g. https://subscription-admin.appstle.com/api/external/v2
 */

interface Env {
  SHOPIFY_APP_PROXY_SECRET: string;
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_SHOP: string;
  APPSTLE_API_KEY: string;
  APPSTLE_API_BASE: string;
}

const ADMIN_API_VERSION = "2025-01";
const METAFIELD_NAMESPACE = "basenote";
const METAFIELD_KEY = "queue";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // 1. Verify the App Proxy signature
    const valid = await verifyShopifyProxySignature(url, env.SHOPIFY_APP_PROXY_SECRET);
    if (!valid) {
      return json({ error: "invalid_signature" }, 401);
    }

    // 2. App Proxy injects logged_in_customer_id when the customer is authenticated
    const customerId = url.searchParams.get("logged_in_customer_id");
    if (!customerId) {
      return json({ error: "not_logged_in" }, 401);
    }

    // 3. Route
    // App Proxy strips its mount prefix before forwarding, so the path we see
    // is the part AFTER /apps/basenote (e.g. /queue, /sync-subscription).
    // Some Shopify proxy configs forward the full path — handle both shapes.
    const path = normalizePath(url.pathname);
    try {
      if (path === "/queue" || path === "" || path === "/") {
        if (request.method === "GET") {
          const queue = await readQueue(env, customerId);
          return json({ queue });
        }
        if (request.method === "POST" || request.method === "PUT") {
          const body = await safeJson(request);
          if (!body || !Array.isArray((body as QueueBody).queue)) {
            return json({ error: "bad_body" }, 400);
          }
          const sanitized = sanitizeQueue((body as QueueBody).queue!);
          await writeQueue(env, customerId, sanitized);
          return json({ ok: true, queue: sanitized });
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      if (path === "/sync-subscription") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const body = await safeJson(request);
        const variantId = body && (body as SyncBody).variantId;
        if (!variantId) return json({ error: "bad_body", detail: "variantId required" }, 400);
        const result = await syncSubscription(env, customerId, String(variantId));
        return json(result, result.ok ? 200 : 502);
      }

      return json({ error: "not_found", path }, 404);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown";
      return json({ error: "server_error", detail: message }, 500);
    }
  },
};

function normalizePath(p: string): string {
  // Strip the App Proxy mount prefix if Shopify forwards the full path.
  // Accepts: /apps/basenote/queue, /queue, /apps/basenote/sync-subscription, etc.
  return p.replace(/^\/apps\/basenote/, "") || "/";
}

interface QueueBody { queue?: unknown[] }
interface SyncBody { variantId?: unknown }

// ─────────────────────────────────────────────────────────────────────
// Shopify App Proxy signature verification
// Docs: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#calculate-a-digital-signature
// ─────────────────────────────────────────────────────────────────────
async function verifyShopifyProxySignature(url: URL, secret: string): Promise<boolean> {
  const params = new URLSearchParams(url.search);
  const signature = params.get("signature");
  if (!signature) return false;
  params.delete("signature");

  // Sort params alphabetically and concatenate as `key=value` (no separators)
  const sortedKeys = [...params.keys()].sort();
  const message = sortedKeys.map((k) => `${k}=${params.getAll(k).join(",")}`).join("");

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const expected = bufferToHex(sig);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────
// Shopify Admin API: read + write customer metafield
// ─────────────────────────────────────────────────────────────────────
async function adminFetch(env: Env, query: string, variables: Record<string, unknown>) {
  const r = await fetch(`https://${env.SHOPIFY_SHOP}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`admin_api_${r.status}`);
  const j = await r.json();
  if ((j as { errors?: unknown }).errors) {
    throw new Error(`admin_api_errors: ${JSON.stringify((j as { errors: unknown }).errors)}`);
  }
  return j;
}

async function readQueue(env: Env, customerId: string): Promise<unknown[]> {
  const gid = `gid://shopify/Customer/${customerId}`;
  const data = await adminFetch(
    env,
    `query($id: ID!, $namespace: String!, $key: String!) {
       customer(id: $id) {
         metafield(namespace: $namespace, key: $key) { value }
       }
     }`,
    { id: gid, namespace: METAFIELD_NAMESPACE, key: METAFIELD_KEY }
  );
  const value = (data as any)?.data?.customer?.metafield?.value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(env: Env, customerId: string, queue: unknown[]): Promise<void> {
  const gid = `gid://shopify/Customer/${customerId}`;
  await adminFetch(
    env,
    `mutation($metafields: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $metafields) {
         metafields { id }
         userErrors { field message code }
       }
     }`,
    {
      metafields: [
        {
          ownerId: gid,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(queue),
        },
      ],
    }
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function sanitizeQueue(raw: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  // Cap to 12 entries (more than enough for a 5-month rotation + buffer)
  const capped = raw.slice(0, 12);
  // Whitelist fields to prevent metafield abuse
  const allowed = new Set([
    "shipMonth",
    "productId",
    "title",
    "url",
    "image",
    "family",
    "variantId",
    "addedAt",
    "locked",
  ]);
  return capped.map((item) => {
    if (!item || typeof item !== "object") return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (allowed.has(k)) out[k] = v;
    }
    return out;
  });
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const j = await req.json();
    return j as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Appstle Admin API: swap subscription line item for a customer
// Docs reference (from scripts/swap-jeff-contract.sh, May 5 2026):
//   GET  $APPSTLE_API_BASE/subscription-contract-details?customerId=...
//   POST $APPSTLE_API_BASE/subscription-contract-details/replace-variants-v3
//   Headers: X-API-Key: <APPSTLE_API_KEY>
// ─────────────────────────────────────────────────────────────────────
interface SyncResult {
  ok: boolean;
  contractId?: string | number;
  oldVariantId?: string | number | null;
  newVariantId?: string;
  noop?: boolean;
  status?: number;
  detail?: string;
}

async function syncSubscription(env: Env, customerId: string, newVariantId: string): Promise<SyncResult> {
  if (!env.APPSTLE_API_KEY || !env.APPSTLE_API_BASE) {
    return { ok: false, detail: "appstle_env_missing" };
  }

  // 1. Find this customer's active contract.
  const contractListUrl = `${env.APPSTLE_API_BASE}/subscription-contract-details?customerId=${encodeURIComponent(customerId)}&page=0&size=10`;
  const listResp = await fetch(contractListUrl, {
    headers: { "X-API-Key": env.APPSTLE_API_KEY },
  });
  if (!listResp.ok) {
    const text = await safeText(listResp);
    return { ok: false, status: listResp.status, detail: `contract_list_${listResp.status}: ${text.slice(0, 200)}` };
  }
  const listJson = (await listResp.json()) as unknown;
  const contracts = Array.isArray(listJson)
    ? (listJson as Record<string, unknown>[])
    : ((listJson as { content?: unknown[]; data?: unknown[] })?.content as Record<string, unknown>[])
      || ((listJson as { content?: unknown[]; data?: unknown[] })?.data as Record<string, unknown>[])
      || [];
  const active = contracts.find((c) => (c.status as string) === "ACTIVE") || contracts[0];
  if (!active) return { ok: false, detail: "no_contract_for_customer" };

  const contractId = (active.subscriptionContractId || active.contractId || active.id) as string | number;
  const lines = (active.lines as Record<string, unknown>[]) || (active.lineItems as Record<string, unknown>[]) || [];
  const line = lines[0];
  const oldVariantId = line ? (line.variantId || (line.variant as { id?: unknown })?.id) as string | number | null : null;

  if (oldVariantId != null && String(oldVariantId) === newVariantId) {
    return { ok: true, contractId, oldVariantId, newVariantId, noop: true };
  }
  if (oldVariantId == null) {
    return { ok: false, contractId, detail: "no_line_on_contract" };
  }

  // 2. Replace variant via v3 endpoint.
  const swapUrl = `${env.APPSTLE_API_BASE}/subscription-contract-details/replace-variants-v3`;
  const swapBody = JSON.stringify({
    shop: env.SHOPIFY_SHOP,
    contractId: typeof contractId === "string" ? parseInt(contractId, 10) : contractId,
    oldVariants: [typeof oldVariantId === "string" ? parseInt(oldVariantId, 10) : oldVariantId],
    newVariants: { [newVariantId]: 1 },
  });
  const swapResp = await fetch(swapUrl, {
    method: "POST",
    headers: {
      "X-API-Key": env.APPSTLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: swapBody,
  });
  if (!swapResp.ok && swapResp.status !== 204) {
    const text = await safeText(swapResp);
    return { ok: false, contractId, oldVariantId, newVariantId, status: swapResp.status, detail: `swap_${swapResp.status}: ${text.slice(0, 300)}` };
  }

  return { ok: true, contractId, oldVariantId, newVariantId };
}

async function safeText(r: Response): Promise<string> {
  try { return await r.text(); } catch { return ""; }
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
