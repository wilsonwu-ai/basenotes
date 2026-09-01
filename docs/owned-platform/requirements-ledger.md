# Owned-platform requirements ledger

This is a sanitized implementation record derived from the merchant’s private
request channel on 2026-09-01. It intentionally excludes chat text, personal
data, account codes, and financial-operation requests.

## Confirmed product requirements

| ID | Requirement | Current local status | Production status |
| --- | --- | --- | --- |
| SUB-01 | Only genuinely new members receive the `$15` introductory first paid cycle. | Pure pricing rule plus positive-only historic-member backfill contracts modeled. | Not connected to a Shopify Function or reconciled customer history. |
| SUB-02 | Former subscribers pay the standard `$20` monthly rate. | Pure pricing rule fails closed when history is unknown; former-member evidence is immutable. | Not verified at checkout or renewal. |
| QUEUE-01 | A future shipment has automatic FOTM plus up to four customer-managed `$18` add-ons. | Revisioned FOTM/add-on state machine, static staging dropdown, D1-shaped repository, and unapplied schema modeled. | No authenticated customer route, actual database, catalog check, or provider write. |
| PRICE-01 | Each future queue add-on costs exactly `$18`, including for an intro-plan subscriber. | Queue schema/service hard-code `1800` cents; current-cart target-price policy remains modeled. | No Shopify Product Discount Function or approved later-order policy. |
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

- Which exact Shopify/store IANA timezone controls the FOTM cutoff and the
  stated `12:01 AM` processing boundary?
- How should future queue add-ons become real subscription order lines:
  supported Appstle bridge, Base Note-owned subscription contract, or a
  customer-approved one-time checkout flow?
- Which email transport and production/staging subdomains should Base Note use?
- Can Appstle provide an approved contract/payment migration path, or should
  existing customers remain on Appstle until voluntary re-enrollment?

## Explicit exclusions

Ownership transfer, Shopify Balance funds, bank-transfer automation, real
customer billing, profile deletion, and email sending require separate scopes,
controls, and approval. They are not part of this code branch.
