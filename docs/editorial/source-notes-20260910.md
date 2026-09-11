# Comparison article research and publication record

Checked and published September 10, 2026. These are original Base Note editorial comparisons, not independent product tests. Both posts disclose the retailer's commercial interest and lack of competitor affiliation. No review, endorsement, user experience or performance data was invented.

## Published articles

- [ScentBox vs Base Note: Sizes, Prices and One-Time Vials](https://basenotescent.com/blogs/hub/scentbox-vs-base-note) — article `668106359002`, 665 words, source HTML `scentbox-vs-base-note.html`.
- [Olfactif Alternatives: Curated Boxes or Your Own Samples](https://basenotescent.com/blogs/hub/olfactif-alternatives) — article `668106391770`, 685 words, source HTML `olfactif-alternatives.html`.

The Deep Research workflow informed a bounded multi-angle check: official subscription offers, sample size and selection, standalone purchasing, cancellation/exchange conditions, then a counter-review against misleading comparisons. Research used primary sources only. No search traffic, SERP rank, review count or conversion uplift is claimed.

## Source ledger

| Primary source | Verified claim used |
|---|---|
| [ScentBox subscribe](https://www.scentbox.com/subscribe.cfm) | Regular one-fragrance monthly tiers: Standard $17.95, Premium $22.95, Platinum $32.95; tiers change scent eligibility. Introductory promotional amounts are not the regular prices. |
| [ScentBox home](https://www.scentbox.com/) | 8 ml atomizer; customer fragrance calendar. |
| [ScentBox product listing](https://www.scentbox.com/shop/details.cfm?id=131933) | Some atomizers/samples are also available as one-time purchases; membership is not the only path. |
| [ScentBox terms](https://www.scentbox.com/pages/terms.cfm) | US active-member exchange conditions: most recent shipment, within 15 days, one exchange shipment monthly and five per 12 months; cancel before next charge. |
| [Olfactif subscription](https://www.olfactif.com/products/subscriptions) and [official product JSON](https://www.olfactif.com/products/subscriptions.js) | Three 2 ml samples for $22 monthly; Deluxe six 2 ml samples for $40. Product variants confirm the regular prices. |
| [Olfactif how it works](https://www.olfactif.com/pages/how-it-works) | Curated themed niche-fragrance collections with supporting education. |
| [Olfactif sample shop](https://www.olfactif.com/collections/samples) | Individual 2 ml samples provide a non-subscription option. |
| [Olfactif FAQ](https://www.olfactif.com/pages/faq) | Regular plan prices corroboration; 15th-of-month cancellation cutoff, prepaid remaining-term handling and nonrenewing gift distinction. |
| [Base Note live product JSON](https://basenotescent.com/products/creed-aventus.js) | Current 5 ml one-time price $20; actual selling-plan introductory allocation $15 then $20. Additional eligible same-cart vials at $18 follow the user's existing commerce rule, not a competitor claim. |

All ten cited/source API responses were captured fresh in `primary-sources.json` before publication. Public ScentBox pages sometimes returned an access-denied wrapper through the research browser; ordinary public HTTP retrieval succeeded without authentication, and the actual offer/terms HTML was read and archived. No protected access was bypassed.

## Counter-review adjustments

1. **Avoid false exclusivity.** Both competitors have standalone sample options. The articles explicitly acknowledge these instead of claiming that only Base Note supports one-time orders.
2. **Avoid manufactured price superiority.** At regular prices, ScentBox Standard's $17.95 / 8 ml is about $2.24 per ml and Olfactif's $22 / 6 ml is about $3.67 per ml, versus Base Note's $20 / 5 ml = $4 per ml. These are labeled simple arithmetic, not equivalent-fragrance comparisons. Selection, concentration, amount per scent, shipping and actual use still matter.
3. **Separate first-shipment promotions from renewal.** Competitor tables use regular prices, and Base Note's $15 first shipment is explicitly followed by $20 monthly until canceled. One-time purchasing is separate and needs no subscription.
4. **State material conditions.** ScentBox's exchange restrictions and Base Note's actual no-returns policy are acknowledged. Olfactif prepaid renewal/cancellation conditions are not collapsed into an unqualified “cancel anytime.”
5. **Keep product examples honest.** Four current Base Note product pages per article are illustrative shortlists, not claims of competitor availability, personal testing, paid endorsements or required bundles.

## Publication and validation

`scripts/publish-audit-comparisons.cjs` defaults to a read-only plan and only publishes with `--publish`. It snapshots all existing article records before any write, refuses a different title at either intended handle, and never replaces an existing article. It verifies 500–800 words, no injected script/duplicate H1, all source responses, all 11 distinct internal destinations, then Admin readback and public HTTP 200/title/canonical/indexability. Shopify inserts table whitespace, so readback normalizes whitespace between tags while requiring otherwise identical HTML.

Backups and exact evidence:

- `/private/tmp/basenote-editorial-comparisons-nCSNls`: prepublication 50-article snapshot, primary sources, initial ScentBox creation response. The first verification stopped only because Shopify reformatted table whitespace; it did not create a duplicate.
- `/private/tmp/basenote-editorial-comparisons-uln4fY`: fresh snapshot retaining the published ScentBox article, all source responses, both successful readbacks and the Olfactif creation response.

Publication occurred before the integrated theme deployment; the articles use ordinary Shopify article bodies and the existing template. No images, existing authors, catalog data, prices, subscriptions, emails or campaigns were changed. Recheck competitor plan details when updating these articles; the dated source capture is evidence of this review, not a promise that future offers remain unchanged.
