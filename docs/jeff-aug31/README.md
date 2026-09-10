# Jeff's remaining request plans — 2026-08-31

## Purpose and boundary

This folder turns the five remaining operations/content requests into build-ready plans:

1. [Protected monthly queue report](01-protected-monthly-queue-report.md)
2. [Actual 5 ml vial media audit](02-actual-vial-media-audit.md)
3. [SEO editorial sprint](03-seo-editorial-sprint.md)
4. [Reviews and reputation](04-reviews-and-reputation.md)
5. [Package tiers and quantity discounts](05-package-tiers-and-quantity-discounts.md)

These are planning artifacts only. They do not publish content, change the theme, query customer records, change Shopify access, or create external tickets.

### Evidence boundary

The plans use the existing August request summary and the saved live-theme snapshot (`docs/audits/2026-08-31-live-theme-snapshot.md`), plus static repository evidence. They deliberately do not restate private message content or customer data.

### Implementation anchors

- The customer queue is a month-indexed list. The browser cache is backed, for logged-in customers, by a Shopify customer metafield through the `/apps/basenote/queue` App Proxy; see `assets/queue-scheduler.js`.
- The existing PDP gallery renders product media, while the product section also has an optional 5 ml vial-image setting; see `sections/main-product.liquid`.
- A Judge.me product-review app block and a post-delivery "Rate it" path already exist; see `templates/product.json`, `snippets/review-scroll-assist.liquid`, and `templates/customers/account.liquid`.
- The current catalog documentation and other repository text disagree on active-product count. No plan may use a hard-coded count until the Shopify catalog is re-inventoried by an authorized operator.

## Delivery graph

| Step | Reads prior output? | Verdict | Safe write target |
| --- | --- | --- | --- |
| Confirm the offer, reporting period, staff roles, catalog source, and retention rules | No | Anchor / human decision | Approved decision record |
| Draft queue-report data contract | Yes: reporting period and roles | Real edge | Protected app/backend branch |
| Inventory actual-vial media | Yes: current catalog source | Real edge | Content inventory sheet or CMS record |
| Create the three editorial drafts | Yes: verified catalog and claims list | Real edge | Unpublished Shopify blog drafts |
| Audit review capture and reputation operations | Yes: role model and approved voice | Real edge | Admin configuration / operating playbook |
| Configure packages and discount rules | Yes: offer rules and inventory model | Real edge | Shopify products, discounts, and fulfillment rules |
| Cross-surface QA | Yes: implemented work | Real edge | Test evidence only |
| Publish, deploy, export, or alter staff access | Yes: QA and explicit approval | Human gate | Shopify, GitHub, Google, and production systems |

The five planning streams can be refined in parallel once the shared decisions are documented, but none is safe to deploy independently of its acceptance tests. The shared-write targets above prevent hidden dependencies.

## Required decision record

Before implementation begins, an authorized business owner must record these answers in one approved change request:

| Decision | Needed by | Why it cannot be inferred |
| --- | --- | --- |
| Canonical active catalog and 5 ml sellable variant for each fragrance | Media, SEO, packages | Repository references are inconsistent and product availability is operational data. |
| Definition of a queue month and whether locked/current-month rows appear in staff reporting | Queue report | This determines which data is operationally actionable. |
| Named staff roles permitted to view/export customer queue data | Queue report, reviews | Customer data access must be least-privilege. |
| Review-request timing, sender, response owner, and escalation path | Reviews | A prompt and public response represent the business. |
| Package contents, price, discount formula, eligibility, stacking, and fulfillment promise | Packages | Theme text cannot safely decide commercial rules. |
| Editorial approver, factual source, and publishing cadence | SEO | Product mentions and claims must be current at publication time. |

## Dependency order and gates

1. **Authorize and record the shared decisions.** Shopify ownership/access transfer remains a separate owner-operated process; it is not solved by these plans.
2. **Establish the canonical catalog and test environment.** Build the product/variant map and a set of synthetic test customers or test orders. Do not use production customer data for development.
3. **Build the protected queue-report backend and run the vial-media inventory in parallel.** The report must be privately accessible; the audit must be a content record, not a theme-only claim.
4. **Approve the catalog-driven editorial briefs, review operating policy, and package offer rules.** These activities may run concurrently after step 2, but must not publish or configure live prices yet.
5. **Implement approved configurations and content in a staging or unpublished state.** Run the individual acceptance tests in each plan.
6. **Run cross-surface QA.** Verify price/copy consistency across PDP, cart, checkout, account, email, and operational reports; verify privacy and roles with separate test accounts.
7. **Human publish gate.** An authorized owner approves deployment, content publication, exports, Google Business changes, discounts, and staff-access changes after QA evidence is attached.

## Cross-cutting quality bar

- Treat Shopify, Appstle, Judge.me, Google, email, and fulfillment data as separate systems of record; reconcile rather than silently overwrite conflicts.
- Use test identities and synthetic queue entries for development and QA. Never put customer names, email addresses, addresses, order notes, or API secrets in GitHub issues, theme code, logs, screenshots, or article drafts.
- Keep all customer-facing pricing, subscription terms, and delivery claims synchronized with approved Shopify/Appstle configuration before release.
- Record the test date, tester role, environment, evidence link, and pass/fail result for every acceptance test.
