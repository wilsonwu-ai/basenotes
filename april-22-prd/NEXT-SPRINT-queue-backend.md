# Next Sprint — Queue Backend (Items 6 + 7)

**Status:** Design + code scaffold. **NOT deployed.** Requires Cloudflare Worker + Appstle admin access to ship.
**Owner:** Wilson (infra) + Engineering (integration)
**Generated:** 2026-04-22 by Claude Opus 4.7

---

## Why this exists

Today's queue (shipped in PRD-01) lives in `localStorage` only. That means:
- **Not cross-device.** Jeff's queue on mobile is invisible on his laptop.
- **Not server-authoritative.** The auto-pick on ship day can't read the queue, so Appstle still uses its default fragrance selection at renewal time.

Items 6 + 7 close both gaps.

---

## Item 6 — Cross-device queue sync

### Architecture

```
Storefront (basenotescent.com)
    ↓ POST /apps/queue-sync  ← Shopify App Proxy (authenticated as storefront)
Cloudflare Worker (basenote-queue-proxy.workers.dev)
    ↓ Shopify Admin API mutation
Shopify Customer Metafield: basenote.queue (json)
```

**Why App Proxy instead of direct Shopify Admin call?** The Admin API requires a secret token that must not ship to the browser. App Proxy lets the storefront make authenticated requests to a backend URL that Shopify proxies and signs — the Worker verifies the signature and forwards to the Admin API.

**Why Cloudflare Worker specifically?** Small, free-tier friendly, global edge, and matches the pattern already used for `update-payment-method` per `memory/project_update_payment_method.md`.

### Files to create / modify

| File | Purpose |
|------|---------|
| `workers/queue-sync/src/index.ts` (new repo or subfolder) | Cloudflare Worker entry point |
| `workers/queue-sync/wrangler.toml` | Deployment config |
| `workers/queue-sync/src/shopify-hmac.ts` | App Proxy signature verification |
| `workers/queue-sync/src/admin-api.ts` | Thin Admin GraphQL client |
| `assets/queue-scheduler.js` | Add `syncToMetafield()` / `syncFromMetafield()` calls |
| Shopify Admin → Apps → Custom Apps → **Base Note Queue Sync** | New custom app to get Admin API token |
| Shopify Admin → Settings → Apps and sales channels → **Develop apps** → Configure the App Proxy path `/apps/queue-sync` → point at the Worker URL |

### Cloudflare Worker (complete code)

```typescript
// workers/queue-sync/src/index.ts
import { verifyProxySignature } from './shopify-hmac';
import { writeCustomerMetafield, readCustomerMetafield } from './admin-api';

export interface Env {
  SHOPIFY_APP_SECRET: string;
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_SHOP: string;           // "base-note.myshopify.com"
  METAFIELD_NAMESPACE: string;    // "basenote"
  METAFIELD_KEY: string;          // "queue"
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Shopify App Proxy attaches signature query params. Verify before doing anything.
    if (!(await verifyProxySignature(url.searchParams, env.SHOPIFY_APP_SECRET))) {
      return json({ error: 'invalid signature' }, 401);
    }

    const customerId = url.searchParams.get('logged_in_customer_id');
    if (!customerId) return json({ error: 'not logged in' }, 401);

    if (req.method === 'GET') {
      const queue = await readCustomerMetafield(env, customerId);
      return json({ queue: queue || [] });
    }

    if (req.method === 'POST') {
      const body = await req.json() as { queue: unknown[] };
      if (!Array.isArray(body?.queue)) return json({ error: 'bad body' }, 400);
      // Validate shape: each entry must have shipMonth + productId
      const valid = body.queue.every((e: any) =>
        e && typeof e.shipMonth === 'string'
          && /^\d{4}-(0[1-9]|1[0-2])$/.test(e.shipMonth)
          && (typeof e.productId === 'number' || typeof e.productId === 'string')
      );
      if (!valid) return json({ error: 'malformed queue entries' }, 400);
      // Cap at 12 slots to bound metafield size
      const queue = body.queue.slice(0, 12);
      await writeCustomerMetafield(env, customerId, queue);
      return json({ ok: true, queue });
    }

    return json({ error: 'method not allowed' }, 405);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
  });
}
```

```typescript
// workers/queue-sync/src/shopify-hmac.ts
export async function verifyProxySignature(params: URLSearchParams, secret: string): Promise<boolean> {
  const signature = params.get('signature');
  if (!signature) return false;
  const sorted = [...params.entries()]
    .filter(([k]) => k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
```

```typescript
// workers/queue-sync/src/admin-api.ts
export async function readCustomerMetafield(env: any, customerId: string) {
  const query = `
    query($ownerId: ID!, $namespace: String!, $key: String!) {
      customer(id: $ownerId) {
        metafield(namespace: $namespace, key: $key) { value }
      }
    }`;
  const res = await fetch(`https://${env.SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: env.METAFIELD_NAMESPACE,
        key: env.METAFIELD_KEY
      }
    })
  });
  const data: any = await res.json();
  const raw = data?.data?.customer?.metafield?.value;
  return raw ? JSON.parse(raw) : [];
}

export async function writeCustomerMetafield(env: any, customerId: string, queue: unknown[]) {
  const mutation = `
    mutation ($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }`;
  const res = await fetch(`https://${env.SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        metafields: [{
          ownerId: `gid://shopify/Customer/${customerId}`,
          namespace: env.METAFIELD_NAMESPACE,
          key: env.METAFIELD_KEY,
          type: 'json',
          value: JSON.stringify(queue)
        }]
      }
    })
  });
  const data: any = await res.json();
  if (data?.data?.metafieldsSet?.userErrors?.length) {
    throw new Error(JSON.stringify(data.data.metafieldsSet.userErrors));
  }
  return true;
}
```

```toml
# workers/queue-sync/wrangler.toml
name = "basenote-queue-proxy"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[vars]
SHOPIFY_SHOP = "base-note.myshopify.com"
METAFIELD_NAMESPACE = "basenote"
METAFIELD_KEY = "queue"

# Secrets (set via `wrangler secret put`):
#   SHOPIFY_APP_SECRET    — from Shopify custom app → API credentials → App Proxy signing
#   SHOPIFY_ADMIN_TOKEN   — from Shopify custom app → Admin API access token
```

### queue-scheduler.js changes (client integration)

Add these methods to the existing module (`window.BasenoteQueue`):

```javascript
function syncFromServer(cb) {
  // Called on account page load. If the server has a more-recent queue, overwrite localStorage.
  fetch('/apps/queue-sync', { credentials: 'include' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !Array.isArray(data.queue)) { cb && cb(null); return; }
      var local = load();
      var serverHasMore = data.queue.length > local.length;
      if (serverHasMore) {
        localStorage.setItem(KEY, JSON.stringify(data.queue));
        emit();
      }
      cb && cb(data.queue);
    })
    .catch(() => cb && cb(null));
}

function syncToServer() {
  fetch('/apps/queue-sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queue: load() })
  }).catch(() => {}); // Fire-and-forget; localStorage is the source of truth client-side
}

// Auto-sync on every save:
var _origSave = save;
save = function (queue) { _origSave(queue); syncToServer(); };

// Expose
window.BasenoteQueue.syncFromServer = syncFromServer;
window.BasenoteQueue.syncToServer = syncToServer;
```

And in `templates/customers/account.liquid`, call `syncFromServer()` once at page load before the first `render()`.

### Deployment steps (Wilson)

1. **Create Shopify custom app**
   - Admin → Settings → Apps and sales channels → Develop apps → Create app "Base Note Queue Sync"
   - API access → Admin API → grant scopes: `read_customers`, `write_customers` (metafield access)
   - Install app → copy the Admin API access token
   - App Proxy tab → set subpath prefix `apps`, subpath `queue-sync`, proxy URL `https://basenote-queue-proxy.workers.dev`

2. **Deploy the Worker**
   ```bash
   cd workers/queue-sync
   npm install wrangler -g
   wrangler login
   wrangler secret put SHOPIFY_APP_SECRET   # paste App Proxy signing secret
   wrangler secret put SHOPIFY_ADMIN_TOKEN  # paste Admin API access token
   wrangler deploy
   ```

3. **Ship the client changes**
   - Add the syncFromServer/syncToServer code to `assets/queue-scheduler.js`
   - Add the syncFromServer call to `templates/customers/account.liquid` initSubscriptionQueue()
   - `shopify theme push`

4. **Verify**
   - Log in on device A, queue a fragrance → wait 3 sec → log in on device B, same account → queue should be populated

---

## Item 7 — Auto-pick on ship day

### Architecture

```
Appstle Subscriptions (renewal event fires ~24h before shipment)
    ↓ Webhook POST {customerId, shippingDate, currentSku, ...}
Cloudflare Worker (basenote-queue-autopick.workers.dev)
    ↓ Read customer metafield basenote.queue
    ↓ Find slot where shipMonth === shippingDate's YYYY-MM
    ↓ If found: Appstle API → setSubscriptionProduct(subscriptionId, slot.productId)
    ↓ If not found: leave current subscription alone → ships default
    ↓ Also: emit Klaviyo event "Queue Auto-Picked" or "Queue Empty — Default Sent"
```

### Why this works

- Queue is now server-authoritative (item 6) so the Worker can read it.
- Appstle fires webhooks on subscription events (see Appstle docs → Webhooks section).
- The Worker mutates the upcoming shipment's SKU before Appstle charges, so the customer gets the right fragrance automatically.

### Requirements (Wilson verifies)

- [ ] Appstle plan supports webhooks (check billing tier).
- [ ] Appstle exposes a "modify upcoming subscription shipment" API — confirm by reading `memory/architecture_appstle_api.md` and current Appstle docs.
- [ ] Appstle admin → Webhooks → add event "renewal.upcoming" (or equivalent) → target URL `https://basenote-queue-autopick.workers.dev/webhook`.

### Files to create

| File | Purpose |
|------|---------|
| `workers/queue-autopick/src/index.ts` | Worker entry: webhook receiver + orchestration |
| `workers/queue-autopick/src/appstle.ts` | Thin Appstle API client (modify subscription) |
| `workers/queue-autopick/src/klaviyo.ts` | Klaviyo server-side track event (optional; client-side already covers most) |
| Reuse: `workers/queue-sync/src/admin-api.ts` (read metafield) |

### Worker scaffold (pseudo-complete)

```typescript
// workers/queue-autopick/src/index.ts
import { verifyAppstleHmac } from './appstle';
import { readCustomerMetafield } from '../../queue-sync/src/admin-api';
import { modifyUpcomingSubscription, APPSTLE_BASE } from './appstle';

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    if (req.method !== 'POST') return new Response('', { status: 405 });

    const bodyText = await req.text();
    if (!(await verifyAppstleHmac(req, bodyText, env.APPSTLE_WEBHOOK_SECRET))) {
      return new Response('invalid signature', { status: 401 });
    }

    const evt = JSON.parse(bodyText);
    // Expected shape (confirm against Appstle docs):
    //   { subscriptionId, customerId, upcomingShipDate, currentSku, ... }
    if (!evt?.customerId || !evt?.upcomingShipDate) {
      return new Response('bad body', { status: 400 });
    }

    const shipMonth = evt.upcomingShipDate.slice(0, 7); // "YYYY-MM"
    const queue = await readCustomerMetafield(env, String(evt.customerId));
    const slot = (queue || []).find((e: any) => e.shipMonth === shipMonth);

    if (!slot) {
      // No pick → default Fragrance of the Month ships. No-op.
      return new Response(JSON.stringify({ ok: true, action: 'defaulted' }));
    }

    // Look up the variant for slot.productId. If slot already stored variantId, use it directly.
    const variantId = slot.variantId ?? await lookupFirstVariantId(env, slot.productId);
    await modifyUpcomingSubscription(env, evt.subscriptionId, variantId);

    return new Response(JSON.stringify({ ok: true, action: 'auto-picked', productId: slot.productId }));
  }
};
```

### Deployment steps (Wilson)

1. Confirm Appstle plan includes webhooks + subscription-modify API.
2. Scaffold the Worker (copy from `workers/queue-sync` as starting point).
3. Add Appstle secrets via wrangler.
4. Appstle admin → Webhooks → add "renewal.upcoming" target.
5. Test with a throwaway subscription: queue a fragrance for next month → trigger renewal → confirm the shipment uses the queued fragrance.
6. Monitor Klaviyo dashboard for "Queue Auto-Picked" / "Queue Empty — Default Sent" events.

---

## What's genuinely blocked on you (Wilson)

| Item | Blocker | Minutes to unblock |
|---|---|---|
| Item 6 deployment | Cloudflare account + Shopify custom-app creation + Admin API scopes | ~30 min setup |
| Item 7 deployment | Appstle webhook support confirmation + webhook secret + modify-subscription API access | ~20 min investigation + ~30 min implementation |
| PRD-04 note copy publish | Shopify admin → 20 products × 3 metafields = ~1 hour data entry | ~1 hour |
| PRD-07 POS permission | Shopify admin → staff user → grant POS role | ~10 min |

The code patterns above are complete enough that when you (or a contractor) are ready to ship, this doc is the implementation plan. Nothing is deployed yet.

---

## Recommended order when you pick this back up

1. **PRD-07 POS** (10 min, unblocks launch party) — see existing `PRD-07-shopify-pos-quicksale.md`
2. **PRD-04 note copy publish** (1 hour, improves catalog quality) — see `PRD-04-DRAFT-note-copy.md`
3. **Item 6 cross-device sync** (half day dev + 30 min infra) — enables proper multi-device UX
4. **Item 7 auto-pick** (half day dev + infra) — the full Phase 4 promise
