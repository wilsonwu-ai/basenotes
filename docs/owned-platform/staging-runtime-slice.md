# Base Note staging-runtime slice

**Status: local-only code and a reviewed D1 migration. No Worker binding, D1
database, Cloudflare account, Shopify app, customer data, sender, or deployment
has been created or connected.**

## Purpose

This slice turns the agreed queue shape into testable, durable boundaries before
any staging resource is provisioned:

- Each exact future delivery cycle has one merchant-controlled automatic FOTM.
- A profile may add, change, or remove up to **four** separately priced future
  add-ons for that cycle.
- Every add-on has a fixed stored unit price of **$18.00** (`1800` cents).
- FOTM is not one of the add-ons; it remains the automatic base selection.
- Customer mutations stop at the published FOTM cutoff and use a revision plus
  idempotency boundary.

The code deliberately does not decide catalog availability, subscription
eligibility, billing, checkout discounts, FOTM timezone policy, or provider
mutation. Those require authenticated, server-side Shopify/Appstle decisions
and disposable development-store proof.

## Local modules

```text
apps/basenote-core/
  migrations/0001_staging_runtime.sql
  src/staging-runtime/d1.ts
  src/profile-queue/contracts.ts
  src/profile-queue/service.ts
  src/profile-queue/repository.ts
  src/profile-queue/d1-repository.ts
  src/profile-queue/ui.ts
  src/subscription-history/contracts.ts
  src/subscription-history/backfill-importer.ts
```

`D1ProfileQueueRepository` accepts a structural D1 port from a future Worker
entrypoint. This package does not declare an environment binding or a Wrangler
configuration, so importing or testing it cannot connect to Cloudflare.

The SQL migration creates:

- revisioned `profile_queue_cycles` and ordered `profile_queue_add_ons`;
- a database-level four-add-on cap and exact-`1800` price guard;
- immutable queue mutation audit rows; and
- historic-subscription and backfill audit tables with append-only triggers.

The migration is not an install command. It must be applied manually only to an
isolated staging database after the app configuration, retention policy,
operator access, backup, and rollback plan are approved.

## Profile Queue API boundary

The browser request shape contains a cycle key, expected revision, idempotency
key, ship month, and a narrow add/change/remove add-on mutation. It does **not**
contain a contract binding ID. An authenticated future App Proxy route must
derive the binding from its server-side session, verify it belongs to the
customer, verify the exact product variant is currently eligible, and create a
server-generated add-on/mutation ID before calling the service.

The included dropdown is static staging markup only. It shows the automatic
FOTM, remaining capacity, explicit `$18.00` add-on price, select control, and
remove controls, but has no form action, API URL, JavaScript handler, contract
identifier, or submit side effect. It is not included in the live Shopify theme.

## Historic-member protection

The backfill importer accepts only opaque source references plus exact Shopify
customer IDs. It rejects email-shaped evidence references and has no CSV/API
reader. Its initial operation is a dry run that records an append-only audit
event while making **zero** changes to eligibility history.

Applying a plan requires the same retained dry-run instance and a separately
formatted approval reference. The repository boundary requires the positive
`ever subscribed` fact and its audit event to be appended atomically; it has no
downgrade/delete API. An absent history row maps to `unknown`, not to “new
subscriber,” so the `$15` introductory benefit continues to fail closed until
durable proof of never having subscribed exists.

## Staging acceptance tests still required

After explicit resource/app approval, run the following with disposable test
customers only:

1. Create one new Base Note subscription and one former-member test profile;
   verify `$15` eligibility fails closed until historic data is reconciled and
   `$20` is used for the former member.
2. Publish a FOTM with the merchant-approved IANA timezone and cutoff; add,
   change, and remove up to four `$18` future add-ons before the cutoff.
3. Attempt a fifth add-on, stale revision, foreign contract, unavailable
   variant, and post-cutoff mutation; all must fail without a provider change.
4. Exercise an idempotent mutation, D1 compare-and-swap conflict, Worker queue
   retry/DLQ, and exact Shopify/Appstle readback before claiming success.
5. Perform historic-member import only after a reviewed dry-run reconciliation;
   compare counts and exceptions before any production record is considered.

No production customer history, queue, billing, Appstle contract, Klaviyo
profile, or sender configuration is altered by this slice.
