# Base Note staging-runtime slice

**Status: reviewed local/staging source and unapplied D1 migrations. No deployed
Worker binding, D1 database, Cloudflare account, Shopify app, customer data,
sender, or deployment has been created or connected.**

## Purpose

This slice turns the agreed queue shape into testable, durable boundaries before
any staging resource is provisioned:

- Each exact future delivery cycle shows its published FOTM as the included,
  pre-selected default. A member may save one month-specific fragrance override;
  no override means the FOTM remains the cutoff fallback.
- A profile may add, change, or remove up to **four** separately priced future
  add-ons in addition to that included selection.
- Every add-on has a fixed stored unit price of **$18.00** (`1800` cents).
- FOTM is not one of the add-ons; it is the included default/fallback only.
- Customer mutations stop at the published FOTM cutoff—exactly **12:01 AM
  America/Chicago** on its configured date—and use a revision plus idempotency
  boundary.

The code deliberately does not decide catalog availability, subscription
eligibility, billing, checkout discounts, or provider mutation. It does encode
the approved 12:01 AM America/Chicago cutoff rule (with DST-safe Worker
validation). The remaining decisions require authenticated, server-side
Shopify/Appstle decisions and disposable development-store proof.

## Local modules

```text
apps/basenote-core/
  migrations/0001_staging_runtime.sql
  migrations/0002_staging_test_bindings.sql
  migrations/0003_member_fragrance_choice.sql
  migrations/0004_durable_historical_backfill.sql
  migrations/0005_staging_admin_scheduler.sql
  src/staging-runtime/d1.ts
  src/profile-queue/contracts.ts
  src/profile-queue/service.ts
  src/profile-queue/repository.ts
  src/profile-queue/d1-repository.ts
  src/profile-queue/ui.ts
  src/cloudflare-staging-worker/
  src/subscription-history/contracts.ts
  src/subscription-history/backfill-importer.ts
```

`D1ProfileQueueRepository` accepts a structural D1 port from a future Worker
entrypoint. This package does not declare an environment binding or a Wrangler
configuration, so importing or testing it cannot connect to Cloudflare.

The queue schema migration creates:

- revisioned `profile_queue_cycles` and ordered `profile_queue_add_ons`;
- a database-level four-add-on cap and exact-`1800` price guard;
- immutable queue mutation audit rows; and
- historic-subscription and backfill audit tables with append-only triggers.

The second migration creates an exact, expiring disposable-test-binding table
and a one-use, short-lived form-nonce table bound to the same exact cycle
scope. It does not seed a customer or binding; an unseeded staging database
must deny every signed Profile Queue request. The Worker source, signed App
Proxy HMAC verifier, and protected configuration requirements are documented in
[`cloudflare-staging-worker.md`](cloudflare-staging-worker.md).

`0003_member_fragrance_choice.sql` adds durable `DRAFT`/`PUBLISHED` FOTM
schedules per `ship_month` so staff can prepare September, October, November,
and later months independently. Every schedule uses the product-approved
`12:01 AM America/Chicago` cutoff policy and an append-only non-PII audit. It also adds
an immutable resulting-selection snapshot for every queue mutation. A theme's
current FOTM setting can supply display context, but it neither enforces this
schedule nor proves a delivery change.

The staging Worker contains a bounded D1-only scheduled lock that is disabled
unless a protected staging variable is explicitly set to `true` after an E2E
gate. It preserves a saved member override or records the published FOTM
fallback at cutoff. It has no Shopify/Appstle write and no production behavior.
There is deliberately no public staff write route; the protected staging-only
embedded Admin implementation is the core of
[issue #35](https://github.com/wilsonwu-ai/basenotes/issues/35).

Issue #35 now joins the server-only schedule boundary to a staging-only,
embedded Shopify Admin scheduler. Its Worker API verifies a fresh HS256 Shopify
ID token against the exact staging app client ID, exact staging shop
issuer/destination, expiry/not-before values, and configured opaque staff
subjects. Each unsafe command records only a SHA-256 digest of the token `jti`
to reject bearer replay. The bounded provisioner then joins one published month
to at most five exact `OPEN`/`UNPUBLISHED` D1 cycles per request through CAS,
append-only audit, and non-PII choice evidence. It makes FOTM visibly
pre-selected as the included default while retaining `UNSELECTED` until a
member override is saved. It has no App Proxy scheduler writer, Shopify/Admin
API call, Appstle call, email/provider call, or production behavior.

This source is still unapplied and unconfigured. A durable schedule or
provisioned D1 cycle does not itself alter a theme, Shopify subscription, or
Appstle shipment. Protected staging app/D1/secrets setup and a disposable E2E
proof remain explicit staging-release blockers.

The migration is not an install command. It must be applied manually only to an
isolated staging database after the app configuration, retention policy,
operator access, backup, and rollback plan are approved.

## Profile Queue API boundary

The browser request shape contains a cycle key, expected revision, idempotency
key, ship month, and a narrow included-member override or add/change/remove
add-on mutation. It does **not**
contain a contract binding ID. An authenticated future App Proxy route must
derive the binding from its server-side session, verify it belongs to the
customer, verify the exact product variant is currently eligible, and create a
server-generated add-on/mutation ID before calling the service.

The Core `profile-queue/ui.ts` dropdown remains static contract markup. The
separate staging Worker has a server-rendered no-JavaScript form page that posts
only through Shopify's signed App Proxy path after its HMAC, exact test-binding,
and runtime-variant gates pass. Neither surface is included in the live Shopify
theme.

## Historic-member protection

The backfill importer accepts only exact Shopify customer IDs plus a
source-qualified SHA-256 surrogate such as `appstle/sha256/<64-lowercase-hex>`.
It rejects raw email, phone, name, CSV-row, and ticket-shaped values before it
prepares a D1 statement, and has no CSV/API reader. Its initial operation is a
dry run that records an append-only audit event while making **zero** changes
to eligibility history.

All historic timestamps are normalized to canonical UTC millisecond ISO format
(`YYYY-MM-DDTHH:mm:ss.SSSZ`) before digesting or persisting. That gives D1 text
comparison and JavaScript comparison the same ordering semantics.

Migration `0004` quarantines every pre-manifest backfill run as
`NO_IMMUTABLE_PLAN`; incomplete rows terminalize as `NEEDS_REVIEW` and cannot
be approved or reopened. It also quarantines pre-0004 history/audit rows rather
than exposing or rewriting legacy values. A separately authorized remediation
is required before any such legacy evidence could be considered.

If a new approved plan encounters a quarantined legacy history row for the
same customer, it cannot overwrite that immutable key or treat the legacy row
as trusted evidence. It records the auditable
`LEGACY_EVIDENCE_REQUIRES_REVIEW` conflict with no fabricated competing run,
withholds every new fact from that batch, and terminalizes as `NEEDS_REVIEW`.
It never fails the batch because a legacy row lacks a durable run ID, and it
never silently filters the row and reports a successful apply.

Applying a plan requires the same retained dry-run instance and a separately
formatted approval reference. The repository boundary requires the positive
`ever subscribed` fact and its audit event to be appended atomically; it has no
downgrade/delete API. An absent history row maps to `unknown`, not to “new
subscriber,” so the `$15` introductory benefit continues to fail closed until
durable proof of never having subscribed exists.

Lifecycle events are generated by the successful D1 state transition itself;
no caller may insert an independent lifecycle audit event. The durable staging
service is maintenance-only and caps a dry run at **14 candidates**. It performs
one batched history lookup and at most 45 statements in one apply batch, below
the conservative 50-subrequest Worker Free safety budget. Larger imports must
be partitioned into independently reviewed dry runs; this code does not run a
bulk import automatically.

## Staging acceptance tests still required

After explicit resource/app approval, run the following with disposable test
customers only:

1. Create one new Base Note subscription and one former-member test profile;
   verify `$15` eligibility fails closed until historic data is reconciled and
   `$20` is used for the former member.
2. Through the authenticated #35 scheduler/provisioning path, schedule/publish
   independent FOTM defaults for at least two future ship months at 12:01 AM
   Central; prove a member override and unselected FOTM
   fallback both lock correctly, then add, change, and remove up to four `$18`
   future add-ons before the cutoff.
3. Attempt a fifth add-on, stale revision, foreign contract, unavailable
   variant, and post-cutoff mutation; all must fail without a provider change.
4. Exercise an idempotent mutation, D1 compare-and-swap conflict, Worker queue
   retry/DLQ, and exact Shopify/Appstle readback before claiming success.
5. Perform historic-member import only after a reviewed dry-run reconciliation;
   compare counts and exceptions before any production record is considered.

No production customer history, queue, billing, Appstle contract, Klaviyo
profile, or sender configuration is altered by this slice.
