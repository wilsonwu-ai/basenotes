# PRD-02 — Fix "685 Months Active" Bug on Account Page

**Ticket:** Apr 22, Image 4 — Christina Warner: "I've been active 685 months already!"
**Status:** Planning
**Owner:** Engineering
**Complexity:** Low (single-file, ~10 min fix + QA)
**Dependency:** None — can ship immediately

---

## 1. Context

Christina Warner (paying subscriber) screenshot of the account page shows a duration readout of roughly 685 months (≈57 years). This is clearly wrong and visible on a customer-facing page, which erodes trust — particularly bad for a subscription product where the account page is the primary retention surface.

## 2. Root Cause

Verified in live `templates/customers/account.liquid`:

- **Line 30/32:** `sub_start_ts = earliest_sub_order.created_at | date: '%s'` (or customer fallback at 32)
- **Line 35:** `diff_seconds = now_ts | minus: sub_start_ts`
- **Line 36:** `months_active = diff_seconds | divided_by: 2592000`
- **Line 37:** minimum-clamp to 1 (but no maximum — why Christina sees 685)
- **Line 140:** rendered as `<span class="acct__stat-num" id="statMonthsActive">{{ months_active }}</span>` — the visible stat.
- **Lines 120 + 316:** also show a separate, correct "Member since {{ customer.created_at | date: '%B %Y' }}" (keep these).

**Arithmetic of the bug:** 685 months × 2,592,000 s = ~1.776 × 10¹². Current Unix epoch is ~1.78 × 10⁹. Ratio ≈ 1,000 → one of the `| date: '%s'` outputs is in milliseconds, not seconds, on this Shopify environment. Dividing-by-1000 would probably "fix" it, but the risk of environmental drift across Shopify rollouts makes the math itself the wrong place to invest.

## 3. Goal

The profile page either shows a correct "Member since [Month Year]" string or a correctly-computed active-duration phrase, never a multi-hundred-month number.

## 4. Decision

**Drop the computed "months active" readout entirely.** Replace with the simple, proven `"Member since {{ customer.created_at | date: '%B %Y' }}"` string. The active-duration is low-value relative to the risk surface of doing timestamp math in Liquid, and Christina's reaction confirms it's net-negative as copy.

Rationale:
- Liquid has no native duration formatter; any math we do is fragile across Shopify environments.
- A "Member since April 2025" line is immediately legible, emotionally positive, and impossible to get wrong.
- If we want active-duration later, do it in JS on the client (`Date.now() - new Date(customer.created_at)`), not Liquid.

## 5. Files to Touch

| File | Change |
|------|--------|
| `templates/customers/account.liquid` lines 30–37 | Delete the `sub_start_ts`, `now_ts`, `diff_seconds`, `months_active`, and minimum-clamp assigns. |
| `templates/customers/account.liquid` line 140 | Remove the `#statMonthsActive` `<span>` entirely, OR replace its surrounding stat tile with a different metric (see §5a). |
| `templates/customers/account.liquid` lines 120, 316 | Keep as-is — already render the correct `Member since {{ customer.created_at | date: '%B %Y' }}` string. No change. |

### 5a. Optional: replace the stat tile with a better metric

If removing `#statMonthsActive` leaves an awkward empty tile in the stats row, replace it with one of:
- **"Fragrances received"** — count of past subscription orders (already fetched on this page via the dual-source Appstle integration — see `memory/architecture_appstle_api.md`).
- **"Current streak"** — consecutive months with a shipment (requires Appstle order iteration; more complex).
- **Just delete the tile** and let the row reflow (simplest, recommended).

**Recommendation:** delete the tile. Tiles on account pages should surface information that changes meaningfully over time and that the subscriber values. Account age is a vanity metric; removing it is net-positive.

## 6. Acceptance Criteria

- [ ] The "685 months" readout is gone from the live account page.
- [ ] Replacement copy reads "Member since [Month Year]" based on `customer.created_at`.
- [ ] No references to `months_active` remain in `account.liquid` or any snippet it includes.
- [ ] Works for brand-new accounts (created today) — should render "Member since April 2026" not blank.

## 7. Verification

- Pull the live theme first (`memory/feedback_pull_before_edit.md`).
- Push fix to theme 158692901082.
- Open the account page as a test customer and as an older customer (if we have a fixture) — confirm both render the correct "Member since" month/year.
- Inform Jeff so he can reply to Christina.

## 8. Risk

None. Pure deletion of buggy code + trivial replacement.
