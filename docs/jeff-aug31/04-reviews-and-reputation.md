# PRD: Review capture and independent reputation operations

## Outcome

Create a reliable, compliant review workflow that makes it easy for genuine customers to review received fragrances, maintains the existing on-site Judge.me experience, and gives authorized staff a clear process for Google Business Profile/reputation operations.

The objective is authentic feedback and a trustworthy public record—not review-volume inflation.

## Current anchor

The product template has a Judge.me review-widget app block. Account shipment history includes a “Rate it” path to the matching product review widget, and a post-delivery email template exists. These are implementation anchors, not evidence that delivery triggers, review eligibility, email flows, Google profile status, or staff response processes are configured correctly.

## Required business decisions

| Decision | Required answer |
| --- | --- |
| Review vendor/source of truth | Confirm Judge.me configuration, ownership, storefront surfaces, and data retention/export policy. |
| Eligible review event | Confirm delivery signal, delay, channel, frequency cap, and treatment of refunds/cancellations. |
| Prompt and incentive policy | Approve neutral language; decide whether any incentive exists. A reward must never be conditioned on a positive rating or review. |
| Moderation policy | What spam, abuse, privacy, or safety cases may be moderated; who approves removal/escalation; how legitimate negative feedback is handled. |
| Google operations | Confirm whether there is a real eligible Google Business Profile, the verified owner, role assignments, response voice, and escalation SLA. |
| Customer support linkage | Owner and path for complaints, replacement requests, fragrance allergy/safety questions, and personal-data deletion/access requests. |
| Success metrics | Approved measures such as verified review rate, response time, rating distribution, and support-resolution rate—not a target that encourages selective suppression. |

## Operating design

### On-site review journey

1. A delivery/fulfillment event identifies an eligible order using the approved vendor integration.
2. After the approved delay, the customer receives one neutral invitation with a product-specific link.
3. The existing account “Rate it” link remains a secondary path for a customer who has received that fragrance.
4. The review platform handles verified-purchase marking, rating/review submission, consent, unsubscribe preferences, and moderation according to the approved configuration.
5. Staff triage public reviews according to the response/playbook, but do not manipulate, pre-screen, or suppress legitimate negative reviews.

### Google/reputation operations

1. An authorized owner verifies the correct business profile and grants role-based access; credentials are never shared.
2. Customer-facing prompts may invite an honest public review only after an approved service event and must not direct only satisfied customers to Google.
3. A designated responder checks reviews on an agreed cadence, responds using approved tone, and moves account/order details to private support channels.
4. Suspected spam, impersonation, or privacy violations follow the platform’s official reporting path and an internal evidence log.

## Privacy, security, and integrity controls

- Use least-privilege roles for Judge.me, Shopify, email provider, and Google. Revoke former staff promptly; use individual accounts and MFA where available.
- Do not put order details, customer names, addresses, email addresses, subscription status, or private support history into public review responses.
- Do not use fake reviews, employee/affiliate reviews presented as customer reviews, review swapping, paid positive reviews, selective review gating, or automated submission on a customer’s behalf.
- Respect marketing consent, unsubscribe choices, regional privacy requirements, and platform policy. Send review requests only through the approved customer-communication basis.
- Keep review/export data in approved systems. Do not store raw review exports or customer identifiers in source control or public project trackers.
- Treat a negative review as a support signal, not a deletion trigger. Moderation decisions need a documented, policy-based reason.
- Make the final public response reviewer accountable; use templates as a starting point, not automated publication.

## Delivery plan

1. Confirm access owners and create a least-privilege role matrix for Shopify, Judge.me, email, and Google.
2. Audit the live configuration in a read-only/admin review: widget presence, product mapping, review submission path, post-delivery trigger, email suppression/unsubscribe, and any existing Google profile.
3. Approve the prompt, incentives, moderation policy, escalation matrix, and response templates.
4. Configure the smallest viable flow in a sandbox/test environment using a synthetic order where the vendor supports it.
5. Run privacy, consent, delivery, link, and public-response QA. Obtain owner approval before enabling requests or changing public profiles.
6. Monitor the approved metrics and audit exceptions on a scheduled cadence.

## Acceptance tests

| Test | Pass condition |
| --- | --- |
| Product mapping | A test recipient’s review link lands on the exact product widget and can submit a review without a broken/lazy-load anchor. |
| Eligibility and timing | A non-delivered, cancelled/refunded, or opted-out test customer does not receive a request; a delivered eligible test customer receives at most the approved number after the approved delay. |
| Neutrality | Prompt language asks for an honest review and does not condition access, reward, or routing on rating sentiment. |
| Consent and privacy | Unsubscribe/suppression is honored; no customer/order data appears in public URLs, messages, page source, or staff response templates. |
| Moderation | A test negative review follows the same allowed submission/visibility rules as a positive one; a policy-violating test case has a documented escalation path. |
| Access control | Former/unauthorized test staff cannot access review exports or Google profile management; authorized roles can perform only their approved actions. |
| Reputation response | A simulated public complaint receives an approved, non-PII response that directs account-specific follow-up to a private channel. |
| Auditability | The team can trace configuration owner, prompt version, responder, and moderation reason without storing sensitive review data in code. |

## Dependencies and release gate

Depends on verified operational ownership/access, approved communication and moderation policies, and a testable delivery signal. It may run in parallel with editorial and media work, but no outreach or public-profile change occurs until a role/access review and the tests above pass.
