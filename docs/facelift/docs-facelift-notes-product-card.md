# Facelift Phase A — notes from the product-card / featured-collection agent

Files I own and changed:

- `snippets/product-card.liquid` (CSS block appended + additive markup only)
- `sections/featured-collection.liquid` (rewritten; render call and schema ids preserved)
- `snippets/bn-notes.liquid` (new)

`shopify theme check` reports **0 offenses** in all three; theme-wide total went
98 → 96 and the only delta was `sections/header.liquid` 2 → 0, which is another
agent's fix, not mine.

---

## 1. Decisions that need a human, ranked

### 1a. Product-card title font — two agents disagree. Pick one.

- My brief said **Instrument Serif italic** for the card title, and that is what
  `snippets/product-card.liquid` now sets.
- `assets/component-variables.css` (someone else's file) sets
  `.product-card__title { font-family: var(--bn-font-display); font-weight: 500 }`
  — Bricolage, matching `design-sheet.html` §04 exactly.

Mine wins today purely by source order (an inline `<style>` in `<body>` beats a
`<link>` in `<head>`). That is a fragile way to settle a type decision. Whoever
integrates should delete the loser rather than leave both.

### 1b. `component-variables.css` `.product-card__badge` is absolutely pinned

That file has:

```css
.product-card__badge { position: absolute; top: 0; left: 0; z-index: 2; }
```

In the real card, badges live inside `.product-card__badges`, which is already
absolutely positioned as a flex column. That rule stacks New / Bestseller /
Exclusive / Limited on top of each other. I defended against it locally with
`position: static; top: auto; left: auto;`, but the rule probably belongs scoped
to the featured-collection placeholder markup, where badges sit directly inside
`.product-card__image`. Same file also treats `.product-card__image` as a
container with `aspect-ratio: 3/4` and a tint background — in the real card that
class is on the `<img>` itself. I neutralised it with `img.product-card__image`.
Both defences are marked in the CSS; consider fixing at source.

### 1c. Packshots use `mix-blend-mode: multiply`

The media now carries the family tint and the image switches to
`object-fit: contain` + padding + `multiply`, so a white-background packshot
drops its white and sits on the tint. `isolation: isolate` on
`.product-card__media` pins the blend group. **QA anchor:** open the grid and
check any product whose image is *not* on white — it will go muddy, not broken.
If more than a couple do, delete the two `mix-blend-mode`/`isolation` lines and
the cards fall back to a white box on tint, still correct.

### 1d. Copy I did not touch, that the brief asks for

- Brief §4.6 wants `CREED AVENTUS — No. 01`. The card renders `No. 01` above the
  house eyebrow; the title still prints the full `product.title`, which already
  contains the house ("Creed Aventus", "Tom Ford Oud Wood"). Stripping the vendor
  prefix (`product.title | remove_first: product.vendor | strip`) would give the
  design sheet's `Creed` / *Aventus* split, but that changes existing markup
  content, so I left it. Cheap follow-up.
- Brief §4.8 wants the grid CTA verb to be **"Add to Rotation"**. The card still
  says **"Start Your Subscription"** because that string sits inside the
  `[data-quick-add]` button, which is DO-NOT-TOUCH. Changing it is a one-word
  edit but it should be a deliberate, funnel-aware one.

---

## 2. Asks for the integrator

1. **`sections/featured-products.liquid` does not exist.** The README's edit
   table names it; the file in this theme is `sections/featured-collection.liquid`
   and that is what I changed. Worth correcting the README so nobody goes looking.
2. **Pass `catalogue_number` from the other grids** if you want numbering
   site-wide. `product-card.liquid` accepts an optional `catalogue_number` and
   renders `No. 07` / `No. 23` from it; passing nothing renders nothing. The
   other four call sites are `sections/main-collection.liquid:226`,
   `sections/main-product.liquid:569`, `sections/product-case.liquid:254`,
   `templates/search.liquid:39`. On a paginated collection you want
   `forloop.index | plus: offset`, not `forloop.index`.
3. **`bn-notes` pdp mode is built but not wired.** Phase B: drop
   `{% render 'bn-notes', product: product, mode: 'pdp' %}` into
   `sections/main-product.liquid`. It carries its own `<style>` (emitted only in
   pdp mode, so it never repeats across a grid) and needs no other change.
4. **Optional metafields.** The snippet prefers
   `product.metafields.custom.top_notes` / `heart_notes` / `base_notes` when they
   exist and falls back to parsing `product.description`. Defining those three
   (plain text or `list.single_line_text_field`, both handled) would make the
   notes independent of description formatting. Nothing is required today —
   verified parsing works on the live description format.
5. **Search page.** `templates/search.liquid` renders `product-card` inside its
   own grid; the new card is wider-content and left-aligned, so give that grid a
   look once the theme is previewable.

---

## 3. What I verified, and how

There is no store preview yet, so nothing here is a screenshot claim.

- **Liquid actually renders.** `python-liquid` 2.3.1 against the real catalogue:
  all **32 products** from `growth-audit/catalogue.json`, with the real
  `Body (HTML)` bodies from `products_import.csv`, render `product-card.liquid`
  end to end with **0 errors**, and every card keeps `data-quick-add` and
  `<span>Start Your Subscription</span>`.
- **Note parsing.** All **9** products in `products_import.csv` that carry the
  `Top Notes: … <br> Heart Notes: … <br> Base Notes: …` body parse all three
  tiers correctly. Creed Aventus →
  `Top: Blackcurrant · Italian Bergamot · Apple · Pineapple`,
  `Heart: Birch · Moroccan Jasmine · Patchouli`,
  `Base: Musk · Oakmoss · Ambergris · Vanilla`.
  A trailing `<p>` after the notes paragraph does **not** leak into Base — tested
  explicitly. `Middle Notes:` and upper/lower-case variants are normalised to
  `Heart Notes:` before parsing.
- **Family keys.** All 32 products resolve to a family; distribution is
  woody 13, fresh 9, amber 3, gourmand 2, aromatic 2, green 1, oriental 1,
  clean 1 — eight distinct tints across the grid. `citrus` → `fresh` token and
  `musky` → `powdery` token (no tokens of their own), with the human label
  preserved: `citrus` renders the chip "Citrus" on the fresh tint.
- **Degenerate cases.** No tags and no notes → no `bn-notes` markup at all, no
  toggle button, `data-has-notes="0"`, and the legacy tag-derived note line stays
  visible as the fallback. Sold out → sold-out button, no quick-add. Available
  but no selling plan → the `data-subscription-unavailable` "Coming Soon" guard
  is intact.
- **Funnel preservation.** The existing `<script>` block in
  `product-card.liquid` is **byte-identical** (4630 bytes, diffed against the
  untouched copy on `~/Desktop/basenote`). Every named hook is present verbatim.
- **JS.** Both script blocks pass `node --check`. My new one contains no Liquid.
- **Tokens.** Zero hard-coded hex or `rgb()` in any CSS I wrote, and every
  `var(--bn-*)` I reference exists in `assets/bn-tokens.css`.

---

## 4. What it should look like

**Card, at rest.** A bone card with a 1px hairline. The media is a 3:4 block
filled with `color-mix(in oklab, var(--bn-family) 15%, var(--bn-bone))` — a pale
wash of the scent family, so a row of cards reads as a colour-coded catalogue
rather than a grid of white boxes. The bottle sits in the middle of that wash at
`object-fit: contain` with ~12% padding, its white background multiplied away.
Badges stack top-left in ink-on-bone; the wishlist square is top-right (always
visible on touch, fade-in on hover); season glyphs are bottom-right, now
monochrome grey instead of the old four-colour set; a pill chip sits bottom-left
with a family-coloured dot and the family name in 10px uppercase on a 22% tint of
the same colour. Below the media, left-aligned: `No. 01` in brass, the house in
uppercase micro-caps, the product name in **Instrument Serif italic** at ~20–26px,
then a hairline, `$20` in Bricolage with tabular figures, and "MONTHLY
SUBSCRIPTION" beneath it. The full-width ink bar with "START YOUR SUBSCRIPTION"
closes the card, unchanged.

**Card, hovered (pointer devices).** Card lifts 5px over 450ms on the house curve
and takes the card shadow; the primary image cross-fades to the second image and
scales 1.045; the family chip and season glyphs fade out; and an ink panel slides
up from the base of the media over 500ms carrying three rows — `TOP` / `HEART` /
`BASE` in brass micro-caps against note lists in dimmed bone, middot-separated.
`:focus-within` opens the same panel, so a keyboard user tabbing to the add
button sees the notes.

**Card, on touch.** No hover anything. A "NOTES ⌄" row appears between the
content and the add bar; tapping it slides the same panel up and rotates the
chevron. The button is a sibling of the card link, not a child, so it cannot
trigger navigation, and it is a separate `[data-notes-toggle]` listener that
never touches the cart path.

**Featured collection, ≥900px.** Left-aligned header: a brass eyebrow with a
hairline running off to the right edge, a Bricolage headline at `--bn-text-3xl`
with `wdth 86 / opsz 96` and −0.045em tracking, optionally followed by an italic
Instrument Serif accent line on its own row in brass. Below it a three-column
grid on `--bn-gutter`, with the **first card spanning 2 columns and 2 rows** — its
media drops the fixed 3:4 crop and stretches to fill the taller block, and its
title steps up to `--bn-text-2xl`. Cards 2 and 3 stack in column three beside it;
everything after runs three-up. Under the grid, a hairline, then a giant italic
"*View all*" at `--bn-text-3xl` with "32 FRAGRANCES · ONE FLAT PRICE" and an arrow
set on the same baseline; the arrow slides 6px right and the word goes brass on
hover, and the whole link is `data-magnetic` so it drifts up to 6px toward the
cursor.

**Featured collection, <900px.** The same grid becomes a horizontal
scroll-snap row: cards at 76% of viewport width (capped 340px), snapping to
start, scrolling inside the container with no page-level horizontal overflow (no
negative margins were used, deliberately). The lead card gives up its 2×2 span
and returns to a normal 3:4 card.

**Reduced motion.** Reveals resolve instantly, the hover lift and the image
scale are pinned to `none`, panel and chevron transitions collapse to 1ms via the
token overrides. The notes panel is still a deliberate hide-until-asked, on both
hover and tap — that is layout, not animation.

---

## 5. Motion hooks I added

| Element | Attribute |
|---|---|
| `article.product-card` | `data-reveal` |
| `.bn-fc__header`, `.bn-fc__grid` | `data-reveal-group` (70ms stagger, cap 6) |
| header eyebrow / title / description, view-all wrapper | `data-reveal` |
| `.bn-fc__viewall` anchor | `data-magnetic` |
| `bn-notes` pdp section + tiers | `data-reveal-group` / `data-reveal` |

`bn-motion.js`'s `isSafe()` deny list matches elements that *are* or are *inside*
a funnel node. `article.product-card` is an **ancestor** of `[data-quick-add]`,
not a descendant, so it passes the guard by design and the reveal's transform
resolves to `none` once revealed. Flagging it so nobody is surprised to see a
funnel button inside a revealed element.

One consequence worth knowing: `.bn-js [data-reveal].is-revealed { transform:
none }` is specificity (0,2,1) and silently kills any plain `.product-card:hover`
transform. That is why the hover lift is duplicated as
`.bn-js .product-card[data-reveal].is-revealed:hover`. Any future card hover
transform needs the same treatment or it will look like it simply does not work.
