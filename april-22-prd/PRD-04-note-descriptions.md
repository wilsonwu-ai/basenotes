# PRD-04 — De-duplicate Fragrance Note Descriptions

**Ticket:** Apr 22, Image 4 — Christina Warner: "The text tends to re-use words a lot. See description of notes. I don't want to see the same description twice."
**Status:** Planning
**Owner:** Wilson (copy) + Jeff (Shopify admin entry); dev only if template change needed
**Complexity:** Low (dev) / Medium (copy writing)
**Dependency:** None

---

## 1. Context

Each fragrance PDP displays top / heart / base notes sourced from product metafields (`product.metafields.custom.top_notes`, `.heart_notes`, `.base_notes`). Christina observed that note descriptions repeat the same words across fragrances — making the catalog feel generic and undermining the "10 exclusive fragrances crafted in-house" positioning from the master PRD.

This is primarily a **content problem**, not a template problem. The template renders whatever metafield content is authored in Shopify admin.

## 2. Goal

Every fragrance's note copy is unique, specific, and sensory — so subscribers reading across the catalog never encounter the same sentence twice.

## 3. Audit Step (before writing)

Run this from the repo root to extract current note content from any local fixtures or verify via live Shopify admin:

1. Shopify admin → Products → pick each of the 10 fragrances.
2. For each, copy `Top notes`, `Heart notes`, `Base notes` metafield values into a single spreadsheet column per note position.
3. Run a duplicate-phrase analysis (word-level trigram overlap is fine — eyeball it or script it). Flag any sentence that appears in 2+ products.

**Output:** a Google Sheet or local CSV — `note_copy_audit.csv` — with columns:
`product | top_notes | heart_notes | base_notes | duplicate_flags`

## 4. Rewrite Guidelines (style spec for Wilson / copywriter)

- **30–60 words per note section.** Short enough to scan, long enough to evoke.
- **Lead with the raw ingredient**, then qualify with sensory verbs: *"Bergamot — bright, peeled-rind, with a whisper of green tea."*
- **No word shall repeat across three products in the same note position.** (e.g., can't use "warm" in three base notes.)
- **No generic adjectives without context.** Banned without a qualifier: "fresh," "warm," "sexy," "sophisticated," "elegant," "luxurious."
- **Voice:** first-person observer, not marketing copy. *"You'll notice leather first, then a smoky drift of oud."*
- **Duration context belongs in the pyramid layout, not in the note copy.** (i.e., don't write "the first 15 minutes" in the top-note text — the template already labels the layer.)

## 5. Scope

### In scope
- Audit + rewrite of `top_notes`, `heart_notes`, `base_notes` metafield content for all 10 Base Note fragrances.
- Shopify admin data entry (Wilson or Jeff re-enters per product).
- Optional: add a `product.metafields.custom.note_short_summary` one-liner for the card view in fragrance selector, separate from the long-form notes — reduces cross-contamination between card grids and PDP detail.

### Out of scope
- Changing the Liquid template structure — current metafield-driven layout is correct.
- Adding note-ingredient illustrations / icons.
- Translating copy to other languages (US-only today).

## 6. Files to Touch (dev)

| File | Change |
|------|--------|
| None required if only copy changes. | |
| **OPTIONAL:** `sections/main-product.liquid` lines 325–378 + `snippets/fragrance-selector.liquid` lines 81–84 | If adding `note_short_summary` metafield, update these to render short summary in cards and full notes on PDP. |
| `scentbird-prd/SHOPIFY_ADMIN_SETUP_GUIDE.md` | Append a "Note copy guidelines" section with the §4 style spec so future additions stay on-voice. |

## 7. Acceptance Criteria

- [ ] Audit CSV exists and shows zero duplicate sentences across the 10 fragrances' note copy.
- [ ] Each fragrance's 3 note sections meet the style spec: 30–60 words, ingredient-led, sensory, no banned adjectives without qualifier.
- [ ] Shopify admin metafields are updated for all 10 products.
- [ ] PDPs visually render the new copy (verify live).
- [ ] `SHOPIFY_ADMIN_SETUP_GUIDE.md` updated with the style spec.
- [ ] (Optional) `note_short_summary` metafield added + fragrance selector cards render the short variant.

## 8. Verification

- Pull the audit CSV post-rewrite; re-run the duplicate analysis — zero duplicates.
- Open 3 random PDPs as a customer; read aloud; confirm no déjà vu.
- Jeff and/or Christina eyeball pass before declaring done.

## 9. Who Does What

- **Wilson:** write the copy (or brief a copywriter with the style spec).
- **Jeff or Alex:** enter copy into Shopify admin metafields per product.
- **Engineer:** only gets involved if Wilson decides to add the `note_short_summary` metafield — then update the two Liquid files per §6.
