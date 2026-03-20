# Website Comments V1 & V2 — Design Spec

**Date:** 2026-03-19
**Source:** `website_comments_v1.docx`, `website_comments_v2.docx` (Jeff's Slack feedback)
**Baseline commit:** `af51db4` (synced live theme before changes)

---

## Overview

17 feedback items from Jeff across two documents. Grouped into 4 batches by complexity and file overlap. Each batch produces one git commit. Theme is pushed after all batches pass local review.

---

## Batch 1 — Quick Text/Copy Fixes

### Item 1: Change spray count
- **Files:** `sections/main-product.liquid:194`, `templates/cart.liquid:81`
- **Change:** `~30 sprays` → `~45 sprays`

### Item 2: Remove free shipping threshold messaging & atomizer case mention
- **Files:**
  - `snippets/cart-drawer.liquid:6-52` — free shipping progress bar and threshold logic
  - `snippets/cart-drawer.liquid:224-249` — subscription upsell prompt containing "free atomizer case included"
  - `sections/subscription-landing.liquid:109` — "free atomizer case" mention on landing page
- **Change:** Remove the progress bar and "Add X more for FREE shipping" messaging (lines 37-52) and the threshold calculation (lines 6-11). All purchases have free shipping — no threshold needed. Also remove "free atomizer case included" text from the cart drawer subscription upsell (line 238) and subscription landing page (line 109).
- **Note:** The subscription upsell section (lines 224-249) will be fully removed by Item 11 in Batch 2, so Item 2 only needs to handle lines 6-52 (shipping bar). The atomizer case text cleanup is covered by Item 11's broader removal.

### Item 10: Remove "$20 retail value" claim — show full bottle retail instead
- **Files:**
  - `sections/main-product.liquid:199` — displays `{{ settings.subscription_price | default: '$20' }}` as the subscription price
  - `templates/cart.liquid:96` — already displays `{{ item.product.price | money }} retail value` (dynamic, correct)
  - `snippets/fragrance-selector.liquid:87` — also shows `{{ product.price | money }} retail value`
- **Change:** Jeff wants to remove the "$20 retail value" positioning and instead show the full bottle retail value. The cart (line 96) and fragrance selector (line 87) already do this correctly using `product.price | money`. The fix is in the subscription box at `main-product.liquid:199` — replace the static `$20` subscription price label with a comparison to the full bottle retail value (e.g., "Retail: $295 — yours for $20/month"). If no full bottle price is available, just show "$20/month" without a retail value claim.

### Item 12: Remove 30-day satisfaction perk
- **File:** `templates/cart.liquid:217-226`
- **Change:** Remove the "30-day satisfaction guarantee" perk from the perks grid. All subscriptions are final sale. Replace with a different perk or reduce to 3 perks.
- **Decision:** Remove the perk entirely and keep 3 perks (free shipping, swap/skip/cancel, free travel case).

---

## Batch 2 — UI Component Removals

### Item 4: Remove social sharing widget
- **File:** `sections/main-product.liquid:477-505`
- **Change:** Remove the "Share this fragrance" section entirely. Basenote doesn't have social media accounts yet.

### Item 5: Fix Privacy Policy link (Cancellations link does not exist in footer)
- **File:** `sections/footer.liquid:153-166`
- **Change:** The footer has 4 legal links: Privacy Policy (line 155), Terms of Service (line 158), Refund Policy (line 161), Shipping Policy (line 164). There is no "Cancellations" link in the footer — Jeff may have seen it elsewhere or it was already removed. The "Cancellations" flow exists in `snippets/cancellation-flow.liquid` and is accessed from the customer account dashboard, not the footer.
- **Action:** Verify that `section.settings.privacy_link` points to a valid page. If empty, set it to Shopify's auto-generated `/policies/privacy-policy`. Do the same for terms, refund, and shipping links.
- **Note:** A "Cancellations" link and policy text will now be added to the footer as part of Item 18 (new business requirement for cancellation policy disclosure).

### Item 11: Remove "Complete Your Collection" & subscription upsell from cart drawer
- **File:** `snippets/cart-drawer.liquid`
  - Lines 161-209: "Complete Your Collection" upsell grid
  - Lines 224-249: "Would you like to add a monthly fragrance subscription?" prompt (contains "free atomizer case included" text at line 238)
- **Change:** Remove both sections entirely from the cart drawer. This also resolves the "free atomizer case" mention from Item 2.

---

## Batch 3 — Product Data & Filters

### Item 3: Replace Intensity filter with Season/Event
- **File:** `sections/main-collection.liquid:128-192`
- **Change:** The filter sidebar uses Shopify's native `collection.filters`. Filters are auto-generated from product tags, metafields, and product properties. To get Season and Event filters:
  1. Add structured tags to products: `season:spring`, `event:date-night`, etc.
  2. The Shopify storefront will auto-generate filter groups for these tag prefixes
  3. Remove any custom Intensity filter rendering if hardcoded
- **Note:** Shopify's native filtering uses product tags — adding `season:X` and `event:Y` tags will make them filterable automatically if the store has Search & Discovery app configured, or via tag-based filtering in the collection template.

### Item 9: Simplify to monthly-only subscription
- **Files:** `templates/cart.liquid:149-178`, `templates/cart.liquid:9-14`, `config/settings_data.json`
- **Change:** Simplify to monthly-only subscription. Remove quarterly and annual plan options from `cart.liquid` plan selector (lines 149-178). Remove the plan selector entirely — just show "Monthly $20/mo". No one-time purchase option.
- **Implementation:**
  - Remove the entire `<div class="plan-selector">` containing Monthly/Quarterly/Annual radio buttons (lines 149-178)
  - Replace with a simple display showing "Monthly Subscription — $20/mo"
  - Remove the quarterly and annual pricing variable assignments at lines 9-14 (keep only monthly)
  - Update `config/settings_data.json` to remove quarterly/annual pricing settings
- **Business decision:** All plans consolidated to monthly-only at $20/mo. Previous quarterly ($18/mo) and annual ($16/mo) options are eliminated.

### Item 15: Subscription view enhancements
- **File:** `templates/cart.liquid`
- **Change:** Add to the subscription/cart view:
  1. Expected ship date (e.g., "Ships by March 25")
  2. Seasonal fragrance recommendations: "Spring Picks (Mar-May)" section showing spring-tagged products
  3. "View All Fragrances" link to `/collections/all`
- **Implementation:** Add a new section below "Your Next Fragrance" that shows recommended spring bottles filtered by `season:spring` tag, plus a CTA link.

### Item 16: Add country of origin to product cards
- **File:** `snippets/product-card.liquid`
- **Change:** Display "Made in [Country]" below the fragrance name. Source from `origin:country` tag on each product.
- **Tag mapping:**
  - France: Creed Aventus, MFK BR540, PdM Layton, PdM Perseus, Creed GIT, PdM Althair, PdM Pegasus
  - USA: Tom Ford Ombre Leather, Bond No 9 Lafayette St (New York brand)

### Item 17: Replace Intensity with Season on product cards
- **File:** `snippets/product-card.liquid:173-178` (intensity dots) → use existing season icons at `147-171`
- **Change:** Remove the intensity dots from product cards. The season icons (already coded at lines 147-171) will be the primary visual indicator. Ensure they render in a visible position.

### Prerequisite: Product Tag Updates (must complete before Batch 3 implementation)

Tags will be added via Shopify Admin GraphQL API using the `shopify` CLI. This is a prerequisite step — Batch 3 theme changes depend on these tags existing on products for season/event filters, origin display, and seasonal recommendations to work.

Tags to add:

| Product | Add Tags |
|---------|----------|
| Creed Aventus | `season:spring`, `season:fall`, `origin:france`, `event:office`, `event:date-night` |
| MFK Baccarat Rouge 540 | `season:fall`, `season:winter`, `origin:france`, `event:date-night`, `event:evening-out` |
| PdM Layton | `season:fall`, `season:winter`, `origin:france`, `event:date-night`, `event:evening-out` |
| Tom Ford Ombre Leather | `season:fall`, `season:winter`, `origin:usa`, `event:date-night`, `event:evening-out` |
| PdM Perseus | `season:spring`, `season:summer`, `origin:france`, `event:office`, `event:daytime` |
| Creed Green Irish Tweed | `season:spring`, `season:summer`, `origin:france`, `event:office`, `event:daytime` |
| Bond No 9 Lafayette St | `season:spring`, `season:summer`, `origin:usa`, `event:daytime`, `event:evening-out` |

**Note on "Free travel case" perk (Item 12):** The 30-day satisfaction perk is being removed, leaving 3 perks including "Free travel case." Since Item 2 removes "free atomizer case" mentions, verify that "travel case" is a distinct offering Jeff wants to keep. If it's the same product, remove it too and keep 2 perks. Defaulting to keeping it since Jeff's feedback specifically targeted the 30-day guarantee, not the travel case.
| PdM Althair | `season:fall`, `season:winter`, `origin:france`, `event:evening-out`, `event:date-night` |
| PdM Pegasus | `season:spring`, `season:fall`, `origin:france`, `event:office`, `event:date-night` |

---

## Batch 4 — Mobile & Checkout Fixes

### Item 6: Mobile cart icon cut off
- **File:** `sections/header.liquid:144-153` + header CSS
- **Change:** The cart icon is being clipped on mobile viewports. Adjust the header layout so all action buttons (menu, search, account, cart) fit within the mobile viewport width. Likely needs `flex-shrink: 0` on cart button or reducing padding/spacing on mobile.

### Item 7: Remove one-time purchase option (subscription-only)
- **Files:** `sections/main-product.liquid`, `assets/theme.js`
- **Change:** Remove one-time purchase option. All products are subscription-only at $20/mo. Ensure the selling plan selector always selects the monthly subscription plan. Remove the "One-time purchase" radio button from the native selling plan selector.
- **Implementation:** In `sections/main-product.liquid`, find the native selling plan selector (around lines 284-316). Remove the "One-time purchase" radio option (lines 289-295). Keep only the monthly subscription plan option. The button should always say "Add to My Queue" (never "Add to Cart"). No toggle or segmented control needed — subscription is the only option.

### Item 8: Mobile checkout broken
- **Investigation needed:** Jeff reports payments won't go through on mobile. This is likely a Shopify Payments / checkout configuration issue rather than a theme issue. Steps:
  1. Test checkout flow on mobile in preview mode
  2. Check if Shopify Payments is properly configured (Settings > Payments)
  3. Check if there's JS errors on mobile checkout
  4. Verify the cart form submits correctly on mobile
- **Note:** Shopify's checkout is hosted — theme code doesn't control the payment form itself. This may be an admin config issue.

### Item 13: Purchased cologne not showing on subscription
- **Investigation needed:** Jeff purchased a cologne but it's not showing on the subscription page. Could be:
  1. The subscription was created via Appstle but not reflected in the theme's cart/account view
  2. The cart.liquid template only shows cart items, not active subscriptions
  3. Need to check Appstle's subscription widget integration
- **Action:** Verify Appstle subscription widget is rendering, check if `customer.metafields.subscription` has data.

### Item 14: Free trial fragrances
- **Change:** Make select fragrances available as free trials. Options:
  - A) Create a "Free Sample" variant at $0 (simplest, but affects AOV metrics)
  - B) Use a discount code for first-time subscribers (cleaner)
  - C) Create a separate "Trial" product type with $0 price
- **Recommendation:** Use option B — create an automatic discount in Shopify for first-time customers. No theme changes needed. If they want a visible "Try Free" button, add a variant.
- **Note:** This requires business decision on which fragrances and the trial mechanism. Flag for Wilson/Jeff to decide.

### Item 18: Add cancellation policy language to cart FTC disclosure and footer
- **Files:** `templates/cart.liquid`, `sections/footer.liquid`
- **Change:** Add cancellation policy text to two locations:
  1. **`templates/cart.liquid`** — the FTC disclosure/terms checkbox area. Add the following text: "Subscriptions renew monthly from your first purchase date. You will be notified 7 days before renewal. Cancellations on the renewal date take effect the following month."
  2. **`sections/footer.liquid`** — add a "Cancellations" link or inline text in the footer legal links section (alongside Privacy Policy, Terms of Service, etc.) with the same cancellation policy language.
- **Rationale:** If a customer cancels on the renewal date, it is too late — the cancellation takes effect the following month. This must be clearly disclosed per FTC requirements and visible in both the cart checkout flow and site-wide footer.

### Klaviyo Renewal Notification
- **Platform:** Klaviyo (existing email platform)
- **Change:** Configure a renewal notification email to be sent 7 days before each subscription renewal date.
- **Implementation:** No theme code changes needed. This is handled via a Klaviyo flow triggered by Appstle subscription events. The flow should:
  1. Listen for the Appstle "upcoming renewal" event (or equivalent webhook)
  2. Send an email 7 days before the renewal date
  3. Include the renewal date, current fragrance selection, and a link to manage the subscription
- **Note:** This is a Klaviyo configuration task, not a theme development task.

---

## Files Changed Summary

| File | Batches | Changes |
|------|---------|---------|
| `sections/main-product.liquid` | 1, 2, 4 | Spray count, remove share widget, remove one-time purchase option |
| `templates/cart.liquid` | 1, 3 | Spray count, remove 30-day perk, simplify to monthly-only plan, add ship date/recs, add cancellation policy to FTC disclosure |
| `snippets/cart-drawer.liquid` | 1, 2 | Remove free shipping bar, remove upsells |
| `snippets/product-card.liquid` | 3 | Add origin display, remove intensity dots, ensure season icons show |
| `sections/main-collection.liquid` | 3 | Update filter logic for season/event |
| `sections/footer.liquid` | 2, 3 | Fix broken links, add cancellation policy text |
| `sections/header.liquid` | 4 | Fix mobile cart icon |
| `assets/theme.js` | 4 | Subscription-only selling plan logic |
| `config/settings_data.json` | 3 | Remove quarterly/annual pricing settings |

---

## Out of Scope / Flagged for Discussion

- **Item 8 (mobile checkout):** Likely Shopify admin config, not theme code. Will investigate but may need Wilson to check Shopify Payments settings.
- **Item 13 (subscription display):** Depends on Appstle integration state. Will investigate.
- **Item 14 (free trials):** Needs business decision on mechanism. Will implement whichever approach Wilson/Jeff choose.
- **Klaviyo renewal notifications:** 7-day pre-renewal email flow must be configured in Klaviyo using Appstle subscription events. No theme code needed.
- **Product tags:** Will be added via Shopify Admin API. Tags are researched from Fragrantica and industry knowledge.
