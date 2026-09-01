# Base Note Core: architecture and safe rollout

## Decision

Build a Base Note-owned Shopify app in stages. The first stages eliminate
client-side price promises and customer-wide queue state while preserving
Appstle's ownership of existing subscriptions. A later Base Note subscription
app owns **new** contracts; it does not silently take over Appstle contracts.

The store already has an installed Dev Dashboard app named **Basenote
Subscription Writer**. The local app foundation is designed to link to that
existing app identity only after its configuration, API approval, and secret
handling have been reviewed. No app version, install, scope, or secret is
changed by this repository work.

## Why this boundary matters

Shopify subscription contracts belong to the app that created them. A Base
Note app using `read_own_subscription_contracts` or
`write_own_subscription_contracts` can manage only Base Note-owned contracts,
not contracts created by Appstle. The historical queue Worker must therefore
not select an arbitrary “first active” contract and attempt a Shopify-native
swap.

```text
Now
Customer account / storefront
        |
        v
Base Note app: queue intent + pricing enforcement + audit
        |                                  |
        |                                  +--> Shopify Functions at checkout
        v
Appstle adapter (only if an approved server API can target an exact contract)
        |
        v
Existing Appstle subscription contract

Later
Customer account / storefront --> Base Note subscription app -->
Shopify selling plan + Base Note-owned contract + billing attempts
```

## Phase 1 — Pricing Guard

### Required behavior

- A genuinely new, signed-in Base Note subscriber can use the intro plan for a
  first $15 cycle; its renewal must be $20.
- A customer with any previous paid Base Note subscription cannot use the intro
  plan.
- An eligible one-time 5 ml vial in a cart containing a Base Note subscription
  costs exactly $18, without discounting the subscription line or unrelated
  products.

### Components

| Component | Responsibility |
| --- | --- |
| App webhook handler | After a successful paid Base Note subscription order, write a permanent `bn_subscription_ever` customer tag and `basenote.membership.subscription_ever` metafield. Deduplicate by webhook event ID. |
| Backfill job | Mark historical Appstle subscribers before validation is enabled; produce an exception report rather than guessing unmatched records. |
| Checkout Validation Function | Block guest or previously subscribed buyers from using the intro selling plan. |
| Product Discount Function | Reduce only explicitly eligible one-time vial lines to exactly $18 when an eligible subscription line is present. |
| Theme app block | Presents valid options, but never acts as the pricing authority. |

The existing automatic 10%-off / $33-minimum discount remains a legacy rule.
It must not be combined with the Function and must be disabled only after the
Function passes the checkout matrix.

### Pricing release gates

1. Capture current Appstle plan and automatic-discount settings.
2. Configure and verify the Appstle intro/standard selling-plan schedules.
3. Backfill and reconcile permanent former-subscriber history.
4. Deploy Functions inactive to a safe development/test store.
5. Pass new, returning, cancellation, renewal, add-on, direct-cart-API, and
   discount-stacking tests using disposable test identities.
6. Enable Functions, then update storefront price copy.

## Phase 2 — Queue v2

### Source of truth

Use an app database with a Shopify metafield mirror only for recovery. Do not
continue treating a single customer JSON array as an authoritative queue.

```text
contract_binding
  id, adapter_owner, canonical_contract_id, adapter_contract_ref,
  shopify_customer_id, subscription_line_id, status, next_billing_at,
  verified_at

queue_slot
  binding_id, cycle_key, ship_month, variant_id, source,
  state, revision, cutoff_at, updated_at

fotm_schedule
  ship_month, variant_id, merchant_timezone, cutoff_at,
  status, published_at, approved_by

apply_outbox
  binding_id, cycle_key, desired_variant_id, idempotency_key,
  status, attempts, adapter_receipt, error
```

### Customer API

All v2 operations use verified customer identity from a signed App Proxy or a
customer-account extension session token. The browser must never provide
authority merely by naming a customer or contract ID.

| Route | Purpose |
| --- | --- |
| `GET /apps/basenote/v2/contracts` | Return only the caller's verified bindings, slots, effective selection, cutoff, and revision. |
| `PUT /apps/basenote/v2/contracts/:id/slots/:cycleKey` | Set one exact eligible variant using an idempotency key and optimistic revision. |
| `DELETE /apps/basenote/v2/contracts/:id/slots/:cycleKey` | Clear a selection; resolve an approved FOTM only after adapter readback. |
| `POST /apps/basenote/v2/contracts/:id/reconcile` | Read back an exact binding without arbitrary mutation. |

### Adapter rule

For existing Appstle contracts, an adapter must call a documented,
server-to-server Appstle API with an exact contract and line identifier, then
read it back. If Appstle does not provide that capability, Queue v2 may store
intent but must not claim a queued choice or FOTM has changed a future
shipment. That is a production gate, not a UI workaround.

### FOTM resolution

At the approved cutoff:

1. Lock the slot revision.
2. Prefer a valid customer selection.
3. Otherwise resolve the published exact FOTM variant for that contract/cycle.
4. Check availability and plan compatibility.
5. Apply through the exact adapter and read it back.
6. Mark `applied` only after readback; otherwise mark `needs_attention`.

## Phase 3 — Base Note-owned subscriptions

Use a Partner/Dev Dashboard app approved for Shopify Subscription APIs. It
will own its selling plans, contracts, payment-method workflow, billing
attempts, retry/dunning rules, cancellations, and subscription webhooks for
**new** subscriptions. It must be tested separately from Appstle.

Migration is a formal release project:

1. Inventory every Appstle contract, payment-method constraint, price,
   upcoming billing date, and discount schedule.
2. Build a development-store migration rehearsal with synthetic contracts.
3. Choose whether existing customers are migrated with approved tooling or
   remain on Appstle until voluntary renewal/re-enrollment.
4. Prevent double billing, publish a customer communication plan, and retain a
   rollback runbook.
5. Only after reconciliation should the merchant approve Appstle removal.

## Queue acceptance matrix

- One contract: an exact slot update changes only its exact line after adapter
  readback.
- Two active contracts: A can never update B; queues are independently
  addressable.
- Clearing a next slot resolves FOTM only after a verified apply/readback.
- No FOTM, unavailable FOTM, paused/cancelled contract, cutoff lock, adapter
  timeout, and retry all fail closed into `needs_attention`.
- Cross-device simultaneous writes produce a revision conflict/reload, not a
  silent overwrite.
- Legacy single-contract queues can be imported only with exact eligible
  variant IDs. Multi-contract records require explicit customer/staff
  assignment.

## Explicit human gates

The following actions are intentionally out of scope until separately
approved:

- Changing Dev Dashboard app scopes, versions, redirect URLs, or app proxy.
- Requesting Shopify Subscription API or protected-customer-data approval.
- Creating/activating Shopify Functions or changing Appstle selling plans.
- Setting Cloudflare/Appstle/Shopify secrets or deploying a Worker.
- Creating real customer contracts, billing attempts, or modifying current
  subscriptions.
- Publishing a theme, switching customer accounts, migrating contracts, or
  uninstalling Appstle.
