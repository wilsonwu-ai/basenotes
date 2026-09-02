# Staging profile-queue evidence log

## 2026-09-01 — isolated development-store connection

This record covers only the disposable Base Note Subscription Staging store and
the temporary staging Worker. It contains no customer contact information,
credentials, payment details, production domain, or production records.

### Connected components

- A separate Dev Dashboard app version is installed only on the isolated
  development store.
- Its Shopify App Proxy forwards the staging storefront route to the temporary
  Cloudflare Worker endpoint.
- A separate staging D1 database has migrations `0001` and `0002` applied.
- The App Proxy shared secret is configured as a Worker secret and is not
  present in this repository or this log.

### Verified disposable-customer path

One expiring test binding and open future cycle were seeded with opaque IDs
only. A disposable test customer then completed Shopify's normal account sign
in and exercised the signed storefront proxy.

The following behavior was observed end to end:

1. An unbound storefront visit returned the generic unavailable page.
2. The exact signed and bound route rendered the server-side Profile Queue.
3. Four `$18` add-on slots were available independently of the automatic FOTM
   placeholder.
4. Add operations persisted through D1 with an optimistic revision increment,
   append-only mutation audit record, and consumed one-use form nonce.
5. At four add-ons, the dropdown and submit control were disabled.
6. Removing an add-on compacted the queue and reopened one slot.

The test records expire on 2026-09-08. They are not production customer or
subscription data and are not a migration rehearsal.

### Known follow-up at the time of this run

- Jeff clarified after this run that the included fragrance must be
  member-selectable for each future shipment. If it is left unselected at the
  Central Time cutoff, FOTM is the fallback; prior-month choices remain
  eligible. The four paid add-ons remain separate. See issue #33.
- The currently deployed foundation does not yet have a scheduled cutoff
  resolver or Shopify order/contract write. The member-choice and automatic
  fallback layer must replace this foundation before it is review-ready.
- No Appstle contract, production Shopify customer, production theme, Shopify
  Admin mutation, email sender, subscription billing attempt, or Klaviyo data
  was changed.
- The production store's plan and required Shopify protected subscription/API
  approvals remain explicit release gates.

## 2026-09-01 — authenticated scheduler and member-choice acceptance

The later staging increment applied migrations `0003` through `0006` to the
same isolated D1 database and deployed commit `703d7bf` only to the staging
Worker. A fresh install passed the structural verifier, all migration smokes,
both TypeScript checks, and 149 of 149 tests.

The controlled development-store acceptance run verified:

1. Two retained ambiguous provision claims were terminalized to
   `NEEDS_ATTENTION` without provisioning a delivery cycle.
2. One fresh October provision completed with one configured cycle and zero
   conflicts.
3. The published FOTM appeared as the included preselected fragrance.
4. A member override could be saved and cleared without changing the FOTM
   schedule, and a fragrance used in a prior month remained eligible.
5. Four ordered `$18` add-ons could be added; the fifth slot was disabled.
6. Removing all four add-ons returned the cycle to the published FOTM with no
   member override and zero add-ons.
7. The resulting command, mutation, selection, and append-only audit evidence
   reconciled to the final D1 state.

This acceptance run proves only the isolated scheduler and Profile Queue
boundary. It did not create or bill a Shopify subscription contract, alter an
Appstle contract or production customer, import subscriber history, send an
email, or deploy a production route. Automatic cutoff execution and all
provider egress remain disabled. Native subscription-contract integration,
approved history migration, messaging-provider setup, and an explicit
production change window remain release gates.
