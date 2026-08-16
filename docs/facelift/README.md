# Base Note — Facelift, Phase A

**Date:** 15 Aug 2026 · **Decision owner:** Wilson + Jeff · **Source brief:** `growth-audit/research/growth-memo.md` §4

Open **`design-sheet.html`** in a browser. Two complete directions, side by side, built from the same components with only the token layer swapped. Screenshots in `qa/`.

---

## The two directions

| | **A — Editorial Grotesque** | **B — Modern Classic** |
|---|---|---|
| Display | Bricolage Grotesque (wdth 86, opsz 96) | Fraunces (opsz 144, SOFT 42, WONK 1) |
| Accent | Instrument Serif italic | Fraunces italic, SOFT 70 |
| Body | Instrument Sans | Manrope |
| Ground | Ink `#0F1211` / Bone `#F3EFE7` | Bistre `#191411` / Parchment `#F7F1E4` |
| Heritage green | Forest `#1F3A34` (from today's `#2D4641`) | Olive Pine `#33463B` |
| Metal | Brass `#B99A5B` | Honey `#C48D3F` |
| Corners | Square (0px) | Soft (3px) |
| Feel | Gallery. Jacquemus / Gentle Monster / SSENSE | Apothecary. Aesop / Le Labo / Diptyque |

Both carry the same eight scent-family accents keyed to `catalogue.json` (`fresh`, `woody`, `amber`, `floral`, `gourmand`, `green`, `spicy`, `clean`), warmed slightly in B.

---

## Recommendation: **Direction A**

1. **It is the only one that is actually a facelift.** B is a refinement of the current Cormorant Garamond look. If the point is that a returning visitor notices, A delivers and B does not.
2. **It satisfies the brief's hardest constraints by construction.** §4.3 (two colours + one accent), §4.4 (no house branding in the grid), §4.5 (black primary / grey secondary) all fall out of ink-and-bone for free. The family accent then becomes the *only* colour on the page, so colour carries information instead of decoration.
3. **The numbered catalogue needs a grotesque.** §4.6 (`CREED AVENTUS — No. 01`) is a zero-copywriting system upgrade. Grotesque numerals make it a design element; a serif makes it a footnote.
4. **It matches the comps the memo actually verified** — Jacquemus at 7.46/10 on Awwwards with two colours and eased motion — rather than the ones flagged as directional.

**Take one thing from B:** its mobile type rules. `bn-tokens.css` already floors A's display size and loosens tracking to −0.030em below 600px, or the tight setting crushes on a 390px screen.

**Pick B instead if** Jeff wants *apothecary* rather than *gallery* (a legitimate brand call), or if you want a smaller visual break while the founding-member cohort is still forming. Switching is one commented block in `bn-tokens.css` — no component rewrite.

---

## What Phase A touches

**New files**
- `assets/bn-tokens.css` — the token layer. Ships Direction A by default; the B palette sits commented at the bottom of the file.
- `assets/bn-motion.js` — reveals, marquee, magnetic buttons, cursor label. Vanilla, deferred, guarded.

**Edited files**
| File | Change |
|---|---|
| `layout/theme.liquid` | Swap the Google Fonts link (Cormorant/Lato → Bricolage/Instrument ×2). Add `bn-tokens.css` after the inline critical CSS and before `base.css`. Add `bn-motion.js` with `defer`. Update the inline critical-CSS `:root` block to the new hex values so first paint matches. |
| `sections/hero.liquid` | Two-line headline with an italic accent line, `$20 / month` stamp, CTA pair, founding-member bar, house marquee. Markup + its own `<style>` block only. |
| `snippets/product-card.liquid` | **CSS block only** plus the family tint hook (`data-family`) and the hover notes panel. Existing class names, `[data-quick-add]`, and the wishlist button are left exactly as they are. |
| `sections/featured-products.liquid` | Grid → horizontal scroll carousel (brief §4.2). |
| `assets/base.css` | Point existing hard-coded hex values at the `--bn-*` tokens. No selector changes. |

**Not in Phase A:** any image pipeline work (brief §4.11 AVIF/srcset), the hero video loop (§4.1), and nav facet changes (§4.9). Those are Phase B and are sequenced after the token layer lands, because §4.11 explicitly says ship images before video.

---

## DO NOT TOUCH

These are load-bearing for the subscription funnel. The July 16–17 incident stripped selling plans at cart store-wide; nothing here may re-open that surface.

```
{% form 'product' %}   internals
#sellingPlanSelector
input[name=selling_plan]
#addToCartButton
[data-quick-add]
[data-cart-*]
#cartDrawer
window.bnCustomerId
assets/queue-scheduler.js
assets/bn-appstle-swap.js
templates/customers/account.*        (and account.liquid)
templates/page.quiz.*
templates/page.fragrance-selector.*
templates/cart.*                     (and snippets/cart-drawer.liquid)
```

**Rules that follow from the list:**
- Restyle these elements **by variable**, never by rewriting their markup or renaming their selectors.
- `bn-motion.js` enforces this structurally: every effect filters candidates through `isSafe()`, which refuses any element matching or nested inside the deny list. An element inside `#cartDrawer` cannot pick up `data-magnetic` even if someone adds the attribute.
- No magnetic behaviour, cursor label, or transform on `#addToCartButton` — a transformed button changes its hit area.
- `[data-reveal]` starts visible and only hides once `.bn-js` is on `<html>`, so a JS failure can never blank content.

---

## QA gates before push

1. `design-sheet.html` screenshots at 1440 and 390 in `qa/` — no horizontal overflow, fonts loaded, text contrast ≥ 4.5:1.
2. On the live theme, run the browser check from `project_subscription_incident_2026_07.md`: `add.price === 1500` and `selling_plan_allocation !== null` after an add-to-cart. Healthy = both true.
3. `prefers-reduced-motion: reduce` — reveals resolve instantly, marquee static, no cursor pill.
4. Deploy via `origin/main` worktree overlay (`reference_deploy_via_github.md`), not the CLI — CLI writes fail on Wilson's wifi.
