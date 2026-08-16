# Integrator notes — bn-hero · bn-marquee · bn-price-table · templates/index.json

Owner of this note: the hero/marquee/price-table agent. Files I own and changed:

- `sections/bn-hero.liquid` (new)
- `sections/bn-marquee.liquid` (new)
- `sections/bn-price-table.liquid` (new)
- `templates/index.json` (edited)

Nothing else was touched. No git commands were run.

---

## 1. Hard dependencies in files I do NOT own

These three sections render as unstyled fallbacks unless `layout/theme.liquid` is
wired per the README. All three are token-only — they define no colour, face or
duration of their own.

**a. `assets/bn-tokens.css` must load before section CSS.** Every value is a
`var(--bn-*)`. Without it the sections fall back to browser defaults.

**b. `assets/bn-motion.js` must load with `defer`.** `[data-reveal]` and
`[data-marquee]` are inert without it, and both fail *visible*: reveals stay on
screen, the marquee renders as a static readable line. No blank-content failure
mode exists.

**c. The Google Fonts link is still the old pair.** `layout/theme.liquid:189-190`
preloads Cormorant Garamond + Lato. Direction A needs the three faces below, and
until this lands the giant hero headline renders in the Georgia fallback — which
is the single most visible thing separating Direction A from the current site.
Exact axis ranges, copied from the `bn-tokens.css` header:

```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Instrument+Serif:ital@0;1&family=Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700&display=swap
```

---

## 2. `--header-height` coupling (please sanity-check on preview)

`sections/header.liquid` now redefines `--header-height` on `:root` to **72px**
(64px ≤767px), and `config`/`header-group.json` has `transparent_on_homepage: true`,
so on the homepage the header is `position: absolute` and **overlays** the hero.
There is also a 32px in-flow `.announcement-bar` above it.

`bn-hero` therefore pads:

```css
padding-block: calc(var(--header-height, 72px) + var(--bn-space-lg)) var(--bn-space-xl);
```

If the announcement ticker is ever changed to overlay as well, this needs
`+ var(--bn-ticker-height)`. One-line change in `bn-hero.liquid`; flagging it
rather than guessing at the final header behaviour.

---

## 3. `templates/index.json` — what changed and how to roll back

Shopify's auto-generated comment header is preserved. The file parses as JSON
once that header is stripped, and every `type` in `sections` resolves to a real
`sections/*.liquid` (verified; `_blocks` entries excluded as they always are).

New render order (disabled entries render nothing):

| # | key | note |
|---|---|---|
| 1 | `bn-hero` | new |
| 2 | `hero` | **`disabled: true`** — kept for rollback, not deleted |
| 3 | `growth-goal` | unchanged, kept second in visible order |
| 4 | `bn-marquee` | new |
| 5 | `17768546331d8577f5` | unchanged AI-gen `_blocks` (its inner block was already disabled) |
| 6 | `delivery-explainer` | unchanged |
| 7 | `bn-price-table` | new, inserted exactly where the old price comparison sat |
| 8 | `1775503735ef6a96df` | **`disabled: true`** — the old "Price Comparison" `_blocks` |
| 9+ | rest | untouched, same order |

**Rollback for the hero:** flip `sections.hero.disabled` to `false`, set
`sections["bn-hero"].disabled` to `true`. No reordering needed — the two sit
adjacent on purpose.

**Rollback for the price table:** same pattern with `1775503735ef6a96df` and
`bn-price-table`.

**Claims parity:** every number and string in `bn-price-table` is carried over
verbatim from `ai_gen_block_9faa96e` — the four rows ($45 / $40 / $32 / $42
against $20 / month), all three column headers, the title and the subtitle. I
added a `footnote` setting but left it **empty**, because sourcing the
comparison prices is a claim I have no anchor for. If Jeff can source them, that
field is where it goes.

---

## 4. Two accepted `RemoteAsset` warnings

`shopify theme check` reports **0 errors** across my four files and exactly two
warnings, both `RemoteAsset` in `bn-hero.liquid`. They come from the two settings
that are *meant* to hold external URLs: `image_url` (external background image)
and `video` (MP4). The current live `sections/hero.liquid` carries the identical
two warnings, so this is not a new class of offence.

**Performance ask:** for LCP, prefer the uploaded `image_picker` over the
external `image_url`. The picker path goes through `image_url | image_tag` with
a 7-step `srcset` (480→2400), `sizes="100vw"`, `fetchpriority="high"`,
`loading="eager"` and real `width`/`height`. The external path can only be given
a hardcoded 1920×1080 and no `srcset`. `index.json` currently uses the picker
(`shopify://shop_images/case-forest-green.png`).

---

## 5. Video is wired but deliberately switched off

Brief §4.11 says ship images before video, so `settings.video` is empty in
`index.json`. The picker, the poster fallback and the reduced-motion rule
(`.bn-hero__video { display: none }`) are all in place for Phase B — dropping an
MP4 URL into the setting is the whole activation step. Always set a poster: the
poster `<img>` renders underneath the video, so reduced-motion users and the
pre-load frame both get a real image rather than a black box.

---

## 6. QA items I could not check (no store preview)

1. **390px hero height.** With a 3-line headline plus the italic accent line, the
   content may exceed `100svh` on a 390×844 device. The section uses
   `min-height`, so it grows rather than clips — nothing is ever cut off — but
   confirm the scroll cue still reads as "there is more below" and doesn't land
   awkwardly. If it's too tall, the cheapest trims are the `reassurance` setting
   (clear it) or shortening `heading_line_2`.
2. **Marquee track width.** `repeat` defaults to 2 for the houses row and 4 for
   the claims row so the track exceeds a 1520px viewport before cloning. On an
   ultrawide monitor, if a gap appears mid-loop, raise `repeat` in the theme
   editor — no code change.
3. **Stamp ring legibility.** The rotating `<textPath>` ring is brass on ink at
   6.6px. It is decorative and `aria-hidden`; if it reads as mud on the preview,
   clear `stamp_ring_text` and the stamp degrades to a clean static disc.
4. **`/pages/find-your-scent`** is the primary CTA target, carried over from the
   live hero settings and already linked from `growth-goal`, `cart.liquid` and
   the account page — so it should exist, but it is worth one click.
