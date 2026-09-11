# Cart feedback, introductory offer, and coastal fragrance ad

## Execution graph

GOAL: Give immediate trustworthy add-to-cart feedback, evaluate a real first-customer $18 vial offer, and create a Base Note fragrance commercial from the supplied beauty/coastal references.
FAN OUT: Commerce feedback implementation; read-only first-order discount feasibility; bounded video-production capability/asset audit. Root owns reference viewing, creative direction, integration, QA, publishing and handoff.
CONTRACT: Each worker returns exact findings/source paths, tests or observed evidence, changes and unresolved dependencies. No worker publishes, changes production discounts, places orders or submits customer data.
ANCHOR: Current public theme 164193468634, current shared commerce code, actual Shopify settings where authorized, the user's copied prompts and supplied public reference video, existing Base Note vial model/photos.
VERIFY: Root independently exercises actual preview/public cart additions on desktop/mobile; no success UI before confirmed API response. Price copy cannot outrun checkout enforcement. Inspect all generated creative outputs before delivery.
REDUCE: Keep feedback fix separate from any blocked discount or video provider dependency. Do not change the praised homepage composition.
CAP: Root + 3 existing workers, no nested agents, one implementation pass and one QA correction pass initially. Estimated aggregate planning effort 12–20k tokens, not a user budget or usage claim. Same inherited model/reasoning. Max fan-in 3.
HUMAN GATE: Standing user authorization covers implementation, scoped commits/push and tested Shopify publication. No new paid provider purchase, campaign publication, customer messages or orders. Workers cannot deploy. No GitHub protection bypass.
FROZEN: Jeff's banner/photos, homepage composition, actual scent identity, ordinary $20/$18 cart logic until a real introductory discount is verified, Monthly Rotation consent/renewal pricing, no invented customer eligibility, no false fragrance/health/retailer claims, original clearly adult fictional model, no real-person impersonation.

The cart fix does not read the video or discount audit: those are independent. Publishing reads successful QA: that is a real dependency. Source writes do not overlap: commerce worker owns toast/feedback code and its tests; other workers are read-only; root owns this plan, creative files and release evidence. With p≈0.75 and N=3 the estimated speedup is 2.0×, theoretical ceiling 4.0×; no measured runtime improvement is claimed.

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
- Prior live theme **164193468634** remains available for rollback. New theme **164195827930** is publication candidate; public verification is recorded below once complete.

## Other branch outcomes

The first-ever $18 introductory offer is not implemented or advertised: current $18 pricing is for additional cart vials. New-customer history qualification and authorized Shopify discount access must be resolved before price copy changes. See the separate first-ever-offer findings.

The coastal ad has an adapted prompt and two generated, inspected reference stills. One Seedance 2.5 request was queued but its result was rejected under the provider's people/likeness restriction. No finished video exists; no alternate-provider bypass, repeat generation, top-up or campaign publication was attempted. See `creative/coastal-scent-20260910/README.md` and its saved receipt.
