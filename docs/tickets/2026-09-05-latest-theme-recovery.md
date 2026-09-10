# PRD: Latest Theme Recovery and Release Guardrail

**Status:** Published as theme 164045029594; independent postpublication smoke checks passed
**Severity:** SEV-1 storefront regression, with P0 commerce containment
**Updated:** 2026-09-06
**Owner:** Base Note engineering

## Outcome

Keep the newest approved Base Note storefront as the only production lineage, retain the four safe September changes, fail closed on the misconfigured internal add-on product, and prevent a QA theme from replacing the canonical storefront again.

## Evidence and incident cause

- Jeff reported that the public site had reverted to the old homepage.
- Shopify showed `Jeff fixes Sep 3 QA` (theme `163971432666`) as live while the preserved newer `basenotes/main` theme (`158692901082`) was unpublished. This was a release-selection failure, not a homepage content edit.
- A pulled-file comparison showed the QA theme matched the older theme-integration lineage, while `basenotes/main` retained the newer hero, founding-member placement, and redesigned How It Works experience.
- Git also drifted: `origin/main` did not contain the later storefront snapshot on `origin/snapshot/live-theme-2026-08-31`, even though both share a common ancestor. Publishing from either lineage alone can therefore regress the other.
- Emergency restoration had completed before this recovery resumed: `basenotes/main` (`158692901082`) was live and the two September QA themes were unpublished. The verified integrated release below now supersedes that emergency restoration.
- The helper product `extra-5ml-vial-add-on` was public and indexable. Its product data exposed a standalone price and a different first-order selling-plan price while `requires_selling_plan` remained false. That made the standalone PDP misleading and potentially purchasable outside its intended subscriber flow.
- A post-restore 390px screenshot clipped several right edges because macOS headless Chrome produced a 390px bitmap from a 500px CSS viewport. Correct CDP device emulation measured the named announcement, hero, and consent elements inside 390px. It did reveal one genuine overflow: the delivery-section CTA reached 405.5px because global large-button padding plus no-wrap text exceeded its container.
- PR #47 is intentionally excluded. Its separate remediation passed eight tests and was pushed to that PR, but deployment still requires a dedicated $18-initial/$18-recurring plan and the exact configured plan ID.

## User requirements

1. Visitors see the newest Base Note homepage and current merchant-configured content.
2. Product pages show the actual Judge.me rating/count, with legacy data only as fallback.
3. The homepage can show eight featured fragrances.
4. PDP delivery copy says `1-3 business days`, consistent with the current shipping FAQ.
5. The retailer-bestsellers template remains available without forcing an unconfigured public page.
6. The internal add-on HTML route is non-indexable and cannot submit a standalone purchase while its Shopify/Appstle configuration is unresolved; ordinary product JSON remains available to internal integrations.
7. At 390px and narrower, announcement, header, hero actions, delivery CTA, and consent UI stay inside the CSS viewport without hiding overflow on `body` or `html`.
8. The current live theme remains available for immediate rollback until post-publish verification passes.

## Recovery scope

The candidate starts from `origin/main`, then incorporates:

- the seven theme-file changes preserved by the 2026-08-31 storefront snapshot;
- the current `basenotes/main` merchant state for the hero asset and shipping/anniversary FAQ content;
- PR #42: Judge.me badge/count integration with legacy fallback;
- PR #43: retailer-bestsellers section and page template;
- PR #44: eight homepage featured fragrances;
- PR #45: 1-3 business-day PDP delivery copy;
- a handle-scoped add-on guard: `noindex, follow`, neutral social metadata, no Product offer JSON-LD, no purchase form or sticky CTA, and a disabled subscriber-only notice with no price promise;
- disable the legacy one-time cart upsell while the recurring add-on plan is unconfigured; exclude the helper from shared product cards, account selectors, quiz recommendations, and base-subscription swap identification;
- component-scoped narrow-screen constraints for header, hero, featured/delivery CTAs, cookie banner, and cookie preferences modal.
- scope placeholder image styles to placeholder cards so actual secondary product images retain absolute positioning; wrap narrow product vendor/concentration labels instead of clipping them.
- respect authored article SEO titles and descriptions, including the reconciled vanilla guide, without replacing the title with the longer editorial heading or truncating the authored description.

Out of scope: PR #47; changing add-on prices or selling plans; Appstle contract migration; disabling the add-on variant at the Shopify backend; blog publication; and deleting any Shopify theme.

## Source-of-truth invariant

1. `main` is the sole release lineage for production theme code.
2. Before each release, pull the current canonical Shopify theme and reconcile merchant-editor changes into the release branch. Never overwrite unreviewed `config/settings_data.json` or JSON-template settings.
3. Publish only an unpublished candidate built from a reviewed commit on that lineage. A QA-named, feature, or local-development theme can never be selected for production.
4. Record the Git commit, candidate theme ID, prior live theme ID, approver, and smoke-test result in the release ticket.
5. Do not delete the prior good live theme until a later release passes observation and rollback is no longer needed.

## Acceptance tests

- [x] `git diff --check` passes locally.
- [x] `sh scripts/check-theme-recovery-static.sh` proves the add-on metadata/UI guards and responsive invariants are present.
- [x] `shopify theme check` matches the pulled canonical theme at 33 errors and 79 warnings across 38 files, with zero offense-signature differences and no new offense in a changed file.
- [x] Candidate remains unpublished during QA; PR #47 behavior and price-comparison UI are absent.
- [x] Desktop and mobile homepage show the latest hero, founding-member band, redesigned How It Works section, and eight featured fragrance cards.
- [x] A normal subscription PDP displays `Ships within 1-3 business days`, retains its product form and selling plan, and adds the correct subscription line to an anonymous cart. Authenticated queue operations were not mutated in this release QA.
- [ ] A product with Judge.me reviews shows its canonical rating/count on PDP and collection card; a product without reviews leaves the badge hidden.
- [ ] `page.bestsellers` renders a selected collection, falls back to the `bestsellers` handle, and presents an accessible empty state if neither is populated.
- [x] `/products/extra-5ml-vial-add-on` emits `noindex, follow`, neutral meta/OG copy, no OG price or Product offer JSON-LD, no product form, no Appstle container, no sticky purchase CTA, and only the disabled subscriber-only notice.
- [x] A representative ordinary PDP still emits Product offer JSON-LD and a working product form.
- [x] A subscription cart has no legacy one-time add-on picker, and search for the internal helper exposes no quick-add control.
- [x] Four executed base-line selection tests prove helper line ordering, helper-only carts, and ordinary one-time lines cannot replace the base subscription.
- [x] `/products/extra-5ml-vial-add-on.js` remains readable; the backend product still reports available and requires_selling_plan=false, so the Admin/Appstle gate remains.
- [x] With candidate CSS injected into a disposable browser session at true 320px and 390px viewports, document/body scroll widths equal their viewport widths and no right-overflowing element remains.
- [x] The same injected-CSS check at 1440px has no right-overflowing element and retains the desktop header, CTA, and consent layouts.
- [x] Candidate-preview smoke tests pass for home, `/collections/fragrances`, `/pages/bestsellers`, representative ordinary PDP, guarded add-on PDP, cart, both search queries, customer-account login, Journal, and vanilla article.
- [x] The vanilla guide preserves its authored SEO title and full description in the candidate HTML, and its canonical points to the public article URL.
- [x] After publish, all eleven public routes return 200 on the intended live theme; independent desktop/mobile image, navigation, and anonymous subscription-cart checks pass.

## Release and rollback

1. Treat current live `basenotes/main` (`158692901082`) as the known-good rollback theme. Keep it untouched while the integrated candidate is tested.
2. Preserve `Jeff fixes Sep 3 QA` (`163971432666`) as the retained secondary rollback/reference theme and keep `Jeff requests Sep 4 QA` (`163992469722`) unpublished. The primary rollback remains `158692901082`, which preserves the latest approved visual storefront.
3. After review, push this branch to a new unpublished Shopify theme, record its ID, and complete the preview acceptance suite.
4. Publish only the recorded candidate ID. Immediately verify the homepage, guarded add-on route, one ordinary PDP, cart, and subscription path.
5. If checkout, subscription, navigation, responsive layout, or rendering regresses, immediately republish `158692901082`, capture the failing URL and timestamp, and continue diagnosis offline.
6. Reconcile and merge the approved recovery commit into `main` so Git and Shopify describe the same storefront before any later theme work begins.

## Residual risks and follow-up

- The theme guard blocks the standalone HTML purchase interface, but it does not secure backend cart endpoints. A crafted POST can remain possible until Shopify/Appstle makes the helper product unavailable outside the intended contract and enforces the correct selling plan server-side.
- `noindex` is a crawl directive, not access control. Search engines may take time to remove a previously indexed URL.
- The screenshot harness must set the CSS viewport through CDP or an equivalent browser-emulation API; bitmap dimensions alone are not proof of responsive layout.
- Merchant-editor changes after this snapshot must be reconciled again before candidate upload.

## September 6 pre-upload verification

- Shopify theme listing still identifies `158692901082` as live, with `163971432666` and `163992469722` unpublished. No recovery candidate or recovery PR existed when checked.
- A fresh pull into `/private/tmp/basenote-live-recheck-BgNR23` matches the candidate's `config/settings_data.json` exactly. The homepage JSON differs only by the intended four-to-eight featured-card change. The collection JSON differs only by Shopify's generated comment header.
- Fresh canonical and recovery Theme Check runs both report 33 errors and 79 warnings across 38 files. All 112 normalized file/check/severity/message signatures match; there are no new lint offenses. These inherited lint issues remain a separate maintenance task.
- Static add-on/overflow/article-SEO guards and `git diff --check` pass. Browser verification uses isolated Playwright contexts with true 1440px, 390px, and 320px CSS viewports.

## Candidate QA findings addressed

- Created unpublished theme `164045029594` from code commit `7eed63468d765e074f067da589c0c1f8b76296d9`; PR: https://github.com/wilsonwu-ai/basenotes/pull/48. Subsequent containment fixes are tracked in the same PR and candidate.
- An initial desktop collection request returned Shopify HTTP 500 directly after upload. Immediate independent candidate/live HTTP checks and the next desktop/mobile browser run returned 200; the initial failure remains in the raw QA log.
- A timed promotional overlay intercepted the first cookie-dismissal harness attempt. The corrected harness closes that existing overlay before consent/menu interactions. Lazy-image screenshots must use instant `scrollIntoView` and await image decoding because CSS smooth scrolling defeated the initial rapid scrolling loop.
- Subscription UI addition verified variant `47739099283674` with plan `26547585242`, one cart line totaling 1500 cents, first allocation 1500, comparison and second allocation 2000.
- That cart exposed an inherited one-time upsell contradicting the required recurring add-on behavior. The cart render call is now removed pending the correct dedicated plan. A read-only reachability audit also found helper entry points through search cards, account fragrance selectors and quiz catalog data; each source is now excluded.
- Existing legacy helper lines are explicitly ignored when choosing a swappable base subscription. Four node tests execute the actual selection block with base/helper ordering, helper-only, and one-time fixtures.
- Vanilla article metadata matches the authored SEO fields. Independent browser QA confirms its mobile comparison table has a functional horizontal scroll container (`overflow-x: auto`) while document width remains 390px.

## Final preview verification

- Candidate theme: `164045029594`, preview https://basenotescent.com/?preview_theme_id=164045029594. Theme code commit: `14fb05ab2213ed19f9e2760afcba1baa741e2474`. Final evidence is from the updated candidate, superseding the initial upload/harness findings above.
- **26/26 route/viewport checks return HTTP 200 and identify the candidate theme**, with no page JavaScript errors, Liquid errors, detected broken images, or document-width overflow. Eleven routes are covered at 1440px and 390px; homepage, collection, ordinary PDP, and guarded helper PDP are also covered at 320px.
- Mobile cookie preferences open without overflow; navigation opens visibly and closes fully. Homepage dimensions remain equal to viewport width with root overflow masking disabled at all three widths.
- All 11 featured image elements across eight cards decode at each tested width. Secondary images retain absolute positioning; no card image remains blank in the final screenshots.
- Final anonymous UI subscription addition yields one line at 1500 cents, comparison 2000 cents and subsequent allocation 2000 cents. The rendered cart has **zero legacy add-on controls**. Search for `extra` has zero helper quick-add controls.
- `node --test scripts/test-theme-addon-containment.cjs`: **4/4 pass**. Static guard script and `git diff --check`: pass. Final Theme Check retains exactly the canonical 112 offense signatures (33 existing errors, 79 warnings).
- Final prepublication merchant check at 2026-09-06 14:59Z (`/private/tmp/basenote-prepublish-merchant-BWNH31`) confirms `config/settings_data.json` and `sections/header-group.json` match the candidate byte-for-byte; homepage JSON differs only by the intended four-to-eight featured-card value.
- Raw final browser report and screenshots: `/private/tmp/basenote-recovery-final-qa-20260906/`. Independent article browser evidence: `/private/tmp/basenote-article-browser-qa-20260906/`. Final lint evidence: `/private/tmp/basenote-recovery-lint-contained.json`, compared against `/private/tmp/basenote-live-recheck-lint.json`.
- QA limits: anonymous account/login was checked; authenticated contract operations were not changed or exercised. The retailer-bestsellers template is available, and the existing public page passes smoke QA; no Admin page-template assignment or collection setup was changed. A positive-review fragrance fixture remains to be identified; the checked ordinary PDP with no rating correctly renders no review badge.

## Publication record

- The release operator published the recorded candidate `164045029594` after independent preview and merchant-drift verification. Immediate Shopify readback confirms it is live; primary rollback `158692901082` and retained secondary rollback `163971432666` remain unpublished and intact. No theme was deleted.
- The public vanilla article now exposes its exact authored title and description. Public crawler and sitemap checks were repeated after publication by the content/release operator.
- Independent postpublication evidence at `/private/tmp/basenote-release-verified-20260906/report.json` confirms **11/11 routes return HTTP 200 with theme 164045029594 and role main**: home, fragrances collection, bestsellers, ordinary PDP, guarded add-on PDP, cart, account/login, two searches, Journal, and vanilla article. No Liquid error was detected.
- Independent live browser checks at 1440px and 390px verify eight featured cards with all eight primary images loaded and visible, document widths matching their viewports, and working mobile navigation. A fresh anonymous UI subscription cart has one line totaling **$15**, a **$20** comparison and subsequent allocation, and zero legacy add-on controls. No checkout order was placed.
- Final live vanilla browser/OAI-SearchBot requests return 200 with the authored title, full description, canonical, hero and Article JSON-LD. The vanilla route is in the sitemap; the gym route remains 404 and absent from the sitemap until its verified December 28 schedule. Article creation, image generation, and Media Worker deployment were not repeated.
- Read-only `?view=bestsellers` rendering also confirms the included retailer template presents its labeled empty state when no collection is configured; no page-template assignment was changed. Its populated-collection state and a positive-rating review fixture remain unexercised because those live fixtures were unavailable.
- Fresh Admin access-scope evidence confirms `write_products` and `read_customers` are absent. The product UNLISTED/configuration gate remains; the requested aggregate customer-queue report cannot retrieve its input. No customer information or private-message content is included in this repository.
- Root worktree protection was verified after release: its tracked diff SHA-256 remained `0ac9fc9ade199d43057490acbe7502dd297a14cde81147edfeded310d37aea4e`, with 421 pre-existing untracked files. All implementation and release records stayed in the isolated worktrees.

## Success signals

- No recurrence of an older homepage after deploy or theme-editor activity.
- Zero checkout or subscription regressions in post-publish smoke tests.
- The helper add-on cannot be bought through its HTML route and disappears from search indexes after recrawl.
- No horizontal clipping at the tested narrow viewport, with root overflow masking unnecessary.
- Every production release maps one live Shopify theme ID to one reviewed Git commit.
