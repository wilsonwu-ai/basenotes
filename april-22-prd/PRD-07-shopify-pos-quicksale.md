# PRD-07 — Shopify POS Quick Sale Access for Launch Party

**Ticket:** Apr 22, Image 3 — Jeff: "Could you setup quick sale on Shopify. We can charge new customers right at the launch party." Screenshot shows "Permission required — You don't have permission to create a Quick Sale. Contact the account owner to request access."
**Status:** Planning — **Admin task, no theme code involved**
**Owner:** Wilson (account owner)
**Complexity:** Low (10–15 min Shopify admin work)
**Dependency:** None — do this first.

---

## 1. Context

Base Note has a launch party coming up. Jeff wants to charge customers in person using Shopify POS's Quick Sale feature but is blocked by a permission error — the staff account he's logged into on the POS app doesn't have Quick Sale permission. Only the account owner (Wilson) can grant this.

## 2. Goal

Jeff can open the Shopify POS app at the launch party, tap Quick Sale, enter a custom amount or a subscription SKU, and charge the customer — without hitting the permission wall.

## 3. Steps (for Wilson)

1. **Shopify admin → Settings → Users and permissions → Staff.**
2. Find Jeff's staff account (jeff@basenotescent.com). If none exists, create one and send invite.
3. Under **Apps and channels → Point of Sale**, grant Jeff a POS role. Minimum role needed for Quick Sale is typically **"Cashier"** or higher; for launch-party breadth, **"Associate"** is safer (lets Jeff also apply discounts, look up customers, etc.).
4. Also verify **"Create custom sales"** is enabled for whatever role you assign — that's the specific permission Quick Sale depends on.
5. On Jeff's phone: open Shopify POS app → sign out → sign in with his staff credentials → test Quick Sale. If still blocked, also check that the POS app is linked to the correct store (base-note.myshopify.com).

## 4. Pre-launch Checklist (for Wilson, to run through once permission is granted)

- [ ] POS app installed on at least 2 devices for the launch party (primary + backup).
- [ ] Card reader paired and test-swiped. Shopify Tap & Chip reader recommended if on iOS; Shopify WisePad for Android.
- [ ] Internet / cellular signal at the venue confirmed (POS will queue offline charges but only up to 24h).
- [ ] Receipt email / SMS option tested — preferably email, so the customer lands in Klaviyo for subscription follow-up.
- [ ] A Quick Sale preset configured for "First-month subscription — $18" and another for "Gift: 3-month — $60" (if offered). Presets live in POS app under Quick Sale → edit tiles.
- [ ] Jeff walked through one full test transaction before the party.
- [ ] Backup plan: if POS hardware fails, Wilson has Shopify admin open on laptop and can create a manual draft order + email-to-pay link.

## 5. Scope

### In scope
- Shopify admin permission grant for Jeff (and anyone else working the launch party).
- POS app verification that Quick Sale now works.
- Pre-launch checklist walkthrough.

### Out of scope
- Theme code changes (none required).
- Building a custom POS app / extension.
- Integrating POS sales into Appstle — POS transactions for subscriptions need an Appstle admin step post-party (see §6).

## 6. Post-Sale Subscription Attach (important)

Shopify POS Quick Sale alone does **not** enroll the customer in an Appstle subscription — it just charges them for the one-time amount. For launch-party signups to become recurring subscribers:

- **Option A (recommended):** Collect the customer's email at POS and send them a follow-up Klaviyo email with a pre-filled Appstle signup link. Subscription starts on their self-checkout.
- **Option B:** Wilson manually creates the Appstle subscription in the Appstle admin after the party, using the customer email + payment method collected at POS. More work per customer, less error-prone if volume is low.
- **Option C (avoid):** Manually charge through Appstle admin at the party instead of POS. Slower and depends on reliable internet at the venue.

**Recommendation: Option A** for speed at the party, Option B as a fallback for any customer who doesn't complete the self-checkout email within 48 hours.

## 7. Acceptance Criteria

- [ ] Jeff logs into POS app with his staff account and successfully creates a Quick Sale for a test $1 transaction (refundable test).
- [ ] Pre-launch checklist (§4) complete at least 24 hours before the party.
- [ ] Plan in place (§6) for converting party sales to recurring subscriptions.

## 8. Verification

- Test transaction Jeff confirms end-to-end: tap Quick Sale → enter amount → take card → receipt sent → refund the test amount.
- Confirm the refunded test transaction shows in Shopify admin → Orders, so the POS↔admin pipeline is working.

## 9. Who Does What

- **Wilson (today):** grant staff permission per §3.
- **Jeff (today):** test-sign-in to POS and confirm Quick Sale works.
- **Wilson (pre-launch):** run §4 checklist.
- **Wilson or Jeff (post-party):** execute §6 Option A follow-up sequence.
