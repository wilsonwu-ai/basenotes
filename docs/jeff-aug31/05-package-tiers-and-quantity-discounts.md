# Discovery PRD: Package tiers and quantity discounts

## Outcome

Define a commercially coherent package/gift-box offer and quantity-discount rules before any cart, checkout, product, or theme implementation. The final configuration must charge the promised amount in Shopify checkout, preserve subscription behavior, and be fulfillable with real inventory.

## Current anchor

The repository contains a subscription-led 5 ml product flow and a cart add-on presentation that describes an $18 one-time vial when an automatic discount applies. That display is not proof that the discount is universally eligible, stacks correctly, or covers every desired package scenario. The plan therefore treats the current implementation as an input to audit—not an approved pricing rule.

## Required business decisions

| Decision | Required answer |
| --- | --- |
| Offer type | One-time gift box, subscriber-only add-on, pre-paid subscription package, or a separate combination; identify the intended buyer and recipient. |
| Tiers | Name, exact vial count, included fragrance selection method, packaging, inserts, fulfillment lead time, and inventory reservation for every tier. |
| Price and discount | List price, customer-paid price, per-vial economics, threshold, maximum quantity, discount type, dates, and tax/shipping treatment. |
| Eligibility | New vs existing subscribers, active/paused/cancelled customers, products/variants/collections, region, customer tags, and redemption limits. |
| Stacking | Explicit matrix for subscription first-order discounts, the $18 add-on rule, referral/reward codes, gift cards, automatic discounts, shipping promotions, and manual staff discounts. |
| Subscription semantics | Whether a package creates/changes a subscription, affects renewal price, can be added to a subscription cart, or is strictly one-time. |
| Fulfillment and returns | Assembly owner, inventory location, backorder behavior, split shipment policy, carrier service, return/refund rules, and customer-support script. |
| Financial/legal approval | Margin owner, tax/price-display review, promotion terms, expiration, and approver responsible for final launch authorization. |

## Offer-definition template

Complete this table for each proposed tier before development:

| Field | Tier definition |
| --- | --- |
| Tier name / SKU | Unique product or bundle identity; no ambiguous title reuse. |
| Customer promise | Exact vial count, sizes, selection rules, and delivery promise. |
| Included components | Variant IDs/SKUs, packaging, and substitution policy. |
| One-time or subscription | Exact checkout behavior and recurring-charge effect. |
| List price / paid price | Currency, comparison display, and tax/shipping policy. |
| Discount rule | Conditions, eligible lines, cap, stack/exclusion matrix, start/end time. |
| Inventory/fulfillment | Stock source, bundle assembly, allocation, lead time, and exception path. |
| Returns/support | Eligibility, return address/path, and response owner. |
| Evidence owner | Finance, merchandising, fulfillment, and legal/terms sign-off. |

## Security, privacy, and commercial-integrity controls

- Configure prices and discounts in authorized Shopify/Appstle administration, not only in client-side Liquid or JavaScript. The cart must be able to display an honest pending state when an automatic discount is not applied.
- Grant discount/product configuration access only to named roles; use individual accounts, MFA, and an audit trail. Never share store-owner credentials.
- Keep discount APIs, Shopify Admin tokens, and fulfillment credentials server-side. Do not expose eligibility logic that relies on customer tags or purchase history in public JavaScript when a server-side/Shopify rule can enforce it.
- Do not use customer purchase history beyond the approved eligibility rule. Avoid exporting buyer data for manual discounting unless there is an approved, private operational workflow.
- Show unambiguous price, recurring-charge, shipping, and expiration disclosures before checkout. Do not advertise an $18 outcome if a legitimate cart can pay $20.
- Do not configure destructive cart manipulation or automatic subscription creation without explicit product/finance approval and rollback steps.
- Keep test orders and discount codes isolated from live campaigns; remove or disable test rules before release.

## Delivery plan

1. Complete and approve the offer-definition template and stacking matrix. Stop if any price, fulfillment, or recurring-charge rule is ambiguous.
2. Map every package component to the canonical catalog/variant and confirm inventory, packaging, tax, and shipping feasibility.
3. Decide the Shopify implementation model: native bundle/product, Shopify Function/automatic discount, Appstle configuration, or approved app. Select based on its ability to enforce—not merely display—the rules.
4. Configure products/discounts in a test or unpublished state. Add only the required storefront/content changes after the checkout calculation is proven.
5. Run matrix QA across customer states, carts, discounts, regions, payment, fulfillment, refund, and cancellation scenarios.
6. Secure finance/fulfillment/owner approval, publish with a rollback plan, and monitor first orders for discrepancy.

## Minimum pricing test matrix

| Scenario | Required result |
| --- | --- |
| Eligible first-time customer, one qualifying package | Correct tier price and disclosures; no accidental recurring charge. |
| Active subscriber adding one eligible vial | Approved $18-or-other configured outcome appears in cart and checkout identically. |
| Customer eligible for first-month subscription offer plus package | Exact approved stacking/exclusion result; no double discount. |
| Multiple add-ons / multiple package tiers | Quantity cap, per-line calculation, and fulfillment contents match the rules. |
| Ineligible customer or mixed cart | No misleading $18/tier claim; clear final price before payment. |
| Reward/referral/gift-card/manual code combination | Result matches the signed stacking matrix and cannot bypass exclusions. |
| Out-of-stock component | Prevents or safely handles sale according to the approved substitution/backorder policy. |
| Cancellation/refund/return | Financial outcome, inventory adjustment, subscription state, and customer communication match the approved policy. |
| Mobile, desktop, and accelerated checkout | Price and recurring disclosures remain accurate through the final payment surface. |
| Admin audit | Authorized role can change a test rule; unauthorized role cannot; change is traceable and reversible. |

## Dependencies and release gate

This work is intentionally downstream of the business-decision record and canonical catalog. It may share media assets with the vial audit, but package pricing cannot launch until the offer, enforcement mechanism, and fulfillment rules are tested end-to-end in checkout. Owner, finance, and fulfillment approval are mandatory release gates.
