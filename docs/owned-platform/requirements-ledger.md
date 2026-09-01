# Owned-platform requirements ledger

This is a sanitized implementation record derived from the merchant’s private
request channel on 2026-09-01. It intentionally excludes chat text, personal
data, account codes, and financial-operation requests.

## Confirmed product requirements

| ID | Requirement | Current local status | Production status |
| --- | --- | --- | --- |
| SUB-01 | Only genuinely new members receive the introductory discount. | Pure pricing rule modeled. | Not connected to a Shopify Function or historic-member backfill. |
| SUB-02 | Former subscribers pay the standard `$20` monthly rate. | Pure pricing rule modeled. | Not verified at checkout or renewal. |
| QUEUE-01 | A profile queue supports four fragrance selections that a customer can add, remove, and change. | Contract-scoped, revisioned queue engine exists. | No customer UI, persistence, or agreed definition of “four selections.” |
| PRICE-01 | An additional bottle costs exactly `$18`, including for an intro-plan subscriber. | Exact target-price policy is modeled for a qualified subscription cart. | No Shopify Product Discount Function or approved later-order policy. |
| MIG-01 | Evaluate native Shopify subscriptions and a safe Appstle transition. | Ownership/migration boundary and staged plan documented. | No migration is authorized or possible without approved Appstle path and test proof. |
| MSG-01 | Reduce reliance on Klaviyo. | Consent, suppression, event, and no-send outbox primitives exist. | No data export/import, sender, flow, or live replacement. |

## Verification order

The merchant asked for pricing requirements to be verified before queue work is
considered complete. The required proof is a disposable-customer test matrix:

1. New authenticated customer: intro charge follows the approved schedule.
2. Former subscriber: intro selection is blocked and standard `$20` plan works.
3. Qualified intro cart plus approved extra bottle: bottle is exactly `$18`.
4. Renewal: billed at the approved recurring amount.
5. Existing Appstle subscriber: unchanged until an explicit migration pilot.

## Decisions still needed

- Does the 25% discount apply to the first cycle, or after a commitment period?
- Does four selections mean four future delivery cycles, four products in one
  shipment, or a different fixed cadence?
- Does the `$18` rule apply only to the same subscription cart or to a later
  standalone purchase by an active subscriber?
- Which email transport and production/staging subdomains should Base Note use?
- Can Appstle provide an approved contract/payment migration path, or should
  existing customers remain on Appstle until voluntary re-enrollment?

## Explicit exclusions

Ownership transfer, Shopify Balance funds, bank-transfer automation, real
customer billing, profile deletion, and email sending require separate scopes,
controls, and approval. They are not part of this code branch.
