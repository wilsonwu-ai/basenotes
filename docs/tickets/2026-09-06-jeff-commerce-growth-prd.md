# PRD: Base Note Commerce Reliability and Growth Surfaces

**Status:** Approved for staged implementation
**Date:** 2026-09-06
**Owner:** Base Note product and engineering
**Source:** Consolidated stakeholder requirements through 2026-09-05; private-message identifiers and customer data are intentionally excluded.

## Outcome

Make the Base Note storefront a dependable path from scent discovery to a correctly priced first order, a durable monthly queue, and repeat purchase—without allowing marketing copy, theme releases, or helper products to contradict the commerce configuration.

## Customer and business problem

Base Note now supports one-time purchases, subscriptions, a future-scent queue, editorial discovery, and additional 5 ml vials. Those surfaces evolved across Shopify, Appstle, theme code, and merchant-edited settings. When their state diverges, customers can see the wrong storefront, receive inconsistent prices, or add a helper product through an unsupported path. The same inconsistency also weakens search and answer-engine trust.

The primary audiences are:

- New shoppers who want an affordable way to wear-test a luxury fragrance.
- Subscribers who want predictable billing and control over future scents.
- Gift and occasion shoppers, including women buying fragrance for men.
- Returning customers who may add more than one vial to a monthly shipment.

## Protected commerce invariants

These rules override stale ticket copy, hard-coded theme values, or inherited Appstle discounts:

1. Base subscription: **$15** on a completely new subscriber's first order, then **$20 per month**. The $15 rate is for new members only; a member who cancelled and returns pays **$20**.
2. Every additional 5 ml vial is **$18**, flat, on every tier and on every order (first and recurring). A one-time purchase is **$20** per vial with **$18** add-ons.
3. Worked examples (derived, not owner-stated acceptance criteria): a first-time subscriber with two add-ons pays $15 + $18 + $18 = $51 before tax and shipping; a one-time buyer with one add-on pays $20 + $18 = $38. Source: owner's messages of 2026-08-31 and 2026-09-01; the earlier "$18 on the initial order and every recurring order / $51" wording was a paraphrase and is superseded by this ladder.
4. An add-on can never become the base subscription line or replace the customer's primary scent during swap/queue operations.
5. Prices shown in UI must be derived from the selected variant and selling-plan allocations. A mismatch fails closed; it must never be replaced with a guessed fallback.
6. The add-on helper product is not a standalone acquisition product. Until its dedicated zero-discount selling plan is live and verified, its standalone route and all add-on entry points remain disabled and non-indexable.

The previously discussed add-on maximum of “4” is ambiguous. Do not enforce whether that means four add-ons or four total vials until the owner resolves it.

## Required customer journeys

### 1. Subscribe or buy once

- A fragrance PDP clearly offers one-time purchase and subscription when both are valid for that product.
- Subscription disclosure states the charge today, subsequent charge, cadence, and cancellation path before add-to-cart.
- The selected purchase type and selling plan survive variant changes, cart addition, cart rendering, and checkout handoff.
- If the live selling-plan data is absent or contradictory, the subscription control is unavailable with a plain-language recovery message.

### 2. Add another vial

- Eligible subscribers can add a 5 ml vial for $18 from an authenticated, contextual flow.
- The flow confirms both the first and recurring allocation are $18 before enabling the action.
- Repeated clicks are idempotent; rollback removes only the exact line created by the failed attempt.
- The helper product is excluded from search, collections, product recommendations, article CTAs, and ordinary product cards.

### 3. Build and maintain a queue

- Customers can select future fragrances across devices and sessions.
- The current contract/cycle is the source of truth; a local-only browser queue is never treated as durable state.
- The Fragrance of the Month is the fallback when no valid customer selection exists.
- The interface shows a Central Time cutoff and locks the applicable cycle after that cutoff.
- Customers can see which month is editable, which is locked, and what will ship if they take no action.

### 4. Fulfillment and self-service

- Operational copy uses the verified service level: fulfillment within two business days and expected delivery in 1–3 business days where applicable.
- Subscription shipping is free. One-time and add-on shipping language must be verified against the live rate configuration before publication.
- Customer-account surfaces provide working pause, skip, swap, and cancel paths with no dead-end redirects.

### 5. Discover and decide

- Product pages show verified Judge.me rating/count data, not placeholder or stale review metafields.
- Founding-member/scarcity claims use a live count with bounded fallback and a nonzero goal.
- Price comparisons identify their basis, use live variant data, and remain accessible by keyboard and screen reader.
- Editorial content answers a purchase question directly, cites authoritative sources, discloses Base Note's commercial interest, and links only to verified products and policies.

## Functional requirements and acceptance tests

| Priority | Requirement | Acceptance test |
|---|---|---|
| P0 | Restore and preserve the newest approved theme | Public response identifies the recorded theme ID; desktop/mobile home, collection, PDP, cart, account, and Journal smoke tests pass; prior live theme remains available for rollback. |
| P0 | Correct base subscription pricing | Anonymous test cart with the live selling plan totals $15 for the first base line and exposes a $20 compare/subsequent allocation. |
| P0 | Correct add-on configuration | A dedicated selling plan assigned only to the helper product reports $18 first and recurring; the global 25% first-cycle discount is absent. |
| P0 | Fail closed on mismatch | With a $13.50/$18 or missing allocation fixture, no add-on CTA can create a cart line. |
| P0 | Protect the base line | A cart containing base plus add-on still identifies only the base as swappable; harness covers line-order changes and duplicate clicks. |
| P0 | Durable queue | A selection made on device A appears on device B after authentication and remains after renewal/webhook refresh. |
| P0 | Release source of truth | Every live Shopify theme maps to one reviewed Git commit; merchant-editor changes are pulled and reconciled before the next release. |
| P1 | One-time/subscription clarity | Both CTAs, disclosures, focus states, error states, and checkout handoff pass desktop/mobile and keyboard QA. |
| P1 | Reviews and proof | Sampled PDP/card counts match Judge.me; zero-review products do not render fake stars or counts. |
| P1 | Shipping consistency | PDP, FAQ, cart, policy, and article copy contain one verified set of fulfillment/delivery terms. |
| P1 | AEO publishing | New article has canonical URL, unique title/description, Article JSON-LD, sitemap inclusion, OAI-SearchBot 200, and no unsupported performance claims. |
| P2 | Survey/review loop | Post-delivery prompt records structured satisfaction and can route verified buyers to a review request without incentive misrepresentation. |

## Release plan

### Phase A — containment and recovery

- Restore the preserved `basenotes/main` storefront.
- Retain the displaced theme as rollback.
- Hide the add-on's unsupported standalone experience and block PR #47 until pricing and accessibility tests pass.
- Reconcile the restored Shopify state into a reviewed Git branch.

### Phase B — commerce correctness

- Create and assign a dedicated add-on selling plan with no introductory discount.
- Implement allocation-based gating, safe cart verification, rollback, and base-line detection.
- Audit Appstle contract, queue, cutoff, and Fragrance-of-the-Month behavior.
- Run a non-order cart suite; use a named test customer/order only with separate operational approval.

### Phase C — conversion and retention

- Release accessible review, scarcity, comparison, and dual-CTA surfaces.
- Normalize shipping and cancellation language.
- Publish source-backed buying guides with reviewed FAL imagery and immutable media URLs.
- Add a measured post-delivery survey and review loop.

## Analytics and success measures

Measure observed outcomes; do not substitute forecasts for missing data.

- PDP-to-cart rate by one-time versus subscription intent.
- First-month subscription starts and second-cycle retention.
- Add-on attach rate and add-on pricing-error rate.
- Queue completion, cross-device persistence, fallback usage, and support contacts.
- Checkout failures by selling-plan error.
- Organic impressions, clicks, product-click rate, and assisted revenue by article.
- Referrals containing `utm_source=chatgpt.com`; presence is measurable traffic, not proof of guaranteed citation.
- Theme rollback count and number of unreconciled Shopify-only edits at release time.

## Risks and controls

- **Cross-system drift:** one release record maps Shopify theme ID, Git commit, Appstle plan IDs, and verification timestamp.
- **Stale hard-coded pricing:** allocation-based rendering plus mismatch tests; no fallback dollar values in purchase logic.
- **Accidental helper-product discovery:** unlisted/noindex product status, route guard, and catalog/search exclusion.
- **Duplicate or destructive cart operations:** line-key verification and exact-line rollback in an isolated cart.
- **Marketing overclaim:** claim-level sources, visible commercial disclosure, and final policy/product readback.
- **Theme regression:** candidate-first browser QA, retained rollback theme, and no direct publication of feature/QA themes.

## Explicit non-goals

- Legal conclusions about fragrance decanting or licensing.
- Publishing an Erba Pura performance review without a documented multi-wear test.
- Enforcing the ambiguous add-on maximum.
- Deleting historical themes during this release.
- Claiming that crawl eligibility guarantees placement or citation in ChatGPT.

## Open owner decisions

1. Does the maximum of four mean four add-ons or four vials total?
2. Which one-time shipping rate is canonical when an order is below the free-shipping threshold?
3. Should the two PDP CTAs be equal visual weight, or should subscription remain primary?
4. Which authenticated surface owns add-on selection: cart, account queue, or both?
5. Who approves and performs the required original wear test for product-review content?
