# Cloudflare staging profile-queue Worker

**Status: reviewed source and an unapplied configuration template only. It has
not been deployed, bound to D1, connected to Shopify, connected to Appstle,
given a secret, or used to send email.**

This is a deliberately small, staging-only adapter around the Base Note Core
profile-queue contracts. It has no production fallback: a customer route is
unavailable unless every staging gate below is present.

## Reconciled Shopify App Proxy route

The Shopify App Proxy target is deliberately the Worker root:

```text
https://basenote-profile-queue-staging.wilson-af8.workers.dev/api/shopify/app-proxy
```

Shopify appends the child route, so the only Worker Profile Queue route is
`/api/shopify/app-proxy/profile-queue`.

The server-rendered page posts to the signed storefront `path_prefix` plus
`/profile-queue` (for example, `/apps/basenote-staging/profile-queue`). This lets
Shopify forward and sign each form submission. The Worker deliberately rejects
the old direct Worker path `/apps/basenote-staging/profile-queue`; it is not a second
authorization surface.

Shopify's App Proxy behavior and signature construction are documented at:

- https://shopify.dev/docs/apps/build/online-store/app-proxies
- https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies

## What the adapter contains

```text
apps/basenote-core/
  src/cloudflare-staging-worker/worker.ts
  src/cloudflare-staging-worker/webcrypto-app-proxy.ts
  src/cloudflare-staging-worker/d1-test-binding-resolver.ts
  src/cloudflare-staging-worker/request-validation.ts
  src/cloudflare-staging-worker/staging-test-variants.ts
  src/cloudflare-staging-worker/profile-queue-page.ts
  src/cloudflare-staging-worker/http.ts
  wrangler.staging.example.toml
  migrations/0001_staging_runtime.sql
  migrations/0002_staging_test_bindings.sql
```

- `GET /healthz` is host-restricted and returns only fixed staging capability
  status. It does not query D1.
- `GET /api/shopify/app-proxy/profile-queue` renders a no-JavaScript,
  server-side Profile Queue page only after the signed-request and exact
  ownership gates pass.
- The page shows automatic FOTM as read-only, exposes at most four `$18.00`
  add-on slots, and gets generic eligible-variant labels only from
  `STAGING_TEST_VARIANT_IDS`. It makes no Admin, storefront, or catalog call.
- Add/remove forms use opaque page-generated idempotency keys and POST through
  Shopify's signed storefront App Proxy child route. There is no browser API
  call, script, OAuth/session token, contract binding, or customer data in the
  markup.
- Each rendered form also receives one high-entropy, server-issued `pqf_` form
  nonce. It is short-lived, one-use, and bound to the verified shop/customer,
  exact binding/cycle/month, and page revision before a mutation can persist.
- JSON and form requests have strict body/type/key boundaries. A browser cannot
  provide a binding ID or choose a server-generated add-on/audit ID.
- The Worker creates add-on and audit IDs server-side, applies the existing
  four-add-on / exact-$18 Core rules, and writes only through the Core D1
  repository once all authorization gates are present.
- Exact allowed staging hosts and origins are configured with no wildcard CORS.
  The code rejects production-looking hosts and refuses to run queue routes
  unless `BASENOTE_RUNTIME_STAGE=staging`.
- Responses are generic, no-store JSON or HTML and intentionally contain no
  customer identity, binding ID, raw request, error stack, or log call.

## Fail-closed authorization path

```text
storefront signed App Proxy request
  -> HTTPS / exact staging host / CORS policy
  -> Web Crypto App Proxy HMAC + exact shop + timestamp + logged-in customer
  -> exact active, unexpired D1 disposable-test-binding lookup
  -> exact cycle + runtime-only disposable test-variant allowlist + issued form nonce
  -> one-use nonce consumption bound to the exact form revision
  -> Core queue mutation and append-only audit
```

The Web Crypto verifier reads the raw query string, validates Shopify's HMAC,
requires a recent timestamp and logged-in customer ID, and derives a safe
storefront form path from Shopify's signed `path_prefix`. It uses no Node
crypto, OAuth, cookies, Admin API credentials, or browser-supplied identity.

`D1StagingTestBindingOwnershipResolver` queries every authorization dimension:
exact shop, Shopify customer ID, cycle key, ship month, `ACTIVE` status, and
unexpired timestamp. It never selects a customer's first contract, accepts a
browser-provided binding ID, or calls Shopify/Appstle. No seed row means deny.

Missing runtime secret, shop, variants, or D1 binding returns generic `503`.
An invalid HMAC returns generic `401`; no matching active test binding or a
non-allowlisted add-on returns generic `403`. A missing, expired, retargeted,
or reused form nonce also returns generic `403`. HTML errors have no raw
diagnostic detail, and JSON errors contain a fixed code only.

## Required protected staging configuration

`wrangler.staging.example.toml` is a review-only template. It intentionally
contains no real account ID, route, secret, or deploy command. A designated
operator must place the following in an approved protected staging deployment
context only:

| Variable or binding | Required staging-only purpose |
| --- | --- |
| `BASENOTE_RUNTIME_STAGE` | Exact literal `staging`; other values fail closed. |
| `STAGING_ALLOWED_HOSTS` | `basenote-profile-queue-staging.wilson-af8.workers.dev` plus localhost only. Non-local traffic must be HTTPS. |
| `STAGING_ALLOWED_ORIGINS` | `https://base-note-subscription-staging.myshopify.com` plus local development only. Shopify may forward this Origin on a proxied native form POST; no wildcard is supported. |
| `STAGING_SHOP_DOMAIN` | Exact disposable development shop: `base-note-subscription-staging.myshopify.com`. |
| `STAGING_TEST_VARIANT_IDS` | Comma-separated exact disposable Shopify ProductVariant GIDs; this is the page dropdown catalog. |
| `SHOPIFY_APP_PROXY_SHARED_SECRET` | Runtime-only Shopify App Proxy shared secret, stored outside git and never in Wrangler vars/template. |
| `BASENOTE_STAGING_D1` | Binding to a separately created empty staging D1 database only. |

The expected Shopify configuration is an App Proxy with the target above,
prefix `apps`, subpath `basenote-staging`, and child route `profile-queue`.
The signed customer-facing path is therefore
`/apps/basenote-staging/profile-queue`. The source has no app ID, account ID,
D1 ID, secret, OAuth callback, or production route. The temporary isolated
Worker endpoint is deliberately a `workers.dev` hostname, not a production DNS
route; the template enables only that temporary endpoint after approval.

## D1 migration and disposable binding sequence

After explicit staging resource approval, and only for a fresh isolated staging
D1 database, a designated operator must perform these reviewed steps in order:

1. Apply `migrations/0001_staging_runtime.sql`.
2. Apply `migrations/0002_staging_test_bindings.sql`.
3. Create or seed one reviewed disposable queue cycle in
   `profile_queue_cycles` for the exact test binding, cycle key, and ship month.
4. Seed one matching row in `staging_profile_queue_test_bindings` with that
   exact development shop, test customer ID, binding, cycle, ship month,
   opaque actor reference, `DISPOSABLE_DEVELOPMENT_STORE` source, `ACTIVE`
   status, opaque seed reference, and a short expiry.
5. Configure the runtime-only variables/binding above, then perform a
   disposable-customer end-to-end test before any wider staging use.

Migration `0002` creates no customer, binding, queue-cycle, or active form
nonce. It includes the one-use nonce table, but only a successfully signed GET
can issue an expiring nonce for an exact authorized test cycle. It is
intentionally impossible for an unseeded database to authorize a customer.
Never seed names, email addresses, payment data, Appstle credentials, or
production records. The migrations are intentionally not executed by `npm`,
the Worker, or this branch.

## Transport, request, and data safeguards

- An allowed non-local host must use HTTPS. A request with
  `X-Forwarded-Proto: http` is rejected; that header can never upgrade an HTTP
  Worker URL to HTTPS.
- HMAC-bearing requests independently enforce the same HTTPS rule before
  signature verification.
- JSON and form bodies are read as a bounded stream, capped at 16 KiB. An
  oversized declared, chunked, or misreported body is canceled rather than
  buffered with `request.text()`.
- Form fields and JSON keys are exact/unique. The browser cannot provide a
  contract binding or a server-generated add-on/audit ID.
- A `pqf_` form nonce is generated only after signed identity, exact binding,
  and exact cycle checks. It expires after ten minutes and the D1 conditional
  update consumes it before queue persistence, so it cannot be replayed or
  retargeted by a cross-site form even when Shopify omits an `Origin` header.
- CORS has exact configured origins only. Responses are `no-store`, use a
  restrictive CSP with `frame-ancestors 'none'`, use `X-Frame-Options: DENY`,
  and contain no raw request data, error stacks, customer identity, or logging
  call.
- There is no sender, Mailgun key, Queue consumer, webhook, OAuth, Appstle
  mutation, Shopify Admin/storefront API call, or production host/theme change.

## Page design brief

The page is a compact **luxury restraint** surface for a fragrance subscription:
paper/ink/gold tokens, serif editorial hierarchy, a protected FOTM ledger, and
four explicit add-on slots. It is intentionally not a generic dashboard. It
uses semantic sections, labels, visible focus states, mobile grid fallback,
clear disabled states, and no JavaScript or external asset. The one memorable
interaction is the contrast between the read-only automatic FOTM and the small,
bounded `$18` queue the customer can control.

## Checks

From `apps/basenote-core` after installing the existing lockfile dependencies:

```sh
npm run check
```

The check runs the offline structural verifier, Core typecheck, Web Worker-only
typecheck, and unit suite. The tests cover the reconciled target path, HMAC
verification, secret/shop fail-closed behavior, non-HTTPS rejection, exact D1
binding lookup, oversized streaming body cancellation, allowlisted variants,
one-use form nonce behavior, a fixed duplicate-parameter HMAC vector, and the
rendered signed form workflow. They make no network, Cloudflare, Shopify,
email-provider, or file-database call.

The source cannot safely be browser-tested against a live protected Worker yet:
that requires the approved disposable D1 seed, protected runtime secret, and
Shopify App Proxy configuration above. The unit-level rendered workflow is
covered; desktop/mobile browser acceptance is an explicit later staging gate.

## Explicit exclusions

- No deployment, D1 creation, account ID, live route, custom-domain change,
  credential, secret, OAuth, Shopify CLI, or app installation
- No sender, Mailgun integration, customer import/history backfill, webhook,
  queue consumer, or Appstle mutation
- No production host, theme, subscription, pricing, or customer change
