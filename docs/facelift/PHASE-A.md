# Base Note facelift — Phase A

**Branch:** `preview/facelift`
**Direction:** A, "Editorial Grotesque" — bone ground, ink type, brass as metal only, no rounded shapes except the rotation-CTA pill and filter chips.
**Status:** integrated, theme-check clean, not previewed in a store. Nothing here has been merged to `main` and no live theme was touched.

The three-line summary: the theme now runs on a single token layer (`assets/bn-tokens.css`), the chrome (header, footer, buttons, cards) has been repainted onto it, and the homepage leads with three new token-only sections. The old hero and the old price block are still in the file, disabled, so rollback is a boolean.

---

## 1. What changed, file by file

### New files

| File | Lines | What it is |
|---|---|---|
| `sections/bn-hero.liquid` | 769 | 100svh editorial hero on ink. Media layer (uploaded image / external URL / video / nothing), two token scrims + optional grain, eyebrow → two-line Bricolage headline → Instrument Serif italic accent → supporting line → CTA pair → reassurance, plus a brass `$20 / MONTH` price stamp with a rotating `<textPath>` ring and a scroll cue. 29 settings, has a preset, no JS of its own. |
| `sections/bn-marquee.liquid` | 239 | Ticker band. One `[data-marquee]` viewport per block row with a single track child for `bn-motion.js` to clone. Ships two rows: house names (display face) and claims (brass micro-label). Repeatable blocks, `ink/bone/forest` scheme. |
| `sections/bn-price-table.liquid` | 495 | Token-driven port of the `ai_gen_block_9faa96e` price comparison. A real `<table>` (column headers + `<th scope="row">`) inside a keyboard-focusable `role="region"` scroller. The block it replaces hard-coded 21 hex values; this one has zero. |
| `snippets/bn-notes.liquid` | 320 | Fragrance-notes renderer, three modes. `card` = family chip + Top/Heart/Base panel. `pdp` = tiered pyramid with its own scoped `<style>` (**built but not wired** — Phase B). `data` = returns `"<family-token>\|<Label>\|<1\|0>"` and no markup, which is how `product-card` gets the family key without a second parser. Reads `product.metafields.custom.top_notes` / `heart_notes` / `base_notes` and falls back to parsing `product.description`. |

### Edited files

| File | What changed |
|---|---|
| `layout/theme.liquid` | Google Fonts swapped Cormorant/Lato → one `css2` request for **Bricolage Grotesque** (`opsz,wdth,wght`), **Instrument Sans**, **Instrument Serif** — the variable axes are load-bearing, every `font-variation-settings` in the theme no-ops without them. `bn-tokens.css` preloaded and linked **before** `base.css`; `bn-motion.js` added with `defer`. Inline critical CSS rewritten onto the `--bn-*` system so first paint is correct while the async stylesheets land. |
| `assets/bn-tokens.css` | Now owns layout geometry: `--bn-header-height` (72px, 64px ≤767px), `--bn-ticker-height: 32px`, and `--header-height` as an alias of the former. |
| `assets/base.css` | `:root` is an **alias-only** layer — every legacy variable points at a `--bn-*` token with the token literal as a `var()` fallback. Removing the old hex here was mandatory, not cosmetic: `base.css` loads *after* `bn-tokens.css`, so the old `:root` would have silently overridden every alias and the facelift would not have landed. Type scale on fluid clamps, headings on the display face, `h1/h2/h3 em` becomes the Instrument Serif italic accent, buttons square with 1px rules, `.section--dark` is ink (not green). |
| `assets/component-variables.css` | Values only — **every selector is byte-identical**, including the `.is-scrolled` / `.is-transparent` / `.is-active` state selectors. Header/mobile-nav on ink, hero on ink, product card with a family-tinted media well, footer on ink with brass headings. `.plan* .step* .testimonial* .cart-item* .account-* .quiz*` also retokenised so account/quiz/cart stay coherent. |
| `sections/header.liquid` | Announcement bar rebuilt as a 32px bone marquee ticker with the countdown pinned right; header bar slimmed 110px → 72px/64px on ink; nav restyled to oversized Bricolage with a brass underline wipe; search overlay and mobile nav rebuilt as full-bleed ink surfaces. Fixed 2 pre-existing `ImgWidthAndHeight` theme-check errors. |
| `sections/footer.liquid` | Forest newsletter band → ink body with a brand column and a 3-column menu grid → giant Bricolage wordmark clipped at the baseline → bottom bar of 10px uppercase legal links and payment icons. |
| `snippets/product-card.liquid` | **Additive markup only** plus an appended CSS block. Added `data-family` / `data-has-notes` / `data-reveal` on the article, the `bn-notes` render inside the media, an optional `No. 07` catalogue label, and a touch-only `[data-notes-toggle]` that is a **sibling** of `.product-card__link` — never a child of the anchor, never inside the quick-add path. |
| `sections/featured-collection.liquid` | Rewritten as an editorial 3-up with the first card spanning 2×2, a mobile scroll-snap row, and a giant italic View-all. `{% render 'product-card' %}` unchanged apart from a new `catalogue_number: forloop.index`. All original schema setting ids and defaults preserved. |
| `templates/index.json` | Purely additive — 3 new sections inserted, 2 old ones flagged `disabled: true` for rollback, no existing section's settings touched, relative order of everything pre-existing preserved. |
| `assets/bn-motion.js` | Two integration fixes: `[data-cart-open]` added to the funnel `DENY` list (`isSafe()` only walks ancestors, so the `[data-cart-count]` badge inside the cart button did not protect the button itself); and marquee clones now have their interactive nodes pulled out of the tab order, so a keyboard user no longer tabs through an invisible duplicate of the ticker. |

### Integration decisions made at merge

Four things the builders could not settle inside their own file boundaries:

1. **`--header-height` is now 72px / 64px, defined once.** It was declared at 110px in three places (`bn-tokens.css`, `base.css`, the `theme.liquid` critical CSS) and shimmed to 72px by a `:root` block inside `header.liquid`'s `<style>`, which won only because it sits in the body. `bn-tokens.css` now owns `--bn-header-height`; the other three alias it; the shim is deleted. This matters because `calc(var(--header-height) + …)` appears in 12 sections and 5 templates — a stale value gives every page 38px of orphan padding.
2. **Product-card title face resolved to the display grotesque**, matching `design-sheet.html` §04 and `component-variables.css`. The Instrument Serif italic variant in `product-card.liquid` was winning only by source order; a type decision settled by cascade accident is a bug waiting to happen. The accent face stays where it belongs — on heading `<em>`.
3. **`.product-card__badge` and `.product-card__image` in `component-variables.css` are now scoped to the placeholder markup** (`.product-card__image > .product-card__badge`, `.product-card__image:not(img)`). Unscoped, the first stacked New/Bestseller/Exclusive/Limited on top of each other at 0,0 in the real card, and the second treated `.product-card__image` as a container when in the real card that class is on the `<img>`. Fixed at source; the local defences in `product-card.liquid` remain as belt-and-braces.
4. **`--bn-ticker-height: 32px` promoted into `bn-tokens.css`** so the full page geometry reads from one file.

---

## 2. How to preview

Nothing below touches the live theme. `preview/facelift` has never been pushed to `main`.

**Path A — connect the branch as its own theme (recommended)**

1. Shopify admin → **Online Store → Themes → Add theme → Connect from GitHub**
2. Repository `wilsonwu-ai/basenotes`, branch **`preview/facelift`**
3. It lands as an unpublished theme. Use **Actions → Preview**. Do **not** publish.
4. The theme editor works normally against it, so Jeff can exercise the new section settings (hero copy, marquee rows, price-table rows) without a code change.

**Path B — preview an already-uploaded theme by id**

`https://basenotescent.com/?preview_theme_id=<THEME_ID>` — the id is in the admin theme URL. Live theme is `158692901082`; the facelift will get its own id on connect, and that is the one to use.

### QA gates to run on the preview, in this order

1. **Funnel first, before anything cosmetic.** Add a subscription product to cart, then in the console confirm `add.price === 1500` and `selling_plan_allocation !== null`. No funnel markup changed in Phase A, but `.product-card__quick-add` and `.header__cart-count` were restyled right next to `[data-quick-add]` and `[data-cart-count]`, so this is the gate that matters.
2. **Fonts actually loaded.** If the giant hero headline renders in a serif, the Google Fonts request failed and everything below is measuring the fallback. Check `document.fonts.check('1em "Bricolage Grotesque"')`.
3. **`prefers-reduced-motion`.** Turn it on at the OS level: reveals must be visible and static, the marquee must render as a readable static line, the hero video must not play. Every effect fails *visible* by design — there is no blank-content failure mode.
4. **Header geometry.** `getComputedStyle(document.documentElement).getPropertyValue('--header-height')` should read `72px` at 1440 and `64px` at 390, and the bar should measure the same.
5. **390px hero.** With a three-line headline plus the accent line the content may exceed `100svh`. The section uses `min-height` so it grows rather than clips — confirm the scroll cue still reads as "there is more below".
6. **Packshots on the product grid.** Cards use `mix-blend-mode: multiply` so white-background packshots drop their white onto the family tint. Any image *not* on white will go muddy, not broken. If more than a couple misbehave, delete the two `mix-blend-mode` / `isolation` lines in `product-card.liquid`.

---

## 3. Rollback

**Homepage sections — a boolean flip, no reordering.** The replaced sections were disabled, not deleted, and each sits adjacent to its replacement in `templates/index.json`:

| To restore | Set | And set |
|---|---|---|
| Old hero | `sections.hero.disabled` → `false` | `sections["bn-hero"].disabled` → `true` |
| Old price comparison | `sections["1775503735ef6a96df"].disabled` → `false` | `sections["bn-price-table"].disabled` → `true` |

Both can also be done from the theme editor without touching code.

**Whole facelift.** Nothing is merged. Delete or unpublish the preview theme and the live site is untouched — `main` has no Phase A commits.

**Individual reverts worth knowing:**

- **Left-aligned section headers** — the single biggest cross-site change. `assets/base.css`, `.section__header { text-align: left }` → `center` and drop the `max-width: 46ch`. There is a comment on the rule. Some blocks under it (`.plan`, `.testimonial`, `.newsletter`) are still centred, so a few pages will show a left header over centred content until Phase B.
- **Packshot blending** — two lines in `product-card.liquid`, noted above.
- **Stamp ring** — if the rotating brass `<textPath>` reads as mud on preview, clear the `stamp_ring_text` setting and the stamp degrades to a clean static disc.

---

## 4. Phase B / C backlog

Carried forward from the four builders' notes. Nothing here blocks Phase A preview.

### Phase B — wiring that is built but not connected

1. **`bn-notes` pdp mode.** Fully built and unused. Drop `{% render 'bn-notes', product: product, mode: 'pdp' %}` into `sections/main-product.liquid`. It carries its own `<style>`, emitted only in pdp mode so it never repeats across a grid, and needs no other change.
2. **Hero video.** Wired and deliberately off per brief §4.11 (images before video). Dropping an MP4 URL into `settings.video` is the entire activation. **Always set a poster** — the poster `<img>` is what reduced-motion users and the pre-load frame see.
3. **Catalogue numbering site-wide.** `product-card.liquid` accepts an optional `catalogue_number` and renders `No. 07` from it; passing nothing renders nothing. The four other call sites are `sections/main-collection.liquid:226`, `sections/main-product.liquid:569`, `sections/product-case.liquid:254`, `templates/search.liquid:39`. On a paginated collection you want `forloop.index | plus: offset`, not `forloop.index`.
4. **Notes metafields.** Defining `custom.top_notes` / `heart_notes` / `base_notes` (plain text or `list.single_line_text_field`, both handled) makes the notes independent of description formatting. Not required — parsing the live descriptions is verified working on all 32 catalogue products.
5. **Price-table footnote.** The `footnote` setting exists and is intentionally **empty**. The $45 / $40 / $32 / $42 comparison figures are carried over verbatim from the block being replaced, but they have no source behind them. If Jeff can source them, that field is where the citation goes. Until then it is a claim on the homepage with nothing under it.
6. **Search and collection grids.** `templates/search.liquid` and `sections/main-collection.liquid` render `product-card` inside their own grids. The new card is wider-content and left-aligned; both grids need one look on preview.

### Phase C — cleanups and open questions

7. **`.header { position: fixed }` in `component-variables.css` vs `relative`/`sticky` in `header.liquid`.** The section wins by document order and that is the behaviour today — **this predates Phase A and the runtime outcome is unchanged**. But the two files disagree in writing, and the `calc(var(--header-height) + …)` padding downstream reads like it was authored for the fixed version. Reconcile deliberately, with a preview open, rather than by cascade accident.
8. **`[data-reveal]` flashes visible → hidden → revealed on first load,** because `bn-motion.js` is `defer` and `.bn-js` only lands after parse. This was left deliberately: `.bn-js` is the proof the script loaded, and pre-setting it inline would blank every `[data-reveal]` permanently if the script ever 404s — the exact failure the brief forbids. The safe fix is an inline script that sets `.bn-js` **and** a timeout that clears it if the module never boots, not a bare class assignment.
9. **Centred blocks under left-set headers.** `.plan`, `.testimonial`, `.newsletter` are still centred. Either left-set them or revert the header alignment (§3) — the mix is the worst of both.
10. **Card copy the brief asks for but Phase A did not change:**
    - Brief §4.6 wants `CREED AVENTUS — No. 01`. `product.title` already contains the house, so `product.title | remove_first: product.vendor | strip` would give the design sheet's `Creed` / *Aventus* split. Changes existing markup content, so it was left alone.
    - Brief §4.8 wants the grid CTA verb to be **"Add to Rotation"**. It still says **"Start Your Subscription"** because that string sits inside the `[data-quick-add]` button, which is DO-NOT-TOUCH. A one-word edit, but it should be a deliberate funnel-aware one with the gate-1 check re-run after.
11. **`--font-size-2xl` and `--font-size-3xl` now resolve to the same token.** The legacy ladder has 7 steps above `base`, the fluid scale has 6; the collapsed pair is the one whose original values (1.5rem / 2rem) are both bracketed by `--bn-text-xl`. Everything that cared now sets its own size explicitly. Restore a distinct step only if something visibly suffers.
12. **`.header__action-btn` forces white with `!important`** (pre-existing, retokenised to `--bn-text-on-ink`). Correct on an ink header, wrong if a transparent header ever sits over a bone section — and the `!important` makes it unfixable from a section stylesheet.
13. **`transparent_on_homepage`.** `header-group.json` has it on, so the header overlays the hero while the 32px ticker stays in flow. `bn-hero` pads `calc(var(--header-height, 72px) + var(--bn-space-lg))`. If the ticker is ever made to overlay too, that needs `+ var(--bn-ticker-height)` — one line in `bn-hero.liquid`.
14. **README correction.** The edit table names `sections/featured-products.liquid`. No such file exists; the real one is `sections/featured-collection.liquid`.
15. **Six pre-existing hardcoded hex values remain in `product-card.liquid`** (four seasonal indicator colours, a `#888` fallback, a `#2a2a2a` hover). They are identical to `HEAD` and were left alone deliberately — retokenising them is a Phase C sweep, not an integration change.
16. **31 pre-existing theme-check errors** live in files Phase A never opened (`delivery-explainer`, `fact-sheet`, `main-product`, `product-case`, `cart`, the email snippets, the customer templates). Unrelated to the facelift; worth their own pass.

---

## 5. Verification receipts

Every number below was measured, not asserted. The "before" column comes from a clean `git archive HEAD` snapshot run through the same checker, not from memory.

| Check | Result |
|---|---|
| `shopify theme check` — errors, theme-wide | **33 → 31** |
| `shopify theme check` — errors, in changed files | **2 → 0** (both were `ImgWidthAndHeight` in `header.liquid`) |
| Only file whose error count moved | `sections/header.liquid` — no new error introduced anywhere |
| Warnings in changed files | 11 → 13; the 2 new are `AssetPreload` on the `bn-tokens.css` preload and one `RemoteAsset` — same classes as the lines beside them |
| Inline `<script>` blocks swept (Liquid stripped, `node --check`) | **5 / 5 pass** |
| `snippets/product-card.liquid` HEAD script block | preserved **byte-identical** (4630 bytes, md5 `a60ae650…`); one new 740-byte block added |
| `sections/header.liquid` HEAD script block | preserved **byte-identical** (3655 bytes, md5 `a2195791…`) |
| `layout/theme.liquid` protected tokens | `{% render %}` 5→5, `{% section %}` 3→3, `bnCustomerId` 1→1, `content_for_header` 1→1, `<script` 8→**9** (the `bn-motion.js` tag; all 8 HEAD inline blocks preserved) |
| Funnel hooks | `data-quick-add` 2→2, `selling_plan` 7→7, `data-subscription-unavailable` 1→1, `Start Your Subscription` 1→1, `data-cart-count` 1→1, `data-cart-open` 1→1 — no drops |
| `countdown-timer` render call | 2 → 1, string byte-identical. **Deliberate**: it used to appear in both branches of a conditional, and sitting inside the marquee track it would have been cloned into two elements with `id="timer-announcement"`, the clone frozen at 05:00 |
| `templates/index.json` | parses; 15/15 keys resolve to a real section file or `_blocks`; no orphans; additive-only vs HEAD; `growth-goal` present at position 3, after `bn-hero` |
| Token references | every `var(--bn-*)` in every changed file resolves to a definition. The one apparent exception, `--bn-reveal-delay`, is set at runtime by `bn-motion.js` and carries a `0ms` fallback |
| CSS brace balance | balanced in all three stylesheets |
| Hardcoded hex in changed files | zero new. `base.css`'s 11 are all `var()` fallbacks equal to their token value; `product-card.liquid`'s 6 are pre-existing and identical to HEAD |
| Fonts | one `css2` request + its `<noscript>` twin; no Cormorant / Lato / Inter / Roboto anywhere outside a comment |
| Asset order | `bn-tokens.css` → `base.css` → `component-variables.css`, in that document order, in both the async and `<noscript>` paths |
| `bn-motion.js` | loaded exactly once, `defer`; `node --check` passes after the two integration fixes |

**Not verified, and why:** no screenshot or rendered claim in this document has been checked against a real store, because no preview theme exists yet. Everything under "intended render" in the four `docs/facelift/docs-facelift-notes-*.md` files is a description of authored CSS, not an observation — with one exception, the header/footer builder measured their work in a static harness that loads the real `bn-tokens.css` and `bn-motion.js`. Treat §2's QA gates as unrun.
