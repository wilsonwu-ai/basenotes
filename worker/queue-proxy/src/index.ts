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
 *   SHOPIFY_ADMIN_TOKEN        – Admin API access token (custom app)
 *                                  Required scopes:
 *                                    read_customers, write_customers           (queue metafield)
 *                                    read_own_subscription_contracts            (sync-subscription)
 *                                    write_own_subscription_contracts           (sync-subscription)
 *   SHOPIFY_SHOP               – e.g. "ath7ay-1y.myshopify.com" (in [vars])
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
// Shopify-native subscription line swap (PRD 2026-05-11 pivot).
//
// Appstle's Admin API was rejecting our key with HTTP 401 across every
// auth scheme after Jeff upgraded to Business. Rather than gate the
// June 7 launch on a third-party support ticket, we swap the contract
// line via Shopify's own subscription-contract GraphQL. Appstle reads
// from Shopify's contract, so the Appstle Admin "Upcoming Orders" view
// reflects the change automatically.
//
// Flow:
//   1. customer.subscriptionContracts → find ACTIVE contract + line
//   2. subscriptionContractUpdate(contractId) → open a draft
//   3. subscriptionDraftLineUpdate(draftId, lineId, {productVariantId, quantity})
//   4. subscriptionDraftCommit(draftId)
//
// Required scopes on SHOPIFY_ADMIN_TOKEN:
//   read_own_subscription_contracts
//   write_own_subscription_contracts
// ─────────────────────────────────────────────────────────────────────
interface SyncResult {
  ok: boolean;
  contractId?: string;
  oldVariantId?: string | null;
  newVariantId?: string;
  noop?: boolean;
  status?: number;
  detail?: string;
}

async function syncSubscription(env: Env, customerId: string, newVariantId: string): Promise<SyncResult> {
  const customerGid = `gid://shopify/Customer/${customerId}`;
  const newVariantGid = newVariantId.startsWith("gid://")
    ? newVariantId
    : `gid://shopify/ProductVariant/${newVariantId}`;

  // 1. Find active contract + its first line.
  const listResp = await adminFetch(
    env,
    `query($id: ID!) {
       customer(id: $id) {
         subscriptionContracts(first: 5) {
           edges { node {
             id
             status
             lines(first: 5) { edges { node { id productId variantId quantity } } }
           } }
         }
       }
     }`,
    { id: customerGid }
  );

  const contracts = ((listResp as any)?.data?.customer?.subscriptionContracts?.edges || []) as Array<{ node: any }>;
  const active = contracts.find((e) => e?.node?.status === "ACTIVE") || contracts[0];
  if (!active) return { ok: false, detail: "no_contract_for_customer" };

  const contractId = active.node.id as string;
  const lines = (active.node.lines?.edges || []) as Array<{ node: any }>;
  const line = lines[0]?.node;
  if (!line) return { ok: false, contractId, detail: "no_line_on_contract" };

  const lineId = line.id as string;
  const oldVariantGid = line.variantId as string | null;
  const quantity = (line.quantity as number) || 1;

  if (oldVariantGid && oldVariantGid === newVariantGid) {
    return { ok: true, contractId, oldVariantId: oldVariantGid, newVariantId: newVariantGid, noop: true };
  }

  // 2. Open a draft.
  const draftOpen = await adminFetch(
    env,
    `mutation($contractId: ID!) {
       subscriptionContractUpdate(contractId: $contractId) {
         draft { id }
         userErrors { field message code }
       }
     }`,
    { contractId }
  );
  const draftErrs = (draftOpen as any)?.data?.subscriptionContractUpdate?.userErrors || [];
  if (draftErrs.length) {
    return { ok: false, contractId, detail: `draft_open_err: ${JSON.stringify(draftErrs).slice(0, 300)}` };
  }
  const draftId = (draftOpen as any)?.data?.subscriptionContractUpdate?.draft?.id as string;
  if (!draftId) return { ok: false, contractId, detail: "no_draft_id" };

  // 3. Update the line.
  const lineUpdate = await adminFetch(
    env,
    `mutation($draftId: ID!, $lineId: ID!, $input: SubscriptionLineInput!) {
       subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
         lineUpdated { id productId variantId quantity }
         userErrors { field message code }
       }
     }`,
    {
      draftId,
      lineId,
      input: { productVariantId: newVariantGid, quantity },
    }
  );
  const updErrs = (lineUpdate as any)?.data?.subscriptionDraftLineUpdate?.userErrors || [];
  if (updErrs.length) {
    return { ok: false, contractId, detail: `line_update_err: ${JSON.stringify(updErrs).slice(0, 300)}` };
  }

  // 4. Commit.
  const commitResp = await adminFetch(
    env,
    `mutation($draftId: ID!) {
       subscriptionDraftCommit(draftId: $draftId) {
         contract { id status }
         userErrors { field message code }
       }
     }`,
    { draftId }
  );
  const commitErrs = (commitResp as any)?.data?.subscriptionDraftCommit?.userErrors || [];
  if (commitErrs.length) {
    return { ok: false, contractId, detail: `commit_err: ${JSON.stringify(commitErrs).slice(0, 300)}` };
  }

  return { ok: true, contractId, oldVariantId: oldVariantGid, newVariantId: newVariantGid };
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
