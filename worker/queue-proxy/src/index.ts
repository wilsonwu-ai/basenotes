/**
 * Base Note — Queue Proxy Worker
 * --------------------------------
 * Cloudflare Worker that backs the customer-queue persistence layer.
 *
 * Mounted via Shopify App Proxy at /apps/basenote/queue/* on the storefront.
 * Reads + writes the customer's queue JSON to a Shopify customer metafield:
 *   namespace: "basenote", key: "queue", type: "json"
 *
 * Auth: every request from Shopify includes a `signature` query param that is
 * an HMAC-SHA256 of the other query params, signed with the App Proxy shared
 * secret. We verify that BEFORE doing any Admin API work.
 *
 * Routes:
 *   GET  /apps/basenote/queue   → returns { queue: [...] } for the logged-in customer
 *   POST /apps/basenote/queue   → writes { queue: [...] } from the request body
 *
 * Env (configured via `wrangler secret put` — never check secrets into the repo):
 *   SHOPIFY_APP_PROXY_SECRET   – shared secret from the Shopify private app's App Proxy config
 *   SHOPIFY_ADMIN_TOKEN        – Admin API access token (custom app, scopes: read_customers + write_customers)
 *   SHOPIFY_SHOP               – e.g. "base-note.myshopify.com"
 */

interface Env {
  SHOPIFY_APP_PROXY_SECRET: string;
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_SHOP: string;
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
    try {
      if (request.method === "GET") {
        const queue = await readQueue(env, customerId);
        return json({ queue });
      }
      if (request.method === "POST" || request.method === "PUT") {
        const body = await safeJson(request);
        if (!body || !Array.isArray(body.queue)) {
          return json({ error: "bad_body" }, 400);
        }
        // Cheap server-side validation: cap size, drop unknown keys
        const sanitized = sanitizeQueue(body.queue);
        await writeQueue(env, customerId, sanitized);
        return json({ ok: true, queue: sanitized });
      }
      return json({ error: "method_not_allowed" }, 405);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown";
      return json({ error: "server_error", detail: message }, 500);
    }
  },
};

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

async function safeJson(req: Request): Promise<{ queue?: unknown[] } | null> {
  try {
    const j = await req.json();
    return j as { queue?: unknown[] };
  } catch {
    return null;
  }
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
