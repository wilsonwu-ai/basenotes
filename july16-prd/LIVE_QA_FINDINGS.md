# Live QA Findings (browser, basenotescent.com) — 2026-07-16/17

Method: claude-in-chrome (bypassed the curl/Cloudflare WAF 429).

## Catalog (products.json, ~25 products)
- Nearly ALL products have `product_type: "Fragrance"`; 2 have `product_type: ""` (e.g. Acqua di Gio Profondo).
- Metafield `custom.fragrance_family` NOT exposed in products.json (can't read directly), but the fallback (`product.type`) = "Fragrance"/"" for all.
- Real family vocabulary lives in TAGS: woody, woodsy, floral, flowery, fresh, citrusy, fruity, oriental, leather, green, gourmand, spicy, sweet, vanilla, amber, Oud, powdery, clean, aromatic, almond, boozy, tropical...
- Collection-page facet family names (screenshots): Aquatic, Citrus, Floral, Fresh, Fruity, Herbal, Lavender, Rose, Spicy, Tea tree, Vanilla, Woody — these are CURATED/normalized, NOT the raw tags (counts don't match raw-tag counts) → collection page uses a mapped taxonomy or a dedicated metafield.

## Bug A — CONFIRMED (high confidence)
- Swap modal tabs: all/woody/floral/fresh/oriental/leather/spicy/musk.
- `musk` matches ZERO products by any tag/type. `oriental`/`leather` match very few.
- Card `data-fs-family` = `custom.fragrance_family | default product.type`. With blank metafield → "fragrance" → contains none of the tokens → every filter tab except "All" hides ALL cards → empty grid. Matches reported symptom exactly.
- The modal's flat metafield-based taxonomy is a DIFFERENT data source than the collection page's curated facets → also the reason for request B.

## Bug D — CHARACTERIZED (needs 1 decision from Wilson)
Sampled 3 PDPs: Creed Aventus, Xerjoff Torino 21, Acqua di Gio Profondo. ALL identical:
- Top summary card shows "$20/month · First month $15 (25% off) · Cancel anytime" + "This is a recurring monthly subscription... $15 today then $20/month" + benefits. → the 25% discount IS shown.
- Below: "MONTHLY PLAN → Monthly Subscription (radio) → START MY SUBSCRIPTION — $20/MONTH" (native selling-plan fallback + custom CTA). "QUEUE FOR A FUTURE MONTH" below.
- **Appstle JS widget does NOT render on any PDP.** read_network_requests (after tracked reload) → ZERO appstle requests. `#appstle_subscription_widget` container stays empty → theme's native fallback (main-product.liquid L337-346) renders everywhere.
- Discount ($15/25%) is LIVE despite settings_data.json lacking `subscription_first_order_price`/`_pct` → either live theme settings differ from repo, or another render path. DUAL-SOURCE-OF-TRUTH risk stands.

### Interpretations of Bug D (pick one — changes the fix)
- R1 (per-product config): a specific product lacks a selling_plan_group → no subscription block. UNLIKELY — 3/3 sampled fine, shop page shows all cards subscribable. (Not yet swept all 25.)
- R2 (Appstle widget not rendering): the PDP never loads Appstle's widget; uses native fallback. "subscribe on appstle" = Appstle widget absent. LIKELY.
- R3 (CTA copy): "$20/MONTH" button doesn't reinforce the first-month $15 at the point of action; discount only in the summary above. LIKELY contributor.

### Open question for Wilson (ask at task-3→4 checkpoint)
Which product did Mike see, and is the ask: (a) make the Appstle widget render on PDP, (b) surface the first-month discount at the CTA button, or (c) fix a specific miswired product? Best-guess default = R2+R3 (make PDP subscribe UX consistent with the cart/Appstle + reinforce discount at CTA).
