# Cloudflare staging profile-queue Worker

**Status: reviewed source and an unapplied configuration template only. It has
not been deployed, bound to D1, connected to Shopify, connected to Appstle,
given a secret, or used to send email.**

This is a deliberately small staging adapter around the Base Note Core
profile-queue contracts. It is intended to be deployed only after a fresh,
empty, separately approved D1 database exists for staging.

## What the adapter contains

```text
apps/basenote-core/
  src/cloudflare-staging-worker/worker.ts
  src/cloudflare-staging-worker/request-validation.ts
  src/cloudflare-staging-worker/boundaries.ts
  src/cloudflare-staging-worker/http.ts
  wrangler.staging.example.toml
  migrations/0001_staging_runtime.sql
```

- `GET /healthz` is host-restricted and returns only fixed staging capability
  status. It does not query D1.
- `GET` and `POST /apps/basenote/profile-queue` are staged route shapes around
  the durable profile-queue repository.
- Browser requests have a strict JSON size/type/key boundary, must match an
  `Idempotency-Key` header, cannot provide a binding ID, and cannot choose an
  add-on ID for a new add-on.
- The Worker creates add-on and audit IDs server-side, applies the existing
  four-add-on / exact-$18 Core rules, and writes only through the Core D1
  repository once all future authentication gates are present.
- Exact allowed staging hosts and origins are configured with no wildcard CORS.
  The code rejects production-looking hosts and refuses to run queue routes
  unless `BASENOTE_RUNTIME_STAGE=staging`.
- Responses are generic, no-store JSON and intentionally contain no customer
  identity, binding ID, raw request, error stack, or log call.

## Why it cannot process customer mutations yet

The default signed-request boundary always returns `503 staging_not_configured`.
That is by design. A Shopify App Proxy HMAC signature proves a request came
through Shopify, but it does not itself establish that a customer owns a
specific subscription binding. The two missing reviewed adapters are separate:

1. A raw-query App Proxy HMAC verifier that validates signature, timestamp,
   intended shop, and logged-in customer using a runtime secret held outside
   this repository.
2. An exact contract/cycle ownership resolver that reads a server-side binding
   and verifies it belongs to that signed customer and is editable.

Neither adapter, OAuth token, Shopify API client, Appstle client, customer
export, sender, Mailgun key, webhook, or Queue consumer is included here. This
means the checked-in Worker can be deployed safely to prove health routing and
D1 migration mechanics, but it cannot become an unsigned customer write API.

## D1 staging procedure — approval required later

The template uses the explicit resource name
`basenote-profile-queue-staging` and placeholder ID only. A designated operator
must separately:

1. Create an empty **staging** D1 database in the intended Cloudflare account.
2. Review backup/retention/access controls and the SQL migration against that
   exact empty database.
3. Copy the template only into a protected deployment context, replace the
   placeholder D1 ID there, and keep the resource binding staging-only.
4. Deploy after a review. Add the staging custom domain separately; do not add
   a production route or a wildcard route.
5. Run health and migration smoke tests with disposable records. Do not import
   customer history or enable a signed queue mutation until the two boundaries
   above and end-to-end Shopify tests have passed.

The migration is intentionally not executed by `npm`, the Worker, or this
branch. It stores opaque identifiers and append-only audit rows; it must never
be pointed at a production D1 database.

## Checks

From `apps/basenote-core` after installing the existing lockfile dependencies:

```sh
npm run worker:check
npm test
```

The Worker-specific compiler configuration uses Web Worker types with no Node
types. This catches accidental Node-only imports such as the Core's local
`node:crypto` App Proxy verifier. Unit tests inject an in-memory repository and
fake signed/ownership boundaries; they make no network, Cloudflare, Shopify,
email-provider, or file-database call.

## Explicit exclusions

- No deployment or D1 creation
- No account ID, route, custom domain, credential, secret, OAuth, or Shopify CLI
- No sender, Mailgun integration, customer import, webhook, queue consumer, or
  Appstle mutation
- No production host, theme, subscription, pricing, or customer change
