# Base Note — Queue Proxy Worker

Cloudflare Worker that backs cross-device customer queue persistence (PRD-4, April 30 2026 sprint).

## What it does

The customer's "fragrance rotation queue" is stored as a JSON metafield on the Shopify customer record:

- **Owner:** Customer
- **Namespace:** `basenote`
- **Key:** `queue`
- **Type:** `json`

The theme's `assets/queue-scheduler.js` calls this Worker over a Shopify App Proxy:

- `GET  /apps/basenote/queue` → returns `{ queue: [...] }`
- `POST /apps/basenote/queue` → writes `{ queue: [...] }`

The Worker:
1. Verifies the App Proxy HMAC signature on every request.
2. Reads `logged_in_customer_id` from the proxy params.
3. Reads/writes the metafield via Shopify Admin GraphQL API.

## One-time setup (Wilson)

### 1. Create a Shopify custom app

Shopify Admin → **Settings → Apps and sales channels → Develop apps → Create an app**

- Name: `basenote-queue-proxy`
- Configuration → **Admin API integration**:
  - Scopes: `read_customers`, `write_customers`
  - Install → copy the **Admin API access token**
- Configuration → **App proxy**:
  - Subpath prefix: `apps`
  - Subpath: `basenote`
  - Proxy URL: `https://basenote-queue-proxy.<your-account>.workers.dev`
  - Save → copy the **shared secret**

> Note: the App Proxy uses `apps/basenote/*` so the public URL becomes `/apps/basenote/queue`.

### 2. Install dependencies

```sh
cd worker/queue-proxy
npm install
```

### 3. Set Worker secrets

```sh
wrangler login
wrangler secret put SHOPIFY_APP_PROXY_SECRET   # paste shared secret
wrangler secret put SHOPIFY_ADMIN_TOKEN        # paste Admin API token
# SHOPIFY_SHOP is already in wrangler.toml as base-note.myshopify.com — no action needed
```

### 4. Deploy

```sh
npm run deploy
```

The first deploy creates the Worker at `https://basenote-queue-proxy.<your-account>.workers.dev`. Make sure that URL matches the App Proxy URL you configured in step 1.

### 5. Verify

```sh
# As a logged-in customer in Chrome, hit:
#   https://basenotescent.com/apps/basenote/queue
# Expect: { "queue": [] } on first call.

# Add a fragrance via the PDP, then re-hit the URL — expect the new entry.
```

## Local dev

```sh
wrangler dev
```

Local URL: `http://localhost:8787`. Use `wrangler tail` for live logs after deploy.

## How sync works on the storefront

`assets/queue-scheduler.js` — on first load, if the customer is logged in:

1. `GET /apps/basenote/queue` → server queue
2. Read localStorage queue
3. Merge (server wins on shipMonth conflict; localStorage-only entries are added)
4. Save merged result to localStorage AND `POST /apps/basenote/queue`

On every subsequent `save()`, a debounced `POST` syncs the latest state to the server.

For logged-out users, behavior is unchanged: localStorage only.

## Costs

Cloudflare Workers free tier: 100,000 requests/day. Average customer makes ~5 queue API calls per session × low-thousands of MAU → well within free tier indefinitely.

## Files

- `src/index.ts` — Worker entrypoint (~200 LOC)
- `wrangler.toml` — Worker config
- `package.json` / `tsconfig.json` — toolchain
