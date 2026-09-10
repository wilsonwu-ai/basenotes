# Homepage redesign — 2026-09-10

## Design brief

- **Purpose:** Help fragrance shoppers confidently buy an authentic 5 ml vial once, then understand the Monthly Rotation subscription and full-bottle path without confusing the three offers.
- **Primary shopper:** Fragrance-curious buyers who want to wear a scent on their own skin before committing to a recurring plan or bottle.
- **Tone:** Luxury restraint with an editorial, product-first rhythm.
- **Differentiator:** “Try the scent. Then decide.” The page turns one vial into the beginning of a clear progression rather than treating subscription as the only entry point.
- **Constraints:** Preserve the current live Shopify imagery and merchant settings; do not alter queue/cart safety selectors; use live product and compare-at prices; remain keyboard accessible, reduced-motion safe, and mobile-first.

## Merchandising hierarchy

1. Interactive one-time 5 ml vial — primary conversion path and CTA. First vial is the live $20 product variant; additional vials use the live $18 add-on SKU and retain the selected scent as a line-item property.
2. Monthly Rotation — explicitly defined as a monthly subscription.
3. Full bottle — positioned as the confident next step. Because the live catalog currently contains only 5 ml variants, the homepage requests a scent-specific quote rather than fabricating a purchasable full-bottle SKU or price.
4. Newsletter — “new-drop alerts,” never labeled as a subscription.

## Protected merchant media

- Live hero setting: `shopify://shop_images/gLmqu.jpg`
- Full-bottle comparison: `shopify://shop_images/Screenshot_2026-05-14_at_4.47.07_PM.png`
- Atomizer comparison: `shopify://shop_images/Screenshot_2026-05-14_at_4.31.57_PM.png`
- All Shopify product featured/secondary images, including Jeff-approved Mont Blanc Legend and Mesh Metal crops.

## Funnel invariants

- The scent atelier adapts Union Made's dependency-free SVG workbench: scoped custom element, pointer and keyboard rotation, reduced-motion fallback, and no WebGL/runtime payload.
- The McLane/Astra reference informs the split-stage composition and live visual response; Base Note's chooser is intentionally reduced to scent, vial/full-bottle size, and checkout.
- Product cards route to the PDP for an explicit purchase choice; no homepage quick-add silently changes purchase type.
- PDP defaults to one-time and submits without `selling_plan`; Monthly Rotation attaches and verifies the live selling plan.
- Monthly Rotation's CTA shows the first charge today, with the recurring monthly charge adjacent; it never collapses those two prices into a misleading `$20/month` button.
- Products missing a required selling-plan group remain fail-closed on the standard PDP.
- Existing IDs and data attributes used by cart, queue, Appstle, and account flows remain unchanged.
- The legacy subscription-first promotional popup is suppressed on the homepage so it cannot interrupt the new one-time-first journey.
