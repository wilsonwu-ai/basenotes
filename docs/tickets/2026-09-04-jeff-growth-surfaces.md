# Jeff growth surfaces — founding proof, price comparison, and extra-vial add-on

Date: 2026-09-04
Source: latest visible Jeff WhatsApp thread

## Context

Jeff asked for more visibility on product pages, specifically mirroring the founding-member progress proof near purchase, and suggested a compare-price action that can appear in search/product discovery. The same thread discussed an optional extra vial as a recurring add-on.

The pop-up/market-festival messages are operational context: customers should be able to smell fragrances and buy in person. They are not included in this code ticket because a venue, date, inventory plan, and offer still need to be confirmed.

## Acceptance criteria

- Product pages show the founding-member progress proof near the subscription purchase control, with editable current-member and goal settings.
- Product pages and product cards expose an accessible “Compare price” action for subscription scents, showing an exact retail reference when available and a transparent retailer-variation note otherwise.
- The comparison action opens a keyboard-dismissible, focusable modal and does not navigate the shopper away from the current page.
- When the merchant gate is enabled and live allocations are valid, a shopper can choose one or two extra 5ml vials on the same monthly subscription checkout.
- Every extra vial is exactly $18 on the initial order and exactly $18 on every recurring order. The first-order 25% base-subscription promotion must not discount an add-on. Jeff's acceptance example is one $15 base subscription plus two $18 extras, totaling $51 before tax and shipping.
- The add-on offer stays hidden unless the configured selling plan is recurring and every live selling-plan allocation proves the $18 initial and recurring prices. Price or plan ambiguity fails closed before any cart write.
- Cart changes target an exact variant, selling plan, line key, quantity, and $18 allocation. A failed verification restores and verifies the pre-change extra-vial quantity before reporting an actionable error; retries converge on the selected quantity instead of adding duplicates.
- The add-on SKU cannot be selected as the base subscription during swap detection, quick add, or its direct product page.
- Existing single-subscription, swap, rotation, and quick-add behavior remains unchanged.

## Implementation

- Shopify product: `Extra 5ml Vial Add-On` (`extra-5ml-vial-add-on`)
- Variant: `48547911696602`
- Current Appstle selling plan: `26547585242` (`Monthly Subscription`) — **not approved for the add-on** because its live initial allocation is discounted.
- Current Appstle plan group: `Monthly Plan` (`3355771098`)
- Native Appstle “Add to Existing Subscription” was checked and is Enterprise+/Business Premium-only on the current account. This storefront scope can add a separately verified recurring line during the initial checkout; it does not claim to modify an existing subscription contract.
- A separate Appstle recurring plan with a 0% first-order discount is required. After an operator verifies that plan's Storefront allocation is $18 initially and recurringly, they must enter its selling-plan ID and separately enable the section's `show_extra_vial_offer` gate. This code does not change Appstle configuration.
- `sections/main-product.liquid` renders the founding proof, gated add-on quantity selector, and compare-price triggers. It excludes variant `48547911696602` from base-subscription swap detection and blocks its direct purchase surface.
- `assets/bn-extra-vial-cart.js` owns exact price/plan verification, idempotent desired-quantity updates, and verified rollback.
- The theme renders one native compare-price dialog with focus containment, Escape/backdrop controls, focus return, and listener cleanup for PDP, collection, search, and related-product triggers.

## QA evidence

- WhatsApp source-of-truth: Jeff specified $18 flat for each additional bottle, including alongside a $15 base subscription (PK 54054, 55252, 55253, and 55341; August 23–September 1, 2026). No Jeff-authored $9/$12 instruction was found.
- Read-only Storefront JSON observed September 5, 2026: variant `48547911696602` is $18 base/$20 compare-at, while selling plan `26547585242` allocates $13.50 initially and $18 recurringly because the 25% first-order promotion applies. That live configuration fails this ticket and therefore must not be enabled.
- Deterministic tests cover the $51 bundle example, price-mismatch fail-closed behavior, add-on exclusion from base swap detection, idempotence, and verified rollback.
- Baseline and branch Theme Check results must be recorded as a differential. Pre-existing theme offenses are not evidence that this change passes; this change must add zero new offenses.
- Final browser and Shopify draft-theme QA remain required before merge or publication. Do not place a checkout/order during QA.


## Pricing ladder (owner-stated, 2026-08-31 and 2026-09-01)

| Tier | Base | Each add-on vial |
|---|---|---|
| One-time purchase | $20 | $18 |
| First-time subscriber, first order only | $15 | $18 |
| Standard or returning subscriber | $20 per month | $18 |

- The add-on is $18 flat on every tier and every order. The earlier "$18 initially and recurring / $51" sentence was a derived paraphrase; $51 is only the first-time-subscriber-with-two-add-ons example, and a one-time buyer with one add-on pays $38.
- The $15 rate is for completely new subscribers only. A member who cancelled and returns pays $20.
- Maximum 4 add-ons per shipment; whether that means four paid add-ons plus the included fragrance or four vials total is still unresolved by the owner and is not enforced.
- Remediation 2026-09-06: the founding-member panel now defaults off, renders no hard-coded count and no pricing promise, and fills from the live member-count endpoint; the thank-you and account surfaces exclude variant 48547911696602 when picking the subscription line.
