# PRD: Protected monthly queue report

## Outcome

Authorized operations staff can view or export a reliable, month-specific list of the customers whose queue has a selection for that fulfillment month, without exposing queue data to customers or unauthorized staff.

This is not a public storefront feature and must not be implemented as a Liquid page, a static CSV in the repository, or an unauthenticated App Proxy route.

## Current anchor

`assets/queue-scheduler.js` defines a queue entry with `shipMonth`, product/variant identifiers, title, URL, image, and timestamps. For logged-in customers, the server-backed customer metafield is the intended source of truth. The existing shopper-facing queue only uses the first upcoming item to synchronize the next subscription contract; a report must not assume later entries are already in a fulfillment system.

## Required business decisions

| Decision | Options / required answer |
| --- | --- |
| Reporting period | Exact `YYYY-MM` definition, timezone, cutoff time, and whether it means planned shipment, renewal date, or fulfillment batch. |
| Included population | Active subscriptions only, or also paused/cancelled/past-due contracts; how to handle no queue selection and duplicate contracts. |
| Queue authority | Whether the report reads only the server-backed queue, reconciles Appstle contract data for the next month, or flags disagreements for manual review. |
| Minimum fields | Default recommendation: internal customer reference, subscription/contract reference, ship month, chosen product/variant, queue state, and last-updated timestamp. Approve any name, email, address, or phone field explicitly. |
| Export behavior | View-only, CSV download, or both; named roles; expiration and retention period; whether CSVs may be stored outside Shopify. |
| Exception handling | Definition and owner for `missing selection`, `locked`, `invalid variant`, `inactive subscription`, and `queue/contract mismatch`. |

## Proposed data contract

Use a server-side report service that receives a validated `month=YYYY-MM` and returns a paginated, deterministic result. It should expose only the approved fields.

| Field | Source | Notes |
| --- | --- | --- |
| `queue_month` | Queue entry | Exact requested month; validate strict `YYYY-MM`. |
| `customer_ref` | Shopify customer ID or opaque internal ID | Never expose a raw record to the browser unless the role is authorized. |
| `subscription_ref` | Appstle/Shopify subscription reference | Used to determine operational status; not a customer-facing identifier. |
| `status` | Reconciled rule | e.g. `ready`, `missing_selection`, `needs_review`, `not_eligible`. |
| `variant_ref` and `fragrance_name` | Canonical product/variant map | Variant is the fulfillment-safe value; display title is not enough. |
| `last_updated_at` | Server queue record | Gives staff an audit signal without inferring a change history. |

The first release should not include postal addresses, phone numbers, payment information, order notes, raw queue JSON, customer notes, or full historical queue data. Fulfillment-address export is a separate, explicitly approved workflow.

## Privacy and security controls

- Require a server-verified Shopify Admin or custom-app session and an allowlist of approved staff roles. Client-side hiding, a predictable URL, or a Shopify customer login is not authorization.
- Enforce authorization on every view, pagination request, and export. Return `403` without revealing whether report data exists.
- Query only the requested month and approved fields; use parameterized/validated filters and a strict `YYYY-MM` parser.
- Keep Appstle and Shopify credentials in server-side secrets. Never send admin tokens, customer metafields, or bulk customer payloads to browser JavaScript.
- Log actor, report month, operation (`view` or `export`), timestamp, and result count. Do not log result rows or personal data. Retain logs according to the approved retention rule.
- Apply row/result limits, pagination, rate limits, and a short export-link lifetime. Exports must use an authenticated, one-time or short-lived download URL.
- Encrypt data in transit and use the platform’s encrypted storage. Do not commit CSV fixtures containing real customer information.
- Provide a revocation test: removing a staff member’s role immediately removes their access.

## Delivery plan

1. Approve the reporting-period, data-field, staff-role, and retention decisions.
2. Inventory the actual server queue storage and Appstle subscription status fields using a non-production/test account; write the reconciliation rules.
3. Implement a private backend/report route and an admin-only UI or protected export endpoint. The endpoint must derive identity from the session, not caller-supplied customer IDs.
4. Add audit logging, pagination, error states, and an exception queue for conflicts.
5. QA with synthetic records and at least two staff roles. Obtain owner approval before production access or export use.

## Acceptance tests

| Test | Pass condition |
| --- | --- |
| Authorized access | An approved operations role can request a valid month and sees only approved columns. |
| Unauthorized access | Logged-out users, Shopify customers, and a staff account without the role receive no data and no record-existence signal. |
| Month isolation | A report for `2026-09` never returns a `2026-08` or `2026-10` queue entry. Invalid month inputs are rejected. |
| Subscription reconciliation | Synthetic active, paused, cancelled, missing-selection, and queue/contract-mismatch cases receive the approved status and do not silently become fulfillment-ready. |
| Data minimization | Browser network responses and CSV exports contain no unapproved fields, secrets, raw JSON, or customer addresses. |
| Export controls | Export requires the same role as viewing, expires as configured, and produces the same rows/columns as the screen after sorting rules are applied. |
| Auditability | A reviewer can identify who viewed/exported which month and when, without recovering customer records from logs. |
| Scale and failure | Pagination works at the approved limit; upstream Shopify/Appstle failure presents a safe retry/error state and creates no partial export. |

## Dependencies and release gate

Depends on the shared decision record, canonical catalog/variant map, authorized role model, and test data. It may be built in parallel with the media inventory after those anchors exist. Production rollout requires security review, role-revocation verification, and an authorized owner’s approval.
