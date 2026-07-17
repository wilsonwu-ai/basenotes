# Base Note — July 16 Fix: Design Alignment (Task 4)

> Grounds the Bug A + Bug D-guard UI in Base Note's own brand framework
> (`base-note-design-framework.docx`, Jan 2026) + locked positioning
> (`project_positioning.md`). The fixes **reuse already-approved components**, so this is an
> alignment pass, not a new design.

## Brand authority (source of truth)
- **Live theme tokens** (current truth, override the Jan-2026 doc where they differ):
  `--color-primary #2D4641` (deep green), `--color-secondary #C9A962` (gold),
  `--color-background #FAF8F5` (warm cream); **Cormorant Garamond** (headings/fragrance names) +
  **Inter** (UI). The swap modal (`fragrance-selector.liquid`) already uses all of these.
- **Principles that bind these fixes:** 1.1 Approachable Luxury (warm, never clinical/error-y),
  1.4 Minimal Friction (every dead-end costs conversion — an empty grid *is* a dead-end),
  1.5 Consistency Through System (reuse components; 8px grid), 7.1 Mobile (≥44px tap targets).

## The taxonomy reconciliation (the heart of Bug A)
- Framework §4.5 intends clean families: **Woody / Fresh / Oriental / Floral (+ Fougère/Chypre)**.
- Live product data (collection facet) uses granular: **Aquatic, Citrus, Floral, Fresh, Fruity,
  Herbal, Lavender, Rose, Spicy, Tea tree, Vanilla, Woody**.
- The modal's tabs were built to the *intended* taxonomy; the data uses the *granular* one → drift → empty grid.
- **Decision for the shippable fix:** generate tabs from the **actual product data** (granular
  vocabulary), which (a) guarantees no empty tabs, (b) matches the fragrance page the merchant asked
  to mirror (Issue B lite), and (c) is honest to what's in the catalog. A later curated-family layer
  (map granular → clean 4-6 families) is a **B-phase design decision for Wilson** — noted, not blocking.

## Bug A — filter modal, design spec
1. **Reuse the existing `.fs-filter` pill row verbatim** (green-active, gold-hover, uppercase 600,
   horizontal-scroll with the right-edge fade already present) — already brand-consistent and
   already approved/live. No new visual language.
2. **Tabs generated dynamically** from the distinct families in the rendered set, **"All" first**.
3. **Title-case the family labels** on both the tabs and the card `.fs-card__family` badge. *(Fixes a
   latent brand nit: today L54 `| downcase` makes the card family render lowercase — off-brand for
   "Approachable Luxury" polish. Display = title-case; matching = normalized lowercase under the hood.)*
4. **Mobile tap targets ≥44px** (framework 7.1): bump `.fs-filter` mobile padding so each pill is
   ≥44px tall. Current desktop `0.4rem 1rem` is fine on desktop; enforce the floor at ≤768px.
5. **No dead-ends** (Minimal Friction): with dynamic tabs a tab can't be empty; keep the existing
   `.fs-empty` copy only for a genuinely empty collection.
6. **Preserve** the approved card layout, the `data-product-*` payload, and `fragrance:selected` —
   zero change to the swap/queue behavior the customer already knows.

## Bug D-guard — PDP unavailable state, design spec
- When `selling_plan_groups.size == 0`, do **not** show a hard error (violates Approachable Luxury).
  Show a **calm, low-prominence** state in the muted palette: disable the "Start My Subscription"
  CTA and replace with a quiet line — e.g. *"Subscription for this scent is being set up — check back
  soon."* — styled like existing muted helper text (`--color-text-muted`), not a red error.
- **Never** let the CTA silently add a one-time purchase (the revenue-leak bug). The guard's whole
  job is to make the failure *graceful and honest* until Wilson attaches the plan in Appstle.

## What is explicitly NOT redesigned here
The rich multi-facet UI (Season/Occasion/Family/Brand/Discovery + counts + Apply) is **Issue B** —
a separate, larger design engagement gated on Wilson's Q7/Q8. This spec covers only the
bug-fix + guard, which ride entirely on approved components.
