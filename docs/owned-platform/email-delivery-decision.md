# Email delivery decision for Base Note staging

**Status:** proposed architecture only; no provider account, DNS record,
credential, data export, import, or email delivery has been created.

## Decision

Use **Cloudflare as the first staging application's control plane** and use
**Mailgun as the first email transport adapter**. Base Note will own its
profiles, consent and suppression decisions, audience logic, templates,
workflow rules, event ledger, and durable outbox. Mailgun will only accept an
already-authorized send intent and return delivery feedback.

Firebase is not needed in the first staging implementation. It remains a
viable later alternative if the application needs the operational model of
Cloud Run, Cloud SQL, and Cloud Tasks, but Firebase's Trigger Email extension
also requires an external SMTP delivery provider. Using both hosting platforms
at the outset would add operational surface without eliminating the transport
dependency.

Cloudflare Email Service is not the replacement for Klaviyo marketing sends at
this time: its published FAQ limits the service to transactional email. It may
be evaluated later for a separate transactional stream, but it is not the
marketing sender selected here.

## Staging topology

```text
Shopify storefront, App Proxy, and verified webhooks
                         |
                         v
app-staging.basenotescent.com (Cloudflare Worker API)
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
  D1 audit data    Queue + DLQ       R2 template/audit snapshots
 (profile token,    (idempotent,     (non-authoritative exports)
 consent, event,    paced jobs)
 suppression,
 outbox)
       |
       v
Mailgun adapter -- authenticated test sender --> allowlisted test inboxes
       |
       v
verified delivery/bounce/complaint feedback --> suppression ledger
```

An outbox record is authoritative before a send is attempted. Each provider
request carries a stable idempotency/delivery key, and provider feedback only
updates a consent/suppression state through audited rules. The worker must never
send directly from a storefront request or a scheduler invocation.

## Why this first choice

| Option | Fit for Base Note staging | Decision |
| --- | --- | --- |
| Cloudflare Worker + D1 + Queues + Mailgun | Reuses the existing Cloudflare direction, keeps app logic and delivery separate, and supports isolated staging with a low operational footprint. | **Use first.** |
| Firebase App Hosting/Cloud Run + Cloud SQL + Cloud Tasks + external sender | A solid more traditional service architecture, but still needs a sender and adds a second hosting control plane. | Keep as a later alternative. |
| Cloudflare Email Service alone | Published as transactional-only, so it cannot replace marketing workflows. | Do not use as the Klaviyo replacement. |
| Amazon SES | Likely economical at higher delivery volume, but adds AWS account, IAM, feedback, and deliverability operations. | Implementable future adapter; do not add for initial staging. |
| Resend marketing | Its marketing model is contact/segment oriented, which risks recreating the profile-cap exposure we are trying to remove. | Do not select first. |

This is an architecture decision, not a claim that changing a sender alone
solves deliverability. Sending domains must be authenticated, consent and
suppression history must be preserved, and volume must be warmed gradually.

## Proposed sender boundary

No DNS changes are authorized by this decision. If approved later, use separate
sender identities rather than replacing existing root-domain mail records:

| Purpose | Proposed identity | Initial use |
| --- | --- | --- |
| Staging | `mail-staging.basenotescent.com` | Provider sandbox / allowlisted test mail only |
| Production transactional | `notify.basenotescent.com` | Receipts and operational notices after approval |
| Production marketing | `hello.basenotescent.com` | Consent-based lifecycle/campaign mail after approval |

Before enabling any one of them, add only the SPF/DKIM/return-path records the
selected provider generates, confirm alignment, and begin DMARC in a monitored
mode. Do not overwrite current Google Workspace, Shopify, Klaviyo, or root SPF
records. Existing DNS must be inspected first.

## Required staging gates

1. Merchant approves Cloudflare + Mailgun and names the account owner and
   billing owner.
2. Create a separate Mailgun sandbox or verified **staging-only** sending domain
   and allowlist disposable test recipients; do not import production profiles.
3. Provision separate Cloudflare staging Worker, D1 database, Queue/DLQ, R2
   bucket, access controls, and secrets. Production resources must be separate.
4. Add a provider adapter to the Base Note outbox. It must enforce consent,
   suppression, idempotency, pacing, audit events, and a manual kill switch.
5. Prove test sends, bounce/complaint feedback, unsubscribe, duplicate-job
   handling, DLQ behavior, and zero sends when the kill switch is active.
6. Export and reconcile Klaviyo consent/suppression/engagement records under a
   reviewed data-handling plan before any production shadow mode. Do not mass
   delete profiles merely because a usage limit was reached.
7. Obtain explicit production approval for DNS, sender verification, data
   migration, warm-up plan, and a feature-flagged cohort.

## Primary references

- Cloudflare Email Service FAQ (transactional-email scope):
  https://developers.cloudflare.com/email-service/reference/faq/
- Cloudflare Queues delivery guarantees and dead-letter queues:
  https://developers.cloudflare.com/queues/reference/delivery-guarantees/
  https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- Firebase Trigger Email extension (requires an SMTP transport):
  https://firebase.google.com/docs/extensions/official/firestore-send-email
- Mailgun pricing and domain setup:
  https://www.mailgun.com/pricing/
  https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox
- Amazon SES pricing and event publishing:
  https://aws.amazon.com/ses/pricing/
  https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html
