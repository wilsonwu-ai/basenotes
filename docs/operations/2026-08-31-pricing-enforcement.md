# Pricing enforcement decision record — 2026-08-31

## Decision

Do **not** try to enforce either pricing rule in Liquid or browser JavaScript.
The current theme can choose a selling plan and show a price, but Shopify/Appstle
calculate the payable price at cart and checkout. A customer can also change a
cart request outside the browser UI.

The safe implementation is a small Shopify app with two server-side Functions,
backed by durable customer membership history:

1. Keep a permanent `bn_subscription_ever` customer tag (or boolean customer
   metafield) once a customer has successfully created a Base Note subscription.
2. Use two Appstle selling plans:
   - `BN_NEW_MEMBER_25`: first cycle $15, then $20/month.
   - `BN_STANDARD_20`: $20/month from the first cycle.
3. Use a Cart and Checkout Validation Function to block a tagged former member
   (or an unauthenticated customer) from completing checkout with
   `BN_NEW_MEMBER_25`.
4. Use a Product Discount Function to take exactly $2 off each eligible,
   one-time 5 ml vial in a cart that includes a subscription line. That makes
   every qualifying add-on $18, regardless of whether the subscription line is
   $15 or $20.

The first rule is only enforceable against a stable Shopify customer identity.
It cannot prove that an unauthenticated buyer using a new email is the same
person as a previously cancelled member. Require sign-in/create-account before
the discounted subscription is allowed, and define "genuinely new" as *no
previous successful Base Note subscription on that Shopify customer record*.

## Request source and clarified scope

Jeff's WhatsApp messages on 2026-08-31 state:

- Only new members receive 25% off; a member who cancelled pays $20/month on a
  later signup.
- "Any additional bottle is $18 flat," including when the subscription's first
  payment is $15.

The second sentence means the $18 rule is **not** restricted to $15 subscribers.
It applies to any qualifying add-on bought alongside a subscription. The open
product decision is whether an already-active subscriber gets $18 on a later,
standalone one-time purchase; the current cart UX does not offer that benefit.

## Current-state evidence

| Surface | Current behavior | Why it is insufficient |
| --- | --- | --- |
| Theme settings | `$15` and `25%` are display defaults in `config/settings_schema.json` (lines 481–499). | They are copy settings, not eligibility rules. |
| PDP | The product form loops through all selling plans and defaults to the first one (`sections/main-product.liquid`, lines 336–360 and 2100–2114). It displays `$15` to everyone (lines 393–426). | It does not read subscription history or authenticate eligibility. Two plans alone would still expose the discounted plan to a former member. |
| Appstle | The repository documents that Appstle's selling plan, not the theme, applies the first-order price (`snippets/subscription-pricing-summary.liquid`, lines 20–25). | A selling-plan first-cycle adjustment applies per new contract; it has no theme-level former-member check. |
| Add-on picker | A subscription cart renders the picker; selected variants are posted as one-time lines without a selling plan (`snippets/cart-addon-picker.liquid`, lines 1–10 and 176–199). | The `$18` result depends on an external automatic discount, which source code cannot inspect or enforce. |
| Existing $18 mechanism | Commit `4823b88` says it uses a 10% automatic discount at a $33+ one-time-fragrance subtotal. The picker itself promises `$2` off automatically (line 39). | It is not an exact, server-owned "$18 per eligible vial" rule; its configuration and stacking behavior are unverified. |

There is no tracked Shopify app, Function extension, or app configuration in this
branch. Consequently, this theme-only repository cannot safely implement the
checkout enforcement layer.

## Implementation graph

| Step | Reads prior output? | Verdict |
| --- | --- | --- |
| Export current Appstle plans/discounts and identify eligible vial variants | No | Independent discovery |
| Backfill durable former-subscriber history | No | Independent discovery/write, but must finish before launch |
| Scaffold Functions and tests | No | Independent local work |
| Configure two plans and activate Functions | Yes | Real edge: needs IDs and reviewed Function artifact |
| Theme plan presentation/copy | Yes | Real edge: must use final plan IDs and approved policy |
| Sandbox checkout QA | Yes | Real edge: verifies combined configuration |

**Shared-write controls:** keep the Function app in its own repository or a
dedicated `extensions/` directory; limit theme changes to pricing-copy surfaces;
serialize Appstle/Shopify Admin updates. Do not alter live discounts while the
current `$18` automatic discount remains enabled.

**GRAPH SPEC**

```text
GOAL:        Enforce new-member $15 pricing and exact $18 qualifying add-ons at checkout.
FAN OUT:     Plan/config audit, historical-tag backfill design, and local Function scaffolding.
CONTRACT:    Each worker returns IDs/config evidence, changed files, tests, and unverified assumptions.
ANCHOR:      Test-customer checkout totals, Appstle contract cycles, and Shopify order discount allocations.
VERIFY:      One verifier checks customer eligibility/plan selection; another checks line-level price and renewals.
REDUCE:      Reject a launch if any matrix row has an incorrect initial price, renewal price, or add-on allocation.
CAP:         First run: 2 plans, 2 Functions, 8 test customers, 12 checkout cases; no production charges.
REPORT:      Matrix result plus source-to-order trace for every test case.
HUMAN GATE:  Appstle plan edits, customer-tag backfill, Function activation, automatic-discount deactivation, and production deployment.
FROZEN:      No client-only eligibility decision; no new $15 copy until checkout evidence passes.
```

With three independent discovery/scaffolding nodes, about 65% of this
workstream can run in parallel. Amdahl estimate: `p=0.65`, `N=3`,
`S=1 / (0.35 + 0.65/3) = 1.77x`; ceiling `2.86x`. The admin-change and QA
portion remains intentionally serial.

## Server-side design

### 1. Durable subscription history

Appstle exposes dynamic Active, Paused, and Inactive customer tags. The
Inactive tag is useful as a migration signal, but it is not the primary record:
the status tag changes as contracts change. Write `bn_subscription_ever` on
the first successful subscription creation and never remove it. Backfill it
once for past subscription customers by querying Shopify orders/contract data
or Appstle's historical subscription API.

This design deliberately permits a customer who has only made a one-time
purchase to receive the new-member subscription offer. If the business instead
wants *any prior purchaser* to pay $20, change the predicate before build.

### 2. New-member plan enforcement

Create one Appstle plan with the existing first-cycle adjustment and a second
standard-rate plan. The Appstle widget/theme may choose the apparent plan for a
signed-in customer, but that is only convenience UI. The checkout validation is
the authority:

- no identified customer + discounted plan → block and ask the buyer to sign
  in or create an account;
- `bn_subscription_ever` + discounted plan → block and direct the buyer to the
  $20 plan;
- untagged identified customer + discounted plan → allow;
- any customer + standard plan → allow.

Shopify documents that Cart and Checkout Validation Functions are server-side
and blocking, and that Function inputs include customer tags and cart-line
selling-plan allocations. Appstle documents a dynamic inactive-customer tag,
which can help validate the backfill but should not replace the durable tag.

### 3. Exact add-on pricing

Build a Product Discount Function whose configuration contains the exact list
of eligible 5 ml vial variant IDs (or an explicit product metafield). At each
cart/checkout evaluation:

1. Find a subscription cart line by `sellingPlanAllocation`.
2. Find every eligible one-time vial line with no selling plan.
3. If both exist, emit a fixed `$2.00`, `appliesToEachItem: true`, product
   discount for every eligible one-time line.
4. Exclude giveaway, full-bottle, gift-card, and non-vial variants.

This produces `$18` from a `$20` vial even for two or more eligible lines. It
must be configured not to stack with the existing `Add-on vials $18` automatic
discount. Retire or narrowly disable that existing discount only after the new
Function passes sandbox QA.

If Shopify plan/app constraints prevent a Function, evaluate a native Buy X Get
Y automatic discount as a fallback: subscription product is Buy X; an eligible
one-time vial is Get Y. Do not use that fallback until its amount, multi-quantity
behavior, and combination rules demonstrate the exact `$18` result in checkout.

## Required external changes (not performed)

1. Export/screenshot the current Appstle selling plan and all automatic
   discount settings.
2. Create and attach `BN_NEW_MEMBER_25` and `BN_STANDARD_20` to every eligible
   subscription product; record their immutable plan IDs.
3. Configure a durable `bn_subscription_ever` tag/metafield write on the
   subscription-created/successful-first-order event, then backfill historical
   customers.
4. Create, deploy, and activate the Checkout Validation and Product Discount
   Functions.
5. Deactivate or scope out the existing automatic add-on discount after the
   new Function's test evidence is approved.
6. Update theme copy so `$15` is labelled "New members" and return accounts
   show an honest $20 starting price. The theme currently claims `$15` without
   an eligibility condition on multiple surfaces.

## QA matrix

Run in a development/sandbox store or against test customers and test payment
method; do not use a real customer or production charge as a test.

| ID | Test identity/cart | Expected checkout result | Required evidence |
| --- | --- | --- | --- |
| N1 | New signed-in customer, discounted plan | First payment $15; renewal $20 | Cart, checkout, Appstle contract, first renewal preview |
| N2 | Former subscriber tagged `bn_subscription_ever`, discounted plan | Checkout blocked; no contract created | Cart and checkout validation error |
| N3 | Former subscriber, standard plan | First payment and renewal both $20 | Checkout and contract details |
| N4 | Prior one-time-only customer | $15 only if definition remains "prior subscriber" | Customer tag and checkout total |
| N5 | New email / no identity, discounted plan | Checkout blocked until identity exists | Checkout validation error |
| N6 | Historical cancelled subscriber after backfill | Same behavior as N2 | Backfill report and validation error |
| A1 | $15 subscription + one eligible add-on | $15 + $18 line; no recurring add-on | Checkout allocations and contract lines |
| A2 | $20 subscription + two different eligible add-ons | $20 + $18 + $18 | Per-line allocations |
| A3 | Subscription + quantity 2 of one eligible vial | Both units at $18 if duplicates are permitted | Allocation quantity and cart behavior |
| A4 | One-time-only cart | No $18 add-on discount | Checkout total |
| A5 | Subscription + full bottle/giveaway | No add-on discount on excluded item | Checkout allocations |
| A6 | Mixed cart shipping | Shipping/discount stacking remains truthful | Cart copy, checkout, order receipt |

## Open business decisions

1. Does "$18 flat" apply only in the initial subscription cart, or also when an
   already-active subscriber later places a one-time-only order?
2. May a buyer add two units of the same vial? Current picker hides an already
   added one-time product, so it does not presently support that case.
3. Does "previous member" mean a previous subscription only (recommended), or
   any prior Base Note order?
4. Are customer accounts mandatory for every discounted subscription? They must
   be, unless the business accepts an unenforceable anonymous/alternate-email
   loophole.

## References

- [Shopify: customer segment eligibility](https://help.shopify.com/en/manual/discounts/managing-discounts#manage-customer-and-market-eligibility-for-discounts)
- [Shopify: subscription discounts](https://help.shopify.com/en/manual/products/purchase-options/subscriptions/manage-subscriptions/subscription-discounts)
- [Shopify: Cart and Checkout Validation Function API](https://shopify.dev/docs/api/functions/2026-01/cart-and-checkout-validation)
- [Shopify: selling-plan allocation on cart lines](https://shopify.dev/docs/api/storefront/latest/objects/SellingPlanAllocation)
- [Appstle: subscription metafields and tags](https://developers.subscription.appstle.com/metafields-and-tags)
