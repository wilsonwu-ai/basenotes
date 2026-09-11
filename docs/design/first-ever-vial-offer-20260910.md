# First-ever one-time vial offer · September 10, 2026

**Status: feasibility findings only. The proposed first-ever-customer $18 offer is NOT implemented, configured, checkout-verified, or live.** The existing $18 additional-vial behavior is a different offer and is not evidence of customer-history eligibility. This document does not authorize a pricing or discount mutation.

The user requested a regular $20 price shown struck through with an $18 price for the customer's **very first purchase**. Working interpretation: one eligible 5ml one-time vial in a genuinely new customer's first-ever Base Note order; existing $18 additional vials and Monthly Rotation's $15 initial / $20 renewal pricing stay unchanged. Root has asked whether an account sign-up/sign-in requirement is acceptable. **No answer was available when this document was written.** Do not silently make newsletter signup or subscription enrollment a condition.

## Verified current evidence

The public product JSON was read again at **2026-09-10 23:08 EDT / 2026-09-11 03:08 UTC**. Values below are USD merchandise prices, excluding shipping and taxes. No customer, order, or private financial records were fetched.

| Record | Exact observed data | What this proves / does not prove |
| --- | --- | --- |
| [Creed Aventus public product JSON](https://basenotescent.com/products/creed-aventus.js) | Variant `47527167951066`, title `5ml`, price `2000` cents, `compare_at_price: null`, `requires_selling_plan: false` | The native one-time variant is $20 and can be purchased without a subscription. It does not establish any new-customer discount. |
| Aventus Monthly Rotation allocation | Selling plan `26547585242`; first price `1500`, next adjustment `2000`; recurring deliveries; first adjustment applies for one order | The published plan advertises $15 initially and $20 thereafter. This public record does not establish enforcement of prior-subscriber eligibility. |
| [Internal additional-vial public JSON](https://basenotescent.com/products/extra-5ml-vial-add-on.js) | Variant `48547911696602`, price `1800`, compare-at `2000` | This is the existing $18 fulfillment/helper variant, not a first-ever-customer entitlement. Preserve selected-scent identity when it is legitimately used. |
| Helper's legacy selling-plan allocation | Same plan `26547585242`, first price `1350`, next adjustment `1800` | A legacy subscription allocation still exists on the helper. The current theme deliberately rejects helper subscription lines and never selects this allocation. Do not use it for the proposed offer or claim that frontend rejection removes its backend availability. |
| [Current commerce module](../../assets/basenote-commerce.js) | `quoteVial`, `addVial`, and `normalizeCart` inspect native variants, selling plans, and the current cart; the first one-time anchor is $20 and additional units use the $18 helper | There is no customer-order-history lookup in this pricing path. Empty cart, browser storage, cart properties, and helper selection cannot prove a first-ever customer. |
| [Existing core package](../../apps/basenote-core/README.md) and [pricing policy](../../apps/basenote-core/src/pricing/pricing-policy.ts) | Explicitly unconnected staging source; policy covers introductory subscriptions and subscription add-ons | It is not a deployed first-ever one-time discount mechanism. Do not describe its intended backend protections as active. |
| [Older catalog notes](../product-catalog.md) and [rollout notes](../basenote-core/architecture-and-rollout.md) | March 19 catalog notes mention a 10% first-order discount; rollout notes identify a legacy automatic 10%-off / $33-minimum rule | These are historical configuration clues, not current discount readback. Earlier real cart QA observed automatic discounts affecting line keys. Inspect actual active rules and combinations before adding another offer. |
| [Access evidence](../audit-resolution-20260910.md) | Existing Admin installation was verified as `read_content`, `write_content`; product requests returned HTTP 403 for missing `read_products` | Content access and restored Shopify CLI theme authentication do not grant discount/customer access. No new Admin scope check or credential search was performed for this document. |

Earlier public cart testing of the existing theme is recorded in [commerce QA](commerce-qa-20260910.md). It establishes the existing $20 / $18 cart behavior, not the proposed first-ever offer. No order was submitted in that QA.

## Current versus proposed rules

These are merchandise subtotals before shipping, taxes, and any separately verified compatible promotion. The proposed column is a specification, **not a statement of live checkout behavior**.

| Scenario | Current intended storefront rule | Proposed rule |
| --- | --- | --- |
| New customer, one eligible one-time vial | $20 | $18 after authoritative eligibility verification |
| New customer, two eligible one-time vials | $20 + $18 = $38 | $18 + $18 = $36; only $2 of new first-ever benefit |
| New customer, three eligible one-time vials | $20 + $18 + $18 = $56 | $18 + $18 + $18 = $54; never another $2 off each helper |
| Returning customer, one / two one-time vials | $20 / $38 | Unchanged: $20 / $38 |
| Monthly Rotation alone | $15 initial, $20 renewal | Unchanged; no one-time introductory discount on a selling-plan line |
| Monthly Rotation plus one additional vial | $15 + $18 = $33 initially | Unchanged: $33; no extra first-ever reduction on the helper or subscription |
| Full bottle, giveaway, unrelated merchandise | Its own actual product terms | Excluded from this offer; no invented full-bottle price or inventory |

“First-ever” should mean the customer's first Base Note order, not their first vial, first visit, first cart, first device, or first use of a code. A previous bottle or subscription purchase therefore makes the customer ineligible under this interpretation. The treatment of canceled, unpaid, refunded, imported, and test orders must be chosen and tested: a generic zero-order segment must not be represented as a proven “never completed a paid purchase” calculation.

## Eligibility is the main dependency

Shopify's official discount FAQ says customer segments only include existing customer profiles: a genuinely new guest normally has no profile until their first order and therefore is not eligible through that segment before it. A segment such as `number_of_orders = 0` can identify a **known zero-order customer profile**, but does not automatically include every anonymous first-time visitor. See [Shopify discount FAQ](https://help.shopify.com/en/manual/discounts/discounts-faq), [discount eligibility and management](https://help.shopify.com/en/manual/discounts/managing-discounts), and [customer segmentation filters](https://help.shopify.com/en/manual/customers/customer-segmentation/reference-guide/shopify-segments?lang=en).

Consequences:

- Resolve an existing, trustworthy customer identity and its order history before promising the discounted price to that shopper. A new account/profile followed by an eligibility check is a possible route, pending the user's answer about this friction.
- An unknown or null customer is **unknown**, not verified new. Existing buyers can also arrive signed out or change email addresses. A customer-record rule is not a guarantee of one benefit per human across alternate identities.
- Code use limited to once per customer prevents repeated use of that code by a recognized customer; it does **not** independently exclude an established customer who has never used it.
- Account creation and order-history checks must not enable marketing consent. Newsletter enrollment stays optional, separately labeled, and unselected by default. No newsletter submission or customer-data import was performed in this audit.

## Recommended smallest native option

Subject to sign-up/sign-in acceptance and checkout QA, investigate a **$2 fixed amount off eligible products**, once per order, through a discount code restricted to the verified zero-order customer segment, with **one use per customer**. A [Shopify shareable discount link](https://help.shopify.com/en/manual/discounts/managing-discounts) can apply the code without asking the shopper to type it; it does not solve identity or eligibility by itself.

Configure only after exporting the existing affected discount settings for recovery:

1. Use an explicit allowlist of real native $20 / 5ml vial variant IDs, verified from current catalog data. Do not infer eligibility from a browser-supplied product title, cart property, or price alone.
2. Apply to **one-time purchases only**, excluding selling-plan purchases. Exclude helper variant `48547911696602`, bottle variants, bundles, giveaways, and unrelated items.
3. Limit the fixed $2 benefit to once per order, not once per eligible item, and limit the code to once per customer. Pair the code with the history segment; neither condition replaces the other.
4. Inspect current automatic/code discount combinations. Avoid unintended stacking with the legacy rule. Disallowing combination is not a guarantee that Shopify selects this specific offer: the platform can choose a better competing discount.
5. Preserve the native $20 price and existing $18 extra-vial mechanism. Do not globally set the native variant to $18, globally add a fictitious compare-at price, or make every empty cart use the helper.

Primary configuration references: [amount-off discounts](https://help.shopify.com/en/manual/discounts/discount-types/percentage-fixed-amount), [DiscountCodeBasicInput](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/DiscountCodeBasicInput), [DiscountCustomerGetsInput](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/DiscountCustomerGetsInput), [DiscountAmountInput](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/DiscountAmountInput), and [discount combinations](https://help.shopify.com/en/manual/discounts/discount-combinations).

Native constraints that must not be hidden:

- Native automatic discounts now support customer-segment context, but [DiscountAutomaticBasicInput](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/DiscountAutomaticBasicInput) does not have the code input's explicit `appliesOncePerCustomer` field. An automatic segment discount must be separately evaluated for repeat/concurrent checkout behavior; do not assume identical controls.
- A fixed amount with `appliesOnEachItem: false` distributes the total discount across eligible items. The existing frontend normally produces one native anchor plus helpers, but a direct/no-JavaScript cart can contain multiple native units. Native allocation is not necessarily an exact “one unit is $18” line presentation in that cart. A $2 first-order benefit alone does not server-enforce the existing additional-vial normalization.
- A direct cart can also combine a native one-time variant and a subscription without passing through the theme's normalization. A native one-time-only discount might still target that native variant; a broad native product discount cannot be assumed to implement every mixed-cart exclusion in the table above.
- Test order-history update timing, pending-payment reservations, concurrent checkouts, and discount selection before declaring strict first-ever enforcement. Shopify documents code reservation/release behavior in its [discount FAQ](https://help.shopify.com/en/manual/discounts/discounts-faq), but no Base Note transaction was used to verify these cases.

## Stricter backend option if the native constraints are unacceptable

A Discount Function can evaluate trusted checkout input including `buyerIdentity.isAuthenticated` and `buyerIdentity.customer.numberOfOrders`, select one eligible one-time cart-line unit, and calculate the $2 difference to the $18 target. It should fail closed when identity/history is unknown, exclude helper/selling-plan/bottle lines, and explicitly handle mixed carts and quantities. It still needs a defined prior-order policy and repeat/concurrent-redemption strategy; null customer input must not be treated as verified new.

Shopify documents that public App Store apps containing Functions can be used on supported plans, while **custom apps containing Functions require Shopify Plus**. Base Note's actual plan and installed app capabilities have not been verified for this proposal. A staging app directory is not evidence of a usable deployment entitlement. An existing suitable public app is an alternative to evaluate, not an approved installation or new spend. See [Shopify Functions availability](https://shopify.dev/docs/apps/build/functions) and [Discount Function input and output](https://shopify.dev/docs/api/functions/latest/discount).

## Minimum access and release prerequisites

| Need | Minimum appropriate capability | Present status |
| --- | --- | --- |
| Read current discount definitions, eligibility, dates and combinations | Existing authorized Admin Discounts access, or `read_discounts` | Not verified available; known API token is content-only |
| Create/update the chosen discount after backup | Authorized Admin Discounts permission, or `write_discounts` | Not available through the known token |
| Inspect an existing customer segment | Authorized Admin segment access, or `read_customers` | Not available through the known token; no customer records fetched |
| Create the zero-order segment if needed | Authorized Admin permission, or `write_customers` for `segmentCreate` | Not available through the known token |
| Confirm precise eligible variant allowlist | Fresh public product data may suffice for known published variants; `read_products` if Admin catalog verification is needed | Public IDs accessible; Admin product scope remains unavailable |
| Deploy a custom Function if selected | Verified compatible shop plan, app entitlement, and the specific authorized app deployment workflow | Unverified; no Function implementation or deployment |
| Display an unconditional personalized $18 entitlement | Backend eligibility/discount readback plus passed real checkout tests | Not met |

Scope evidence: [discountNodes — read_discounts](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/discountNodes), [discountAutomaticBasicCreate — write_discounts](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/discountAutomaticBasicCreate), [segmentCreate — write_customers](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/segmentCreate), and [segment management permissions](https://shopify.dev/docs/apps/build/marketing/customer-segments/manage).

Use existing authorized Admin access if it is already available; do not search for additional credentials, expand permissions silently, or treat CLI theme login as discount authorization. Broad order-history exports, customer lists, payment information, and financial records are not necessary for this feasibility stage. Any transaction-based QA must use an authorized test environment or explicitly approved test procedure; do not place an actual customer order merely to test the theme.

## Customer-facing copy, only after activation and verification

For a verified eligible customer, the proposed presentation is:

> ~~$20~~ $18 first-order offer
>
> One eligible 5ml vial for new customers. No subscription required. Eligibility confirmed at checkout; shipping and taxes additional.

Place the actual account requirement and any code/claim step next to that price, not solely in a footer. If eligibility has not yet been established, show the regular $20 with a clearly conditional invitation to check first-order eligibility; do not display $18 as that shopper's guaranteed checkout price. Returning customers retain $20 first-vial pricing. Additional-vial messaging remains a distinct $18 offer.

Do not publish this copy until the backend mechanism exists and has passed the matrix below. Do not change public Product structured data to an unconditional $18 offer for all visitors; schema, cart, product page, collection, 3D viewer, and checkout must agree on actual eligibility and payable prices.

## Required QA matrix — new offer tests have NOT run

All expected totals below assume USD and no separate applicable promotion. Evidence must include the relevant eligibility result, cart-line identity/quantity, applied discount identity/allocation, and checkout merchandise subtotal. Recording a storefront quote alone is not a pass.

| Test | Expected outcome before release |
| --- | --- |
| Verified zero-order customer, one native eligible vial | $20 regular price, exactly $2 first-order reduction, $18 payable merchandise |
| Verified zero-order customer, two different scents | $18 + $18 = $36; correct scent identity and exactly $2 of new benefit |
| Verified zero-order customer, quantity three / same scent | $54 total under the preserved extras policy; no extra $2 reduction on helpers |
| Returning customer, one / two vials | $20 / $38; first-ever discount rejected even if code is unused |
| Prior purchase was a bottle or subscription | Not a first-ever customer; first-order offer rejected |
| Anonymous guest / unknown history | No verified-eligible claim; follow the approved account/eligibility path, or remain at regular pricing |
| Newly created zero-order account | Eligibility resolves correctly after profile/segment availability; no marketing opt-in created |
| Signed-out returning customer; alternate email/account | Unknown identity is not treated as proven new; document the remaining per-customer-record limitation honestly |
| Monthly Rotation alone | $15 initial / $20 renewal retained, no new first-order reduction on either cycle |
| Monthly Rotation plus an extra vial | $33 initial merchandise; helper stays $18 and no $2 reduction hits the subscription |
| Helper-only cart or direct helper URL/API add | No first-order benefit; invalid standalone-helper case cannot become a backdoor entitlement |
| Full bottle, giveaway, bundle, unrelated merchandise | No first-order reduction on excluded lines; unrelated actual price remains unchanged |
| Direct/no-JavaScript cart with multiple native vial units | Correct agreed $18/$18 offer and quantity handling at checkout, or this path blocks release until backend rules can enforce the promise |
| Direct mixed subscription plus native one-time cart | Same intended subscription/additional-vial policy as the normal frontend; no unintended extra first-order reduction |
| Remove original anchor, change quantity, change scent, add/remove subscription | Discount recalculates against the remaining eligible units; original scent and selling-plan identity preserved |
| Change customer identity or sign out during checkout | Eligibility recalculated; no stale personalized $18 promise |
| Shop Pay / express checkout / shareable discount link | Same eligibility and final amount; no path bypasses conditions or hides the account/code requirement |
| Reuse offer after first successful order | First-order benefit rejected, including another cart/session/device associated with that customer |
| Two concurrent checkouts for the same eligible customer | No unintended second redemption; test actual platform reservation and history-update timing |
| Failed payment / abandoned pending checkout | Retry behavior matches the documented policy; reservation release does not grant extra successful redemptions |
| Canceled, unpaid, refunded, imported and test-order histories | Each follows the explicitly chosen definition of first-ever; do not infer paid-order semantics from an untested count |
| Legacy automatic discount plus offer / other discount codes | No unintended stacking; selected promotion and resulting amount match disclosed terms |
| USD versus another market/currency | USD target is not misapplied as 18 units of another currency; unsupported currencies show actual verified pricing |
| Collection, PDP, viewer, cart, schema, accessibility announcement | Conditional/unconditional copy matches verified eligibility; no false global compare-at price or unconditional $18 structured offer |
| Marketing consent and account creation | Account eligibility does not subscribe the user to email marketing; optional newsletter consent stays separate |

Release sequence: resolve the account requirement and prior-order definition → inspect and snapshot active discounts → configure the smallest suitable backend mechanism with authorized access → pass eligibility, checkout, mixed-cart and stacking tests → update conditional storefront copy → publish and independently read back. Until then, retain the current $20 first-vial / $18 extras and $15 initial / $20 renewal subscription presentation.

## Work performed and boundaries

This handoff records local source inspection, earlier read-only official documentation research, the public product readback above, and known scope evidence. Writing this file is the only repository change made for this documentation task. No code, discount, product price, compare-at price, selling plan, customer record, order, newsletter enrollment, credentials, deployment, or production setting was changed. No commit was created.
