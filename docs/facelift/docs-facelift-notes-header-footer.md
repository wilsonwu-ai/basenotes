# Integrator notes — header + footer (Phase A, Direction A)

Owner of this pass: header/footer agent. Files touched: `sections/header.liquid`, `sections/footer.liquid` only.
Everything below is a change that lives **outside** those two files and needs someone else's hands.

---

## 1. `--header-height` — the number is **72px desktop / 64px ≤767px**

The bar went from 110px to 72px. `--header-height` is the legacy alias that other sections pad
against (`calc(var(--header-height) + …)` appears in 12 sections plus 5 templates), so it has to move
with the bar or every page gets 38px of orphan padding.

**What I did (inside my own file, because it was the only lever I own):** `sections/header.liquid`
declares in its `<style>` block:

```css
:root { --header-height: 72px; --bn-ticker-height: 32px; }
@media (max-width: 767px) { :root { --header-height: 64px; } }
```

That block is in the body, so it wins the cascade over both `bn-tokens.css` and `base.css` at runtime.
Verified in a browser: `getComputedStyle(document.documentElement).getPropertyValue('--header-height')`
returns `72px` at 1440 and `64px` at 390, and the header box measures 72 / 64.

**What I need from you — three places, in this order of importance:**

1. **`assets/base.css` line ~54 still says `--header-height: 110px`.** base.css loads *after*
   bn-tokens.css, so changing the value only in bn-tokens.css does nothing — base.css overrides it.
   Either update base.css to 72px or delete the declaration there and let bn-tokens.css own it.
2. **`layout/theme.liquid` line 151, inline critical CSS `:root{…--header-height:110px…}`.** Until this
   is 72px there is a first-paint jump: the browser paints a 110px bar, then my section `<style>`
   parses and it snaps to 72px. Same line also needs the new hex values per the README, so it is being
   edited anyway.
3. **`assets/bn-tokens.css` legacy alias block** (`--header-height: 110px`, last line of `:root`) →
   72px, plus the 64px mobile override in the existing `@media (max-width: 600px)` guard (note: my
   breakpoint is 767px, not 600px — pick one and I will follow yours).

Once all three carry the value, **delete the `:root` block from my `<style>`** — it is a shim, not a
design decision, and it is flagged as such in a comment in the file.

`--bn-ticker-height: 32px` is a new variable I introduced. It only has one consumer (the announcement
bar) so it can stay where it is, but it belongs in bn-tokens.css next to the layering block if you
want the full geometry in one file.

## 2. `layout/theme.liquid` critical CSS fights the section on `position`

Line 157 of the critical CSS says `.header{position:fixed;…;height:var(--header-height)}`. The section
stylesheet says `position: relative` (and `sticky` under `.is-sticky`). The section is later in
document order at equal specificity, so **relative/sticky wins today** — this was already true before
my pass, I have not changed the outcome. But the two files disagree in writing, and the padding
`calc(var(--header-height) + …)` in downstream sections reads like it was authored for the fixed
version. Worth reconciling deliberately rather than by cascade accident.

## 3. Google Fonts link must carry the variable axes

The header and footer set `font-variation-settings` on the display face — `'wdth' 86/90/100` and
`'opsz' 24/96`. A static Bricolage Grotesque will silently ignore all of it and the wordmark tracking
will look wrong. The axis-bearing URL (already specified in the bn-tokens.css header comment):

```
Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800
Instrument+Serif:ital@0;1
Instrument+Sans:ital,wdth,wght@0,75..100,400..700;1,75..100,400..700
```

Instrument Serif italic is **not** currently used by either of my two files — the accent face lands in
hero/section headings, not in chrome. Load it anyway for the rest of Phase A.

## 4. `assets/bn-motion.js` — two small asks

Both are one-liners in a file I do not own.

1. **The marquee clone duplicates focusable anchors.** `initMarquee()` sets `aria-hidden="true"` on the
   clone but leaves its `<a>` elements in the tab order, so a keyboard user tabs through an invisible
   duplicate of the announcement link. Suggested fix, right after the `aria-hidden` line:
   ```js
   clone.querySelectorAll('a,button,input').forEach(function (n) { n.setAttribute('tabindex', '-1'); });
   ```
   I already minimised the blast radius on my side: only the **first** copy of the ticker text inside
   the track is a link; copies 2 and 3 are plain `aria-hidden` text. So this is exactly one stray
   anchor, not three.
2. **`[data-cart-open]` is not in the `DENY` list.** It is the cart *button*, and `isSafe()` only walks
   ancestors — the `[data-cart-count]` badge inside it does not protect the button itself. Nothing
   currently puts `data-magnetic` on it (I deliberately did not), but the README's own rule about not
   transforming funnel buttons argues for making it structural rather than a convention. Add
   `'[data-cart-open]'` to `DENY`.

## 5. Announcement bar: the countdown render call moved, and one duplicate branch was collapsed

`{% render 'countdown-timer', duration: settings.urgency_timer_duration, id: 'announcement', style: 'inline' %}`
is preserved **byte for byte**, but:

- It used to appear **twice** (once in the link branch, once in the no-link branch). It now appears
  **once**. Rendered output is unchanged: exactly one countdown, same id, same params, same conditional
  (`settings.urgency_timer_enabled`).
- It now sits **outside** the `[data-marquee]` track, pinned to the right of the ticker.

That second point is not cosmetic. bn-motion clones the marquee track wholesale; if the countdown were
inside it, the page would end up with **two elements carrying `id="timer-announcement"`** and
`data-countdown-init="true"` copied onto the clone — the clone would freeze at 05:00 and scroll past a
user showing a dead timer next to a live one. Keeping it out of the track is the fix, and it also reads
better: text crawls, the clock holds still.

## 6. Ticker is bone, header is ink — check this against `transparent_on_homepage`

The 32px ticker is now **bone ground / ink text** (16:1) sitting above an **ink** header bar. The
setting `transparent_on_homepage` (default `false`) makes the header `position:absolute`, and the
announcement bar stays in normal flow above it. Nobody has exercised that combination since the
repaint. If Jeff turns it on, re-check `sections/hero.liquid`'s `calc(var(--header-height) + 40px)`
top padding — it assumes the old 110px bar and does not account for the ticker at all.

## 7. Pre-existing, untouched

`sections/footer.liquid` carries 4 `UndefinedObject` warnings for `policies` (lines 165–168, the legal
link `default:` filters). They were there before this pass and I left the markup alone. Theme check on
`sections/header.liquid` went from **2 errors to 0** (both were `ImgWidthAndHeight`).
