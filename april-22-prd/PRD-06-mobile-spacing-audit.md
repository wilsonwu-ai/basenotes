# PRD-06 — Mobile Spacing Audit (#17 Follow-up)

**Ticket:** Wilson's action-item list, item #17 — "Mobile spacing: made general improvements; the specific issues may need screenshots."
**Status:** Planning — **BLOCKED on screenshots from Jeff**
**Owner:** Engineering + Jeff (QA / screenshots)
**Complexity:** Medium
**Dependency:** None — can run in parallel with any other PRD once unblocked.

---

## 1. Context

Jeff flagged mobile spacing issues in an earlier QA pass. General improvements were made; specific cases remained unresolved. Without concrete screenshots, any "fix" is shooting blind — we need targeted before/after evidence.

## 2. Goal

Resolve every reported mobile spacing issue with a specific before/after comparison, and establish a lightweight workflow so future spacing regressions are reported with enough precision to fix on first pass.

## 3. Workflow (the unblocking move)

### 3a. Request from Jeff
Send Jeff (via WhatsApp / email) a short form, one message per issue:

```
Mobile spacing report template:

1. Page URL:
2. Device + viewport (iPhone 14 / Pixel 7 / etc., portrait / landscape):
3. Section or element: (e.g., "hero subtitle sits too close to the Subscribe button")
4. Screenshot (highlight or circle the bad spacing):
5. Expected behavior: (e.g., "more breathing room below hero, like desktop")
```

### 3b. Engineer triage
For each report, reproduce in DevTools mobile emulation at the exact viewport Jeff named, then fix with minimum scope. Never "while I'm in here" refactor spacing globally — that's how #17 became ambiguous in the first place.

### 3c. Verification
Each fix gets a before/after screenshot appended to a running `mobile-spacing-fixes.md` log inside this PRD directory.

## 4. Probable Suspect Pages (pre-screenshot)

Based on the site architecture, these are the pages most likely to have mobile spacing issues and are worth eyeballing proactively while waiting on Jeff:

| Surface | Known risk |
|---------|-----------|
| PDP (`sections/main-product.liquid`) | Fragrance pyramid (top/heart/base notes) is dense; note layers may crowd on mobile. |
| Subscription landing (`sections/subscription-landing.liquid`) | Hero + pricing + how-it-works stack — vertical rhythm often breaks on mobile. |
| Account page (`templates/customers/account.liquid`) | Stat tiles and timeline elements are frequent offenders; see PRD-05 for restyle that may obviate half of these. |
| Cart (`templates/cart.liquid`) + cart drawer (`snippets/cart-drawer.liquid`) | Line-item rows + pricing summary often get tight. |
| Header / hamburger menu | Tap targets for nav items can be too close vertically. |
| Footer | Column collapse on mobile; often ends up cramped. |

## 5. Scope

### In scope
- Collect screenshot-grounded reports from Jeff.
- Fix each reported issue with scoped CSS changes (prefer `padding` / `margin` on the specific element; avoid global resets).
- Log each fix in `april-22-prd/mobile-spacing-fixes.md` with before/after.
- Quick preemptive audit of §4 probable-suspect pages; add anything found to the fix queue.

### Out of scope
- Rebuilding any section layout from scratch (use PRD-05 for account-page restyle).
- Changing global spacing tokens in `config/settings_data.json` without explicit Wilson approval (risks site-wide regressions).
- Typography or color changes — spacing only for this ticket.

## 6. Acceptance Criteria

- [ ] At least 3 specific reports received from Jeff (or preemptive-audit findings), each with a screenshot.
- [ ] Each reported issue fixed in a separate commit with a descriptive message.
- [ ] `mobile-spacing-fixes.md` log populated with before/after for each.
- [ ] Site passes a full walkthrough on iPhone 14 viewport (390×844) and Pixel 7 viewport (412×915) without visible spacing pathology on the surfaces in §4.
- [ ] Jeff signs off on the fixes.

## 7. Verification

- DevTools mobile emulation at each target viewport.
- Real-device test on at least one iOS and one Android device if available (Wilson or Jeff).
- Live push; QA per `memory/feedback_qa_after_changes.md`.

## 8. Open Action

**[For Wilson]**: message Jeff now with the form in §3a and a nudge — "For each mobile spacing issue you still see, send me one quick message with URL + viewport + screenshot + expected. Going to batch-fix them this sprint."
