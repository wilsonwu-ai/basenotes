# April 22, 2026 — Ticket PRD Set

**Source:** `April 22 tickets.docx` (Jeff Theefs QA + Christina Warner subscriber feedback, 2026-04-15 → 2026-04-22)
**Status:** Planning — NOT yet in execution
**Author:** Wilson Wu
**Brand:** Base Note (basenote.com)
**Platform:** Shopify 2.0 + Appstle Subscriptions + Klaviyo

---

## Framing

These tickets collectively complete the **Phase 4 (pick-in-advance)** deferred work Wilson flagged earlier. The 6 Scentbird screenshots Jeff shared are the **UX wireframe reference** — not a signal that Base Note is expanding into cases/candles/diffusers. Base Note stays fragrance-only.

Christina Warner (paying subscriber) surfaced three customer-facing issues in parallel:
1. Odd "685 months active" on profile landing page
2. Repetitive fragrance note copy
3. Unclear pricing ($15 vs $20) + no visible way to queue future months before checkout

Jeff separately asked for Shopify POS Quick Sale access (admin config) and shared a dashboard mockup he generated with Claude (Image 6 in the doc).

---

## Ticket Index

| # | PRD | Type | Est. Complexity | Owner |
|---|-----|------|-----------------|-------|
| **P1** | [Scentbird-style month-by-month queue UI](PRD-01-queue-ui.md) | Feature | **High** | Eng |
| P2 | [Fix "685 months active" bug on profile](PRD-02-member-since-bug.md) | Bug | Low | Eng |
| P3 | [Subscription pricing clarity (PDP + cart + pre-checkout)](PRD-03-pricing-clarity.md) | UX copy | Low-Med | Eng + Wilson copy |
| P4 | [De-duplicate fragrance note descriptions](PRD-04-note-descriptions.md) | Content | Low (dev) / Med (copy) | Wilson or Jeff (admin) |
| P5 | [Account dashboard restyle to Image 6](PRD-05-dashboard-restyle.md) | UI refactor | Med-High | Eng |
| P6 | [Mobile spacing audit (#17 follow-up)](PRD-06-mobile-spacing-audit.md) | Audit + fix | Med | Eng + Jeff screenshots |
| P7 | [Shopify POS Quick Sale for launch party](PRD-07-shopify-pos-quicksale.md) | Admin config | Low (no dev) | Wilson |

---

## Recommended Execution Order

1. **P7** (Wilson, 10 min, unblocks launch party)
2. **P2** (fast win, customer-visible embarrassment)
3. **P3** (customer confusion driving subscription abandonment)
4. **P4** (Wilson/Jeff author copy in Shopify admin — in parallel with dev work)
5. **P1** (main feature — the framework Jeff wants)
6. **P5** (visual polish on top of P1's new queue data model)
7. **P6** (can run in parallel with any of the above once Jeff sends screenshots)

P1 and P5 share a data model — **P1 must land first** so P5 consumes the real queue data, not mock data.

---

## Cross-cutting Assumptions (apply to every PRD)

- **Pull the live theme before editing** (see `memory/feedback_pull_before_edit.md`) — Jeff may have made admin edits that aren't in git yet.
- **QA on the live site after push** (see `memory/feedback_qa_after_changes.md`).
- **Preserve the Appstle dual-source data layer** on the account page (see `memory/architecture_appstle_api.md`) — order history merges Shopify orders + Appstle API.
- **Fragrance-only scope** (see `memory/project_scentbird_framework.md`) — Scentbird screenshots showing Case/Sample Duo/Diffuser/Car Scent/Candle are wireframe reference only. Do NOT build product-category tabs.
- **First-order discount is 10% via Appstle** (see `memory/project_first_order_discount.md`) — any pricing-clarity copy must reflect this accurately.
- **Subscription = flat $20/month**, monthly only. No tiered "+$5 / +$10 PREMIUM" upcharges (Wilson decision 2026-04-22).

---

## Out of Scope for this Batch

- Season / fragrance type filters (delegated to Jeff or Alex — Shopify admin tagging task).
- Product-category expansion beyond fragrances (Cases, Candles, Sample Duos, etc.) — not in plan.
- Premium / tiered fragrance pricing — decision: keep flat $20/month.
- Anonymous / pre-checkout queue builder — decision: queue is post-checkout only (matches Scentbird's real model).
- Auto-pick algorithm + notification system — tracked separately under Phase 4 later-sprint work.
