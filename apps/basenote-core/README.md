# Base Note Core

**Status: local-only foundation. It is deliberately not linked to a Shopify app.**

This package is the starting point for Base Note's subscription and queue
platform. It contains no credentials, app registration, Shopify configuration,
installation, deployment target, or database connection. Running it locally
starts a loopback-only health server; it cannot call Shopify or mutate a
subscription contract.

## Why this exists

The current storefront queue is coupled to Appstle. Base Note Core is intended
to make a queue explicitly contract-scoped, so a customer with two subscriptions
never has one contract selected implicitly. It also defines a deterministic
Fragrance of the Month (FOTM) fallback when a queue slot is empty.

The boundary is intentional:

```text
customer account / app proxy
            |
            v
Base Note Core API + durable queue store
            |
            +-- hybrid bridge (approved Appstle server-to-server API)
            |
            +-- later: Base Note-owned Shopify subscription contracts
```

Shopify subscription-contract access is app-owner scoped. A Base Note app can
only read and write contracts that Base Note created; it cannot use
`write_own_subscription_contracts` to edit Appstle-owned contracts. The hybrid
bridge therefore needs an Appstle-supported server-to-server integration that
can update one exact contract line and read it back. A Flow or metafield signal
can record intent, but is not proof that an Appstle shipment was changed. Do
not route an Appstle contract through the future Base Note Shopify contract
gateway.

Relevant Shopify references:

- https://shopify.dev/docs/apps/build/purchase-options/subscriptions/contracts/build-a-subscription-contract
- https://shopify.dev/docs/api/usage/access-scopes

## Local use

Requirements: Node 20.10+ and npm.

```sh
cd apps/basenote-core
cp .env.example .env
npm install
npm run check
npm run dev
curl http://127.0.0.1:3000/healthz
```

`npm run dev` binds only to `127.0.0.1`. In local mode, startup refuses to run
if Shopify credentials or an Admin access token are present in the environment.
Every Shopify-facing route returns a local-only response and no customer data is
stored.

## Design invariants already encoded here

- Every queue slot has a required Shopify `SubscriptionContract` GID.
- Every queued scent has an exact Shopify `ProductVariant` GID; there is no
  title, handle, or URL fallback for new writes.
- A queue operation may only act on the contract ID supplied by the authenticated
  context; it must never select a customer's “first active” contract.
- The next shipment resolves to the queued variant or an explicit FOTM variant.
- A provider may mutate only a contract whose `appId` matches Base Note's future
  app ID.

The current source is deliberately local-domain logic only. It includes a
testable App Proxy HMAC verifier, pure pricing policy, an in-memory queue state
machine, a D1-shaped-but-unbound profile-queue repository/migration, a
staging-only queue-dropdown renderer, a durable-but-unbound historic-member
manifest/approval lifecycle, and a Messaging Core for consent, event audit,
and no-send delivery intents. It has
no configured persistence, OAuth/session implementation, webhook route,
Appstle integration, Shopify Admin API call, recipient resolver, email sender,
or billing attempt.

## Repository layout

```text
src/
  auth/app-proxy.ts                  Signed Shopify App Proxy verification
  config.ts                         Local-only startup gate
  index.ts                          Loopback health server
  domain/ids.ts                     Strong Shopify GID validation
  domain/queue.ts                   Contract-scoped queue + FOTM resolution
  messaging/contracts.ts            PII-minimizing messaging data contracts
  messaging/consent.ts              Consent/suppression audit ledger
  messaging/events.ts               Idempotent customer-event audit ledger
  messaging/outbox.ts               Explicit-eligibility, no-send outbox
  pricing/pricing-policy.ts         Pure $15/$20 and exact-$18 policy logic
  queue/in-memory-queue-service.ts  Revisioned queue/outbox state machine
  profile-queue/contracts.ts        FOTM + maximum-four future add-on contract
  profile-queue/service.ts          Pure queue mutation/cutoff state machine
  profile-queue/d1-repository.ts    Injected D1 persistence shape; no binding
  profile-queue/ui.ts               Static staging-only dropdown renderer
  subscription-history/             Dry-run and durable approval-gated historic evidence
  staging-runtime/d1.ts             Minimal D1 structural port, no runtime import
  domain/queue.test.ts              Invariant tests
  platform/subscription-gateway.ts  Provider boundary for Base Note-owned contracts
migrations/0001_staging_runtime.sql Reviewed, unapplied D1 schema
migrations/0004_durable_historical_backfill.sql
                                  Immutable dry-run manifest and staging-only
                                  historical backfill lifecycle
scripts/verify-skeleton.mjs         Offline structural/safety verification
shopify.app.example.toml            Deliberately unlinked future config template
```

## Required gates before any Shopify connection

All of these must be complete before copying `shopify.app.example.toml` to
`shopify.app.toml`, adding credentials, running `shopify app dev`, installing
an app, or deploying an app version.

1. Use the existing **Basenote Subscription Writer** Dev Dashboard app only after
   confirming its owner, client ID, approved scopes, and intended production
   relationship. Do not expose its client secret in this repository or chat.
2. Obtain the relevant Shopify approval for protected Subscription APIs before
   requesting or configuring those scopes.
3. Decide the transition boundary in writing: keep Appstle contracts in Appstle
   with a supported bridge, or create Base Note-owned contracts only for new
   subscribers. Existing Appstle contracts cannot be silently taken over.
4. Provision a production backend, encrypted session/token storage, durable
   database, secret manager, audit log, backup/retention policy, and incident
   owner. Do not store customer or payment data in browser local storage.
5. Implement authenticated OAuth/session handling with Shopify's maintained
   library, signed webhook verification, App Proxy verification, least-privilege
   scopes, idempotency keys, rate-limit handling, and CSRF protection.
6. Build pricing as an audited selling-plan/contract policy plus Shopify
   Functions where appropriate. Verify `$15` first order, `$20` renewals, and
   the exact `$18` add-on with disposable test customers. Theme text alone is
   not enforcement.
7. The current store uses legacy customer accounts, so add an approved signed
   App Proxy/theme surface for the first release. Use a Customer Account
   extension only after a separately approved account upgrade; do not expose
   internal contract IDs or actions without authorization.
8. Test one-contract, two-contract, paused, cancelled, retry, FOTM fallback,
   failed webhook, duplicate request, and rollback cases in a development store.
9. Obtain an explicit production-release approval with a migration/rollback plan
   and customer communications. Keep Appstle installed until the migration is
   validated.

## Explicitly out of scope for this foundation

- Registering, installing, deploying, or configuring a Shopify app
- Creating Shopify Functions or Customer Account extensions
- Modifying Appstle, Shopify subscriptions, pricing, discounts, customers, or
  the published theme
- Accessing Shopify credentials, payment methods, customer data, or the existing
  Cloudflare Worker secrets

The companion staging decision is documented in
[`../../docs/owned-platform/email-delivery-decision.md`](../../docs/owned-platform/email-delivery-decision.md).
It selects no provider account or live sender; it describes the proposed
Cloudflare + Mailgun boundary and the gates required before a test integration.
The local-only staging runtime slice is documented in
[`../../docs/owned-platform/staging-runtime-slice.md`](../../docs/owned-platform/staging-runtime-slice.md).

## Future commands (do not run yet)

After the gates above are approved, a maintainer can link the existing approved
Dev Dashboard app using its client ID, fill the template with real URLs, add a
secure environment, and then use the Shopify CLI. This repository intentionally
does **not** provide copy-paste deployment or installation commands so that local
scaffolding cannot accidentally become a production change.
