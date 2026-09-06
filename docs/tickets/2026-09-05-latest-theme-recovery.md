# PRD: Latest Theme Recovery and Release Guardrail

**Status:** Recovery candidate ready for QA
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
- Emergency restoration is complete: as of 2026-09-06, Shopify reports `basenotes/main` (`158692901082`) as live and the two September QA themes as unpublished.
- The helper product `extra-5ml-vial-add-on` was public and indexable. Its product data exposed a standalone price and a different first-order selling-plan price while `requires_selling_plan` remained false. That made the standalone PDP misleading and potentially purchasable outside its intended subscriber flow.
- A post-restore 390px screenshot clipped several right edges because macOS headless Chrome produced a 390px bitmap from a 500px CSS viewport. Correct CDP device emulation measured the named announcement, hero, and consent elements inside 390px. It did reveal one genuine overflow: the delivery-section CTA reached 405.5px because global large-button padding plus no-wrap text exceeded its container.
- PR #47 is intentionally excluded. Its add-on assumptions conflict with the current commerce configuration, and its comparison UI has unresolved accessibility QA.

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
- component-scoped narrow-screen constraints for header, hero, featured/delivery CTAs, cookie banner, and cookie preferences modal.
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
- [ ] Candidate remains unpublished during QA; PR #47 behavior and price-comparison UI are absent.
- [ ] Desktop and mobile homepage show the latest hero, founding-member band, redesigned How It Works section, and up to eight featured fragrance cards.
- [ ] A normal subscription PDP displays `Ships within 1-3 business days` and retains working variant, selling-plan, add-to-cart, and queue behavior.
- [ ] A product with Judge.me reviews shows its canonical rating/count on PDP and collection card; a product without reviews leaves the badge hidden.
- [ ] `page.bestsellers` renders a selected collection, falls back to the `bestsellers` handle, and presents an accessible empty state if neither is populated.
- [ ] `/products/extra-5ml-vial-add-on` emits `noindex, follow`, neutral meta/OG copy, no OG price or Product offer JSON-LD, no product form, no Appstle container, no sticky purchase CTA, and only the disabled subscriber-only notice.
- [ ] A representative ordinary PDP still emits Product offer JSON-LD and a working product form.
- [ ] `/products/extra-5ml-vial-add-on.js` or the equivalent internal product JSON endpoint remains readable by the integration that needs it.
- [x] With candidate CSS injected into a disposable browser session at true 320px and 390px viewports, document/body scroll widths equal their viewport widths and no right-overflowing element remains.
- [x] The same injected-CSS check at 1440px has no right-overflowing element and retains the desktop header, CTA, and consent layouts.
- [ ] Candidate-preview smoke tests pass for home, `/collections/fragrances`, `/pages/bestsellers`, representative ordinary PDP, guarded add-on PDP, cart, search, and customer account.
- [ ] The vanilla guide preserves its authored SEO title and full description in the candidate HTML, and its canonical points to the public article URL.
- [ ] After publish, the same smoke suite passes on the public domain and Shopify reports the intended candidate ID as live.

## Release and rollback

1. Treat current live `basenotes/main` (`158692901082`) as the known-good rollback theme. Keep it untouched while the integrated candidate is tested.
2. Keep `Jeff fixes Sep 3 QA` (`163971432666`) and `Jeff requests Sep 4 QA` (`163992469722`) unpublished; neither is a rollback target.
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

## Success signals

- No recurrence of an older homepage after deploy or theme-editor activity.
- Zero checkout or subscription regressions in post-publish smoke tests.
- The helper add-on cannot be bought through its HTML route and disappears from search indexes after recrawl.
- No horizontal clipping at the tested narrow viewport, with root overflow masking unnecessary.
- Every production release maps one live Shopify theme ID to one reviewed Git commit.
