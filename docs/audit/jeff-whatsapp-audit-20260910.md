# Jeff WhatsApp feedback audit — September 10, 2026

I reviewed the WhatsApp exports currently stored in the original project folder (`website_comments_v1`–`v7`, April/May tickets, and the July 16–24 ticket exports). The latest dated feedback in those files is July 24, 2026; no newer WhatsApp transcript is present in the repository. Screenshots were treated as evidence of the reported state, not as current production truth.

## Findings and disposition

| Jeff's report | Evidence | Current disposition |
| --- | --- | --- |
| Account shows the previous shipment as the next one; dates disagree between the account and Appstle | May 11–12, July 16–17 exports; examples include April 7 vs April 20 and a prior scent shown as next | **Fixed in source in this pass.** The account no longer derives a next date from the previous order or local storage. It waits for the Appstle contract response, then paints the actual next date and line. If Appstle is unavailable it explicitly says the date is pending instead of guessing. |
| Queue disappears or differs between devices | April 30 export | Existing cross-device App Proxy sync remains in place. A full authenticated multi-device test requires a customer session and was not fabricated. |
| Swap filter returns no fragrances | July 16 export | **Already fixed in current source.** `fragrance-selector.liquid` derives filters from the actual rendered taxonomy/metafield vocabulary and scopes tabs and cards to the same collection. Existing browser checks cover filter/search behavior. |
| Queue selection accidentally goes to cart / wording causes confusion | April 23 and March 23 exports | **Already fixed in current source.** Account queue selection writes a queue slot; collection cards are explicitly one-time adds with visible cart confirmation; PDP has an explicit one-time vs Monthly Rotation choice. |
| Scent quiz did not work | March 23 export | Jeff later approved removing the quiz. Current homepage and collection discovery surfaces contain no quiz CTA; the legacy quiz template remains only as an unlinked route for safe rollback. |
| Product page does not show subscription / Appstle 25% offer | July 16–17 and March exports | Current live PDP visibly exposes “Monthly Rotation subscription” when the vial has a selling plan and discloses first/renewal prices. The 25% figure is not asserted because the live plan data is the authority; Appstle account/discount entitlements cannot be repaired from theme Liquid alone. |
| Cancel/pause controls and cancellation notification | April 30 and July 24 exports | Current account flow calls the real subscription endpoint and falls back to a mailto request if automatic cancellation fails. Email delivery to Jeff is an operational/Appstle or worker configuration concern; no unverified email claim was added. |

## Change made

`templates/customers/account.liquid` now has one source-of-truth rule for dates and next fragrance:

- no previous-order anniversary calculation;
- no local-storage billing-date fallback;
- no first-of-month placeholder presented as a real renewal;
- Appstle `nextOrderDate`/billing date and active contract line populate the dashboard;
- a pending message explains that the subscription portal has not confirmed the date yet.

This prevents the exact false “April 7 / April 20” and “previous shipment = next shipment” states Jeff reported. It does not pretend to repair a missing or incorrect Appstle contract; that requires authorized subscription-app access and a real customer session.

## Verification boundary

Public, unauthenticated QA can verify the product page, collection filters, one-time cart path, Monthly Rotation disclosure and homepage. It cannot verify a customer's Appstle contract, swap, pause, cancellation, or cross-device queue without using an authorized test account. No order, checkout, customer record, or newsletter submission was created for this audit.
