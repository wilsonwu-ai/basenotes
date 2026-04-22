# PRD-01 — Scentbird-Style Month-by-Month Queue UI

**Ticket:** Apr 22, Image 1 + Image 2 — "Another profile page setup. ScentBird you can scroll up and down to rearrange month by month."
**Status:** Planning
**Owner:** Engineering
**Complexity:** High
**Dependency:** None (precedes PRD-05)

---

## 1. Context

Christina Warner ("It also seems like there isn't a clear way to set up a queue ahead of time?") and Jeff both want Base Note's profile page to match Scentbird's **pick-in-advance** UX: the subscriber sees a timeline of upcoming months (April → May → June → July…) with a fragrance slotted into each, can swap, reorder by drag, and leaves empty months as "Pick Your Next Scent" placeholders that auto-pick later.

This completes the previously-deferred **Phase 4** work. Today, the queue is a flat unordered localStorage list (`basenotes_queue`) with no month mapping, rendered as a "My Rotation" tab on the account page. That's insufficient.

## 2. Goal

Give subscribers a visible, reorderable, month-by-month schedule of upcoming fragrance shipments on the account page, with confidence-building empty-state slots for future months they haven't picked yet.

## 3. User Stories

- As a subscriber, I see my next 4–6 months of shipments at a glance with the fragrance, ship month, and ship status for each.
- As a subscriber, I can drag a fragrance card to swap the order of any two months.
- As a subscriber, I can remove a fragrance from a month (slot returns to "Pick Your Next Scent" empty state).
- As a subscriber, I can click an empty "Pick Your Next Scent" slot and be sent to the fragrance library to pick one.
- As a subscriber, if I take no action, the earliest empty slot auto-picks via the existing fragrance-of-the-month rotation on shipment day (out-of-scope UI here; acknowledge the guarantee in copy).

## 4. Scope

### In scope
- Replace current "My Rotation" tab contents in `templates/customers/account.liquid` with a month-by-month queue block.
- New data model: each queue entry has `{ productId, title, url, image, family, shipMonth: 'YYYY-MM', locked: bool }`.
- Rendering a horizontal card row for 5 months (the active current month + next 4).
- Drag-and-drop reordering between months (HTML5 DnD or SortableJS — prefer SortableJS for touch support on mobile, already-common in Shopify themes).
- Empty-state slot → `href="/collections/fragrances"` with `?queue_target_month=YYYY-MM` query param.
- On fragrance PDP, if `queue_target_month` param is present, the existing "Add to Rotation" CTA becomes "Add to [Month Name] Slot" and writes directly into that slot on save.
- Persist queue to localStorage `basenotes_queue` (existing key) in the NEW shape (migrate on first read — see §7).
- Persist queue to the customer's Shopify `customer.metafields.basenote.queue` namespace via Shopify's AJAX API when logged in, so queue survives device/browser changes.

### Out of scope
- Auto-pick algorithm itself (server-side cron / Appstle webhook) — separate ticket.
- Shipment-day enforcement / locking a month 3 days before ship — separate ticket.
- Pre-checkout (anonymous) queue building — explicitly deferred (Wilson decision).
- Product-category tabs (Case/Candle/Diffuser/Car Scent/Sample Duo) — Base Note is fragrance-only.
- Premium / tiered pricing badges — flat $20/month stays.
- Visual restyle of surrounding account page chrome → handled in PRD-05.

## 5. Acceptance Criteria

- [ ] Queue renders 5 horizontal cards on desktop, scrolls horizontally on mobile, matches Image 2 layout.
- [ ] Drag handle on each card; dragging reorders and persists to localStorage + metafield (if logged in).
- [ ] `X` remove button empties that month slot to "Pick Your Next Scent" placeholder.
- [ ] Empty slot click routes to `/collections/fragrances?queue_target_month=YYYY-MM`.
- [ ] PDP with `?queue_target_month=` renders a modified CTA ("Add to [Month]") that saves directly to that slot.
- [ ] Months auto-roll monthly (`new Date()` compared to `shipMonth` on page load — any slot whose month is < current is considered shipped and falls off the display).
- [ ] Queue data survives a logout/login cycle when the user is a known customer (metafield round-trip).
- [ ] Mobile touch drag works (SortableJS with `touch: true`).
- [ ] No regression in existing "Swap Now" flow that routes to Appstle portal.

## 6. Files to Touch

| File | Change |
|------|--------|
| `templates/customers/account.liquid` | Replace "My Rotation" tab body with new queue block; inject SortableJS; add inline JS for drag/save. |
| `sections/main-product.liquid` (lines ~1534–1588, `addToRotationQueue` fn) | Extend to read `queue_target_month` URL param and write into the targeted slot instead of appending. Modify CTA label conditionally. |
| `assets/theme.js` (or new `assets/queue-scheduler.js`) | New module: `QueueScheduler` with `load()`, `save()`, `reorder()`, `setSlot(month, product)`, `clearSlot(month)`, `migrate(legacyQueue)`, `syncToMetafield()`, `syncFromMetafield()`. |
| `snippets/queue-card.liquid` (new) | Renders one month card (filled or empty state). |
| `config/settings_schema.json` | Add a theme setting `queue_months_visible` (default: 5). |

## 7. Data Migration

Existing localStorage `basenotes_queue` is a flat array `[{productId, title, url, image, family}, ...]` without `shipMonth`. On first load with the new code:

```js
function migrate(legacy) {
  if (!legacy?.length || legacy[0]?.shipMonth) return legacy; // already new shape
  const monthsOut = 5;
  const now = new Date();
  return legacy.slice(0, monthsOut).map((item, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return { ...item, shipMonth: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, locked: false };
  });
}
```

Log migration count to `console.info` for QA observability.

## 8. Shopify Metafield Spec

- Namespace: `basenote`
- Key: `queue`
- Type: `json`
- Owner: Customer
- Write path: `/account/addresses.js` pattern won't work for customer metafields; use a small Shopify App Proxy endpoint OR Appstle customer metafields if their API supports arbitrary JSON. **Open question — resolve during implementation kickoff**: confirm whether Appstle's customer-level metafields are writable from the storefront; if not, we need a tiny proxy via Cloudflare Worker (existing infra per `memory/project_update_payment_method.md` pattern).

## 9. Design Reference

- **Image 1** (in `April 22 tickets.docx`): single-column vertical queue showing April/May/June/July with cards including up/down reorder arrows and X remove. Reference for copy + empty state ("Pick Your Next Scent — If this slot is empty, we'll ship you our curated Fragrance of the Month.")
- **Image 2**: horizontal queue layout ("My Subscription List — Grab and drag to change monthly shipment order") with drag-handle icon, "Ships Immediately" vs "Ships in May" status, and three "+" empty slots labeled "Select Your June Fragrance / July Fragrance / August Fragrance." Use this horizontal layout as the **primary** desktop design; fall back to Image 1's vertical stack on mobile.

Use Base Note brand colors/typography from `config/settings_data.json` (NOT Scentbird's purple-gradient circles). Empty-slot CTAs should use Base Note's existing primary button treatment.

## 10. Verification

- Local: `shopify theme dev --store base-note.myshopify.com` → log in as a test customer → account page → test drag, swap, remove, empty-slot flow on desktop and mobile viewport.
- Staging metafield: write a known queue, log out, log in on a different browser, confirm queue loads from metafield.
- Rollout: push to live theme 158692901082, then QA against `memory/feedback_qa_after_changes.md` checklist.
- Jeff QA pass before announcing to subscribers.

## 11. Open Questions for Implementation Agent

1. Does Appstle's customer-metafield API accept arbitrary JSON writes from a storefront session token? (If no → stand up Cloudflare Worker proxy.)
2. Confirm SortableJS licensing is acceptable for commercial use (MIT — yes, pre-cleared).
3. Confirm `queue_months_visible` default of 5 — or should it be 4 per Image 2? (Default 5, make it a theme setting.)
