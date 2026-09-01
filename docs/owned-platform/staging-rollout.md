# Base Note owned-platform staging rollout

## Objective

Replace the parts of Appstle and Klaviyo that Base Note needs to control while
keeping Shopify responsible for checkout, payment vaulting, orders, customer
records, and Base Note-owned subscription contracts. This is a staged migration,
not an in-place switch.

## Environment boundary

| Environment | App/runtime | Shopify | Email | Customer data |
| --- | --- | --- | --- | --- |
| Local | `work/basenote-owned-platform` and loopback-only Core | No app connection | No sender | Synthetic fixtures only |
| Staging | Proposed `app-staging.basenotescent.com` | Separate Dev Dashboard app configuration and Shopify development store | Sandbox/allowlisted test transport only | Test customers only |
| Production | Proposed `app.basenotescent.com` | Separate production app configuration | Approved authenticated sender | Production data under retention/access controls |

The names above are proposals only. Creating DNS records, apps, stores,
credentials, or deployments is outside this repository change.

## Base Note-owned components

```text
Storefront / signed App Proxy
             |
             v
Base Note backend
  - customer profile + consent/suppression ledger
  - event audit log and idempotent outbox
  - queue/FOTM service and subscription policy
  - admin review/audit UI
             |
             +--> Shopify Admin/Functions/Subscription APIs
             +--> approved email transport adapter
```

Email delivery is deliberately an adapter. Base Note can own the audience,
consent, templates, workflow logic, audit trail, and sending policy without
attempting to operate an SMTP/deliverability network.

## Release order

1. **Foundation** — complete local domain logic, tests, data contracts, and
   threat-model review. No customer data or sends.
2. **Staging runtime** — provision isolated backend, database, job queue,
   secrets, monitoring, Shopify development app, and a test-only sender.
3. **Email shadow mode** — import only approved test records; capture Base Note
   events and calculate audiences/outbox decisions without sending production
   email. Preserve existing Klaviyo flows.
4. **New-subscription pilot** — create Base Note-owned subscription contracts
   only for staff/disposable test customers. Exercise selling plans, billing,
   retries, queue edits, FOTM, webhook idempotency, and cancellation.
5. **Controlled production launch** — enable a narrow, feature-flagged cohort
   after merchant approval. Keep Appstle and Klaviyo as fallbacks.
6. **Legacy migration** — only after an Appstle-supported contract/payment
   migration rehearsal, reconciliation report, customer notice, and rollback
   plan. Do not uninstall Appstle while any active contracts remain.

## Immediate Klaviyo-limit response

Do not mass-delete profiles. First export/audit profile, consent, suppression,
and engagement data; then consider suppressing only clearly unengaged profiles
under a reviewed policy. Existing unsubscribe, complaint, hard-bounce, and
transactional-notification behavior must be preserved before any sender change.

## Required decisions before production work

- Whether the 25% intro price is the first cycle or begins after a commitment
  period.
- Whether four fragrance selections mean four future cycles, items per shipment,
  or another cadence.
- Whether $18 add-ons apply only in a qualifying subscription cart or to later
  orders by an active member.
- The provider and account owner for email transport, including SPF/DKIM/DMARC
  and send-volume warm-up.
- The Appstle-supported strategy for existing contracts and payment methods.
- The production data-retention, role-access, incident, and release owner.

See [requirements-ledger.md](requirements-ledger.md) for the sanitized request
traceability and test order.
