# PRD — April 23 v2 Tickets

**Source:** `april 23 tickets v2.docx` (Jeff Theefs QA)
**Status:** Planning → Implementation (same turn)
**Author:** Wilson / Claude
**Date:** 2026-04-23

---

## Context

Jeff re-QA'd the post-PRD-01 live site as a logged-in subscriber and surfaced five bugs that break the mental model of Queue vs Next Shipment vs Fragrance Journey. Left unfixed these keep users confused about what's actually shipping.

---

## Issues & Fixes

### A. Fragrance-selector button text clipping + missing filters

**Symptom (Image 1):** Modal "Choose Your Fragrance" shows each product card with a CTA "LECT THIS FRAGRAN..." — text is clipped inside the button. Filters row shows only `ALL / WOODY / FLORAL / FRESH`; missing the other fragrance families (Oriental, Spicy, Musk, Leather).

**Root cause:** Button label "SELECT THIS FRAGRANCE" is too long for the card-narrow button width on mobile. Filter row either omits categories or its tabs don't scroll.

**Fix:**
- Rename CTA to **"ADD TO QUEUE"** (pure "ADD" feels too terse and loses context).
- Make filter tabs horizontally scrollable on narrow viewports and include all families the products actually have.
- Pull the family list dynamically from products so we don't hardcode ones the catalog doesn't support.

**Files:** `snippets/fragrance-selector.liquid`

**Acceptance:**
- [ ] CTA text "ADD TO QUEUE" renders fully on iPhone 14 (390px) without ellipsis or clipping.
- [ ] Filter row shows ALL + every fragrance family present in the product catalog; scrollable if overflowing.

---

### B. Queue "Ships Immediately" wrong — shows already-shipped month

**Symptom (Image 2):** Jeff's April shipment (Bond No. 9 FiDi) already delivered, but "My Subscription List" still shows April 2026 as **Ships Immediately** with FiDi. His real next shipment is Tom Ford in May.

**Root cause:** `queue-scheduler.js` → `slotsFromNow(5)` uses `new Date()` as the first slot. Calendar current month = April. Code doesn't know that April has already shipped. `pruneExpired()` only drops slots whose month is strictly *before* current month, so April survives.

**Fix:**
- Pass the customer's latest shipped subscription-order month into `BasenoteQueue.slotsFromNow()` via a new config call `setShippedThrough(monthStr)`.
- The scheduler uses `max(currentMonth, shippedThrough + 1)` as the first visible slot.
- Auto-compute `shippedThrough` server-side from `customer.orders` (already in scope in `account.liquid`). Pass to the scheduler on account-page load.
- Prune: drop any queue entry whose shipMonth is `<= shippedThrough`.

**Files:** `assets/queue-scheduler.js`, `templates/customers/account.liquid` (inject Liquid-computed last-shipped month).

**Acceptance:**
- [ ] If Jeff's latest shipped order is April, the queue's first slot is May 2026 (not April).
- [ ] "Ships Immediately" label appears only on the first visible slot, and only when that slot's month matches the current billing month from Appstle.

---

### C. Fragrance Journey data mismatch with queue

**Symptom (Image 4 + 2):** Dashboard Fragrance Journey shows MAR = Bond No. 9 Bleecker, APR = Creed Green Irish. Queue shows APR = Bond No. 9 FiDi. Contradiction between "what I received" and "what's queued" for the same month.

**Root cause:** Journey pulls from `customer.orders` (real shipments). Queue pulls from `basenotes_queue` localStorage (user-picked future intent). They can legitimately disagree, but we also let the queue render already-shipped months (see Issue B), which collides with journey.

**Fix (depends on B):**
- Once B is fixed, the queue only shows future months, journey only shows past months, no overlap.
- Add a visual cue on the Journey so the final stop is labeled **Current** instead of just the month short-name.
- Truncate the final visible journey stop at "last month with a delivered shipment" (not current month or later).

**Files:** `templates/customers/account.liquid` — `initFragranceJourney()` JS.

**Acceptance:**
- [ ] Journey stops show strictly months where a subscription order was fulfilled + the "current month in-progress" marker.
- [ ] No month appears in both Journey and Queue simultaneously with different fragrances.

---

### D. "Next Shipment" stat tile shows wrong date

**Symptom (Image 4):** Dashboard stat tile "Apr 7 — Next Shipment". Jeff's real next ship date is **May 21**. Off by over a month.

**Root cause:** `#statNextShipment` is populated client-side. Likely either (1) it's defaulting to "today + 7 days" placeholder, or (2) it's reading Appstle's next-billing date but Appstle returned something stale, or (3) it's reading from a localStorage shadow that's outdated.

**Fix:**
- Identify the JS populating `#statNextShipment` and trace the data source.
- Prefer Appstle API's `nextBillingDate` for the upcoming-charge subscription contract.
- If Appstle unavailable, fall back to computing `(latest shipped order date + 30 days)` — but never default to "today + N".

**Files:** `templates/customers/account.liquid` — search for `statNextShipment`.

**Acceptance:**
- [ ] Tile shows the real next ship date (matches Appstle portal).
- [ ] Never shows a date in the past or a month of the current shipment.

---

### E. "Current subscription: X" vs "Next Shipment: Y" confusion

**Symptom (Image 3):** "Next Shipment: TOM FORD OUD WOOD — Ships in 0 days" directly above "Your current subscription: Creed Green Irish Tweed — Want a different fragrance next month? Swap Now". Two competing statements about what's shipping.

**Root cause:** The `Next Shipment` block shows the *queued or confirmed fragrance for the next ship date*; the `Your current subscription` fallback block shows the *most-recent shipped fragrance* as a way to surface the Appstle swap link. The two blocks mean different things but the copy reads as conflicting.

**Fix:**
- Rename the fallback block copy. Instead of "Your current subscription: X", say **"Last shipped: X — [Ship date]"** with a clear visual separator.
- Move the "Swap Now →" link into the Next Shipment card's action row so there's only one place to manage the upcoming shipment.

**Files:** `templates/customers/account.liquid` — find the `ns-sub-fallback` block.

**Acceptance:**
- [ ] User reading the page top-to-bottom never sees two different fragrances both claimed as "current".
- [ ] "Last shipped" label is past-tense and dated; "Next Shipment" label is future-tense.

---

## Implementation order

1. Issue A (button + filters) — isolated, low risk.
2. Issue B (queue shippedThrough) — foundational for C.
3. Issue C (journey consistency) — depends on B.
4. Issue D (next shipment date) — likely a small data-source swap.
5. Issue E (copy disambiguation) — pure copy, no logic.

All fixes live on the same branch, pushed together after QA.
