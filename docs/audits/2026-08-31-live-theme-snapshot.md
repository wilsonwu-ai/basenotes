# Live theme snapshot — 2026-08-31

## Source

- Store: `base-note.myshopify.com`
- Published theme: `basenotes/main` (`158692901082`)
- Capture method: authenticated, read-only Shopify theme pull on 2026-08-31
- Git baseline: `origin/main` at `458dd77`

## Published changes not present in the Git baseline

| Area | Files | Observed change | Request linkage |
| --- | --- | --- | --- |
| Homepage member journey | `sections/how-it-works.liquid`, `templates/index.json` | Redesigned the journey to: subscribe and order; log in and visit the queue; build a rotation of up to five months; continue monthly. | Jeff's Aug. 25–28 request to route subscribers to their profile/queue and let them choose future scents. |
| Homepage presentation | `sections/header-group.json`, `sections/promotional-banner.liquid`, `snippets/promo-popup.liquid`, `templates/index.json` | Refreshed announcement and promotional copy, hero image/configuration, CTA labels, and founding-member content. | Jeff's Aug. 27 request for a clearer explanation of the membership journey. |
| 5 ml product facts | `snippets/product-faq.liquid`, `templates/index.json`, `templates/page.subscription-terms.liquid` | Updated the stated atomizer capacity from approximately 45 to approximately 60 sprays. | Published content correction; no single dated request identified in the reviewed one-week window. |

## Deliberately excluded

Nine untracked `assets/wechat_2026-04-05_*.png` files were downloaded with the live theme pull but are not referenced by the published theme diff and are not included in this archival commit.

## Follow-up

This branch preserves the live source before implementing further request tickets. New work must start from this snapshot (or a successor merged into `main`), not from the older divergent local branch.
