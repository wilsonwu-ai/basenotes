# Cart feedback, introductory offer, and coastal fragrance ad

## Execution graph

GOAL: Give immediate trustworthy add-to-cart feedback, evaluate a real first-customer $18 vial offer, and create a Base Note fragrance commercial from the supplied beauty/coastal references.
FAN OUT: Commerce feedback implementation; read-only first-order discount feasibility; bounded video-production capability/asset audit. Root owns reference viewing, creative direction, integration, QA, publishing and handoff.
CONTRACT: Each worker returns exact findings/source paths, tests or observed evidence, changes and unresolved dependencies. No worker publishes, changes production discounts, places orders or submits customer data.
ANCHOR: Current public theme 164193468634, current shared commerce code, actual Shopify settings where authorized, the user's copied prompts and supplied public reference video, existing Base Note vial model/photos.
VERIFY: Root independently exercises actual preview/public cart additions on desktop/mobile; no success UI before confirmed API response. Price copy cannot outrun checkout enforcement. Inspect all generated creative outputs before delivery.
REDUCE: Keep feedback fix separate from any blocked discount or video provider dependency. Do not change the praised homepage composition.
CAP: Root + 3 existing workers, no nested agents, one implementation pass and one QA correction pass initially. Estimated aggregate planning effort 12–20k tokens, not a user budget or usage claim. Same inherited model/reasoning. Max fan-in 3.
REPORT: Live cart result, separate pricing/video dependencies, linked creative deliverables, exact verification and returned-versus-sent worker contract count.
HUMAN GATE: Standing user authorization covers implementation, scoped commits/push and tested Shopify publication. One bounded normal video-generation request uses the existing Base Note provider configuration; no new provider subscription or credit purchase, campaign publication, customer messages or orders. Workers cannot deploy. No GitHub protection bypass.
FROZEN: Jeff's banner/photos, homepage composition, actual scent identity, ordinary $20/$18 cart logic until a real introductory discount is verified, Monthly Rotation consent/renewal pricing, no invented customer eligibility, no false fragrance/health/retailer claims, original clearly adult fictional model, no real-person impersonation.

The cart fix does not read the video or discount audit: those are independent. Publishing reads successful QA: that is a real dependency. Source writes do not overlap: commerce worker owns toast/feedback code and its tests; other workers are read-only; root owns this plan, creative files and release evidence. With p≈0.75 and N=3 the estimated speedup is 2.0×, theoretical ceiling 4.0×; no measured runtime improvement is claimed.

| Apparent sequence | Reads prior output? | Dependency verdict / separate write targets |
| --- | --- | --- |
| Cart feedback → first-ever pricing audit | No | Fake edge: feedback source/tests versus read-only pricing findings and its dedicated doc |
| Pricing audit → ad references | No | Fake edge: pricing findings versus dedicated creative assets; ad omits unverified offer |
| Cart feedback → video generation | No | Fake edge: Shopify UI files versus one provider job/creative receipt |
| Actual preview QA → Shopify publication | Yes | Real edge: root alone publishes the exact verified theme |
| Inspected reference images → video submission | Yes | Real edge: root sends the exact generated/inspected assets; workers cannot submit jobs |

The initial video capability worker was subsequently assigned only the two reference stills and `reference-prompts.md` in the creative directory; root kept ownership of `prompt.md`, runner, provider request and receipt. The pricing worker's follow-up wrote only `first-ever-vial-offer-20260910.md`. These explicit ownership changes introduced no shared-file writers.

## Design brief

Cart: restrained ivory/forest-green confirmation, scent name, quantity, View cart link and close button; visible near the viewport without forcing navigation or stealing keyboard focus. Confirm only after Shopify succeeds. Prevent accidental repeated in-flight taps; preserve explicit intentional repeat purchases. Accessible live announcement and reduced motion. Existing brand styling dictates the visual answer; no redesign concept generation is needed for this narrow fix.

Offer: interpret first as a customer's first-ever qualifying one-time purchase, not the first item after every cart reset. Desired display is regular $20 struck through beside $18 introductory price with explicit eligibility. Do not publish that promise until the same eligibility and amount are enforced at checkout.

Ad: product-led luxury fragrance, ivory/champagne/forest-green palette with restrained coastal blue. Preserve the existing clear-glass Base Note spray vial, silver cap/pump, dimensions and label. Use fine atomized fragrance and clear liquid, not milky toner, hydration claims or unrelated skincare ingredients. Original adult woman age 25+, natural dark hair, understated white clothing and unbranded cap; breezy coastal mood, elegant nonsexual wrist-spray interaction. A generated concept is not a real customer testimonial. Target a short vertical social ad, with a 3:4-safe composition.

## Cart release verification

- Existing behavior confirmed: the cart mutation succeeded, but its inline message was below the full grid and easy to miss. A changing header count was insufficient feedback. There was no intentional requirement for the shopper to inspect the cart to discover success.
- Added a global, non-modal ivory/green confirmation for fragrance-card adds. It shows scent name, quantity, View cart and an explicit close button. It persists until dismissed rather than disappearing during reading; opening it does not steal focus.
- Shows success only after the commerce API resolves. All catalog add buttons are disabled during the pending request, with an Adding label. Rejection restores controls and shows an error without retry or native fall-through.
- Root ran 30 passing Node regression tests. Theme Check: zero errors; 92 existing warnings. Preview SEO/offer/canonical/FAQ/LLM checks passed. Root's collection fidelity verification passed at 1440px and 390px, including no legacy left sidebar, exact compact grid contract, filters/search and no page errors.
- Deployed-preview cart verifier passed at 1440×1000 and 390×844 on theme **164195827930**, with no local asset overlays: six rapid taps made one real add at $20; later intentional different-scent add totaled $38 with scent identity preserved. Controlled HTTP 422 produced a visible error and no extra item/retry. View cart navigation, keyboard close/focus restoration, 44px controls, reduced motion and no overflow passed. Only isolated QA carts were cleared; no checkout/order/customer submission.
- Root visually inspected preview confirmation screenshots at `/private/tmp/basenote-feedback-preview-qa/feedback-success-1440.png` and `feedback-success-390.png`.
- `config/settings_data.json`, `templates/index.json`, header group and footer group byte-match the read-only preservation of the previous live theme. Jeff's `gLmqu.jpg` and the praised homepage composition remain intact.
- Prior live theme **164193468634** remains available for rollback. New theme **164195827930** was published successfully after the preview checks; public verification is recorded below.

### Public release

Source commit **6c00af7** was pushed to `feat/scent-studio-audit-20260910` / PR #56, then Shopify theme **164195827930** was published. GitHub PR #56 is still open with `REVIEW_REQUIRED`; Shopify publication is independent of that protected-branch review. No main-branch protection was bypassed.

Root ran `scripts/verify-cart-feedback.cjs 164195827930 --live` against fresh public browser contexts with deployed assets, no preview parameters. Both desktop and mobile verified exact theme ID and `main` role, one confirmed $20 item for six rapid taps, later intentional $18 add and $38 total, visible controlled-error feedback without another item/retry, View cart navigation, focus restoration, 44px targets, no overflow and zero page exceptions. Both isolated carts were cleared. Screenshots are under `/private/tmp/basenote-feedback-live-qa`; the mobile success image was independently inspected.

Public `verify-storefront-seo.cjs` passed metadata, actual offers, canonical/robots, helper containment, all 16 visible/schema FAQ answers and all three agent/LLM endpoints. Public `verify-fragrance-reference.cjs 164195827930 --live` passed desktop/mobile exact-theme identity, compact grid, no legacy sidebar, filter/search and no browser errors.

An independent public `test-vial-studio-browser.cjs 164195827930 --live` pass verified the main theme without preview parameters: Jeff's `gLmqu.jpg` banner on desktop/mobile, reverse/open/reset/drag controls, reduced motion, WebGL-loss fallback, mobile navigation/search focus and Escape cleanup, 10.84:1 scrolled-header contrast, filters/search, no horizontal overflow and zero page exceptions. This preservation run used no `--cart` flag and made no cart/order/form writes. Evidence directory: `/var/folders/yg/qvjnvr693832pkp806w46tc40000gn/T/basenote-vial-browser-TqO0LR`.

## Other branch outcomes

The first-ever $18 introductory offer is not implemented or advertised: current $18 pricing is for additional cart vials. New-customer history qualification and authorized Shopify discount access must be resolved before price copy changes. See the separate first-ever-offer findings.

The coastal ad has an adapted prompt and two generated, inspected reference stills. One Seedance 2.5 request was queued but its result was rejected under the provider's people/likeness restriction. No finished video exists; no alternate-provider bypass, repeat generation, top-up or campaign publication was attempted. See `creative/coastal-scent-20260910/README.md` and its saved receipt.

## Graph retrospective

Metrics below count the three bounded worker output packages, not individual test assertions or the separate provider generation request. All three packages were useful and retained; the rejected video request is explicitly not a delivered package.

```text
RUN RETRO — cart feedback / first-ever offer / coastal ad · 2026-09-10
VERIFIER KILL RATE   0/3 worker packages (0%); provider separately rejected 1/1 video jobs
FAN-OUT EFFICIENCY   3 useful / 3 started (100%)
COMPRESSION RATIO    3 worker packages -> 3 retained outcomes, independently labeled
RETURNED VS SENT     3/3 worker contracts; follow-up checks included within those nodes
COST                 12–20k tokens estimated -> actual unavailable; video ~$9.50 estimate -> invoice unavailable
```

Recommendation: leave the graph unchanged. The cart release completed independently while pricing eligibility/access and video-provider restrictions remained unresolved; adding more workers cannot remove those dependencies.
