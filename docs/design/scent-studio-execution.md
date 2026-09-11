# Base Note storefront execution · September 10, 2026

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

- 19 shared-commerce behavioral tests and 3 order-surface/FAQ guard tests pass.
- Both current artifact-fidelity and recovery-invariant checks pass.
- Full Shopify Theme Check: zero errors; existing advisory warnings are not represented as a zero-warning result.
- Real Shopify Ajax API, fresh isolated cart: $20 first vial; $18 additional; $38 total; removing the anchor restores the remaining scent to $20; actual $15 first/$20 renewal Monthly Rotation plan retained; extras remain $18 one-time; quantity three totals $56. No checkout or order was submitted.
- Local actual-Liquid projections at desktop/mobile widths: homepage, collection, product and cart inspected, no horizontal overflow or JavaScript errors. WebGL orbit, cap, fragrance label changes, 32 real fragrance choices, touch scroll, reduced motion and photo fallback pass. These are **not** a substitute for an unpublished Shopify theme's final rendered-page checks.
- Audit content changes independently read back live: two redirects, article link repairs, two purchase pages, two primary-source researched comparison articles. Recovery snapshots and all 29 audit statuses are recorded in `docs/audit-resolution-20260910.md`.

### Deployment gate

The new theme has **not** been published or merged. The existing live theme remains `164190748890` (Claude Artifact Fidelity Sep 10 QA). The CLI successfully pulled a preservation snapshot earlier in this session, then requested a fresh device login for the upload. The canonical store alias also returned HTTP 401 `Service is not valid for authentication`. Selecting the existing CLI account did not restore store access. A device login was provided to the user while QA continued; no saved credentials or auth scopes were altered to bypass that requirement.

After authentication is restored:

1. Upload the branch as an unpublished theme. Keep live settings and `gLmqu.jpg` intact.
2. Run `node scripts/verify-storefront-seo.cjs --theme=THEME_ID`, and the actual rendered desktop/mobile commerce, viewer, navigation, newsletter validation checks. Temporary browser runners: `/private/tmp/basenote-preview-visual-qa.cjs` and `/private/tmp/basenote-scent-studio-commerce-qa.cjs`.
3. Only after those pass, mark the PR ready, merge, publish the tested theme, and rerun public URL/schema/cart sanity checks without preview parameters.
4. Catalog audit rows need actual `read_products`/`write_products` access. `scripts/apply-catalog-metadata.cjs` is a read-only plan unless explicitly run with `--apply`; it backs up affected records, excludes internal helper/zero-price items and protects prices/inventory/images/plans. Full-bottle checkout additionally needs real bottle sizes, prices and inventory. GSC reporting needs an authenticated property connection.

### Graph retrospective

The planned three-way fan-out was useful because imagery/interaction, commerce and audit work consumed different inputs and files. All core branches returned (3/3); integration retained each (3/3). The critical path ultimately became external Shopify authentication, not agent compute. Real backend verification and a separate visual reviewer were necessary verification edges; requiring one worker to wait for another's unrelated implementation would have been a false edge. The 2.0× speedup was a planning estimate only; actual serial baseline, aggregate agent token usage and attributable speedup were not measured, so no realized cost or speedup claim is made.
