# Bug & Change Log

> A running log of every bug or miss uncovered during build + QA. Two lines per entry: **Problem** → **Solution**. Purpose: spot patterns, prevent regressions, improve the process over time.

---

## 2026-04-22

### 1. "685 months active" on account page
- **Problem:** Welcome-banner stat tile rendered "685 months active" because Liquid math `(now_ts - sub_start_ts) / 2592000` was dividing inconsistent units (one side in seconds, the other in milliseconds on this Shopify environment).
- **Solution:** Deleted the broken math + the `#statMonthsActive` tile entirely; kept only the safe `Member since {{ customer.created_at | date: '%B %Y' }}` string.

### 2. Subscription pricing unclear on PDP / cart (Christina Warner feedback)
- **Problem:** Christina could not tell from PDP or cart whether the sub was $15 or $20, how often she'd get shipped, or how to cancel — every pricing surface had slightly different copy.
- **Solution:** Built `snippets/subscription-pricing-summary.liquid` as single source of truth rendered across PDP / cart / cart drawer / subscription landing, with theme settings for first-order price and discount percent.

### 3. Live `templates/customers/account.liquid` was truncated
- **Problem:** The simplified live file ended mid-CSS at `inset: 0__` — no closing `</style>`, no `<script>` block — stripping ~700 lines of queue/view-switch/Appstle interactivity from the account page.
- **Solution:** Restored the file from commit `18344c5` (known-good 1361-line version) before layering new queue code on top; future edits diff against live before pushing.

### 4. Cart titled "Your Queue" — created mental-model confusion
- **Problem:** Cart header + drawer header + empty-state all read "Your Queue (N)", so subscribers believed cart == queue and expected future-month scheduling from the cart.
- **Solution:** Renamed every instance to "Your Cart" in `snippets/cart-drawer.liquid` and `templates/cart.liquid`.

### 5. First-order discount misdocumented as 10% / $18
- **Problem:** Memory + theme-setting defaults claimed 10% off first order = $18, but Appstle's real selling-plan adjustment is 25% off = $15 (confirmed by Jeff's cart screenshot showing $15 line items on a $20 base product).
- **Solution:** Updated `config/settings_schema.json` defaults to `$15` / `25`; rewrote `memory/project_first_order_discount.md` with the correct numbers + a history note.

### 6. No queue-add path on PDP for logged-in subscribers
- **Problem:** Jeff reported "I try to add a scent for next month, it goes to cart" — subscribers browsing any fragrance PDP had no way to queue for a future month; every Subscribe click added to cart.
- **Solution:** Added a customer-gated secondary CTA "Queue for a Future Month" on PDP that opens an in-page month-picker modal, writes directly to `basenotes_queue` localStorage, and routes to `/account#next-shipment`.

### 7. Empty-slot flow lost the `queue_target_month` URL param
- **Problem:** Empty queue slot link `/collections/all?queue_target_month=YYYY-MM` routed to the collection, but clicking a product from there dropped the param → PDP submit couldn't detect the target → selection fell through to cart.
- **Solution:** Replaced the `<a href>` with a button that opens the existing `fragrance-selector.liquid` modal with `window.__bqPendingTargetMonth` set; the global `fragrance:selected` listener checks the flag and routes to `BasenoteQueue.setSlot()` on match.

### 8. "Member since" line sometimes blank
- **Problem:** `customer.created_at` returns empty for some accounts, rendering the welcome-banner line as `Member since` with nothing after it.
- **Solution:** Added a Liquid fallback chain: customer.created_at → earliest_sub_order.created_at → omit the line entirely. Never renders a partial string.

### 9. Filled queue cards had no direct swap action
- **Problem:** Replacing a queued fragrance required three clicks — X remove → click empty slot → pick new.
- **Solution:** Added a "Swap" button on filled queue cards that opens the fragrance-selector modal with the target month pre-set, collapsing the flow to one click.

### 10. Mobile header buttons were 36×36 (below WCAG tap target)
- **Problem:** Header search / account / cart icons were 36×36 px on ≤768px viewports, below WCAG 2.5.5's 44×44 minimum.
- **Solution:** Bumped to 44×44 in `sections/header.liquid` mobile media query.

### 11. No Klaviyo events firing on queue activity
- **Problem:** Marketing had no way to trigger Klaviyo flows when a user queued / swapped / removed a fragrance.
- **Solution:** Added `emitKlaviyo()` inside `BasenoteQueue.setSlot` / `clearSlot` emitting "Added to Queue" / "Swapped Queue Slot" / "Removed from Queue" events with product + month context; safe no-op when `window._learnq` missing.

---

## 2026-04-23

### 12. Fragrance-selector CTA "Select This Fragrance" clipped on mobile
- **Problem:** The modal's per-card button label overflowed its button box on narrow viewports, rendering as "LECT THIS FRAGRAN…".
- **Solution:** Renamed label to "Add to Queue" in `snippets/fragrance-selector.liquid`.

### 13. Fragrance-selector filter tabs appeared incomplete
- **Problem:** All 8 family tabs (All / Woody / Floral / Fresh / Oriental / Leather / Spicy / Musk) existed but only the first 4 fit on mobile, with no visual cue they were scrollable.
- **Solution:** Wrapped `.fs-filters` in a `.fs-filters-wrap` container with a right-edge white gradient fade + slim scrollbar — scrollability is now obvious.

### 14. Queue slot 1 labeled "Ships Immediately" for an already-shipped month
- **Problem:** Jeff's April shipment was already delivered, but the queue's first slot still read "April 2026 · Ships Immediately" because `slotsFromNow(5)` always started at calendar current month regardless of fulfillment history.
- **Solution:** Added `BasenoteQueue.setShippedThrough(monthStr)` API; queue now starts at `max(currentMonth, shippedThrough+1)`; `account.liquid` passes `latest_shipped_sub_order`'s month; "Ships Immediately" label gated to `idx === 0 && monthStr === currentMonth`.

### 15. Fragrance Journey timeline contradicted the Queue
- **Problem:** Journey pulled from any subscription order in `customer.orders`, Queue from localStorage; both could claim different fragrances for the same month → "which is the truth?" confusion.
- **Solution:** Journey now filters `fulfillment_status == 'fulfilled'` only and ends at a single "Current · [Month]" stop anchored to `firstVisibleMonth()`; no month can appear in both Journey and Queue at once.

### 16. Dashboard "Next Shipment" tile showed wrong date (Apr 7 vs real May 21)
- **Problem:** `renderNextShipment()` guessed the next ship date by projecting the original order's day-of-month into the current month, producing fake dates divorced from Appstle's actual schedule.
- **Solution:** Removed the anniversary-guess code path entirely; only the Appstle API fetch now populates `#statNextShipment` and `#nsShipDays`; falls back to `—` placeholder if Appstle is unreachable.

### 17. "Current subscription: X" read as conflicting with "Next Shipment: Y"
- **Problem:** The `ns-sub-fallback` block under the Next Shipment card said "Your current subscription: [old fragrance] — Swap Now →" right below "Next Shipment: [new fragrance]" → two different fragrances both sounded present-tense.
- **Solution:** Renamed copy to past-tense "LAST SHIPPED: [fragrance] · [date]" with visual left-border separator; removed the redundant Swap Now link since the Next Shipment card above already exposes swap/skip actions.

### 18. Account sidebar nav + "Select Fragrance" button did nothing on click
- **Problem:** Clicking My Queue / Order History / Fragrance History / Select Fragrance did nothing. Router listened only for `window.hashchange`, which doesn't fire when an `<a href="#x">` matches the current hash, and could fail silently on defer-script race conditions.
- **Solution:** Added explicit click handlers on every `a[href^="#"]` matching a known route — calls `navigate()` directly, independent of hashchange. Plus `MutationObserver` re-binds any route links injected client-side, and `history.replaceState` keeps URL in sync without triggering loops.

### 19. Promo popup re-triggered on every page after clicking through
- **Problem:** `snippets/promo-popup.liquid` set `bn_promo_seen` only on close/overlay/Escape flows, not on the CTA click. Users who engaged with "Start Your Journey" were never marked as "seen" → popup reappeared on arrival at the collection page, looping.
- **Solution:** Added a click handler on `.promo-popup__cta` that writes `bn_promo_seen='1'` before navigation proceeds. Engaging with the offer now counts as "seen".

### 20. Sidebar nav clicks still did nothing after per-link binding fix
- **Problem:** First fix attached click handlers to each `a[href^="#"]` in bubbling phase, but clicks still didn't work live — likely because theme.js's pre-existing bubbling-phase handler and attachment-order dependencies combined to block ours.
- **Solution:** Replaced with document-level event delegation in CAPTURE phase. Intercepts every in-page-hash anchor click before any element-level handler, calls `preventDefault + stopImmediatePropagation`, then `navigate()` directly. No per-link binding, no MutationObserver, no stale refs.

### 21. `/account/addresses` visually inconsistent with `/account`
- **Problem:** The Addresses page still used the old `.account-layout` / `.account-nav` / `.account-nav__link` design system (predating PRD-05), so typography, sidebar structure, welcome banner, and card treatment all looked different from the dashboard.
- **Solution:** Rewrote `templates/customers/addresses.liquid` to mirror account.liquid — same `.acct__layout` grid, identical sidebar (6 nav items in matching order, same icons, `acct__*` classes), dark-teal welcome banner, card-based address grid with gold badge for default, restyled form with uppercase-eyebrow labels.

---

## How to use this log

- When a new bug is reported, add a new entry at the bottom under today's date with the two-line format.
- Keep entries short — link to commits or PRDs for detail.
- Review monthly for patterns (e.g., "three bugs this month came from stale memory files" → fix memory discipline).
