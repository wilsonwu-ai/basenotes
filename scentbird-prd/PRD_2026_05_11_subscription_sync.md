# PRD: Profile → Appstle Subscription Sync ("Queue is the subscription")

**Author:** Wilson Wu / Claude (PM mode)
**Date:** 2026-05-11
**Source of truth for problem statement:** `May 11 2026 tickets.docx` (Jeff Theefs WhatsApp transcript + 10 screenshots, May 5–7 2026)
**Launch deadline:** June 7, 2026
**Status:** Draft → ship within 48 hours

---

## 1. Problem (Jeff's pain, in his words)

> "His order came in this way. Even though he selected Green Irish Tweed."
> "I go to customers and view their next order. Still showing the previous order."
> "We have to connect the profile selection to this customer id or subscription number? If we can link those. I think the problem solves itself."

**Concretely (from screenshots):**

| Surface | What it shows |
|---|---|
| `basenotescent.com/account` — "Your Fragrance Journey" | NEXT SHIP = Parfums de Marly Perseus; queue = Perseus → Silver Mountain → Aventus → Torino 21 → Bond No. 9 |
| Shopify Admin → Appstle Subscription `#17377067226` (Jeffrey Theefs) → Upcoming Orders | All 6 upcoming = "Creed Green Irish Tweed -5ml" (the original signup product) |
| Shopify Admin → Customer Subscription Portal preview | Single product: "Acqua di Gio Profondo Parfum -5ml" — Swap Product link present but unused |
| Order #1029 (Mark McGowan) | Shipped "Xerjoff Alexandria II" though customer reportedly selected something else |

**Root cause:** The customer profile queue (`basenotes_queue` in `localStorage` + the new `customer.basenote.queue` metafield from PRD-4) is *visually* a "lineup" but is **not the source of truth for what Appstle ships**. Appstle keeps shipping the variant set at signup until *somebody* manually clicks "Swap Product" inside Appstle Admin per customer per month. That doesn't scale and is exactly why Jeff upgraded to Business hoping auto-swap would solve it — it won't, because Appstle's "Product Swap Automation" is a manually configured static chain (Product 1 → Product 2 after 1 renewal), not a per-customer dynamic lineup.

**Existing partial scaffold (May 5 deploy, commit aab0969):**

- `assets/bn-appstle-swap.js` — wraps Appstle customer-portal endpoint `/apps/subscriptions/cp/api/subscription-contract-details/replace-variants-v2`.
- `assets/queue-scheduler.js` — manages `basenotes_queue`.
- `templates/customers/account.liquid:1413` — calls `syncNextShipmentToAppstle()` ONLY when `bn_next_shipment` saves (a separate "next pick" UI).
- `worker/queue-proxy` (deployed to `basenote-queue-proxy.basenote-wu.workers.dev`) — syncs queue to `customer.basenote.queue` metafield via App Proxy + HMAC. Does NOT touch Appstle.

**Why the scaffold isn't enough:**

1. **Wrong trigger.** Sync only fires from `bn_next_shipment` save. Reordering the queue (the primary action) does nothing.
2. **Wrong path.** `bn-appstle-swap.js` uses the Appstle customer-portal proxy (`/apps/subscriptions/cp/api/...`). On `basenotescent.com` the proxy mount is unconfirmed; calls likely fail silently behind `console.warn`.
3. **No reconciliation.** If a swap fails, nothing recovers it. Appstle drifts back to the original variant forever.
4. **No verification surface.** Customer sees "Confirmed" in UI even when Appstle wasn't actually updated.

---

## 2. Goal & non-goals

**Goal:** When the customer's *first un-shipped queue slot* changes — for any reason, in any UI — the Appstle subscription's current line item updates to match within 5 seconds, and the customer sees authoritative confirmation that the change is reflected in Appstle.

**Non-goals (for June 7):**
- Letting customers schedule months 2–6 of the queue into discrete Appstle line items per future ship date. Appstle only exposes "current next shipment"; deeper scheduling needs the Business-plan "Swap Cycles" feature, which is a separate workstream.
- Migrating off Appstle.
- Touching billing dates, prices, or skip logic.

---

## 3. Success criteria (acceptance tests)

A. **Queue head edit → Appstle update.** Logged-in customer drags Parfums de Marly Perseus into queue slot 1 (next month). Within 5 seconds, the Appstle Admin "Upcoming Orders" first row shows Perseus. ✅ if exactly that.

B. **Drift recovery.** Force-set Appstle line item to Creed Green Irish Tweed via Admin while queue head says Perseus. Customer loads `/account`. Within 5 seconds of page load, Appstle Admin first upcoming row shows Perseus. ✅ if recovery fires automatically.

C. **Authoritative confirmation UI.** "Next Ship" tile shows a green "Synced to subscription" only when an Appstle round-trip confirms the variant matches. Failed swap shows an amber "Save failed — retry" with a working retry button.

D. **Logged-out / no subscription.** No console errors, no false "Confirmed" badges, no Worker calls. Graceful skip.

E. **Failed Appstle call.** Worker returns 5xx → customer sees the amber retry state and email fallback CTA (`hello@basenotescent.com`). Local queue state is preserved.

F. **Idempotency.** Calling swap twice with the same variant is a no-op (no double-ship risk, no Appstle order-count anomaly).

G. **Auditability.** Every swap (success or fail) is logged with `{contractId, oldVariantId, newVariantId, source, ts}` to Worker tail logs.

---

## 4. Solution architecture (one diagram, one decision tree)

```
                 ┌────────────────────────────────────┐
                 │  Customer @ /account               │
                 │  (queue-scheduler.js owns          │
                 │   basenotes_queue + metafield)     │
                 └──────────┬─────────────────────────┘
                            │  on(queueHeadChanged)
                            ▼
            ┌───────────────────────────────────────┐
            │  bn-appstle-swap.js                   │
            │  swap({handle | variantId})           │
            └──────┬───────────────────────────┬────┘
                   │ Path A (preferred)        │ Path B (fallback)
                   ▼                           ▼
   /apps/subscriptions/cp/api/...    POST basenote-queue-proxy
   (Appstle customer-portal,         /sync-subscription
    no key needed, in session)        ↓ Appstle Admin API
                                      X-API-Key (server secret)
                                      replace-variants-v3
                            ▼
                     Appstle contract line item updated
                            ▼
                  Verification fetch (customer-portal /valid)
                            ▼
                  UI shows "Synced to subscription" ✓
```

**Decision tree at swap time:**

1. Try Path A (customer-portal proxy). 200/204 → verify → done.
2. Path A fails (any non-2xx, or network error) → call Worker `/sync-subscription` with `{customerId, newVariantId}`.
3. Worker validates customer session via App Proxy HMAC (already in place for `/queue`), resolves contract, calls Appstle Admin `replace-variants-v3`. Returns `{ok, contractId, oldVariantId, newVariantId}`.
4. Worker failure → UI amber state, email fallback CTA.

**Why dual-path:** Path A keeps the secret out of the storefront and is instant. Path B exists because Path A has been unreliable in production and is the *actual* root cause of the May 11 ticket. Worker becomes the durable line of defense.

**Reconciliation on every `/account` load:**

```
queueHead = first un-shipped slot in basenotes_queue
appstleCurrent = fetch contract.lines[0].variantId
if queueHead and queueHead.variantId !== appstleCurrent:
    swap(queueHead)  // same code path
```

This is what makes Jeff's "drift" case (success criterion B) recoverable without engineering intervention.

---

## 5. Open questions / risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Appstle customer-portal proxy `/apps/subscriptions/cp/api` not actually mounted on `basenotescent.com` | Verify with one curl during implementation. If broken, Path A is dead — Worker becomes the only path. Don't block on this. |
| R2 | Appstle Admin API rate-limit on reconciliation calls (every page load) | Cache `appstleCurrent` for 60s per customer in `sessionStorage`. Only call swap when mismatch detected. |
| R3 | Customer changes queue head AFTER billing cron fired but BEFORE order placed | Out of scope for v1. Add a "queue locked" lock window in the 24h before billing in v2. |
| R4 | Multiple subscriptions per customer (future) | v1 picks `contracts[0] with status ACTIVE`. Multi-contract UX is v2. |
| R5 | API key leak | Worker holds the only copy as a Wrangler secret. Theme JS never sees it. Already established pattern from PRD-4. |

---

## 6. Out-of-scope (parking lot)

- Future-month per-slot scheduling in Appstle (needs "Swap Cycles").
- Email confirmation when a swap succeeds ("Your June fragrance is locked in: Perseus").
- Admin dashboard for Jeff/Alex showing all customers whose queue head ≠ Appstle line. (Useful, build after launch.)

---

## 7. Definition of done

- [ ] Worker `/sync-subscription` deployed and reachable.
- [ ] Theme JS swap path A unchanged; new path B added; reconciliation on `/account` load added.
- [ ] Acceptance criteria A–G pass in live store on Jeff's test customer.
- [ ] Wilson observes a queue reorder → Appstle Admin upcoming-orders update inside 5 seconds via Playwright MCP.
- [ ] Jeff confirms via WhatsApp.
