# Queue "next month" roll — what we changed

**Short version:** Your diagnosis was exactly right. The queue's "current / next-editable month" was advancing on a **calendar rule** (3 days before month-end) instead of **when the order actually happens**. We changed the trigger so it now rolls forward **the moment a subscription order is placed** — "the day after the order," like you said.

## What was wrong

The account page computes which month is the "next editable" slot via `firstVisibleMonth()`. It had two ways to advance:

1. **Event-based (what should drive it):** a value called `shippedThrough`, set from your most recent subscription order.
2. **Calendar fallback:** if there are fewer than 3 days left in the month, roll to next month.

The bug: `shippedThrough` was being fed **only from orders marked `fulfilled` in Shopify** (`fulfillment_status == 'fulfilled'`). When fulfillment lags the charge — or the order never gets marked fulfilled (e.g. shipping outside Shopify) — the event-based path never fires. That leaves **only the 3-day calendar buffer** to move the view. Hence exactly what you saw: it rolls ~3 days before month-end instead of right after the order.

## What we changed

One targeted change in `templates/customers/account.liquid`: `shippedThrough` is now fed from **`latest_sub_order`** (the most recent subscription order, *any* status) instead of the fulfilled-only order. Three spots: the two `data-shipped-through` attributes and the `setShippedThrough(...)` call.

Result: **the moment this cycle's order is placed/charged, the editable window advances to next month.** That's correct because once a cycle is charged, that month's scent is locked anyway — so the next thing you can change is next month.

The "Last Shipped: [fragrance]" card still reads from the truly-*fulfilled* order, so that display stays accurate.

## How we verified it (before you test)

We ran the real queue engine (`assets/queue-scheduler.js`) through an automated harness (`tests/queue-scheduler.qa.js`) — `node tests/queue-scheduler.qa.js`. All 6 scenarios pass:

| # | Scenario | Result |
|---|----------|--------|
| 1 | Order placed this month → view rolls to **next** month | ✅ rolls (the fix) |
| 1b | Upcoming slots start next month | ✅ `[Aug, Sep, Oct]` |
| 2 | No order detected, mid-month → **stuck** on current month | ✅ reproduces the old bug |
| 3 | No order, <3 days left → calendar buffer still rolls it | ✅ fallback intact |
| 4 | Month-end charge (Jun 30 for Jul) → off-by-one | ✅ known caveat (below) |
| 5 | Repeat trigger → no infinite-loop | ✅ safe |

## How you can test it

1. Open the preview theme for the `fix/queue-roll-on-order-placed` branch (Shopify admin → Online Store → Themes → Preview).
2. Log into an account whose subscription has a **placed order for the current month**.
3. Go to the account page → the "upcoming fragrances" queue.
4. **Expected:** the first editable slot is **next month**, not the month that already ordered — without waiting for month-end.

## One known caveat (not fixed in this change)

Because it keys off the order's **created-at month**, a renewal charged on the **last day of a month for the next month's shipment** (e.g. charged June 30 for the July shipment) can be off by one. The permanent cure — for this and the separate "ship date" display — is to read **Appstle's actual next-billing-date** instead of inferring the cycle from calendar math. We can do that as a follow-up if month-end renewals are common for you.
