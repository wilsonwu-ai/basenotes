# Product and cart verification · September 10, 2026

The product and cart templates follow Jeff's supplied Claude references: a restrained cream-and-green product page with size, price, quantity, and one add action; compact cart items beside an order summary and purchase-mode cards. The PDP pairs the existing clear-glass, silver-cap Base Note vial illustration with the preserved merchant product photo, explicitly labeled “Your 5ml vial” and “Original fragrance.” It makes no true-to-scale claim. Full-bottle selection hides the vial reference while keeping the merchant photo and all thumbnails. Product notes and occasions come from merchant content. Mockup review counts, generic scent notes, and the nonexistent $360 bottle price were removed.

## Actual Shopify cart verification

Tested the current shared commerce asset against the real Shopify Ajax API from a fresh, isolated Playwright browser context. No customer session, theme publication, product/price mutation, checkout submission, or order creation was involved. The test cart was cleared before the context closed.

| Operation | Actual server result |
|---|---|
| First Creed Aventus vial | $20, original variant 47527167951066 |
| Add Green Irish Tweed | $18 additional vial, total $38 |
| Remove Aventus base | Remaining Green Irish Tweed promoted to original variant 47527168114906, total $20 |
| Select Monthly Rotation | Plan 26547585242 retained; $15 first shipment and $20 monthly renewal |
| Add an extra Aventus to Monthly Rotation | $18 one-time extra; total $33; helper has no selling plan |
| Switch the base back to one-time | $20 + $18, total $38 |
| Add three of the same scent to an empty cart | $20 + $18 + $18, total $56 |
| Remove the same-scent base line | Two correctly identified remaining vials, total $38 |

Every new additional line records public `Selected scent` plus private original product handle and variant ID. The additional-vial helper's actual subscription allocation remains $13.50 initially/$18 recurring, so it is never attached to an additional vial.

Live testing discovered that the store's existing automatic discount can change line keys while a helper is promoted to its original fragrance. Mutations now re-resolve the current line by variant, properties, and plan after every intervening write. Selling-plan changes use the required current `line` index and quantity, per [Shopify's Cart API](https://shopify.dev/docs/api/ajax/reference/cart#update-selling-plans). The response is verified before reporting a subscription as selected. The theme's early captured `__bnFetch` avoids Appstle's global fetch wrapper stripping a chosen plan.

## Automated checks

`node --test scripts/test-scent-studio-commerce.cjs`: 19 passing behavioral tests. Coverage includes concurrent adds, repeated quantities, same/different-scent base removal, legacy selected-scent recovery, changing Shopify line keys, invalid helper subscriptions, rollback after a failed replacement, stripped selling plans, unavailable variants, and full-bottle pricing exclusion.

`scripts/check-claude-artifact-fidelity.sh` and `scripts/check-theme-recovery-static.sh` pass with current native form and metadata guards. Shopify Theme Check reports zero errors in the changed product and cart templates. Native quantity fields, remove links, and ordinary product forms provide a no-JavaScript fallback; subscription consent remains a native required checkbox.

## Local visual and interaction verification

Rendered the actual updated PDP/cart Liquid through a local LiquidJS compatibility fixture, using public Shopify product data, actual merchant photos, and the updated header/footer. This is a local projection, not Shopify server-rendered preview evidence. The adapter handles Shopify-only tags and LiquidJS's different nil/blank assignment behavior; all cart responses in this visual fixture are explicitly local fixtures.

At 1440 × 1000 and 390 × 844, product, one-time cart, and subscription cart all have zero page JavaScript errors and no horizontal overflow. Merchant product images load. Product size controls correctly switch between the real 5ml variant and the unavailable-bottle enquiry state. Selecting Monthly Rotation shows the actual $15 first-shipment price and an unchecked, required consent box. Cart checkout remains disabled until recurring consent is checked; the disclosure explicitly shows $20 monthly renewal and says one-time extras do not renew.

Screenshots (local projection):

- `/private/tmp/basenote-commerce-local-product-1440.png`
- `/private/tmp/basenote-commerce-local-product-390.png`
- `/private/tmp/basenote-commerce-local-cart-1440.png`
- `/private/tmp/basenote-commerce-local-cart-390.png`
- `/private/tmp/basenote-commerce-local-subscription-1440.png`
- `/private/tmp/basenote-commerce-local-subscription-390.png`

The fixture runner is `/private/tmp/basenote-commerce-local-visual-qa.cjs`. The isolated actual Shopify API runner is `/private/tmp/basenote-live-commerce-api-qa.cjs`. The prepared unpublished-theme browser runner is `/private/tmp/basenote-scent-studio-commerce-qa.cjs THEME_ID`.

## Remaining verification and limitations

The new templates still require screenshot/interaction testing in the unpublished Shopify theme once its upload authentication is restored. Neither the actual backend tests nor the local visual projection substitutes for that final Shopify preview QA. Root will keep the PR unmerged and production unchanged until that gate passes.

Creed Aventus has only a 5ml Shopify variant; its full-bottle selector therefore explains availability and links to the bottle enquiry form. Real full-bottle variants, when present, use their own size, inventory availability, and price.

The existing $18 helper architecture does not provide server-side enforcement of the qualifying base vial or the original fragrance's inventory quantity. The theme validates available source variants and corrects normal cart interactions, but a backend validation/discount implementation is required to enforce those rules against direct API edits. Regular pricing applies to native no-JavaScript product submissions; checkout shows Shopify's final server-calculated price.
