# Base Note storefront execution · September 10, 2026

**Latest release:** The subsequent [Fragrances reference correction](fragrance-reference-correction-20260910.md) is published as theme `164193468634`, source `440fa69`. It supersedes the collection styling and theme identity in the historical release notes below. The corrected public collection, commerce and preserved homepage all passed verification; PR #56 remains pending GitHub's recorded approving review.

## Dependency graph

| Step | Reads prior output? | Verdict |
|---|---|---|
| Audit PDF → current finding verification | Yes, audit claims | Real edge |
| Artifact review → product/cart changes | Yes, visual references | Real edge |
| Audit verification → video analysis | No | Independent |
| Video/reference analysis → 3D vial | Yes, interaction/physical reference | Real edge |
| Marketing fixes → product/cart changes | No; separate files | Independent |
| All implementations → integrated browser QA | Yes | Real edge |
| QA → merge/publish → public verification | Yes | Real edge |

GRAPH SPEC
GOAL: Implement the three Claude page references, resolve the Downloads audit, and build an interactive 3D Base Note vial homepage with three clear purchase paths.
FAN OUT: Audit/marketing, product/cart, 3D viewer; root owns homepage, collection mapping, shared shell, integration.
CONTRACT: Each worker returns changed files, evidence/finding IDs, tests, unresolved dependencies; no production writes or merges by workers.
ANCHOR: Downloads/Base Note Search Audit.pdf, current public HTML/Shopify data, three supplied Claude artifacts, supplied video, existing vial photos.
VERIFY: Root browser QA and commerce tests; workers independently review integrated surfaces outside their own ownership.
REDUCE: Deduplicate audit findings by URL + behavior, retain evidence-backed changes, classify fixed/already-fixed/external dependency.
CAP: 3 workers + root; one implementation round and one correction round initially; <= 35 audit findings; no nested fan-out. Same inherited model/reasoning. Planning estimate 35–55k aggregate tokens, not a hard session budget.
REPORT: User summary, PR/deployment, screenshots, full audit resolution ledger; returned/sent and graph retrospective.
HUMAN GATE: User has authorized implementation, merging, and deployment. Root alone can publish after QA. No email, messages, purchases, or advertising spend.
FROZEN: Preserve Jeff's new gLmqu.jpg banner and existing product assets; no fake reviews/ratings/stock/savings; accurate prices from Shopify; no substitution of customer cart products without traceable selected scent; no nonexistent full bottle price; progressive enhancement and reduced motion.

Estimated parallel fraction p=.75, N=3; Amdahl speedup S=2.0, ceiling=4.0. Maximum fan-in=3. Shared writes are prohibited until integration: audit owns metadata/schema/SEO and report; commerce owns main-product/cart/shared commerce module; 3D owns new viewer module/section/assets; root owns homepage/collection/header/footer/layout glue. Root arbitrates file overlap before editing.

## Design brief

Purpose: let a new fragrance shopper choose an authentic one-time 5ml vial quickly; optional monthly discovery and full bottles remain clear alternatives.
Tone: luxury restraint, anchored in Jeff's Playfair/EB Garamond/Jost cream #f4efe3 and green #22392b artifacts.
Differentiator: a tactile clear-glass Base Note atomizer with polished silver cap, full camera orbit and cap separation, with real fragrance/price selection.
Composition: homepage copy and 3D viewer share the first viewport; three purchase paths follow as a compact numbered editorial row. Jeff's floating-vial image stays as a separate full-width campaign story. Fragrance collection uses the provided sparse centered catalog mockup, product/cart use the other two artifacts.
Constraints: preserve photos; don't reuse fabricated 4.8/1240 review figures; no invented full-bottle stock/prices; real selling plans; one-time first; deliberate lazy WebGL with static fallback; accessible camera controls and reduced motion. Existing references dictate the design, so new bitmap concept generation is unnecessary.

## Execution and verification handoff

The implementation ran in `/private/tmp/basenote-scent-studio-20260910` on `feat/scent-studio-audit-20260910`, branched from `81f13f9`. The original Desktop worktree was dirty and was not overwritten. Live theme configuration was independently pulled to `/private/tmp/basenote-live-preserve-20260910`; global settings and the merchant's header/footer group settings remain unchanged. Jeff's `gLmqu.jpg` is explicitly retained on the homepage, and existing product media was not replaced or reordered.

Three core workers returned usable implementations; all three were retained. Root integrated four storefront surfaces, two purchase landing templates, navigation and newsletter changes. Follow-up review caught real issues: sticky-header double spacing, mobile banner cropping, misleading original-bottle imagery, and Shopify automatic discounts changing cart line keys during price normalization. The real Cart API test—not a mock-only check—caught the line-key problem before release.

Validation completed before the deployment gate:

- 21 shared-commerce behavioral tests, 3 order-surface/FAQ guard tests, and the shared-header controller regression pass (25 Node tests total).
- Both current artifact-fidelity and recovery-invariant checks pass.
- Full Shopify Theme Check: zero errors; existing advisory warnings are not represented as a zero-warning result.
- Real Shopify Ajax API, fresh isolated cart: $20 first vial; $18 additional; $38 total; removing the anchor restores the remaining scent to $20; actual $15 first/$20 renewal Monthly Rotation plan retained; extras remain $18 one-time; quantity three totals $56. No checkout or order was submitted.
- Local actual-Liquid projections at desktop/mobile widths: homepage, collection, product and cart inspected, no horizontal overflow or JavaScript errors. WebGL orbit, cap, fragrance label changes, 32 real fragrance choices, touch scroll, reduced motion and photo fallback pass. These are **not** a substitute for an unpublished Shopify theme's final rendered-page checks.
- Audit content changes independently read back live: two redirects, article link repairs, two purchase pages, two primary-source researched comparison articles. Recovery snapshots and all 29 audit statuses are recorded in `docs/audit-resolution-20260910.md`.

### Restored deployment access and actual preview

The user completed the Shopify device login. The unpublished theme `164192813274` (Scent Studio Sep 10 QA) was uploaded successfully. The installed CLI 3.89.0 then returned HTTP 401 again; a task-local invocation of official CLI 4.8.0 against `ath7ay-1y.myshopify.com` successfully listed, pulled and pushed repeatedly. No global CLI replacement, credential extraction, scope bypass or unrelated background-process termination was performed. A fresh live configuration capture at `/private/tmp/basenote-release-preserve-jVZLhc` exactly matches the earlier preservation snapshot.

Real Shopify preview testing—not local projections—found and corrected: an in-flight price quote after selecting an unavailable bottle; two mobile navigation controllers leaving an invisible overlay; legacy scrolled-header background overriding the green header; divergent FAQ/product search and social descriptions; and an implicit cart-pricing loading window that could ignore a premature remove click. Cart mutation controls now disable visibly while prices are checked, with status and ARIA busy state. The corrected preview passes the SEO verifier, including 16 exact FAQ answers and three agent/LLM endpoints. An independent read-only sweep passed all 32 ordinary product pages. Monthly Rotation, bottle enquiry and FAQ pages pass desktop/mobile route, native newsletter validation and scrolled-header contrast checks without any customer-data submission. CLI 4.8.0 Theme Check reports zero errors and 108 warnings; this is not a zero-warning claim.

Durable browser runners now live in `scripts/test-vial-studio-browser.cjs`, `scripts/verify-scent-studio-commerce-preview.cjs`, and `scripts/test-purchase-routes-browser.cjs`. They distinguish unpublished theme identity, isolate any cart changes, and never place an order or submit customer/newsletter data. Final actual-preview commerce checks pass: mixed Aventus/Green Irish Tweed $20+$18 cart, remaining original scent restored to $20, real $15 first/$20 renewal subscription, unchecked consent blocking purchase, native no-JavaScript add, no mobile overflow and zero browser errors. The release is ready for root to merge PR #56 and publish the tested theme; public verification must still run afterward without preview parameters. Viewer and commerce runners have an explicit `--live` mode that additionally asserts the published theme role.

### Publication and source-control handoff

Theme `164192813274` is now **published** at https://basenotescent.com. The tested theme source is commit `622bcd0dc2f70cfc9a0c0e8b1c117ebf42c57690`, pushed to PR #56. Shopify confirms role `main`; public homepage HTML contains the new vial studio and Jeff's `gLmqu.jpg`, not the retired `hero-atomizer.png`. Previous theme `164190748890` remains available unpublished for rollback.

Post-publication checks ran with fresh browser contexts and **no preview parameters**. Public commerce passed the mixed-scent $20/$18 path, base-removal repricing, actual subscription plan/renewal consent, native no-JavaScript add and mobile overflow/console checks. Public viewer tests asserted theme identity and `main` role on desktop/mobile home and collection; orbit, cap, selection, reduced motion, photo fallback, menu/search focus, contrast and filters all passed. Public SEO verification passed, and an independent public sweep validated all 32 fragrance pages. Purchase routes and native newsletter/enquiry validation passed without sending customer data. No orders were submitted; isolated test carts were cleared.

**PR #56 remains OPEN, not merged.** GitHub rejected the normal merge because `main` requires one approving review; auto-merge is disabled for the repository. No protection settings or administrator bypass were used. The release is live and its exact source is saved in the PR, but source integration needs that review and a subsequent normal merge. No unrelated PRs were merged.

Catalog audit rows still need actual `read_products`/`write_products` access. `scripts/apply-catalog-metadata.cjs` is a read-only plan unless explicitly run with `--apply`; it backs up affected records, excludes internal helper/zero-price items and protects prices/inventory/images/plans. Full-bottle checkout additionally needs real bottle sizes, prices and inventory. GSC reporting needs an authenticated property connection.

### Graph retrospective

The planned three-way fan-out was useful because imagery/interaction, commerce and audit work consumed different inputs and files. All core branches returned (3/3); integration retained each (3/3), and all three independently verified their published surfaces. The critical path moved from Shopify authentication to integrated browser corrections, then to the GitHub review requirement for source merging. Real backend verification and a separate visual reviewer were necessary verification edges; requiring one worker to wait for another's unrelated implementation would have been a false edge. The 2.0× speedup was a planning estimate only; actual serial baseline, aggregate agent token usage and attributable speedup were not measured, so no realized cost or speedup claim is made.
