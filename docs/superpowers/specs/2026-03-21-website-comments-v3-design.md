# Website Comments V3 — Account Page Subscription Fix

**Date:** 2026-03-21
**Source:** `website_comments_v3.docx` (Jeff's feedback after subscribing)
**Baseline commit:** `a0adcad`

---

## Overview

6 issues reported by Jeff after purchasing a subscription. Root cause: the account page detects subscriptions via customer tags (`subscriber` / `active_subscriber`) which Appstle never sets. Fix: rewrite detection to use order history with selling plan data.

---

## Issues

### Issue 1: Account "My Subscription" doesn't detect subscription
- **File:** `templates/customers/account.liquid:3-6`
- **Root cause:** Detection uses `customer.tags contains 'subscriber'`. Appstle doesn't add this tag.
- **Fix:** Replace tag-based detection with order history check. Loop through `customer.orders` and check for `line_item.selling_plan_allocation`.

New detection logic:
```liquid
{%- assign is_subscriber = false -%}
{%- assign latest_sub_order = nil -%}
{%- assign latest_sub_item = nil -%}
{%- for order in customer.orders -%}
  {%- for line_item in order.line_items -%}
    {%- if line_item.selling_plan_allocation -%}
      {%- assign is_subscriber = true -%}
      {%- unless latest_sub_order -%}
        {%- assign latest_sub_order = order -%}
        {%- assign latest_sub_item = line_item -%}
      {%- endunless -%}
    {%- endif -%}
  {%- endfor -%}
{%- endfor -%}
```

### Issue 2: "Next Shipment" tab is blank
- **Root cause:** Same tag detection failure. Non-subscriber view shows "Subscribe to Base Note".
- **Fix:** With the detection fix above, the subscriber view will render. Populate next shipment from `latest_sub_item` (the most recent subscription order's line item). Add a "Swap Fragrance" link to the Appstle portal.

### Issue 3: "$14/mo" old pricing on account page
- **File:** `templates/customers/account.liquid:348`
- **Root cause:** Hardcoded `$14/mo` in non-subscriber CTA. Doesn't use settings.
- **Fix:** Since we're monthly-only ($20/mo), replace with `$20/mo`. Also update:
  - `snippets/cancellation-flow.liquid:269` — hardcoded "$14/mo" annual plan reference
  - `config/settings_schema.json` — default values for `sub_plan_annual_per_month` and `subscription_annual_price`

### Issue 4: All upcoming months show same fragrance
- **Root cause:** Appstle limitation. Appstle creates future orders with the same product unless the customer manually swaps via the portal.
- **Fix (theme-side):** Add a prompt in the subscription view encouraging customers to swap: "Your next fragrance will be [Product Name]. Want something different? [Swap Now →]" linking to the Appstle portal. This is the intended UX — customers swap via the portal.
- **Note:** This is not a bug. It's how Appstle works. The "My Rotation" section in the cart uses localStorage which is separate from Appstle's actual order queue.

### Issue 5: "$20.00 retail value" still showing on cart
- **File:** `templates/cart.liquid` — check for remaining retail value references
- **Fix:** Find and update or remove any remaining "$20.00 retail value" text.

### Issue 6: Appstle portal works but theme account page doesn't
- **Root cause:** Theme relies on customer tags + localStorage. Appstle has its own database.
- **Fix:** The detection rewrite (Issue 1) fixes the primary problem. For real-time subscription data (billing dates, upcoming orders), the account page should link to the Appstle portal rather than trying to replicate that data in Liquid. Add prominent "Manage Subscription" CTAs pointing to the portal.

---

## Design Decisions

### Use order history, not customer tags
Customer tags require external automation (Appstle flow or Shopify Flow) to set. Order history with selling plan data is always available and accurate.

### Link to Appstle portal for management
The theme's Liquid templates cannot call Appstle's API. Rather than building a complex JS integration, link subscribers to the Appstle portal for real-time subscription management (swap, cancel, billing info). This is the pattern Appstle recommends.

### Monthly-only model
All pricing references must reflect $20/mo only. No quarterly/annual. Remove or update all legacy pricing references.

---

## Files Changed

| File | Changes |
|------|---------|
| `templates/customers/account.liquid` | Rewrite detection (lines 3-6), fix $14/mo (line 348), update non-subscriber CTAs (lines 124, 244, 347), populate Next Shipment from order data, add Appstle portal links |
| `snippets/cancellation-flow.liquid` | Fix $14/mo annual reference (line 269), simplify to monthly-only |
| `templates/cart.liquid` | Fix any remaining "$20.00 retail value" reference |
| `config/settings_schema.json` | Update default pricing values to reflect monthly-only model |

---

## Out of Scope

- Appstle API integration (server-side) — the TODO markers in account.liquid are for a future phase
- Building a custom subscription management portal — use Appstle's built-in portal
- Fixing the "My Rotation" localStorage feature — this is separate from Appstle's order queue
