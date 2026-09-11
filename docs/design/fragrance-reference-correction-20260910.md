# Fragrances reference correction — September 10, 2026

## Why this correction was needed

The preceding release passed commerce and functional tests but did not reproduce Jeff's compact collection layout. It enlarged and recolored the heading, introduced oversized image panels and widely separated cards, and placed a search toolbar above the product grid. Describing that as a visual match was incorrect.

The latest saved screenshot explicitly shows artifact `df9b5ae6-2daa-4979-8fc2-8673232088ed`. That screenshot anchors the current heading, two navigation rows, hierarchy and joined grid. The separately saved WhatsApp `jeff-homepage-mockup.html` is an older revision, used for consistent typography, colors and compact grid CSS—not misrepresented as the latest artifact source. Direct public artifact access currently presents a Cloudflare challenge; it was not bypassed.

## Narrow implementation

Collection-only `fragrance-reference.css` restores the black 44px/700 Playfair heading (32px mobile), gold eyebrow, italic 18px introduction, darker category bar, 1020px four-column joined grid with one-pixel borders, compact merchant photos, and name → house/5ml → add-to-cart hierarchy. Mobile uses two fluid columns. The search input remains functional inside a collapsed disclosure below the grid, with the global header search unchanged.

Intentional differences from the mockup are retained: real merchant photos rather than placeholder icons; real catalog order and titles; truthful purchase reassurance instead of unverified ratings/order counts; actual Monthly Rotation/full-bottle navigation; and touch targets of at least 44px. No product photography is replaced, reordered or deleted. No changes are made to the homepage banner, header/footer configuration, product/cart layouts or pricing engine. The original dirty Desktop worktree is untouched.

## Evidence before publication

- Fresh preservation pull: `/private/tmp/basenote-fragrance-before.aUdiQ2`, from then-live theme `164192813274`. Settings, homepage index and header/footer groups match the release worktree byte for byte.
- Corrected unpublished preview: `164193468634` (Jeff Fragrance Grid Sep 10 QA).
- Shopify Theme Check: zero errors.
- `verify-fragrance-reference.cjs`: actual Shopify preview at 1440px and 390px. Desktop heading 44px/700/black; grid 1020px, four columns, one-pixel gaps/border; card approximately 254×249px; media 66px. Mobile two columns and 32px heading. No overflow or browser errors; preference filters, search, empty state and clear all pass.
- Independent commerce runner: actual $20 Aventus + $18 Green Irish Tweed = $38, retained source scent identity, removal repricing, real subscription plan and consent, native no-JavaScript add, mobile overflow and PDP photo/vial switching pass. Isolated carts cleared; no order or customer submission.
- SEO verifier passes metadata, offers, canonical/robots, helper containment, 16 matching FAQ answers and three agent/LLM endpoints.

## Dependency graph and scope

Reference/source verification → collection correction → preview visual + commerce QA → publish → fresh public verification. Read-only PR inventory and independent screenshot comparison run alongside implementation; neither owns source files. Older PRs include staging apps, unrelated histories and obsolete storefront snapshots, so they are not bulk-merged into this release. Repository approval status must be reported separately from Shopify publication.

Publication and final source commit are recorded below after the actual public checks complete.
