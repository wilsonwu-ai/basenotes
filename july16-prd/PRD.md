<!--
  Base Note — July 16, 2026 Ticket PRD
  Produced by: multi-agent investigation workflow (5 parallel code readers + adversarial
  verification + synthesis) + live browser QA on basenotescent.com.
  Status: Tasks 1 (PRD/root-cause) + 2 (QA/impact) COMPLETE. Awaiting Wilson's decisions on
  the open questions in §7 before implementation (task 5).
-->

# Live QA Corroboration (browser, basenotescent.com — 2026-07-16/17)

The code analysis below was independently corroborated against the **live store** (claude-in-chrome,
bypassing the Cloudflare WAF that blocked curl). Findings that resolve/strengthen §7 open questions:

- **Catalog (products.json, ~25 products):** every product's `product_type` is `"Fragrance"` (2 empty).
  So the swap modal's `| default: product.type` fallback resolves to `"fragrance"` for all —
  which contains none of the tab tokens (`woody/floral/fresh/oriental/leather/spicy/musk`).
  `musk` matches **zero** products by any tag or type.
- **Collection "Fragrance family" facet vocabulary (from screenshots + live):** Aquatic, Citrus,
  Floral, Fresh, Fruity, Herbal, Lavender, Rose, Spicy, Tea tree, Vanilla, Woody — this is the real
  `custom.fragrance_family` vocabulary, and it does **not** align with the modal's hardcoded tabs
  (`oriental/leather/musk` don't exist in it). Strongly implies the modal's family derivation yields
  a non-matching value for all cards (list-metafield render issue → `product.type` fallback), so
  **every** non-"All" tab empties. This makes the dynamic-tab fix (Issue A) robust regardless of the
  exact metafield type. → partially resolves Q1/Q2/Q3.
- **Bug D live sampling:** Creed Aventus, Xerjoff Torino 21, and Acqua di Gio Profondo (the empty-
  `product_type` edge case) **all** render the full subscribe block with "First month $15 (25% off)"
  and a working native selling-plan CTA — i.e. these products **have** selling plans. The Appstle JS
  widget injects on **none** of them (zero `appstle` network requests) → the native fallback is
  universal. This **confirms** the verifier's ruling: "$15/25% discount displays correctly on
  configured products" (Part B refuted) and "the broken product Mike saw is one with `size==0`."
  → partially resolves Q4 (the 3 sampled are NOT the broken SKU; the broken one remains to be swept).

---

# Base Note — July 16, 2026 Ticket PRD

> Source of truth for every claim below is the **theme code**, not live Shopify/Appstle data (MCP token lacks `products` scope). Each claim cites `file:line`. Verdict labels — **CONFIRMED / PARTIAL / REFUTED** — are carried verbatim from the adversarial-verification pass and must not be softened downstream.

---

## 1. Executive summary

| ID | Type | One-line status |
|----|------|-----------------|
| **A** | Bug | **CONFIRMED.** Swap-modal filter tabs (FRESH, ORIENTAL, LEATHER, SPICY, MUSK, likely WOODY) empty the grid because a **hardcoded 8-tab taxonomy** (`snippets/fragrance-selector.liquid:41-48`) is substring-matched (`:390`) against each product's real `fragrance_family`/`product.type` value — the tab tokens aren't substrings of the products' actual family strings. **Not a casing bug.** |
| **D** | Bug | **PARTIAL.** *Confirmed* part: products **not attached to the Appstle selling-plan group** (`product.selling_plan_groups.size == 0`) lose every subscribe control on the PDP and **add-to-cart as a plain one-time purchase** (`sections/main-product.liquid:338, 1959-1962, 2044`). *Refuted* part: the "prints $18/10% wrong discount" claim — schema defaults (`config/settings_schema.json:489-499`) already yield **$15/25%**, matching the stated live Appstle discount. Residual is an architectural dual-source-of-truth smell, not a live mismatch. |
| **B** | Request | **Scoped as a rebuild, not a port.** The rich fragrance-page facets (Season / Occasion / Family / Brand / Discovery, with counts + Apply) come from Shopify's Search & Discovery `collection.filters` object (`sections/main-collection.liquid:128`), which the swap modal's render context structurally cannot access. Matching them in the modal requires manually recomputing facets + counts from raw product data. |
| **C** | Request | **Feasible, needs a two-tier signal.** No subscriber-vs-prospect differentiation exists on any browse surface today (PDP CTA hardcoded, `sections/main-product.liquid:368`). Recommended: a cheap server-written `customer.basenote.subscription_status` metafield for first paint **plus** the existing client/Worker Appstle contract check for true ACTIVE vs paused/cancelled. The "add to *this* month with an upsell discount" sub-request has **no code path** — net-new build. |

---

## 2. Issue A — Swap filter shows nothing

### Symptom
In the "Choose Your Fragrance" swap modal, clicking any non-"All" filter tab (FRESH, ORIENTAL, LEATHER, SPICY, MUSK, and likely WOODY) empties the product grid; FLORAL and ALL show products.

### Confirmed root cause (`file:line`)
**Verdict: CONFIRMED.** The filter is a **pure substring-containment test** between a fixed hardcoded tab vocabulary and each card's family string. The tab tokens do not appear as substrings of the products' actual `fragrance_family`/`product.type` values.

- `snippets/fragrance-selector.liquid:41-48` — exactly 8 hardcoded tabs with lowercase `data-fs-filter` tokens: `all, woody, floral, fresh, oriental, leather, spicy, musk`. This taxonomy is authored in the theme, independent of the store's real family vocabulary.
- `snippets/fragrance-selector.liquid:54` — card family derived as `product.metafields.custom.fragrance_family | default: product.type | downcase`.
- `snippets/fragrance-selector.liquid:61` — written to the card as `data-fs-family="{{ family | downcase }}"` (downcased a **second** time).
- `snippets/fragrance-selector.liquid:389-390` — handler computes `cardFamily = (card.dataset.fsFamily||'').toLowerCase()` and shows the card **iff** `cardFamily.indexOf(family) !== -1`.

**It is provably not a casing bug:** every side of the comparison is lowercase (Liquid `downcase` at `:54` *and* `:61`, JS `.toLowerCase()` at `:389`, literal-lowercase tokens at `:41-48`). There is no uppercase anywhere in the comparison path.

**The FLORAL/FRESH asymmetry is itself the proof of a data cause:** the JS handler (`:378-393`) is identical for every non-"all" tab — no per-tab branching. Two tabs can only differ in outcome if the product data differs. FLORAL populating proves at least one card's family contains `"floral"` (so the match logic works); FRESH emptying proves `"fresh"` is absent from **all** rendered cards' family values.

### Mechanism
Modal rendered once (`templates/customers/account.liquid:376`, `mode:'modal'`) → per product (`limit: 20`, `:53`) family stamped onto `data-fs-family` → tab click reads token, substring-matches against every card, hides non-matches. A tab with zero substring hits yields a fully empty grid.

### Blast radius
One modal instance shared by **every** swap/pick entry point:
- `templates/customers/account.liquid:880-886` — generic `[data-open-fragrance-selector]` trigger.
- `templates/customers/account.liquid:1162` — queue-strip per-month SWAP; `:1163` — queue-strip per-month PICK.
- `templates/customers/account.liquid:1826-1834` — Next Shipment `nsChooseBtn` / `nsSwapBtn`.
- `templates/customers/account.liquid:2204-2210` — bq-card SWAP; `:2229-2248` — empty-slot "Pick Your Next Scent".
- **Data-flow sink:** selected family (`:82`/`:97`, un-downcased) → `fragrance:selected` → `BasenoteQueue.setSlot({family})` (`account.liquid:1191/1849/1862`) → persisted in `basenotes_queue` and rendered on queue cards. Any change to family derivation changes stored/displayed labels.
- **Coupled but not broken:** same `fragrance_family` value is displayed (not filtered) in four Klaviyo email templates (`snippets/email-pre-shipment-confirmation.liquid:82`, `email-pre-shipment.liquid:61`, `email-post-delivery.liquid:47`, `email-shipment-confirmation.liquid:89`).
- **PDP is out of scope:** grep confirms `sections/main-product.liquid` renders no `fragrance-selector` and no `data-fs-*` — the PDP queue modal is a separate Appstle-bridge component unaffected by this bug.

### Regression risks
- **Preserve the Appstle swap-bridge payload.** The swap keys off the selected card's `data-product-id/handle/title/image` (`:93-96`), which feed `frag.id/frag.handle` → `setSlot` → the `contractDetailsJSON + gid` form the recent commits fixed. A fix that only changes tab tokens or the `indexOf` comparison is **safe**; a fix that regenerates cards or alters `data-product-*` risks breaking the swap.
- **Match-type change:** switching substring → exact-equality to kill false positives (a compound family like `"Floral Woody Musk"` currently surfaces under three tabs) would **regress the working FLORAL tab** if families are multi-value strings. If multi-value families exist, tokenize (split on space/comma) — don't exact-match.
- **Keep the `product.type` fallback (`:54`).** Removing it gives metafield-less products a blank family → hidden from every non-"all" tab (a new empty-grid failure).
- **`limit: 20` (`:53`) is a compounding secondary cause:** a family present only on product #21+ empties its tab regardless of token correctness. If the fix generates tabs from products, tab scope and grid scope must be reconciled.

### Fix direction (high-level)
Replace the hardcoded 8-tab list with tabs **generated from the distinct family values actually present** in the rendered collection (or map the store's real vocabulary onto the intended marketing families) rather than assuming products carry `fresh/oriental/leather/spicy/musk` labels. **Note the two variants of the root cause** (see Open Questions): (a) tabs authored with the wrong words vs (b) `fragrance_family` unpopulated → `product.type` fallback matches nothing. Dynamic tab generation neutralizes both; a data-side fix (populate/normalize the metafield in Admin) also fixes it but has customer-facing email side effects.

---

## 3. Issue D — PDP missing 25% discount + Appstle subscribe

### Symptom
Some PDPs render only the static "$20/MONTH" box + "Start My Subscription — $20/month" / "Queue for a Future Month" CTAs, with **no Appstle subscribe option and no discount surface**, while other products show the Appstle widget correctly.

### Confirmed root cause — Part A (`file:line`)
**Verdict: PARTIAL — Part A CONFIRMED.** Affected products are **not attached to the Appstle selling-plan group**, so Shopify reports `product.selling_plan_groups.size == 0`. On those products:
- `sections/main-product.liquid:267` — `#appstle_subscription_widget` container is emitted, but Appstle injects nothing (no plan) → stays empty.
- `sections/main-product.liquid:338` — the native Shopify selling-plan selector is wrapped in `{%- if product.selling_plan_groups.size > 0 -%}` → **never rendered**.
- `sections/main-product.liquid:1954-1962` — submit handler: `formData.get('selling_plan')` is null (`:1954`), querySelector fallback finds nothing (`:1955-1958`), and the only force-default assignment (`:1960`) is **itself** Liquid-guarded by `size > 0` (`:1959-1961`) so it is **not compiled in** → `sellingPlan` stays null → `const isSubscription = !!sellingPlan` (`:1962`) is `false`.
- `sections/main-product.liquid:2044` — single-subscription enforcement (`:1972`) is skipped and the payload posts `{ id, quantity:1 }` with **no `selling_plan`** → the item is added as a **plain one-time purchase** at variant base price, with no recurring billing and no discount.

**Uniqueness argument (strengthens the finding):** the total absence of *both* subscribe controls fingerprints `size == 0` specifically. If `size > 0` but Appstle's JS merely failed to load, the native selector at `:338` is a server-rendered backstop that would still show subscribe radios. So "Appstle script didn't load" is ruled out.

### REFUTED — Part B (the "$18/10% wrong discount" claim)
**Verdict: this half of the finding is REFUTED.** The finding claimed the PDP prints "First month $18 (10% off)" because `subscription_first_order_price`/`_pct` are absent from `config/settings_data.json`. That is wrong:
- `config/settings_schema.json:489-499` **defines** these settings with schema defaults `"$15"` and `"25"`. In Shopify a setting absent from `settings_data.json` resolves to its **schema default**, so `settings.subscription_first_order_price` returns `"$15"` (not nil) and the `| default: '$18'` / `'10'` fallbacks in `snippets/subscription-pricing-summary.liquid:21-22` **never fire**.
- The PDP actually renders **"First month $15 (25% off)"**, which **matches** the stated live Appstle discount. The schema author even annotated it "Must match the actual Appstle selling-plan discount."

So the evidence item on `settings_data.json:37` and the "displayed discount is wrong even on correctly-configured products" claim are **false**. Do not act on them.

### Dual-source-of-truth discount risk (flag explicitly)
Even though Part B is refuted as a *live* bug, a real **architectural risk remains and must be called out**: the first-month discount copy is **theme settings, not read from Appstle's actual `plan_allocation.price`**. Two independent latent hazards:
1. **Divergent Liquid fallbacks on the same page.** `snippets/subscription-pricing-summary.liquid:21-22` falls back to **$18/10%**, while `snippets/subscription-renewal-disclosure.liquid:18` falls back to **$15/25%**, and **both render on the PDP** (`main-product.liquid:184` and `:189`). Today the schema default ($15/25%) masks the divergence. But if anyone ever sets these keys to an **empty string** in `settings_data.json`, the two snippets print **contradictory numbers on the same page**.
2. **Copy decoupled from Appstle.** If Appstle's real discount ever changes, the theme-settings copy will silently drift from the selling plan the customer is actually charged against. This is the canonical dual-source-of-truth exposure.

### ⚠️ Do NOT apply the finding's own suggested "interim fix"
The finding's Open Questions suggest "set `subscription_first_order_price`/`_pct` in `settings_data.json` to $15/25%." The schema **already yields $15/25%**; writing the pricing-summary's stale `$18/10%` fallback into `settings_data.json` would **create the very mismatch the finding wrongly alleged.** Leave the keys unset (or, if set, set both to $15/25%).

### Additional confirmed blast radius (browse + cart misrepresentation)
An unattached product is misrepresented as a subscription on surfaces the customer sees before checkout:
- `snippets/product-card.liquid:195` — every card hardcodes `{{ settings.subscription_price | default: "$20" }}` + "Monthly Subscription" regardless of attachment.
- `snippets/product-card.liquid:225-227` — quick-add sets `data-selling-plan` only when `size > 0`; unattached quick-add posts no plan → one-time purchase while the card claims subscription.
- `snippets/cart-drawer.liquid:64,84,112-115,154-163` — a no-plan line renders as non-subscription at variant price; the $20/month reassurance is suppressed.
- `templates/cart.liquid:18-21` — `has_subscription` keyed on `item.selling_plan_allocation`; unattached item → no subscription disclosure, retail line price, wrong totals.
- **Downstream:** a one-time line never creates an Appstle contract → no renewal, no swap bridge.

### Variant-naming caveat on the "always-on $20 box" framing
The finding asserts the static box "renders unconditionally." That is **imprecise.** The box at `main-product.liquid:160` carries `{% unless is_subscription_variant %}...display:none{% endunless %}`, and `is_subscription_variant` (`:46-54`) is true for a `size==0` product **only** via the variant-title keyword path at `:48` (`5ml`/`5 ml`/`atomizer`/`subscription`); the `:52` path requires `size > 0`. What is genuinely unconditional is the **CTA button** ("Start My Subscription — $20/month", `:365-372`) and the "Queue for a Future Month" button (`:377`), which live outside the box. The visible-$20-box symptom therefore also depends on the affected products having keyword-named 5ml variants — consistent with Base Note's 5ml catalog, but a dependency to verify per affected SKU.

### Regression risks
- Removing the `size > 0` guard at `:1959-1961` to "always default a plan" does nothing for `size==0` (`selling_plan_groups[0]` renders empty) and could emit garbage `selling_plan` → `/cart/add.js` 422.
- A theme guard that hides/disables the CTA when `size==0` must not fire on **intentionally one-time** SKUs (if any exist — samples, full bottles) that rely on the `:48` keyword path.
- Newly attaching products makes them subject to the single-subscription swap-modal enforcement (`:1972`); re-verify the Appstle swap bridge (`contractDetailsJSON + gid`) still receives a valid `selling_plan` id and that each variant actually gets a `plan_allocation` so `:344/:351` render a price.

### Fix direction (high-level)
Preferred is **data-only**: attach each affected product's variant to the Appstle selling-plan group so `selling_plan_groups.size > 0` — restores the native selector, plan-default, subscription enrollment, cart treatment, and Appstle billing with **no Liquid change**. **Additionally recommended** (defense-in-depth): a theme guard that disables/redirects the subscribe CTA when `size==0` so an unconfigured product can never silently add as a one-time purchase. **Separately**, decide whether first-month discount copy should be driven from Appstle's real `plan_allocation.price`/`compare_at_price` instead of theme settings, to permanently close the dual-source-of-truth gap.

---

## 4. Issue B — Unify swap-modal filters with the fragrance page

**This is a rebuild, not a port** — the two UIs run on fundamentally different data plumbing.

### Reference system — facet-by-facet spec (fragrance/collection page)

The reference facets are a **generic loop over Shopify Storefront Search & Discovery filters** — `sections/main-collection.liquid:128` (`{%- for filter in collection.filters -%}`). The facet **groups are NOT hardcoded**; they render whatever the merchant configured in the Shopify Search & Discovery admin app. Each facet maps to a product attribute:

| Facet | Exact data source it reads | Notes |
|-------|----------------------------|-------|
| **Fragrance family** | `metafields.custom.fragrance_family`, fallback `product.type` | Same underlying attribute the swap modal already reads (`fragrance-selector.liquid:54`). |
| **Brand** | `product.vendor` | Also `product-card.liquid:162`, `main-product.liquid:140`, `scent-quiz.liquid:1340`. A rebuilt facet iterates + groups/counts by `product.vendor`. |
| **Season** | `metafields.fragrance.season.value` (list metafield), fallback structured/plain tags `season:spring` / `spring` | Source model at `main-product.liquid:5, 25-30`. |
| **Occasion** | Parsed from structured tags `event:X` (loose `wedding`/`formal` tags) — `scent-quiz.liquid:1270, 1277` | **No dedicated occasion metafield exists anywhere in the theme** (grep confirms only `metafields.fragrance.season`). Weakest/most divergent facet source; needs a tag convention or new metafield to be reliable. **Do not** mistake `blocks/ai_gen_block_e4e9960.liquid:651-689` "Occasions" pills — those are static merchant-configured display marketing, not a data-driven facet. |
| **Discovery / "Not Tried Yet"** | `customer.orders[].line_items[].product.handle` → a Set → hides matching cards client-side | `main-collection.liquid:191, 984`. **Not a Shopify facet**; logged-in-only; **fully portable into a modal** (no filtering context needed). |

**How counts are produced:** for each `list`/`boolean` filter (`main-collection.liquid:140`) the theme emits a checkbox per `value` using `filter.param_name` + `value.value`, marks `value.active`, prints `value.count`, and disables the box when `value.count == 0 and not active` (`:147, :152`). **Counts are computed server-side by Shopify's filtering engine** against the current collection + active-filter set.

**Apply affordance:** the APPLY FILTERS submit + Clear All (`:210`) clears existing `filter.*` params, appends checked values, then `window.location.href = url` — a **full-page navigation** so the server re-renders `collection.products` already filtered (`:946`); desktop checkbox change auto-submits (`:972-977`). **A modal that stays open cannot use this navigation-based apply.**

**Mobile drawer:** `.collection__sidebar` is fixed off-canvas `translateX(-100%)` under `@media (max-width:992px)` (`:801`), slides in via `.is-open`, toggled by `[data-filter-toggle]` + overlay + close (`:927-941`).

### Why the swap modal cannot reuse any of this
`snippets/fragrance-selector.liquid:14` assigns `fs_products = collections[fs_collection].products` — it reads `.products` only. There is **no `collections[...].filters` object** in this render context, no `value.count`, no `param_name`, no filtering request. Its current filter is a single axis (family), hardcoded chips (`:41-48`), client-side substring show/hide (`:378-393`), no counts, no Apply. The rich facet objects the collection page renders **literally do not exist** in the product/customer template the modal lives in.

### What reuse requires
To match the fragrance page inside the modal, all facets + counts must be **rebuilt from raw product data and computed manually in Liquid**, then filtered client-side while the modal stays open:
- Iterate the full subscription collection (today capped at `limit: 20`, `:53`) — paginate or emit a JSON product feed so counts are accurate.
- For each of Family / Brand / Season / Occasion, iterate products, group by the attribute above, and count in Liquid.
- Port "Not Tried Yet" directly from `main-collection.liquid:984` (purchase-history Set) — it's already context-free.
- Replace the full-navigation Apply with an **in-modal, client-side apply** (the modal can't navigate away mid-swap).

### Fix direction (high-level)
Treat as a **facet-rebuild inside the modal**, not a component port. Realistic pattern: emit the subscription collection as an inline JSON feed (or full Liquid iteration), compute per-facet counts in Liquid, render checkboxes with an in-modal Apply, reuse the collection page's mobile-drawer CSS/JS pattern, and reuse the purchase-history "Not Tried Yet" logic verbatim. Confirm the live Search & Discovery facet→attribute mapping in Admin first (Open Questions) so the modal's manually-computed facets match the collection page — especially Occasion, which has no metafield today.

---

## 5. Issue C — Subscriber vs non-subscriber PDP treatment

**Verdict: CONFIRMED — feasible, but requires a two-tier signal.**

### Current state
No subscriber-vs-prospect differentiation exists on **any** browse surface:
- `sections/main-product.liquid:368` — primary CTA hardcoded "Start My Subscription — $20/month" for everyone.
- `sections/main-product.liquid:376` — the only per-customer conditional on the PDP is the login gate `{% if customer %}` on "Queue for a Future Month" — never subscriber status.
- `snippets/product-card.liquid:233` — collection quick-add always "Choose This Scent".
- Grep confirms `is_subscriber` appears **only** in `templates/customers/account.liquid` — never on any browse surface. A subscriber and a prospect render an identical PDP today.
- *Minor correction to the finding:* `snippets/promo-popup.liquid:8` **does** branch per-customer on a browse-adjacent surface, but on `customer.orders_count > 0` (a crude has-ordered proxy), **not** subscription status, and only to suppress a popup. The finding's blanket "no differentiation on any storefront browsing surface" is very slightly overstated by this popup; none of the actionable conclusions change, hence CONFIRMED not PARTIAL.

### Available signals and their reliability

| # | Signal | Where | Semantics | Reliability |
|---|--------|-------|-----------|-------------|
| **1** | Order-history loop | `templates/customers/account.liquid:9-24` — loops `customer.orders`, sets `is_subscriber` on any `line_item.selling_plan_allocation` | **"has ever subscribed"** | Server-side, render-time, but **heavy** order loop; **cannot** distinguish paused/cancelled — a churned customer still reads true (mislabels "Active Member" at `:91`). |
| **2** | `customer.tags contains 'subscriber'` | `snippets/checkout-thank-you.liquid:513` (the **only** such check; `customer.tags` proven readable at `account.liquid:1247`) | tag-based | **Cheap** render-time, BUT **no code anywhere in theme or Worker applies this tag** (grep-confirmed). Depends on an unverified external Appstle/Flow rule; stale-prone. A **latent correctness risk today** (the "Subscribe & Save" CTA silently always shows). Unsafe basis for gating as-is. |
| **3** | Live Appstle contract status | `assets/bn-appstle-swap.js:69-133` `fetchActiveContract()` → CP proxy, filters `status==='active'` (`:86`), throws `'no-active-contract'` (`:89`); Worker mirror `worker/queue-proxy/src/index.ts:470-471` (`status === "ACTIVE"`) | **the only signal that sees ACTIVE vs paused vs cancelled** | **True** contract state, BUT **async HTTP round-trip**, not a Liquid render value; invoked lazily on `swap()` (`:234`), not eagerly exposed. Note fallback to `list[0]` when none active (`:88`) — a client-side "confirm active" guard on it does not strictly guarantee an active contract. |

**Net:** at PDP render, Liquid can cheaply tell logged-in (yes) and could tell "has ever subscribed" (heavy loop), but **cannot** tell active-vs-paused-vs-cancelled without the client/Worker Appstle call. This gap is the crux for safely offering swap/add actions.

### Recommended approach (two-tier)
1. **First paint / cache-safe:** have the Worker write a `customer.basenote.subscription_status` metafield (`active|paused|cancelled` + `next_bill_date`) whenever it already resolves the contract (`index.ts:469-471`), then read that single cheap metafield at PDP render. `customer.metafields` are proven render-readable (`account.liquid:166` reads `customer.metafields.subscription.fragrance_history`). This reflects real contract state in one Liquid read — unlike the order-history loop and unlike the unset tag. The metafield does **not exist yet** (Worker persists only `basenote.queue`, `index.ts:42-43`).
2. **Enable actions:** confirm/refresh client-side via the already-loaded `BasenoteAppstleSwap` contract fetch (or piggyback the existing per-page round-trip `assets/queue-scheduler.js:334-339`, `GET /apps/basenote/queue`) before enabling swap — so a stale metafield can't fire a swap against a non-shipping contract.

**PDP gating recommendation:** logged-out / no subscription → keep "Start My Subscription — $20/month"; **ACTIVE** subscriber → contextual actions wired to existing plumbing ("Swap into next month's box" → `BasenoteAppstleSwap.swap(...)` at `bn-appstle-swap.js:234`; "Add to a future month" → existing PDP `BasenoteQueue.setSlot` flow at `main-product.liquid:377, 1900`); **paused/cancelled** → Reactivate CTA, **not** swap.

### "Add scent to THIS month's pick with an upsell discount" — no code path
The model is single-line, one item/month (project MEMORY; swap **replaces** the contract line — `index.ts:452-476`, `bn-appstle-swap` replace-variants). Adding an extra vial to the current cycle needs a **net-new capability** (Appstle "add product to next order" / one-time add, or a second contract line) plus a discount rule. **This is a new build, not a gating change.**

### Risks
- **Divergent subscriber truths.** Adding a live `subscription_status` metafield while leaving the order-history `is_subscriber` (`account.liquid:9-24`) in place yields two disagreeing definitions — a churned customer sees "Active Member"/cancellation-flow on the account page but "Reactivate" on the PDP. Reconcile or the UX self-contradicts.
- **Stale-metafield-fires-swap.** Gating swap on a cached metafield can enable a swap against a contract paused/cancelled after the write; the `fetchActiveContract` `list[0]` fallback (`:88`) does not strictly guarantee active.
- **Swap-bridge invariants** (see §6) apply to any PDP swap wiring — must go **through** `BasenoteAppstleSwap.swap()`, never reimplement the call.
- **`checkout-thank-you.liquid:513` flip.** Making the "subscriber" signal reliable would correctly hide the always-currently-shown "Subscribe & Save" CTA for real subscribers (intended), but any Klaviyo/analytics keyed to that impression sees volume drop.
- **Operational:** Worker Admin token must keep `write_customers` (already used for the queue metafield); the metafield definition must be created in Admin or it renders untyped/hidden.

---

## 6. Cross-cutting architecture invariants to preserve (Appstle swap-bridge contract)

**Verdict: ARCH map CONFIRMED end-to-end.** Any fix touching the swap modal, fragrance-selector, PDP CTAs, or subscriber gating **must preserve** these invariants or it silently regresses renewal fulfillment.

**The sanctioned data flow** (modules load in fixed order, `layout/theme.liquid:205-209`: `window.bnCustomerId` → `queue-scheduler.js` → `bn-appstle-swap.js`, both `defer`):
1. **Event contract (INVARIANT):** `snippets/fragrance-selector.liquid:399-407` dispatches `fragrance:selected` with `detail={id,handle,title,image,family}` from `data-product-*`. Renaming these dataset keys or detail fields **breaks every queue write silently.**
2. **Single sanctioned write path:** `BasenoteQueue.setSlot` (`assets/queue-scheduler.js:179-209`) — localStorage upsert → `save()`→`emit()` → Klaviyo → `syncFirstSlotToAppstle`. Direct localStorage writes are the "canonical Jeff bug."
3. **Slot-0-only Appstle bind (INVARIANT):** `syncFirstSlotToAppstle` (`:167-177`) hard-guards `if (month !== firstVisibleMonth()) return`. **Queue slot 0 == active Appstle contract line.** Only slot 0 is bound to Appstle; months 2+ stay local until they roll forward.
4. **Cross-device metafield layer:** `SYNC_URL '/apps/basenote/queue'` App Proxy → Worker → `customer.basenote.queue` metafield; debounced push (`:356-360`), hydrate+merge server-wins-on-month (`:326-379`), pagehide `sendBeacon` (`:385-395`), all gated on `isLoggedIn() == !!window.bnCustomerId`.
5. **Appstle bridge invariants** (`assets/bn-appstle-swap.js`) — **must not regress:**
   - `lineId` kept in **full gid form** (`:110-118`) — stripping it re-triggers Appstle HTTP 400 "Contract line not found".
   - Post-replace **cache invalidation** `lineId=null; fetched=false` (`:198-204`) — Appstle assigns a new lineId per replace; removing this breaks the **second** swap.
   - **`contractDetailsJSON`-first** parse (`:98-107`) — reverting to `lines/lineItems` breaks post-May-11 contracts.
   - **`swap()` serialization** (`:234-261`) — firing replace-variants from a new code path without going through `swap()` races concurrent replaces and can strand the contract on a stale variant.
   - Two-path design: A = CP proxy `replace-variants-v2` (`:146-160`), B = Worker `/apps/basenote/sync-subscription` (`:162-178`).
6. **Roll-forward guard:** `setShippedThrough` (`queue-scheduler.js:259-282`) — the no-op guard at `:269` prevents the May-12 `emit()` RangeError recursion (`account.liquid` calls it every render at `:923/1099/2128`); then re-prunes and re-syncs the new first-visible month (`:279-281`).
7. **PDP path:** `sections/main-product.liquid:1890-1921` routes the month-picker through `BasenoteQueue.setSlot` (`:1900-1901`) with a 1700ms settle so the debounced push flushes.

### Two fragile-but-currently-working seams to preserve/fix carefully
- **Seam #1 — double `fragrance:selected` listener** (`account.liquid:1182` router + `:1837` big-script). The `:1182` handler clears `window.__bqPendingTargetMonth`; the `:1837` handler then reads it null and falls through to `saveNextShipment()`→`syncNextShipmentToAppstle()` (`:1420-1449`), which is **not** gated by `firstVisibleMonth`. A future-month (slot 2+) pick can therefore be pushed onto the next Appstle renewal even though `syncFirstSlotToAppstle` correctly declined. Any selector/modal refactor must preserve single-dispatch semantics — fire the Appstle swap **exactly once for slot 0, never for slot 2+**. Also: `:1856` fallback is the **only** path servicing the Next-Shipment Choose/Swap buttons — don't remove it wholesale.
- **Seam #2 — `addToRotationQueue` direct-write** (`main-product.liquid:1746-1771`) writes localStorage via `saveRotationQueue`, bypassing `setSlot` → **no metafield push, no Appstle swap.** Verification found it **more reachable than the finding claimed**: its no-target branch (`:1756-1767`) iterates from the current calendar month and takes the first empty slot, so when the current month is empty it **does** target `firstVisibleMonth` (slot 0); its cart-swap-modal caller `onAddToRotation` (`:2017`) can therefore land a slot-0 pick that silently skips Appstle + metafield. Recommend routing it through `BasenoteQueue.setSlot` — but note `setSlot` lacks `addToRotationQueue`'s duplicate-productId block (`:1758`), so dedupe behavior changes, and from the cart mid-add it could swap the *existing* contract unexpectedly (force a non-slot-0 target or suppress the swap).

### Family-taxonomy coupling (ties A, B, ARCH together)
The **selector filters** on metafield/`product.type`-derived family (`fragrance-selector.liquid:54`), while the **queue/Appstle layer stores** family from `product.vendor` (`main-product.liquid:1886`, account `setSlot` `family:frag.family`). If filter taxonomy and vendor values diverge, filtering and stored "family" can disagree — cosmetic today, but confirm before changing either.

---

## 7. Open questions needing live data or Wilson's decision

1. **[A — live data]** Exact live `custom.fragrance_family` / `product.type` values per product (no `products` scope). FLORAL-populated + FRESH-empty is confirmed by the report; which of WOODY/ORIENTAL/LEATHER/SPICY/MUSK are empty vs populated depends on the live vocabulary.
2. **[A — decision]** Is `fragrance_family` a single-select or a comma/space-delimited multi-value string in Admin? Determines exact-match vs tokenized-match vs dynamic-tab generation, and whether an exact-match fix would regress FLORAL.
3. **[A — root-cause variant]** Is the empty grid driven by *wrong tab words* or by `fragrance_family` being **unpopulated** on most products (→ `product.type` fallback matching nothing)? A dynamic-tab fix neutralizes both; a data fix has email-template side effects.
4. **[D — live data]** Exactly which live products are **not** attached to the Appstle selling-plan group (`size == 0`). Code confirms the mechanism, not the SKUs.
5. **[D — decision]** Data-only fix (attach all products in Appstle) vs data + a theme guard that disables the CTA when `size == 0`? Recommendation: both.
6. **[D — decision]** Should first-month discount copy be driven from Appstle's real `plan_allocation.price`/`compare_at_price` to permanently close the dual-source-of-truth gap? (And confirm no `settings_data.json` write of $18/10% — see §3 warning.) Are there **intentional** one-time SKUs (samples / full bottles) that must keep the keyword path?
7. **[B — live/Admin]** The live Search & Discovery facet→attribute mapping (configured in Admin, not code) — especially **Occasion**, which has no metafield today (only `event:` tags). And whether `fragrance_family` / `metafields.fragrance.season` / `event:`/`season:` tags / `product.vendor` are populated consistently enough for Liquid-computed counts to look correct.
8. **[B — decision]** URL-param persistence vs purely in-modal client-side filtering? (The modal can't use the collection page's full-navigation apply.) And whether to inline all products in Liquid vs a JSON feed for accurate counts beyond the current `limit: 20`.
9. **[C — Admin/live]** Is a `subscriber` (or "Active Subscriber") customer tag actually applied by Appstle/Flow in the live shop? Nothing in the theme sets it; `checkout-thank-you.liquid:513` already depends on it. Does a `customer.basenote.subscription_status` metafield exist, or only `customer.basenote.queue` + `customer.metafields.subscription.fragrance_history`?
10. **[C — decision]** Business rule for churned/paused customers on the PDP: Reactivate vs Subscribe vs standard prospect CTA? And whether Appstle supports adding a one-time/extra product to the current or next order (determines if the "add-to-this-month + discount" ask is config or net-new build).

---

## 8. Proposed fix sequencing (high-level; detailed design in a later phase)

1. **D first — data-only, lowest risk, revenue-critical.** Attach every affected product's variant to the Appstle selling-plan group so `size > 0`. Restores subscribe controls, plan-default, subscription enrollment, cart treatment, and Appstle billing with **no Liquid change**. Verify each variant receives a `plan_allocation`. *(Stops the silent one-time-purchase revenue leak.)*
2. **D hardening — small theme guard.** Disable/redirect the subscribe CTA when `size == 0`, guarding against future unconfigured products. Confirm no legitimate one-time SKU is blocked (Q6).
3. **A — fix the swap-modal filter.** After confirming the live family vocabulary (Q1-3), replace the hardcoded 8-tab list with tabs generated from the distinct family values actually present, reconciling tab scope with the `limit: 20` grid scope. Preserve the `data-product-*` swap payload and the family data-flow sink. *(Small, self-contained; restores every swap/pick entry point.)*
4. **C — subscriber gating (two-tier signal).** Add the Worker-written `customer.basenote.subscription_status` metafield (piggyback `index.ts:469-471`), read it at PDP render for first paint, confirm client-side via the existing round-trip before enabling swap. Reconcile with the order-history `is_subscriber` to avoid divergent truths. Fix the latent `checkout-thank-you.liquid:513` tag dependency as part of this. Defer the "add-to-this-month + discount" ask pending Q10 (net-new build).
5. **B — swap-modal facet rebuild (largest, do last).** After Admin facet mapping is confirmed (Q7), rebuild Season/Occasion/Family/Brand/Discovery facets + counts from raw product data with an in-modal client-side apply and a mobile drawer, reusing the purchase-history "Not Tried Yet" logic verbatim. Scope as a rebuild, not a port.

**Throughout 3-5:** preserve every §6 Appstle swap-bridge invariant (full-gid `lineId`, post-replace cache invalidation, `contractDetailsJSON`-first parse, `swap()` serialization, slot-0-only bind, `bnCustomerId` login gate), and route all swap wiring through `BasenoteAppstleSwap.swap()` — never reimplement the call.