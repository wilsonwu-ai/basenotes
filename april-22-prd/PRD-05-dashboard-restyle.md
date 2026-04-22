# PRD-05 — Account Dashboard Restyle to Match Image 6 Mockup

**Ticket:** Apr 22, Image 6 — Jeff: "This is the profile page [generated via Claude]. With the Shopify skills and front-end dev skills we can create something even more refined."
**Status:** Planning
**Owner:** Engineering (frontend-design agent recommended)
**Complexity:** Medium-High
**Dependency:** **Depends on PRD-01** (queue data model must land first so this consumes real data, not mocks).

---

## 1. Context

Jeff produced a dashboard mockup (Image 6 in `April 22 tickets.docx`) using Claude Design. It shows:

- Left sidebar: brand lockup (Base Note logo), nav items (Dashboard, My Fragrances, Queue, Orders, Profile).
- Top-right: "Welcome, Olivia" greeting.
- Status strip: "Subscription Status: Active · Next Shipment: October 15."
- Full-width card: "Your Fragrance Journey" — horizontal timeline of past + upcoming months with small avatar dots for each recipient/month.
- Two side-by-side cards: "Manage Subscription" (current fragrance + Pause Subscription CTA) and "Your Queue" (three-up fragrance preview + Place Ahead CTA).
- Full-width card: "Order History" table with Date / Fragrance / Fragrance Type / Status / Details columns.

The current live `account.liquid` (~677 lines, recently simplified by Jeff/Alex per `memory/project_account_page_live_simpler.md`) already has the equivalent sections via tabs (Dashboard, History, My Rotation, Addresses). The content is right; the visual treatment is not at the polish level Jeff wants.

## 2. Goal

Restyle the current account page so that it visually matches the refinement of Image 6 — card-based layout, Fragrance Journey timeline, improved hierarchy — **without rebuilding the underlying data layer or breaking the Appstle dual-source integration.**

## 3. Decision (Wilson confirmed 2026-04-22)

**Restyle the current shell, don't rebuild from scratch.**

Rationale: the existing `account.liquid` already merges Shopify order history + Appstle API (see `memory/architecture_appstle_api.md`), renders correctly, and was just cleaned up. A from-scratch rebuild would force us to re-implement the dual-source merge and risks regression on a live, paid-customer surface. A restyle ships the Image 6 aesthetic at ~30% of the effort.

## 4. Scope

### In scope
- Convert the current tabbed layout into a sidebar-nav layout (Image 6 pattern): tabs become sidebar items with brand lockup on top.
- Top-right welcome + subscription status strip (active / paused / cancelled + next ship date from Appstle).
- Net-new "Your Fragrance Journey" card — horizontal timeline rendering past shipments + upcoming queue slots from PRD-01's data model.
- Convert Dashboard body into card-based layout: "Manage Subscription" card + "Your Queue" preview card side-by-side.
- Keep the Order History table — improve styling to match Image 6's density and column order.
- Apply Base Note brand tokens (colors, typography) — do NOT copy Image 6's green (#1D4D3A-ish) sidebar if it conflicts with Base Note's palette. Use the brand palette from `config/settings_data.json`.
- Mobile-first: sidebar collapses to top nav / hamburger on mobile.

### Out of scope
- Changing the Appstle data integration — keep dual-source logic intact.
- Building the queue drag-and-drop itself — that's PRD-01.
- Adding new account pages beyond what's already rendered (e.g., no net-new "Wishlist" or "Settings" tabs).
- Extra fragrance imagery or 3D treatments in the Journey timeline — keep it simple dots + labels on v1.

## 5. Files to Touch

| File | Change |
|------|--------|
| `templates/customers/account.liquid` | Primary restyle. Restructure top of page into sidebar + main-content two-column layout. Refactor tab content into card blocks. |
| `assets/theme.css` (or `sections/account.css.liquid` if already scoped) | Add new card / sidebar / journey-timeline CSS. Prefix everything with `.acct__` to stay scoped. |
| `snippets/account-sidebar.liquid` (new) | Sidebar nav component. |
| `snippets/account-journey.liquid` (new) | Fragrance Journey horizontal timeline — reads from `QueueScheduler` (PRD-01) + past orders. |
| `snippets/account-card.liquid` (new) | Reusable card container (for Manage Subscription, Your Queue preview, etc.). |

## 6. Design Reference

- **Image 6** (`April 22 tickets.docx`): primary mockup.
- **Base Note brand palette + typography** from `config/settings_data.json`. Do NOT replicate Image 6's Claude-generated green sidebar verbatim — apply Base Note colors.
- If the `frontend-design` skill is in use, invoke it here; Image 6 is a good Claude-gen starting mockup and benefits from the skill's iteration patterns.

## 7. Acceptance Criteria

- [ ] Account page visually matches the **spatial layout + card hierarchy** of Image 6 (sidebar + main + card stacks).
- [ ] Sidebar nav items: Dashboard / My Fragrances / Queue / Orders / Profile (map to existing tab contents).
- [ ] Welcome strip shows customer first name, subscription status, and next ship date (from Appstle).
- [ ] "Your Fragrance Journey" timeline renders with past months (from order history) and upcoming months (from PRD-01 queue data).
- [ ] "Manage Subscription" and "Your Queue" render as side-by-side cards on desktop, stacked on mobile.
- [ ] Order History table preserves its dual-source data (no regression vs current).
- [ ] Mobile viewport: sidebar collapses, cards stack, horizontal journey timeline scrolls with inertia.
- [ ] Base Note brand colors only — no placeholder greens or Scentbird purples.
- [ ] No regression in Appstle integration (swap, pause, cancel flows still route correctly).

## 8. Verification

- Local: log in as a test customer with active subscription + at least 2 past orders. Walk through each sidebar tab.
- Log in as a brand-new customer (no orders yet) — Journey timeline must render an empty-state gracefully.
- Mobile: test on actual device or DevTools mobile emulation for iPhone SE, iPhone 14, Pixel 7.
- Appstle round-trip: pause subscription from the new UI, confirm pause reflects in Appstle admin.
- Push to live 158692901082; Jeff QA pass before announcing.

## 9. Open Questions

1. Does Image 6's "Fragrance Journey" timeline need individual avatar images per month, or is a dot + label sufficient for v1? **Recommendation: dot + label for v1; add mini bottle images in v2.**
2. Sidebar-on-mobile: hamburger menu vs bottom-tab-bar? **Recommendation: hamburger (Shopify customer convention).**
3. Should "Pause Subscription" be a direct action or route to Appstle portal? **Recommendation: route to Appstle portal — don't duplicate Appstle UX in the theme, per `memory/project_update_payment_method.md` pattern.**
