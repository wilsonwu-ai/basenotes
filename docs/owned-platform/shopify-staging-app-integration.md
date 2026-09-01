# Base Note Shopify staging-app integration

**Status: configuration and verification scaffold only. It has not created,
linked, installed, deployed, authenticated, or modified a Shopify app, theme,
store, subscription, customer, Appstle contract, or production resource.**

This document is the handoff for a separately created **Base Note Staging
Platform** app in Shopify Dev Dashboard and an isolated Shopify development
store. It is intentionally not a production setup guide.

## Staging boundary

```text
Development-store unpublished theme
  └─ inert `basenote-profile-queue-staging-mount` snippet (no network call)
       └─ /apps/basenote-staging/profile-queue
            └─ Base Note Staging Platform App Proxy
                 └─ app-staging.basenotescent.com static HMAC-gated preview

No route in this scaffold calls Shopify Admin, Appstle, Cloudflare D1,
Mailgun, Klaviyo, a browser API, or a production hostname.
```

The proposed app host is `app-staging.basenotescent.com`. It must be backed by
a separate staging deployment and separate secrets, not an alias for the live
site. The proposed storefront proxy is `/apps/basenote-staging`; Shopify permits
one configured app proxy per app, so this is intentionally a dedicated staging
app, not a modification to an existing production app.

## App configuration template

The only source-controlled configuration is
[`shopify.app.staging.example.toml`](../../apps/basenote-core/shopify.app.staging.example.toml).
It has a placeholder client ID and must stay a template until a merchant creates
a **separate staging Dev Dashboard app**. Do not insert client secrets anywhere
in the repository. Keep URL auto-update off so a local `app dev` tunnel cannot
silently rewrite the reviewed `app-staging` URLs.

The initial app is intentionally unembedded and requests only these scopes:

| Scope | Staging reason | Explicitly not allowed by it |
| --- | --- | --- |
| `read_products` | Server-side lookup of currently eligible fragrance variants for a future Queue UI. | Product writes, inventory writes, discounts, checkout changes. |
| `read_customers` | Bind a signed App Proxy customer to one server-side profile/binding record. | Customer profile writes, browser-supplied customer selection, email export. |
| `write_app_proxy` | Configure the single `/apps/basenote-staging` storefront path. | Theme writes, customer actions, subscription changes. |

The staging configuration deliberately excludes `write_customers`, order writes,
`read_all_orders`, payment, checkout, theme, and Appstle access. It also excludes
`read_own_subscription_contracts` and `write_own_subscription_contracts` until
Shopify approves the Subscription APIs and Base Note has a separate contract
pilot. App-owner-scoped contracts never grant permission to mutate Appstle-owned
contracts.

**Shopify Functions are not part of this scaffold.** Base Note’s current Grow
production plan must not be treated as a production Function entitlement. No
Function source, extension, or production pricing enforcement is added here.
The `$15`, `$20`, and `$18` domain rules remain locally testable policy only.

## Authentication and webhook boundary

There are two different HMAC checks with different secrets:

| Inbound path | Verifier | Secret | Before accepting |
| --- | --- | --- | --- |
| Storefront App Proxy | `src/auth/app-proxy.ts` | Staging app shared client secret | Verify query signature, timestamp, exact development-store domain, and logged-in customer. |
| HTTPS webhooks | `src/shopify-staging/webhook.ts` | Same staging app shared client secret | Preserve raw bytes; HMAC-verify first; then validate shop/topic/delivery ID; then deduplicate before parsing/queueing. |

The static App Proxy bridge is in
[`app-proxy-bridge.ts`](../../apps/basenote-core/src/shopify-staging/app-proxy-bridge.ts).
It returns a strict static preview only after App Proxy verification. It has no
write method, no queue data, and no network import. The eventual Queue API must
be a separate server adapter that derives the contract binding from trusted
server state; it must not accept a browser-supplied binding/contract ID.

`webhook.ts` is a raw-body HMAC boundary, not a webhook processor. A real route
must persist a verified `X-Shopify-Webhook-Id` idempotency key atomically before
processing a payload, return timely acknowledgements, and never parse or log raw
customer payloads before verification.

## Theme-safe Profile Queue mount

[`basenote-profile-queue-staging-mount.liquid`](../../snippets/basenote-profile-queue-staging-mount.liquid)
is unreferenced and inert. It renders only when an unpublished theme explicitly
passes `basenote_staging_enabled: true` and the request host equals the exact
development-store permanent domain. It contains no `<script>`, `<form>`, remote
asset, proxy URL, or customer data.

Do not add it to `theme.liquid`, a published section, or the live profile page.
It exists to prove safe layout placement before the App Proxy route is separately
approved and installed on the development store.

## Development-store install and QA checklist

Do these serially in a separate Shopify development store. Each unchecked item
is a hard stop, not an invitation to improvise access or production changes.

1. Create a new Dev Dashboard app named **Base Note Staging Platform**; verify
   it is distinct from every production, Appstle, and legacy app.
2. Record the development-store `*.myshopify.com` permanent domain and create a
   secret-manager entry for the staging app's shared client secret. Inject it
   under role-specific runtime references for App Proxy and webhook verification
   rather than creating an ad hoc browser or repository secret. Do not paste it
   into chat, source, browser storage, a `.env.example`, or GitHub.
3. Review the template line by line. Replace only its placeholder client ID and
   only the development-store domain in operator configuration; retain the
   approved staging `application_url`, two OAuth redirects, three scopes, one
   App Proxy route, and lifecycle/privacy webhooks.
4. Confirm the staging app is not installed on the live Base Note store. Do not
   give it a production app client ID or redirect URL.
5. Deploy a separately reviewed staging runtime whose health route proves it is
   in `staging`, whose egress policy rejects production hosts, and whose secret
   identities are separate from production. This repository does not supply a
   deployment command or runtime binding.
6. Install only on the development store. Verify the actual granted scope list
   matches `read_products`, `read_customers`, and `write_app_proxy` exactly.
7. Open `/apps/basenote-staging/profile-queue` as a logged-out visitor, a
   logged-in disposable test customer, a stale signed request, and a request
   for another shop. Only the valid disposable customer may see the static
   preview; none may see customer data or mutation controls.
8. Send synthetic signed `app/uninstalled` and privacy webhook fixtures to the
   staging receiver. Verify valid raw-body HMAC acceptance, invalid-HMAC reject,
   wrong-shop reject, duplicate-delivery idempotency, and no unverified payload
   logs. Do not use a production webhook endpoint.
9. Add the inert Liquid snippet only to an unpublished development-store theme;
   confirm it renders only with both explicit staging inputs and creates zero
   browser network requests. Remove it again before any theme publish.
10. Before adding the durable Queue API, obtain a new review for D1 bindings,
    contract-binding authorization, product eligibility, revision/idempotency,
    FOTM timezone/cutoff, feature flags, audit retention, test data deletion,
    Appstle boundary, and rollback.

## Acceptance evidence

Record these in the staging change log without secrets or raw customer payloads:

- staging app ID reference and store permanent domain reference (opaque IDs);
- actual granted scopes and proxy prefix/subpath;
- verifier test run output and invalid-signature screenshot/result;
- webhook delivery IDs and duplicate-handling result; and
- evidence that no production app, storefront theme, subscription contract,
  customer, sender, or Appstle contract was touched.

## References

- [Shopify app proxy configuration](https://shopify.dev/docs/apps/build/online-store/app-proxies)
- [Shopify webhook HMAC verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [Shopify app configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration)
