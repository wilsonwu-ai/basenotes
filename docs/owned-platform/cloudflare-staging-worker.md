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
  src/cloudflare-staging-worker/cutoff-locker.ts
  src/cloudflare-staging-worker/fotm-schedule-admin.ts
  src/cloudflare-staging-worker/webcrypto-shopify-admin-id-token.ts
  src/cloudflare-staging-worker/admin-id-token-replay.ts
  src/cloudflare-staging-worker/admin-scheduler-request-validation.ts
  src/cloudflare-staging-worker/admin-scheduler-page.ts
  src/cloudflare-staging-worker/http.ts
  wrangler.staging.example.toml
  migrations/0001_staging_runtime.sql
  migrations/0002_staging_test_bindings.sql
  migrations/0003_member_fragrance_choice.sql
  migrations/0005_staging_admin_scheduler.sql
```

- `GET /healthz` is host-restricted and returns only fixed staging capability
  status. It does not query D1.
- `GET /api/shopify/app-proxy/profile-queue` renders a no-JavaScript,
  server-side Profile Queue page only after the signed-request and exact
  ownership gates pass.
- The page shows the published FOTM as the visibly pre-selected included
  default. A customer saves only a month-specific override; otherwise the
  FOTM remains the fallback at the exact **12:01 AM America/Chicago** cutoff.
  It separately exposes at most four `$18.00`
  add-on slots. A fragrance chosen in a prior month remains eligible; no
  history/gamification rule exists here. Labels come only from
  `STAGING_TEST_VARIANT_IDS`; no Admin, storefront, or catalog call is made.
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
  four-add-on / exact-$18 Core rules, records an immutable non-PII resulting
  selection snapshot whose ordered add-ons exactly reconcile to D1, and writes
  only through the Core D1 repository once all authorization gates are present.
- A bounded staging cron remains inert until protected staging explicitly sets
  `STAGING_CUTOFF_AUTOMATION_ENABLED=true` after migration 0003 and a
  disposable E2E gate. Each tick makes one due-cycle scan, at most ten add-on
  reads, and at most ten D1-only compare-and-swap writes. It enforces the
  `12:01 AM America/Chicago` product cutoff policy, locks D1 only, and never
  calls Shopify, Appstle, Mailgun, or production.
- `GET /admin/fotm-scheduler` is an unprivileged Shopify embedded-App Bridge
  bootstrap shell. It contains no schedules, variants, customer data, staff
  data, bearer token, or secret. Its CSP can be framed only by Shopify Admin
  and the exact disposable shop.
- `GET` and `POST /api/admin/fotm-schedules` are the only scheduler API routes.
  They are not App Proxy routes and have no public schedule writer. Every API
  request server-verifies a fresh Shopify Admin HS256 ID token with exact app
  audience, staging issuer/destination shop, `exp`/`nbf`, and an opaque
  allowlisted staff `sub`. Unsafe POSTs retain only a SHA-256 `jti` digest in
  D1 and reject a replay.
- Authenticated staff can draft/publish a durable future-month FOTM and then
  provision at most five exact `OPEN`/`UNPUBLISHED` staging cycles per request.
  Each cycle uses CAS plus immutable audit/evidence and becomes `PUBLISHED` +
  `UNSELECTED`: its FOTM is visibly pre-selected as the one included fragrance,
  not a paid add-on and not a stored member override. No scheduler path calls
  Shopify, Appstle, an email provider, or production.
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
| `STAGING_ALLOWED_ORIGINS` | Exact disposable storefront, exact temporary Worker origin, and local development only. Shopify may forward the storefront Origin on a proxied native form POST; the embedded scheduler uses its exact Worker origin. No wildcard is supported. |
| `STAGING_SHOP_DOMAIN` | Exact disposable development shop: `base-note-subscription-staging.myshopify.com`. |
| `STAGING_TEST_VARIANT_IDS` | Comma-separated exact disposable Shopify ProductVariant GIDs; this is the page dropdown catalog. |
| `STAGING_CUTOFF_AUTOMATION_ENABLED` | Defaults to `false`. Exact `true` enables only the bounded staging D1 cutoff lock after migration 0003 and E2E approval. |
| `SHOPIFY_APP_PROXY_SHARED_SECRET` | Runtime-only Shopify App Proxy shared secret, stored outside git and never in Wrangler vars/template. |
| `SHOPIFY_ADMIN_CLIENT_ID` | Public ID of the separately approved staging embedded Shopify app. It may render only in the bootstrap shell; it is not a secret. |
| `SHOPIFY_ADMIN_CLIENT_SECRET` | Runtime-only HMAC secret for server verification of Shopify Admin ID tokens. Use protected secret storage only; never add it to vars/template/git/browser. |
| `STAGING_ADMIN_ALLOWED_STAFF_IDS` | Comma-separated exact opaque numeric Shopify Admin ID-token `sub` values for approved staging staff only; never names or email addresses. |
| `BASENOTE_STAGING_D1` | Binding to a separately created empty staging D1 database only. |

The expected Shopify configuration is an App Proxy with the target above,
prefix `apps`, subpath `basenote-staging`, and child route `profile-queue`.
The signed customer-facing path is therefore
`/apps/basenote-staging/profile-queue`. The source has no app ID, account ID,
D1 ID, secret, OAuth callback, or production route. The temporary isolated
Worker endpoint is deliberately a `workers.dev` hostname, not a production DNS
route; the template enables only that temporary endpoint after approval.

The separate issue #35 embedded-Admin configuration is deliberately not made by
this branch. After explicit approval, a designated operator must configure the
already-approved staging app as embedded for only
`base-note-subscription-staging.myshopify.com`, set its App URL to
`https://basenote-profile-queue-staging.wilson-af8.workers.dev/admin/fotm-scheduler`,
place its client secret in protected staging secret storage, and allowlist only
reviewed opaque staff subjects. The scheduler has **no App Proxy target**. The
browser must obtain a fresh App Bridge ID token for every API request; the
Worker verifies it rather than trusting browser claims.

## D1 migration and disposable binding sequence

After explicit staging resource approval, and only for a fresh isolated staging
D1 database, a designated operator must perform these reviewed steps in order:

1. Apply `migrations/0001_staging_runtime.sql`.
2. Apply `migrations/0002_staging_test_bindings.sql`.
3. Apply `migrations/0003_member_fragrance_choice.sql`.
4. Apply `migrations/0004_durable_historical_backfill.sql` byte-for-byte from
   staging head; it is separately owned and this work never changes it.
5. Apply `migrations/0005_staging_admin_scheduler.sql`.
6. Create or seed one reviewed disposable queue cycle in
   `profile_queue_cycles` for the exact test binding, cycle key, and ship month.
7. Seed one matching row in `staging_profile_queue_test_bindings` with that
   exact development shop, test customer ID, binding, cycle, ship month,
   opaque actor reference, `DISPOSABLE_DEVELOPMENT_STORE` source, `ACTIVE`
   status, opaque seed reference, and a short expiry.
8. Configure the runtime-only variables/binding above, then perform a
   disposable-customer end-to-end test before any wider staging use.

Migration `0002` creates no customer, binding, queue-cycle, or active form
nonce. It includes the one-use nonce table, but only a successfully signed GET
can issue an expiring nonce for an exact authorized test cycle. It is
intentionally impossible for an unseeded database to authorize a customer.
Never seed names, email addresses, payment data, Appstle credentials, or
production records. The migrations are intentionally not executed by `npm`,
the Worker, or this branch.

Apply `0003` only through `wrangler d1 migrations apply`, which stops and rolls
back a migration on error. Do not apply it through a raw `sqlite3 < file`
redirection. The local `npm run migration:smoke` regression invokes
`sqlite3 -bail` specifically so an invalid legacy preflight cannot continue
into persistent DDL.

Apply `0005` through the same migration runner only. It adds an append-only
replay table containing just a SHA-256 digest of a short-lived Admin ID-token
nonce and timestamps. The local `npm run admin-scheduler:migration:smoke`
proves duplicate, malformed, expired, update, and delete records are rejected.

If a nonempty *staging* D1 is ever intentionally migrated, `0003` carries a
legacy `RESOLVED` non-open cycle forward as an FOTM fallback using its existing
FOTM variant and `updated_at`. It does not invent a member override. Other
inconsistent closed legacy shapes, or an existing published/resolved cutoff
that is not 12:01 AM Central, abort the migration for manual reconciliation.

## Future-month FOTM schedules and staff boundary

Migration `0003_member_fragrance_choice.sql` adds one durable FOTM schedule
per `ship_month`, with draft/published state, an `America/Chicago` cutoff
policy fixed to 12:01 AM local time (DST-safe in Worker code), revision checks,
and an append-only non-PII audit. It supports
independent September/October/November configuration instead of overwriting a
single current-month setting. It is never itself a member override: at cutoff,
the scheduler locks either the saved override or that published FOTM fallback.

The existing theme FOTM setting may provide a display value, but it does not
configure the durable schedule, authorize a member request, lock a cutoff, or
prove a provider delivery change.

`StagingFotmScheduleAdminBoundary` is a server-facing D1 port requiring an
opaque `SERVER_VERIFIED_STAGING_STAFF` context. Issue #35 now provides that
context only after the Worker verifies a fresh Shopify embedded Admin ID token
on the server: HS256 HMAC, exact client ID/audience, exact staging-shop
issuer/destination, `exp`/`nbf`, and exact opaque staff allowlist. A POST then
consumes a D1 row holding only a SHA-256 digest of `jti`; duplicate bearer
nonces are rejected before a schedule/cycle mutation. There is no public
schedule writer or App Proxy writer, OAuth exchange, session persistence, or browser-supplied
staff authority.

After an authenticated staff member publishes an exact month, the scheduler
may call `applyPublishedFotmScheduleToProfileQueueCycle` only for up to five
exact `OPEN`/`UNPUBLISHED` staging cycles in a request. Every mutation uses the
existing revision CAS plus append-only queue audit and non-PII selection
evidence. The result remains `UNSELECTED` until a member chooses an override:
the FOTM is visibly pre-selected as the included item, falls back at Central
cutoff only if no override exists, and is never converted into an add-on or
invented member selection. Repeating provisioning sees only still-unpublished
cycles; it never calls a provider. This is still a staging deploy/E2E blocker,
not a claim that a theme setting or D1 record changes an Appstle/Shopify
shipment.

## Transport, request, and data safeguards

- An allowed non-local host must use HTTPS. A request with
  `X-Forwarded-Proto: http` is rejected; that header can never upgrade an HTTP
  Worker URL to HTTPS.
- HMAC-bearing requests independently enforce the same HTTPS rule before
  signature verification.
- Customer JSON/form bodies are read as a bounded stream, capped at 16 KiB;
  scheduler JSON commands are capped at 8 KiB. An
  oversized declared, chunked, or misreported body is canceled rather than
  buffered with `request.text()`.
- Form fields and JSON keys are exact/unique. The browser cannot provide a
  contract binding or a server-generated add-on/audit ID.
- A `pqf_` form nonce is generated only after signed identity, exact binding,
  and exact cycle checks. It expires after ten minutes and the D1 conditional
  update consumes it before queue persistence, so it cannot be replayed or
  retargeted by a cross-site form even when Shopify omits an `Origin` header.
- CORS has exact configured origins only. Customer responses are `no-store`,
  use a restrictive CSP with `frame-ancestors 'none'`, and use
  `X-Frame-Options: DENY`. The unprivileged embedded Admin shell instead has a
  CSP restricted to Shopify Admin + the exact disposable shop and intentionally
  omits `X-Frame-Options`; its protected API remains no-store. Neither surface
  contains raw request data, error stacks, customer identity, or logging call.
- There is no sender, Mailgun key, Queue consumer, webhook, OAuth, Appstle
  mutation, Shopify Admin/storefront API call, public staff scheduler route, or
  production host/theme change.

## Page design brief

The page is a compact **luxury restraint** surface for a fragrance subscription:
paper/ink/gold tokens, serif editorial hierarchy, a visibly pre-selected FOTM
default, an optional included-fragrance override, and four explicit `$18`
add-on slots. It is intentionally not a generic dashboard. It uses semantic
sections, labels, visible focus states, mobile grid fallback, clear pre/post
cutoff states, and no JavaScript or external asset on the customer page. The
separate embedded Admin shell uses only Shopify App Bridge plus a same-origin
authenticated API; it contains no protected scheduler data before verification.

## Checks

From `apps/basenote-core` after installing the existing lockfile dependencies:

```sh
npm run check
```

The check runs the offline structural verifier, Core typecheck, Web Worker-only
typecheck, SQLite migration smoke (requires the `sqlite3` CLI), and unit suite. The tests cover the reconciled target path, HMAC
verification, secret/shop fail-closed behavior, non-HTTPS rejection, exact D1
binding lookup, oversized streaming body cancellation, allowlisted variants,
one-use form nonce behavior, a fixed duplicate-parameter HMAC vector, the
pre/post-cutoff member UI, future-month schedule revisioning, authenticated
Admin token invalid/missing/wrong-shop/staff/replay cases, duplicate/stale
schedule submits, and bounded D1-only schedule provisioning/cutoff locking.
SQLite migration smoke checks cover legacy resolved backfill, append-only
evidence, exact add-on snapshot reconciliation, the 12:01 AM Central cutoff
guard, and append-only Admin-token replay records. They make no network,
Cloudflare, Shopify, email-provider, or file-database call.

The source cannot safely be browser-tested against a live protected Worker yet:
that requires the approved disposable D1 seed, protected runtime secrets, and
both Shopify App Proxy and embedded-App configuration above. The unit-level
rendered workflows are covered; desktop/mobile browser acceptance is an
explicit later staging gate.

## Explicit exclusions

- No deployment, D1 creation, account ID, live route, custom-domain change,
  credential, secret, OAuth, Shopify CLI, or app installation
- No sender, Mailgun integration, customer import/history backfill, webhook,
  queue consumer, or Appstle mutation
- No production host, theme, subscription, pricing, or customer change
