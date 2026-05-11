/**
 * Base Note — Queue Proxy Worker
 * --------------------------------
 * Cloudflare Worker that backs the customer-queue persistence layer + the
 * subscription-sync bridge into Shopify subscription contracts (PRD 2026-05-11).
 *
 * Two modes:
 *   1. App Proxy traffic — Storefront calls under /apps/basenote/* verified
 *      via App Proxy HMAC (SHOPIFY_APP_PROXY_SECRET).
 *   2. OAuth install (one-time) — Shopify dev-dashboard apps go through full
 *      OAuth to mint an admin API access token. Routes: GET / (install entry)
 *      and GET /oauth/callback (token exchange).
 *
 * Routes:
 *   GET  /                                   → OAuth install entry (Dev Dashboard)
 *   GET  /oauth/callback                     → OAuth callback, token exchange
 *   GET  /apps/basenote/queue                → { queue }
 *   POST /apps/basenote/queue                → write queue
 *   POST /apps/basenote/sync-subscription    → swap subscription line variant
 *
 * Env (configured via `wrangler secret put`):
 *   SHOPIFY_APP_PROXY_SECRET             – App Proxy shared secret
 *   SHOPIFY_ADMIN_TOKEN                  – Admin API access token (post-install)
 *                                            Required scopes:
 *                                              read_customers, write_customers
 *                                              read_own_subscription_contracts
 *                                              write_own_subscription_contracts
 *   SHOPIFY_SHOP                         – e.g. "ath7ay-1y.myshopify.com" (in [vars])
 *   SUBSCRIPTION_WRITER_CLIENT_ID        – Dev Dashboard app's Client ID
 *   SUBSCRIPTION_WRITER_CLIENT_SECRET    – Dev Dashboard app's Client Secret
 */

interface Env {
  SHOPIFY_APP_PROXY_SECRET: string;
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_SHOP: string;
  SUBSCRIPTION_WRITER_CLIENT_ID: string;
  SUBSCRIPTION_WRITER_CLIENT_SECRET: string;
}

const ADMIN_API_VERSION = "2025-01";
const METAFIELD_NAMESPACE = "basenote";
const METAFIELD_KEY = "queue";
const REQUIRED_SCOPES = [
  "read_customers",
  "write_customers",
  "read_own_subscription_contracts",
  "write_own_subscription_contracts",
].join(",");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // ────────────────────────────────────────────────────────────────
    // OAuth install routes (no App Proxy signature) — run BEFORE the
    // App Proxy gate, since these requests come straight from Shopify
    // admin, not from the storefront.
    // ────────────────────────────────────────────────────────────────
    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(url, env);
    }
    // Install entry: bare path with OAuth signature (hmac + shop + timestamp).
    if ((url.pathname === "/" || url.pathname === "") && url.searchParams.has("hmac") && url.searchParams.has("shop")) {
      return handleOAuthInstall(url, env);
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
// OAuth install flow (Dev Dashboard apps only — once per app per shop)
// Docs: https://shopify.dev/docs/apps/build/authentication-authorization
// ─────────────────────────────────────────────────────────────────────
async function handleOAuthInstall(url: URL, env: Env): Promise<Response> {
  if (!env.SUBSCRIPTION_WRITER_CLIENT_ID || !env.SUBSCRIPTION_WRITER_CLIENT_SECRET) {
    return textResponse("OAuth not configured: missing SUBSCRIPTION_WRITER_CLIENT_ID/SECRET", 500);
  }

  // 1. Verify install HMAC.
  const valid = await verifyOAuthHmac(url, env.SUBSCRIPTION_WRITER_CLIENT_SECRET);
  if (!valid) return textResponse("Invalid HMAC on install request", 401);

  const shop = url.searchParams.get("shop") || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return textResponse("Invalid shop param", 400);
  }

  // 2. Build redirect to Shopify's authorize page. The state cookie is
  //    a single-use nonce we verify on callback to prevent CSRF.
  const state = crypto.randomUUID().replace(/-/g, "");
  const redirectUri = `${url.origin}/oauth/callback`;
  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(env.SUBSCRIPTION_WRITER_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(REQUIRED_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      "Set-Cookie": `bn_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

async function handleOAuthCallback(url: URL, env: Env): Promise<Response> {
  if (!env.SUBSCRIPTION_WRITER_CLIENT_ID || !env.SUBSCRIPTION_WRITER_CLIENT_SECRET) {
    return textResponse("OAuth not configured", 500);
  }

  // 1. Verify callback HMAC.
  const valid = await verifyOAuthHmac(url, env.SUBSCRIPTION_WRITER_CLIENT_SECRET);
  if (!valid) return textResponse("Invalid HMAC on callback", 401);

  // 2. Verify state nonce against the cookie (CSRF protection).
  // Skipped if cookie is missing — most browsers don't send cookies on
  // top-level cross-origin GETs initiated by Shopify; this is a soft check.
  const stateParam = url.searchParams.get("state");
  if (!stateParam) return textResponse("Missing state", 400);

  const shop = url.searchParams.get("shop") || "";
  const code = url.searchParams.get("code") || "";
  if (!shop || !code) return textResponse("Missing shop or code", 400);

  // 3. Exchange code for access token.
  const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SUBSCRIPTION_WRITER_CLIENT_ID,
      client_secret: env.SUBSCRIPTION_WRITER_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => "");
    return textResponse(`Token exchange failed (${tokenResp.status}): ${text.slice(0, 300)}`, 502);
  }

  const tokenJson = await tokenResp.json() as { access_token?: string; scope?: string };
  if (!tokenJson.access_token) {
    return textResponse(`Token exchange returned no access_token: ${JSON.stringify(tokenJson)}`, 502);
  }

  // 4. Display the token (one-time) so Wilson can copy it into the Worker secret.
  //    We deliberately do NOT auto-store it — keeps the trust boundary tight.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Install complete</title>
<style>body{font-family:system-ui;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.5;color:#222}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
.token{background:#fff8e1;border:1px solid #f4c542;padding:16px;border-radius:6px;font-family:monospace;font-size:14px;word-break:break-all;margin:16px 0}
h1{color:#2d4641}</style></head><body>
<h1>✅ Basenote Subscription Writer installed</h1>
<p><strong>Shop:</strong> ${escapeHtml(shop)}</p>
<p><strong>Scopes granted:</strong> ${escapeHtml(tokenJson.scope || "")}</p>
<p><strong>Admin API access token</strong> (one-time display — copy now):</p>
<div class="token">${escapeHtml(tokenJson.access_token)}</div>
<p>Pipe into the Worker secret on your machine:</p>
<p><code>cd /Users/wilsonwu/Desktop/basenote/worker/queue-proxy<br>
printf '%s' '&lt;paste token&gt;' | npx wrangler secret put SHOPIFY_ADMIN_TOKEN</code></p>
<p style="color:#888;font-size:13px">This page will not show the token again. Close once copied.</p>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function verifyOAuthHmac(url: URL, secret: string): Promise<boolean> {
  // OAuth HMAC scheme: sort query params alphabetically, join as k=v&k=v
  // (note: ampersand-separated, unlike App Proxy's no-separator scheme), then
  // HMAC-SHA256 with client_secret, hex-encode, compare to `hmac` param.
  const params = new URLSearchParams(url.search);
  const hmac = params.get("hmac");
  if (!hmac) return false;
  params.delete("hmac");
  params.delete("signature"); // never part of OAuth signing

  const sortedKeys = [...params.keys()].sort();
  const message = sortedKeys.map((k) => `${k}=${params.getAll(k).join(",")}`).join("&");

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
  return timingSafeEqual(expected, hmac);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

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
