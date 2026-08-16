// basenote-media: (1) static asset CDN for blog images/video, (2) public member-count endpoint
// for the homepage growth-goal section. Static files under ./public are served at
// https://basenote-media.<account>.workers.dev/<path>.
//
// Secrets/vars: SHOPIFY_ADMIN_TOKEN (read_customers), SHOPIFY_SHOP, MEMBER_GOAL, MEMBER_TAG, MEMBER_DEADLINE

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra } });
}

async function countActiveMembers(env) {
  const shop = env.SHOPIFY_SHOP || "ath7ay-1y.myshopify.com";
  const tag = env.MEMBER_TAG || "appstle_subscription_active_customer";
  let after = null, total = 0, pages = 0;
  do {
    const q = `query($q:String!,$after:String){ customers(first:250, query:$q, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id } } }`;
    const r = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({ query: q, variables: { q: `tag:${tag}`, after } }),
    });
    if (!r.ok) throw new Error(`admin ${r.status}`);
    const d = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 200));
    const c = d.data.customers;
    total += c.nodes.length;
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
    pages++;
  } while (after && pages < 20);
  return total;
}

async function handleMemberCount(request, env, ctx) {
  const cache = caches.default;
  const key = new Request("https://basenote-media.internal/member-count-v1");
  const hit = await cache.match(key);
  if (hit) return hit;
  const goal = Number(env.MEMBER_GOAL || 60);
  let active = null;
  try { active = await countActiveMembers(env); } catch (e) { active = null; }
  const body = {
    active,
    goal,
    remaining: active === null ? null : Math.max(goal - active, 0),
    deadline: env.MEMBER_DEADLINE || "2026-11-30",
    updatedAt: new Date().toISOString(),
  };
  const res = json(body, 200, { "cache-control": active === null ? "no-store" : "public, max-age=600" });
  if (active !== null) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("basenote-media ok", { headers: { "content-type": "text/plain", ...CORS } });
    }
    if (url.pathname === "/member-count") return handleMemberCount(request, env, ctx);
    const res = await env.ASSETS.fetch(request);
    if (res.status === 200) {
      const h = new Headers(res.headers);
      h.set("cache-control", "public, max-age=31536000, immutable");
      h.set("access-control-allow-origin", "*");
      return new Response(res.body, { status: 200, headers: h });
    }
    return res;
  },
};
