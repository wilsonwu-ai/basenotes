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
- A shopper can opt into a second 5ml vial on the same monthly subscription checkout.
- The extra vial uses the Appstle Monthly Plan selling plan and is billed at $9 on the first order and $12/month thereafter, verified from the live Storefront product JSON.
- If the selling plan cannot be applied, the add-on is rolled back and the shopper sees an actionable error; no one-time add-on is silently created.
- Existing single-subscription, swap, rotation, and quick-add behavior remains unchanged.

## Implementation

- Shopify product: `Extra 5ml Vial Add-On` (`extra-5ml-vial-add-on`)
- Variant: `48547911696602`
- Appstle selling plan: `26547585242` (`Monthly Subscription`)
- Appstle plan: `Monthly Plan` (`3355771098`)
- Native Appstle “Add to Existing Subscription” was checked and is Enterprise+/Business Premium-only on the current account. The storefront implementation therefore adds the second line item with the same selling plan at checkout.
- Updated `sections/main-product.liquid` with founding proof, add-on selection, compare-price modal, and cart-level selling-plan verification.
- Updated `snippets/product-card.liquid` with compare-price actions for search, collection, and related-product surfaces.

## QA evidence

- PR #45 shipping copy was merged separately and verified as `Ships within 1–3 business days`.
- The add-on product is active, available, and attached to the Appstle plan.
- Storefront JSON reports first-order price `$9.00`, recurring price `$12.00`, and the expected selling-plan allocation.
- Final browser QA is required on the draft theme before publishing this new code path; no checkout/order should be placed during QA.
