# DEPLOY_PLAN — July 16 fixes, execution runbook

## ⏱ EXECUTION LOG — Opus 4.8, 2026-07-17

**Done (auth-independent, theme-check clean, committed):**
- **P0-2** quick-add guard — `snippets/product-card.liquid`: quick-add now only renders when
  `selling_plan_groups.size > 0`; otherwise "Coming Soon" (was: leaked a one-time purchase).
- **P1-2** fallback alignment — `snippets/subscription-pricing-summary.liquid`: `$18/10%` → `$15/25%`.

**P0-1 RESOLVED → DROPPED (Wilson confirmed 2026-07-17): `custom.fragrance_family` IS populated.**
⇒ The committed `dbf7d12` fix already delivers working family filters. No taxonomy re-point needed.
Only remaining step for the swap filter is the preview render to confirm the tabs populate live.
(Original P0-1 analysis retained below for the record.)

**P0-1 REVISED after deeper verification (do NOT ship the original P0-1 as written):**
- The theme references **only** `metafields.custom.fragrance_family` for family — there is NO theme
  code touching `metafields.shopify.fragrance`, and the season pattern
  (`metafields.fragrance.season.value`, a list of plain STRINGS) shows the taxonomy `.name` access I
  guessed has **no precedent here and is unverified**. Do not ship it blind.
- The collection facet `filter.v.t.shopify.fragrance` is Shopify Search-&-Discovery taxonomy — a
  SEPARATE system from `custom.fragrance_family`; its presence does NOT prove `custom.fragrance_family`
  is empty. That was an unproven assumption.
- **The committed dbf7d12 fix is SAFE either way:** if `custom.fragrance_family` is populated (likely a
  list the old `| downcase` mishandled — the real bug), filters work; if empty, the modal degrades to
  "All only" with a full grid. **The reported bug (empty grid on filter) is fixed regardless.**
- **The one fact that decides whether P0-1 is even needed:** is `custom.fragrance_family` populated?
  → **Ask Wilson / check one product's metafields in admin.** If populated → dbf7d12 is complete, P0-1
  is unnecessary. If empty → re-point to the Shopify "Fragrance" category attribute AND verify the
  Liquid field access on a PREVIEW render before deploy (dump `{{ product.metafields.shopify.fragrance.value | json }}`).

**BLOCKED:** Shopify CLI is not logged in (device-code flow; needs Wilson to authorize interactively:
`! shopify theme list --store base-note.myshopify.com`, open the link, approve). All preview/QA/deploy
steps wait on this. No live change was made.

---



> **For: Opus 4.8 execution session.** Written by the Fable 5 review pass (2026-07-17) after
> auditing the loop's shipped work (branch `fix/july16-swap-filter-pdp-guard`, commit `dbf7d12`).
> **Do NOT re-run the investigation** — root causes in `PRD.md` stand except where corrected below.
> Apply P0 edits → preview-verify → deploy → commit/push. Expected total diff: ~130 lines, 4 files.

---

## New live evidence (Fable QA pass, 2026-07-17 ~00:30 ET) — corrections to PRD

1. **The collection facets are Shopify TAXONOMY attributes, not `custom.fragrance_family`.**
   Verified by reading the live collection page's filter input names:
   `filter.v.t.shopify.fragrance`, `filter.v.t.shopify.season`, `filter.v.t.shopify.occasion`,
   `filter.p.vendor` (values are `gid://shopify/TaxonomyValue/...`).
   ⇒ Family data lives in `product.metafields.shopify.fragrance` (list of taxonomy-value
   metaobjects). `custom.fragrance_family` is presumed unpopulated ⇒ **the dbf7d12 fix as shipped
   would render ZERO family tabs** (graceful, but filters gone). **P0-1 fixes this.**
   *(This also corrects PRD §4's facet-source table and answers PRD §7 Q1–Q3.)*

2. **Zero `size==0` products exist right now.** Full-catalog sweep via `/products/<handle>.js`:
   all 22 published products have exactly 1 selling-plan group. Every product's `updated_at` is
   **2026-07-16T22:45** — a same-evening bulk touch, consistent with the plan group being
   re-attached after Mike's 8:28 AM report. ⇒ The D-guard ships as **defense-in-depth for future
   unattached products** (the failure mode evidently occurs); no SKU attach is currently needed.
   *(Answers PRD §7 Q4; softens §3 "which SKUs" to "transient, likely already fixed".)*

3. **Confirmed additional leak (PRD blast radius, not covered by dbf7d12):** collection-grid
   quick-add posts a one-time purchase when `size==0` (`snippets/product-card.liquid:219-227`
   renders `data-selling-plan` only when `size>0`; `assets/theme.js:90-95,193-195` and
   `product-card.liquid:740-742` do `if (sellingPlan) payload.selling_plan=...`). **P0-2.**

4. **Verified safe (do not re-check):** `data-fs-family` has no consumers outside the modal's own
   JS; no leftover `family` variable refs; D-guard `size>0` branch behaviorally identical; form
   structure balanced; `String | join` pass-through semantics confirmed.

---

## P0-1 — Re-point the swap-modal family source to the taxonomy metafield

File: `snippets/fragrance-selector.liquid` (on branch `fix/july16-swap-filter-pdp-guard`).

**(a) Replace the tab pre-pass loop body** (currently lines ~27–41, the `fs_family_blob` build).
New logic — taxonomy first, then legacy metafield, then product.type:

```liquid
{%- assign fs_family_blob = '' -%}
{%- for product in fs_products limit: 20 -%}
  {%- comment -%} Family source of truth = Shopify taxonomy attribute — the same data the
       collection page facet (filter.v.t.shopify.fragrance) filters on. Fallbacks: legacy
       custom.fragrance_family metafield, then product.type. {%- endcomment -%}
  {%- assign p_tax = product.metafields.shopify.fragrance.value -%}
  {%- if p_tax != blank -%}
    {%- for tv in p_tax -%}
      {%- assign fvs = tv.name | strip -%}
      {%- unless fvs == blank -%}
        {%- assign fs_family_blob = fs_family_blob | append: '~~' | append: fvs -%}
      {%- endunless -%}
    {%- endfor -%}
  {%- else -%}
    {%- assign p_ff = product.metafields.custom.fragrance_family.value -%}
    {%- if p_ff == blank -%}{%- assign p_ff = product.type -%}{%- endif -%}
    {%- assign p_ff_arr = p_ff | join: '~~' | replace: ',', '~~' | split: '~~' -%}
    {%- for fv in p_ff_arr -%}
      {%- assign fvs = fv | strip -%}
      {%- unless fvs == blank -%}
        {%- assign fs_family_blob = fs_family_blob | append: '~~' | append: fvs -%}
      {%- endunless -%}
    {%- endfor -%}
  {%- endif -%}
{%- endfor -%}
{%- assign fs_families = fs_family_blob | split: '~~' | uniq | sort_natural -%}
```

**(b) Replace the per-card derivation** (currently ~lines 82–100, the `card_ff_*` build) with the
same taxonomy-first branch feeding the existing three outputs (`card_ff_key` pipe-delimited
lowercase, `card_ff_display` comma-joined title-case, `card_ff_primary` first value). Keep the
element-wise `strip`. Structure:

```liquid
{%- assign card_ff_key = '|' -%}
{%- assign card_ff_display = '' -%}
{%- assign card_ff_primary = '' -%}
{%- assign card_tax = product.metafields.shopify.fragrance.value -%}
{%- if card_tax != blank -%}
  {%- for tv in card_tax -%}
    {%- assign fvs = tv.name | strip -%}
    {%- unless fvs == blank -%}
      {%- assign fvl = fvs | downcase -%}
      {%- assign card_ff_key = card_ff_key | append: fvl | append: '|' -%}
      {%- if card_ff_display == blank -%}
        {%- assign card_ff_display = fvs -%}{%- assign card_ff_primary = fvs -%}
      {%- else -%}
        {%- assign card_ff_display = card_ff_display | append: ', ' | append: fvs -%}
      {%- endif -%}
    {%- endunless -%}
  {%- endfor -%}
{%- else -%}
  {%- comment -%} legacy fallback — keep the existing dbf7d12 loop (custom.fragrance_family →
       product.type, comma-split, stripped) exactly as-is here {%- endcomment -%}
{%- endif -%}
```

**(c) Tab render: case-insensitive dedupe + case-insensitive 'Fragrance' exclusion + escape**
(replaces the current `fs_families` loop at ~lines 66–72):

```liquid
{%- assign fs_seen = '|' -%}
{%- for fam in fs_families -%}
  {%- assign fam_clean = fam | strip -%}
  {%- assign fam_l = fam_clean | downcase -%}
  {%- assign fam_probe = fam_l | prepend: '|' | append: '|' -%}
  {%- unless fam_clean == blank or fam_l == 'fragrance' or fs_seen contains fam_probe -%}
    {%- assign fs_seen = fs_seen | append: fam_l | append: '|' -%}
    <button class="fs-filter" data-fs-filter="{{ fam_l | escape }}">{{ fam_clean | escape }}</button>
  {%- endunless -%}
{%- endfor -%}
```

⚠️ **`.name` field confidence ~85%** (taxonomy-value metaobjects expose `name`). Verify on the
preview theme FIRST: temporarily render
`<script>console.log({{ product.metafields.shopify.fragrance.value | json }})</script>` on a PDP
(or `{{ ... | json }}` in a comment div), confirm the field key, adjust `tv.name` if the label
field differs, then remove the debug line. Do not deploy without this render check.

## P0-2 — Guard the collection-grid quick-add

File: `snippets/product-card.liquid`, quick-add block (~lines 219–236). Wrap the existing button:

```liquid
{%- if show_quick_add and product.available -%}
  {%- if product.selling_plan_groups.size > 0 -%}
    (existing <button class="product-card__add-btn" ...> unchanged)
  {%- else -%}
    {%- comment -%} Bug D guard: unattached product must not quick-add a one-time purchase {%- endcomment -%}
    <div class="product-card__sold-out-btn"><span>Coming Soon</span></div>
  {%- endif -%}
{%- elsif product.available == false -%}
  (existing sold-out block unchanged)
{%- endif -%}
```

Reuses the existing sold-out style — no new CSS. Brand-calm copy ("Coming Soon", not an error).

## P1 (do in the same pass — small)

- **P1-1 Discount at the CTA (Mike's literal complaint).** `sections/main-product.liquid`, inside
  the `size>0` branch, directly under the submit button (~line 374 area), add:
  ```liquid
  <p class="subscription-box__note subscription-box__note--pricing">
    First month {{ settings.subscription_first_order_price | default: '$15' }}
    ({{ settings.subscription_first_order_discount_pct | default: '25' }}% off)
    · then {{ settings.subscription_price | default: '$20' }}/month · cancel anytime
  </p>
  ```
  ⚠️ Defaults MUST be **$15 / 25** (schema defaults) — never $18/10 (see PRD §3 warning).
- **P1-2 Align divergent fallbacks.** `snippets/subscription-pricing-summary.liquid:21-22`:
  change `| default: '$18'` → `'$15'` and `| default: '10'` → `'25'` so both PDP snippets agree
  even if settings are ever blanked (PRD §3 hazard 1).
- **P1-3 PRD corrections.** In `july16-prd/PRD.md`: mark §4's facet-source table corrected
  (taxonomy attributes per this file); mark §7 Q1–Q4 answered; note Bug D's live status
  (0 broken SKUs as of 2026-07-17, bulk update 22:45 Jul 16). One short "2026-07-17 addendum"
  section at the top is enough — don't rewrite the body.

## P2 (optional, defer freely)
- Gate "Queue for a Future Month" (`main-product.liquid:377`) on `size>0` too (queueing an
  unattached product could roll into an Appstle swap later).
- Note: stored queue `family` values are historically lowercase, new picks title-case — cosmetic
  display inconsistency on queue cards; ignore or normalize at render.

---

## Deploy sequence (exact)

1. **Re-auth CLI** (needs Wilson at the terminal — suggest `! shopify auth logout` then
   `! shopify theme list --store base-note.myshopify.com` to trigger interactive login).
2. **Pull + diff-guard** (Jeff/Alex bulk-touched products 22:45 Jul 16; theme may have moved):
   `bash .claude/session-start.sh` (timebox ~90s — if it hangs, stop and tell Wilson).
   Review `git diff` on the 7 theme dirs; flag any 100+ line shrink per memory rule. Re-apply/rebase
   the branch edits if the two target files moved (they were byte-identical to live as of Jul 17 00:15).
3. **Apply P0/P1 edits above** on the branch; `shopify theme check` must show no NEW offenses.
4. **Preview:** `shopify theme push --store base-note.myshopify.com --development` → run the
   `.name` debug check (P0-1) → QA checklist:
   - PDP (Creed Aventus): subscribe CTA unchanged, new pricing note reads "$15 (25% off)".
   - Collection grid: quick-add works on attached products (all 22 currently).
   - Account swap modal needs a logged-in customer — hand Wilson/Jeff the preview link: expect
     ~12 family tabs (Aquatic…Woody), each tab shows ≥1 card, picking a fragrance still lands in
     the queue (event contract untouched).
5. **Live deploy (scoped):** after Wilson's explicit OK —
   `shopify theme push --store base-note.myshopify.com --theme 158692901082 --only snippets/fragrance-selector.liquid --only sections/main-product.liquid --only snippets/product-card.liquid --only snippets/subscription-pricing-summary.liquid`
6. **Post-deploy live QA** (browser): repeat step-4 checks on basenotescent.com; per memory rule
   `feedback_qa_after_changes` this is mandatory.
7. **Commit + push branch** (amend or new commit on `fix/july16-swap-filter-pdp-guard`), include
   this file and PRD addendum. Note: `origin/main` is the Shopify-GitHub sync branch with disjoint
   history — do NOT try to PR/merge into it; the CLI push is the deploy, git is the record.

## Rollback
`git show dbf7d12~1:<file> > <file>` for each touched file → same scoped `theme push --only` (or
Shopify admin → theme → version history). The four files are independent; partial rollback is fine.

## Wilson actions (parallel)
- Confirm with Mike/Jeff which SKU broke on Jul 16 morning and whether the 22:45 bulk update was
  the plan re-attach (validates Bug D closure).
- New-product onboarding checklist: (1) attach to Appstle selling-plan group, (2) set the Shopify
  taxonomy "Fragrance" attribute (feeds collection facet AND the fixed swap-modal tabs), (3) set
  Season/Occasion taxonomy attributes.
- B (facet rebuild — note: it should read the SAME taxonomy metafields per this file, not the
  PRD §4 table) and C (subscriber gating) go/no-go — designs in SOLUTION_DESIGN.md.
