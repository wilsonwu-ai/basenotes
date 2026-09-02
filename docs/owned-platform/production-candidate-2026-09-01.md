# Owned-platform production candidate — 2026-09-01

## Purpose

This candidate places the verified Base Note Core and isolated staging
implementation under `main` review. Merging it does not activate a production
route, deploy a Worker, configure Shopify, apply a database migration, import a
subscriber, send email, or change an Appstle contract.

Source anchors:

- production base: `458dd77a3a17ebd1da8ac561999da34ebee4ca00`
- verified staging integration: `8a3a195da1303aebeee0b14e4d5e8e3d06d37e8a`
- deployed staging fix: `703d7bffcbf458db5682f38bd5fa7752ba26ae95`

## Included

- Contract-scoped queue and pricing policy boundaries.
- Durable staging Profile Queue, member-choice, FOTM schedule, and audit model.
- Authenticated staging Admin scheduler and signed App Proxy boundaries.
- Approval-gated historical-subscriber backfill implementation.
- Consent, suppression, event-audit, and no-send messaging-domain foundations.
- Six D1 migrations and their smoke tests.
- Isolated staging runbooks and acceptance evidence.

## Still disabled or absent

- The Node entry point accepts local loopback mode only and refuses
  credential-like environment variables.
- The checked-in Wrangler file is a staging example with placeholder resource
  identifiers, no production route, and cutoff automation disabled.
- There is no Shopify subscription-contract creation, billing-attempt,
  renewal, cancellation, or production webhook implementation.
- There is no Appstle export, contract migration, payment-method migration, or
  provider adapter that can apply a queued choice to a shipment.
- There is no Mailgun credential, DNS configuration, recipient resolver,
  provider webhook, or real email-delivery path.
- There is no automatic post-checkout redirect to Profile Queue.

## Verification

On a fresh detached worktree at the staging integration commit:

- `npm ci` completed with zero production dependency vulnerabilities.
- `npm run check` passed the structural verifier, three migration smoke suites,
  both TypeScript checks, and 149 of 149 tests.
- The merge simulation against the production base completed without a
  conflict.
- The production diff adds only `apps/basenote-core/**` and documentation; it
  modifies no existing storefront, deployment workflow, or live configuration.

## Separate activation gates

Each of the following requires its own reviewed change and evidence; none is
authorized by merging this candidate:

1. A production Shopify app identity and approved protected subscription
   scopes.
2. Native selling-plan, checkout, contract, billing, renewal, cancellation,
   webhook, and readback E2E tests.
3. A hashed Appstle export manifest, dry-run reconciliation, subscriber-history
   approval, and active-contract/payment-method migration plan.
4. Mailgun domain DNS, restricted secrets, consent/suppression import, signed
   webhooks, allowlisted test delivery, and rollback evidence.
5. A true Shopify-supported post-signup Profile Queue handoff.
6. Explicit production deployment and cutover approval after the test subdomain
   acceptance suite and rollback rehearsal pass.
