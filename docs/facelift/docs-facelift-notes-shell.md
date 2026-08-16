# Facelift Phase A — notes from the shell agent (theme.liquid / base.css / component-variables.css)

Owned and edited: `layout/theme.liquid`, `assets/base.css`, `assets/component-variables.css`.
Nothing else was touched. No git command was run.

---

## 1. Verification receipts

**`layout/theme.liquid` — protected-line grep, before vs after**

| pattern | before | after | why |
|---|---|---|---|
| `{% render` | 5 | 5 | unchanged |
| `{% section` | 3 | 3 | unchanged |
| `<script` | 8 | **9** | **+1 — the required `bn-motion.js` tag.** All 8 pre-existing `<script>` lines are byte-identical. |
| `bnCustomerId` | 1 | 1 | unchanged |
| `content_for_header` | 1 | 1 | unchanged |
| bare word `render` | 6 | 5 | the removed line was the comment *"prevent render-blocking"*, not a `{% render %}` tag |

A line-level diff of every matching line shows exactly two deltas: that comment line removed, the `bn-motion.js` line added. `{{ content_for_header }}`, the `window.bnCustomerId` block, `queue-scheduler.js`, `bn-appstle-swap.js`, `theme.js`, `{% sections 'header-group' %}`, `{% sections 'footer-group' %}`, `{% section 'cart-drawer-section' %}`, all five `{% render %}` calls and all four JSON-LD blocks are untouched.

**`shopify theme check --output json`** — **0 errors and 0 new error classes in my three files.** 7 warnings on `theme.liquid`: 6 are pre-existing (`RemoteAsset` ×4 for the Google Fonts preconnects and the font stylesheet, `AssetPreload` ×2 for the base.css and LCP-image preloads), 1 is new and is the same `AssetPreload` class on the line immediately above it (the `bn-tokens.css` preload). Theme-wide there are 31 errors, all pre-existing and all in files I do not own.

**CSS**: braces and parens balanced in both stylesheets. Every original selector in both files still exists — checked mechanically against a full list of the pre-facelift selectors; zero renames, zero removals.

**Inline JS**: I wrote no new inline `<script>`. The pre-existing one still parses under `node --check` with the Liquid stripped.

---

## 2. Two things that need your decision

### 2a. `.section__header` is now left-aligned
This is the single most visible cross-site change and the one I'd most expect pushback on. Brief §4.5 (strict hierarchy) and the design sheet's `.sh` block are both left-set, and centred headers over an editorial grotesque read as the old theme. But it changes *every* section on *every* page at once, and some blocks underneath it (`.plan`, `.testimonial`, `.newsletter`) are still centred, so a few pages will have a left header over centred content.

One declaration reverts it — `assets/base.css`, `.section__header { text-align: left }` → `center`, and drop the `max-width: 46ch`. There is a comment on the rule saying so. Nothing else depends on it.

### 2b. `--font-size-2xl` and `--font-size-3xl` now resolve to the same token
The legacy ladder has 7 steps above `base`; the bn fluid scale has 6. I collapsed the pair whose original values (1.5rem and 2rem) are both bracketed by `--bn-text-xl` (1.5→2.25rem), which is the least harmful place to lose a step. If you want them distinct, `--font-size-2xl` can move down to `--bn-text-lg` — but that also drags `.header__logo`, `.footer__logo`, `.mobile-nav__link` and `.card__title` down, all of which now set their own size explicitly anyway.

---

## 3. Things I found that are outside my files

1. **`sections/header.liquid` and `sections/footer.liquid` win over `assets/component-variables.css`.** Both carry an inline `<style>` that appears later in the document, so on ties they beat my file. Same for `snippets/product-card.liquid`. I aligned my values to what those files currently do (header ground = `--bn-ink`, announcement bar = `--bn-bone`, footer = `.bn-on-ink`) so the fallback layer and the section layer agree. **If the header/footer/card agents change ground colour after this, my critical CSS and `component-variables.css` need the same flip** or there will be a flash of the wrong ground before the section CSS applies. The two places to change are `layout/theme.liquid`'s inline `.header{…}` / `.announcement-bar{…}` and `component-variables.css`'s `.header{…}`.

2. **`sections/header.liquid` redefines `--header-height` to 72px (64px on mobile) and introduces `--bn-ticker-height`, which is not in `bn-tokens.css`.** My files still assume the legacy 110px for `.main-content`'s `min-height` and `.hero--minimal`'s top padding. Because the header scopes its redefinition, `calc(var(--header-height) + …)` in other sections may resolve against 110px or 72px depending on where the element sits in the tree. Worth one pass by whoever owns the header: either promote `--header-height` to `bn-tokens.css` at the real value, or confirm the scoping is deliberate. `--bn-ticker-height` should probably live in `bn-tokens.css` too.

3. **`[data-reveal]` will flash visible then hide on first load.** `bn-motion.js` is `defer`, so `.bn-js` lands on `<html>` only after the document is parsed — content paints, then hides, then fades in. I deliberately did **not** fix this by setting `.bn-js` in the existing inline `<script>`: that class presence is what proves the motion script actually loaded, and pre-setting it would leave `[data-reveal]` content permanently invisible if `bn-motion.js` ever 404s. That is the exact failure the README forbids. I mitigated the CSS half only — the reveal primitive is inlined in the critical CSS so the hidden/revealed states are correct the instant `.bn-js` appears. If the flash is unacceptable, the safe fix is a tiny inline script that sets `.bn-js` **and** a `<noscript>`-style timeout that clears it if the module never boots — not a bare class assignment.

4. **`.header__action-btn` still forces white with `!important`** (I kept the pre-existing rule, retokenised to `--bn-text-on-ink`). On an ink header that is correct. It would be wrong if a transparent header ever sits over a bone section. Nobody does that today; flagging it because the `!important` makes it unfixable from a section stylesheet.

---

## 4. What changed, file by file

### `layout/theme.liquid`
- **Fonts.** Cormorant Garamond + Lato replaced by one `css2` request for Bricolage Grotesque (`opsz,wdth,wght@12..96,75..100,200..800`), Instrument Sans (`ital,wdth,wght`, both italic axes) and Instrument Serif (`ital@0;1`). Loaded with `media="print" onload="this.media='all'"` plus the `<noscript>` fallback, per the pattern used by the stylesheet links directly below. The two `fonts.googleapis.com` / `fonts.gstatic.com` preconnects were already present and are untouched.
- **Asset order.** `bn-tokens.css` is preloaded and linked **before** `base.css`, and is first in the `<noscript>` block. Document order is what fixes the cascade here, not load order, so the async `media=print` swap is safe.
- **`bn-motion.js`** added with `defer`, after `bn-appstle-swap.js`.
- **Critical CSS rewritten** onto the new system. It declares the `--bn-*` core palette, type, scale and motion values inline — *identical values to `bn-tokens.css`*, which is what README line 48 asks for, because `bn-tokens.css` loads async and first paint would otherwise be unstyled. Because those custom properties are declared on `:root` inline, every `var(--bn-*)` in `base.css` resolves correctly even in the window before `bn-tokens.css` arrives. **If you edit a token value in `bn-tokens.css`, edit it here too** — there is a comment saying so at the top of the block.
- The critical block also carries the 600px mobile type guard, a `prefers-reduced-motion` guard, and the `[data-reveal]` primitive.

### `assets/base.css`
- `:root` is now an **alias layer only**. Every legacy variable points at a `--bn-*` token and carries the `bn-tokens.css` literal as a `var()` fallback, so a failed token-file load degrades to the right palette rather than to nothing. Removing the old hard-coded hex here was mandatory, not cosmetic: `base.css` loads *after* `bn-tokens.css`, so the old `:root` would have silently overridden every alias and the facelift would not have landed at all.
- Type scale repointed to the fluid `--bn-text-*` clamps. The per-breakpoint `--font-size-*` overrides at 768px and 480px are gone — the clamps and the 600px guard in `bn-tokens.css` do that job now. Spacing steps down at 768px as before.
- Headings take the display face with `font-variation-settings: var(--bn-display-vf)`; `h1`/`h2` at weight 250 and display tracking, `h3`–`h6` at 400–600 with a narrower `'wdth' 92` setting so small headings do not smear.
- `h1/h2/h3 em` is now the Instrument Serif italic accent line — heritage green on bone, brass on ink.
- **Buttons.** Square, 1px rule, uppercase micro-label at `--bn-track-nav`. `.btn--primary` is ink (brief §4.5 "black primary") and **inverts to bone inside `.section--dark`, `.hero` and `.footer`**, or it would vanish on the ink grounds those sections use. `.btn--secondary` is the quiet grey step. `.btn--gold` is the one metal button — ink text on brass, ~7:1. Its hover drops to `--bn-brass-ink` on bone and stays `--bn-brass` on ink, because brass-on-bone is 2.3:1 and illegal as text. Added `.btn:focus-visible` (there was no visible focus state before) and a `[disabled]` state.
- `a:hover` is `--bn-brass-ink` on light grounds, `--bn-brass` inside header/footer/hero/dark sections. Same contrast rule as above.
- `.section--dark` is now ink, not green (brief §4.3, two colours only), and locally remaps `--color-text-light` / `--color-text-muted` / `--color-border` to their on-ink variants so any un-migrated component inside it stays legible without being touched.
- Forms, cards, modal, badge, overlay, divider, skip link, spinner all retokenised. Focus ring on inputs is a 2px brass halo.

### `assets/component-variables.css`
Values only — every selector is unchanged, including all the `.is-scrolled` / `.is-transparent` / `.is-active` state selectors.
- **Header**: ink ground, hairline border instead of a shadow, display-face logo in wide uppercase tracking, nav links as 10px micro-labels with a brass underline that grows on hover. Cart count is brass with ink text. `z-index` left at 100 so the cart-drawer stacking is unchanged.
- **Mobile nav**: ink panel, display-face links at `--bn-text-xl` weight 250, hairline dividers.
- **Hero**: ink ground, brass eyebrow at label tracking, display-face title at `--bn-text-4xl` with display leading and tracking, `--bn-text-on-ink-dim` body copy capped at 46ch. This is the fallback for every template that is *not* the homepage — about, legal, list-collections, quiz intro. `sections/hero.liquid` owns the homepage.
- **Product card**: bone card with a hairline, family-tinted media well via `color-mix(… var(--bn-family) 15% …)` with a flat `--bn-bone-2` fallback declaration underneath, left-aligned content (was centred), display-face title, mono-ish uppercase house line. `.product-card__quick-add` keeps its exact original `translateY(100%)` → `translateY(0)` mechanic; only its colours and type changed. No transform was added to any funnel control.
- **Footer**: ink, brass column headings, dim bone links that brighten on hover, social discs that fill brass with an ink glyph. Also remaps `--color-text-light` and `--color-border` locally.
- **Legacy pages kept coherent**: `.plan*`, `.step*`, `.testimonial*`, `.newsletter*`, `.cart-item*`, `.account-*` and `.quiz*` were all retokenised rather than left to inherit. Two intentional shape changes: `.plan__badge` moved from a centred pill to a square top-left tab, and `.step__number` went from a 60px circled numeral to a small uppercase label over a hairline rule — circles and pills are the two shapes Direction A does not have. The rotation-CTA pill (`--bn-radius-pill`) and filter chips are the only sanctioned round things.

---

## 5. Asks

1. **Confirm or revert §2a (left-aligned section headers)** before QA screenshots — it changes every page and I could not screenshot to check it.
2. **Whoever owns `sections/header.liquid`: resolve `--header-height`** (§3.2). My `.main-content { min-height: calc(100vh - var(--header-height)) }` and `.hero--minimal`'s top padding both assume one value for the whole document.
3. **Add `--bn-ticker-height` to `bn-tokens.css`** if the announcement ticker is staying.
4. **QA gate 3 from the README** (`prefers-reduced-motion`) is covered from my side twice — in the inline critical CSS and in `base.css` — but the authoritative guard is the one in `bn-tokens.css`. Please verify against that file, not mine.
5. **Re-run gate 2** (`add.price === 1500`, `selling_plan_allocation !== null`) after integration. I changed no funnel markup, but I did restyle `.product-card__quick-add` and `.header__cart-count`, which sit next to `[data-quick-add]` and `[data-cart-count]`.
