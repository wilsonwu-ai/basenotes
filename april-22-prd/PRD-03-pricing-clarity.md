# PRD-03 — Subscription Pricing Clarity (PDP + Cart + Pre-Checkout)

**Ticket:** Apr 22, Image 5 — Christina Warner: "About the subscription itself — is it $15 or $20? And how does it work? Do I get one/month? Or something else? Not clear before I checkout."
**Status:** Planning
**Owner:** Engineering + Wilson (copy review)
**Complexity:** Low-Medium
**Dependency:** None

---

## 1. Context

A paying subscriber could not determine the price OR the cadence of Base Note's subscription from the product page and cart. Jeff's reply ("$20 a month for one vial, but you get a discount for the first order") confirms the actual model:

- **Regular price:** $20/month, one 5ml vial, ships monthly.
- **First-order discount:** 10% off (see `memory/project_first_order_discount.md`) — so first month is effectively **$18**.
- **No $15 tier exists today** — Christina's "$15" is a misread, likely from an external reference or a stale marketing asset. We should find and kill any $15 reference on-site if it exists.

This is a conversion-killing issue. Every hour it's live costs subscribers.

## 2. Goal

Any visitor — logged out, on a PDP, in the cart drawer, or reading the subscription landing page — can answer three questions in under 10 seconds:

1. **How much does it cost?** "$20/month — $18 your first month (10% off)"
2. **How often do I get it?** "One 5ml vial every month"
3. **How do I change it?** "Cancel or swap anytime from your account"

## 3. Scope

### In scope
- Audit all occurrences of subscription pricing on-site (PDP, cart, cart drawer, subscription landing, hero, footer, any marketing snippets, any email templates).
- Standardize copy via a single Liquid snippet (`snippets/subscription-pricing-summary.liquid`) that all surfaces include, so future price changes flip in one place.
- Add a 3-line "How it works" callout next to every "Subscribe" CTA.
- Grep the theme for any literal "$15" and either remove it or convert it to a correct reference.
- First-order discount must be shown visibly and truthfully wherever the $20 price is shown.

### Out of scope
- Changing the actual subscription price or discount percentage — that's Wilson's decision, not a dev task.
- Appstle subscription-product configuration — already correct per `memory/project_first_order_discount.md`.
- Email template copy changes — track as a separate follow-up if copy drift shows up there too.

## 4. Canonical Copy (to be used everywhere)

**Primary pricing line (under Subscribe CTA on PDP, cart, hero):**

> **$20/month** · First month $18 (10% off) · Cancel anytime

**"How it works" 3-line callout (next to Subscribe CTA on PDP and subscription landing):**

> • One 5ml vial (~30 sprays, a month's supply)
> • Ships automatically every month
> • Swap, pause, or cancel anytime from your account

**Pre-checkout reassurance line (cart + cart drawer):**

> You'll pick your next months' fragrances from your account after checkout. Or let us curate — we'll send you our Fragrance of the Month.

## 5. Files to Touch

| File | Change |
|------|--------|
| `snippets/subscription-pricing-summary.liquid` (new) | Single source of truth for the pricing line + "How it works" block. Accepts a `surface` param ("pdp" / "cart" / "hero" / "landing") to adjust verbosity. |
| `sections/main-product.liquid` | Replace current inline "$20/month" + "Retail: …" block with `{% render 'subscription-pricing-summary', surface: 'pdp' %}`. Add pre-checkout reassurance line above the Subscribe CTA. |
| `sections/subscription-landing.liquid` | Same replacement with `surface: 'landing'`. |
| `sections/hero.liquid` | Same replacement with `surface: 'hero'` (terse variant). |
| `templates/cart.liquid` | Replace existing subscription pricing text with `{% render 'subscription-pricing-summary', surface: 'cart' %}`; add the pre-checkout reassurance line above the Checkout button. |
| `snippets/cart-drawer.liquid` | Same replacement with `surface: 'cart'` (terse variant). |
| `config/settings_schema.json` | Add editor-controllable `subscription_first_order_price` (default `"$18"`) and `subscription_first_order_discount_pct` (default `"10"`). Pull these into the snippet. |
| Grep-and-fix | Search the theme for literal `$15` and `15/month` — verify each and remove/correct. |

## 6. Acceptance Criteria

- [ ] Single snippet renders consistent copy across PDP, cart, cart drawer, hero, subscription landing.
- [ ] Price appears as `$20/month · First month $18 (10% off) · Cancel anytime` on every surface listed above.
- [ ] "How it works" 3-line callout appears on PDP and subscription landing (but not cart — too crowded there).
- [ ] Pre-checkout reassurance line appears in cart and cart drawer.
- [ ] `grep -r '$15\|15/month' sections snippets templates` returns zero theme-code hits (marketing `<img>` assets excluded).
- [ ] Theme Customizer shows `subscription_first_order_price` and `subscription_first_order_discount_pct` as editable fields.
- [ ] Christina (or a comparable tester) can answer the 3 goal questions from §2 in under 10 seconds of looking at the PDP.

## 7. Verification

- Local dev server, walk the flow: home → subscription landing → PDP → add to cart → cart drawer → full cart page. Confirm pricing matches on every surface.
- Push to live theme 158692901082; QA per `memory/feedback_qa_after_changes.md`.
- Ask Jeff to forward screenshot to Christina with the fix live; request her response as validation.

## 8. Open Questions

1. Is the first-order 10% discount configured in Appstle such that **every** new subscriber gets it automatically, or is it gated behind a code/link? (Per `memory/project_first_order_discount.md` it's intentional — but confirm it applies to organic checkout, not only to a specific campaign. This affects whether we can show "$18 first month" unconditionally.)
2. Should we add a tiny tooltip/popover on the discount line explaining "You'll see the 10% off automatically applied at checkout" to prevent a different confusion?
