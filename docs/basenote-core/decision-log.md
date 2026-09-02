# Base Note Core decision log

This log separates decisions already safe to implement locally from decisions
that affect live customer contracts, charges, or storefront behavior.

## Decided for the local foundation

| Decision | Rationale |
| --- | --- |
| Keep Appstle installed and authoritative for existing contracts. | Shopify subscription-contract access is scoped to the app that created the contract. |
| Make queue data contract-scoped. | A customer can have more than one active contract; choosing the first one is unsafe. |
| Resolve an empty queue slot to one published exact FOTM variant. | A browser fallback or collection-first choice is not auditable or deterministic. |
| Fail closed on an adapter error or unavailable FOTM. | The system must never report a shipment change that it cannot read back. |
| Use a signed App Proxy for the initial customer surface. | The live store remains on legacy customer accounts. |
| Keep the local package disconnected from Shopify and Cloudflare. | App, scope, deployment, and migration changes need a distinct production approval. |

## Merchant decisions required before release

| Decision | Options / consequence |
| --- | --- |
| Legacy Appstle bridge | Approve an Appstle server API that can mutate and read back one exact contract line, or limit Queue v2 to saved intent until members re-enroll. |
| Existing-member transition | Keep legacy members in Appstle, migrate with Appstle-supported tooling, or invite voluntary re-enrollment. Never silently create a second billing contract. |
| Intro-price definition | The proposed policy is `no prior paid Base Note subscription on this Shopify customer record`; confirm handling for one-time buyers, failed first payments, and duplicate accounts. |
| Add-on eligibility | The proposed initial policy is exactly `$18` for approved one-time vial variants only when the same cart contains a Base Note subscription line. Confirm whether later standalone orders by active members qualify and whether more than one eligible vial per line should receive the price. |
| FOTM calendar | Approve merchant timezone, per-cycle cutoff, eligible plans, and who can publish/revise a FOTM. |
| Customer-account upgrade | Keep legacy accounts for this release, or separately preview and approve an upgrade before adding Customer Account UI extensions. |
| Production ownership | Confirm who owns the Dev Dashboard app, secure runtime, incident response, and release approval. |

## Evidence required at each release gate

1. Exported Appstle contract/plan and automatic-discount baseline.
2. Test-store or disposable-customer proof of $15 first charge, $20 renewal,
   returning-customer rejection, and exact $18 add-on behavior.
3. Adapter test showing an exact contract/line update plus readback, including
   timeout/idempotency behavior.
4. Migration rehearsal proving no double billing and a rollback procedure.
5. Explicit merchant approval before an app version, Function, pricing rule,
   theme, account system, or production deployment changes.
