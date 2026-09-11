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

## Published result

Theme `164193468634` is now published at https://basenotescent.com/collections/fragrances. Exact deployed theme source: `440fa69e983c996cdcd9c6bcc67037c3fe8c2aad`, committed and pushed to PR #56. The prior theme `164192813274` remains available unpublished for recovery.

Fresh public contexts with **no preview parameters** assert theme `164193468634` and role `main`. The reference verifier passes desktop/mobile typography, connected-grid geometry, product ordering within cards, 32 products, preference filters/search, no overflow and no browser errors. Root inspected the public first-view screenshots, not just preview captures. Public SEO verification and the independent commerce regression also pass. The independent public homepage runner passes 3D interactions, reduced motion, photo fallback, preserved `gLmqu.jpg` banner, mobile focus/search, header contrast and collection search. All 25 Node regressions pass.

Public evidence: `/private/tmp/basenote-fragrance-fidelity-live.json`; screenshots in `/var/folders/yg/qvjnvr693832pkp806w46tc40000gn/T/basenote-fragrance-fidelity-NpN3vV`; commerce screenshots in `/private/tmp/basenote-compact-public-commerce-qa`. No orders or customer submissions occurred; only fresh isolated QA carts were changed and cleared.

PR #56 remains **open**, because a fresh ordinary merge attempt is rejected by the branch's approving-review requirement. GitHub returns `REVIEW_REQUIRED` and has no recorded approving review. No admin override or branch-protection changes were used. This does not block the completed Shopify publication. Other open PRs were not bulk-merged: they include unrelated staging apps, unrelated branch histories, and obsolete visuals that could undo the approved correction.

The frontend, Shopify and UI/UX checks narrowed the correction to reference typography/density and preserved native commerce and touch usability. The independent visual and commerce branches both returned usable verification; neither needed to edit the other's files. No measured speedup or conversion uplift is claimed.

## Follow-up: reported left category sidebar

The user's follow-up requested removal of a left category sidebar and publication of all completed storefront work. A fresh read-only pull from live theme `164193468634` confirms the active collection section is still `fragrance-catalog`; its source exactly matches the committed release. The JSON template differs only by Shopify's autogenerated comment header. An independent desktop/mobile public audit confirms `/collections/fragrances` and `/collections/all` show the reference's horizontal category row and no legacy sidebar. Both homepage navigation links point to `/collections/fragrances`. `/pages/fragrances` is a 404, not another catalog.

The old `main-collection.liquid` sidebar is dormant, not mounted by the active template. It was not deleted or modified merely to manufacture a change. No category removal beyond the user's intended left sidebar is inferred: the horizontal row also exists in Jeff's supplied HTML. The browser verifier now explicitly rejects mounted legacy sidebar markup and a vertical category layout. A screenshot of the reported sidebar is needed to reconcile the user's view with the reproducible public page; a stale tab or preview session is only a possibility, not an established cause.

Verification graph: root checks committed/live source while one independent read-only agent audits up to four public routes; root integrates evidence and runs the stronger public regression. Fan-in one; no shared writes or nested agents; all external deployment writes remain root-only under the user's existing approval. A full implementation graph was unnecessary for this narrow report. One useful verification branch returned out of one started. No theme source changes or new visual deployment were needed for this follow-up; completed theme changes remain live, while the regression/documentation update is committed and pushed separately.
