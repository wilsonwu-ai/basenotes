# PRD — April 30 2026 Sprint

**PM:** Wilson Wu | **Source:** `April 30 2026 tickets.docx` | **Reporter:** Jeff Theefs

This document covers six tickets surfaced 2026-04-26 → 2026-04-29. Each ticket below is structured for direct hand-off to a subagent: Problem → Acceptance Criteria → Implementation Notes → Files → Agent/Skill → QA.

---

## PRD-1 — Reorder account dashboard (Upcoming above Shipped)

**Problem.** On `/account`, the dashboard renders **Shipped** above **Upcoming (X of 5 picked)**. Jeff wants them swapped — Upcoming should appear above Shipped so the customer sees the next-action queue first.

**Acceptance criteria.**
- On `/account`, the order is: `NEXT SHIP + CHARGE` card → `UPCOMING (n of 5 picked)` → `SHIPPED`.
- Same order on logged-in mobile + desktop.
- Both the standalone-router renderer AND any legacy renderer in `account.liquid` updated (current account page has both per `project_session_2026_04_23.md`).

**Implementation notes.**
- Pure DOM-order swap. No data-model changes.
- Watch for parse-error script around line 2126 of `account.liquid` — don't accidentally fix-or-break it; that's PRD-5's territory.

**Files touched.** `templates/customers/account.liquid`, plus any `assets/account-router*.js`.

**Agent.** `frontend-design` (small surgical edit) or direct `Edit`.

**QA.** Load `/account` logged in; confirm visual order; confirm on a second device (validates this isn't a localStorage artifact).

---

## PRD-2 — Per-fragrance fact-sheet system (referral-ready)

**Problem.** A high-quality launch fact sheet exists for Creed Aventus (`Base Note — Creed Aventus Fact Sheet.pdf`). Jeff wants the same template re-used across the catalogue and made shareable as a referral asset.

**Acceptance criteria.**
- A reusable Liquid template (`templates/page.fact-sheet.liquid` or `sections/fact-sheet.liquid`) renders the Aventus layout dynamically from product metafields:
  - **Hero block:** product image, "BASE NOTE", "MADE IN [country]", category eyebrow ("THE ICON"), product title, brand · concentration, tasting copy.
  - **Body:** Key Notes (Top / Heart / Base columns), Vibe & Personality tag pills, Best For bullet list, Pro Tip card.
  - **Footer CTA:** "Join Base Note — your first month just $15", QR code to `basenotescent.com`.
- An index page at `/pages/fact-sheets` listing all live fact sheets.
- Each fact sheet has:
  - **Preview** button → renders the styled HTML page.
  - **Download** button → static PDF (one per fragrance).
- PDFs are stored in `/assets/fact-sheets/` (or Shopify Files) and named `factsheet-{handle}.pdf`.
- Linked from the product page (PDP) via a small "Download fact sheet" CTA below the buy box.

**Implementation notes.**
- **Phase 1 (this sprint):** Ship Aventus only end-to-end as the template-of-record. Upload the PDF as a Shopify File, link from `pages/fact-sheet-aventus`. Build the dynamic Liquid template but seed only Aventus content.
- **Phase 2 (next sprint):** Backfill metafields for the rest of the catalogue and auto-generate per-product fact sheets.
- **Metafields needed (Shopify Admin → Settings → Custom data → Products):**
  - `factsheet.eyebrow` (text — e.g. "THE ICON")
  - `factsheet.tagline` (multi-line text)
  - `factsheet.notes_top`, `factsheet.notes_heart`, `factsheet.notes_base` (text/list)
  - `factsheet.vibe_tags` (list.single_line_text)
  - `factsheet.best_for` (list.single_line_text)
  - `factsheet.pro_tip_title`, `factsheet.pro_tip_body` (text)
  - `factsheet.pdf` (file_reference)
  - `factsheet.country` (single_line_text — e.g. "France")
- **PDF generation strategy:** for now, manual upload of the existing Aventus PDF. Long-term, a Cloudflare Worker / Vercel function rendering the Liquid HTML to PDF via Puppeteer is the right path (out of scope for sprint).

**Files touched.** New: `sections/fact-sheet.liquid`, `templates/page.fact-sheet.liquid`, `templates/page.fact-sheets-index.liquid`, `snippets/factsheet-cta.liquid`. Edit: `sections/main-product.liquid` (CTA), `config/settings_schema.json` (metafield surfacing if needed).

**Agent.** `frontend-design` for the Liquid template + visual fidelity to the PDF; coordinate with the PM on copy.

**QA.** Aventus fact-sheet page renders pixel-close to the PDF on mobile + desktop; PDF download link works; `/pages/fact-sheets` index lists Aventus; PDP shows CTA.

---

## PRD-3 — Host fragrance application guide on site

**Problem.** Jeff sent `fragrance-application-guide.html` (an 800-line self-contained styled page on pulse points, concentration, do's & don'ts, layering). He wants it added to the website.

**Acceptance criteria.**
- Live at `/pages/fragrance-application-guide` (or `/blogs/journal/fragrance-application-guide`).
- Renders inside the Base Note theme chrome (header + footer), not as a raw orphan page.
- A "Download as PDF" button on the page (link to a Shopify File-stored PDF version).
- Internal nav: linked from PDP "Tips" section, account page "Resources", and footer "Learn".
- Existing inline styles in the HTML are preserved or migrated to a scoped section stylesheet so they don't bleed into the rest of the theme.

**Implementation notes.**
- **Recommended path:** Convert the standalone HTML to a Shopify section/template:
  - Lift `<style>` block into `assets/section-application-guide.css` (or scope under `.application-guide` in `theme.css`).
  - Lift `<body>` content into `sections/application-guide.liquid`.
  - Create `templates/page.application-guide.liquid` that renders the section.
  - Create the Shopify Page in Admin pointing to that template.
- Preserve Cormorant Garamond + Montserrat font loading — already used in fact-sheet design system; consolidate at theme level.
- "Download PDF" — generate once with Chrome's Print → Save as PDF, upload as Shopify File. Future: same Puppeteer pipeline as PRD-2.

**Files touched.** New: `sections/application-guide.liquid`, `templates/page.application-guide.liquid`, `assets/section-application-guide.css`. Edit: `sections/main-product.liquid`, `sections/footer.liquid`.

**Agent.** `frontend-design` (visual fidelity) + `senior-frontend` (CSS scoping / font dedup).

**QA.** Page loads at canonical URL with theme chrome; nav pills work (anchor scroll); PDF download serves a valid file; mobile layout unbroken.

---

## PRD-4 — Cross-device queue persistence (server-backed) ⚠ **needs architecture sign-off**

**Problem.** Customer queue (`localStorage["basenotes_queue"]`) disappears every other day and never syncs across devices. Jeff confirmed this on his own account. This is a **conversion-killer** — customers are doing the highest-intent action (curating their rotation) and watching it vanish.

**Why localStorage broke down.**
- Each device + browser has its own localStorage; no sync layer.
- Safari aggressive eviction (7-day cap on storage for sites without engagement) → the "every other day" pattern is consistent with Safari ITP.
- Incognito sessions, browser cleanups, OS updates all wipe it.

**Architecture options (need PM/Wilson sign-off before build).**

| Option | Where queue is stored | Pros | Cons | Build effort |
|---|---|---|---|---|
| **A. Shopify customer metafields via App Proxy** ★ recommended | `customer.metafields["basenotes"]["queue"]` (JSON) | Native Shopify, no new vendor, persists per-customer, GDPR-clean (deletes when customer deletes), free | Requires a tiny serverless endpoint (Cloudflare Worker / Vercel) signed by App Proxy to write metafield via Admin API; ~150 LOC + Shopify App Proxy setup | 1–2 days |
| **B. Appstle subscription contract attributes** | Stuffed into Appstle contract `note_attributes` | No new infra at all, syncs with the subscription itself | Appstle contract attributes have undocumented size limits, mixing queue data into billing-critical objects is risky, only works once a subscription exists (not pre-purchase) | 0.5 day |
| **C. External database (Supabase / Firebase) via App Proxy** | Postgres/Firestore row keyed by `customer.id` | Most flexible, easy querying for analytics | New vendor, new $0–$25/mo line item, more attack surface, more to maintain | 1–2 days |

**Recommendation: Option A.** Native to the platform we're already on, no new vendor relationship, customer-data-deletes-with-customer satisfies privacy by default, and metafields are queryable from the Storefront API for read paths (write still goes through the proxy). Migration of existing localStorage queues is one-shot on next login.

**Acceptance criteria (assuming Option A approved).**
- Logged-in customer's queue is read from + written to `customer.metafields.basenotes.queue` (JSON array).
- Read path: theme JS hits `/apps/basenote/queue` (App Proxy → Worker) → Worker reads metafield via Admin API → returns JSON. Cache in `localStorage` as warm cache for 60s.
- Write path: theme JS POSTs queue mutations to same endpoint; Worker validates Shopify proxy signature, writes metafield.
- Logged-out users: continue to use localStorage (no regression).
- On login: merge localStorage queue into server queue (server wins on conflict, but unique items added).
- Queue survives: device switch, browser refresh, Safari eviction, 30-day inactivity.

**Implementation notes.**
- Shopify App Proxy must be configured in a (private) custom Shopify app — Wilson needs to confirm whether the existing dev/private app can host the proxy or a new one needs creating.
- Worker code: `~150 LOC TypeScript` — schema validation (zod), Shopify proxy HMAC verify, Admin API client. Hosted on Cloudflare Workers (free tier sufficient).
- Secrets: Admin API access token, app proxy shared secret. Stored as Worker env vars, not in repo.

**Files touched.** New: `worker/queue-proxy/` (separate repo or subdir). Edit: `assets/theme.js` (or new `assets/queue-store.js`), `templates/customers/account.liquid`, `snippets/cart-drawer.liquid`.

**Agent.** `senior-backend` (Worker + Admin API) + `senior-frontend` (theme JS refactor) + `senior-architect` (review the proxy auth flow before build).

**QA.** Add 3 fragrances on Device A (Chrome desktop) → log in on Device B (Safari iOS) → queue identical. Wait 48h on Safari → queue still present. Logout → queue still in customer record. Login as different customer → queue isolated.

**Sub-agents wait until Wilson approves Option A.**

---

## PRD-5 — Fix Pause + Cancel buttons on /account

**Problem.** Customer-reported (relayed via Jeff): "the cancel and pause button didn't work."

**Confirmed root causes (after inspecting live theme — Jeff edited between sessions).**

1. **Pause button has never been implemented.** Standalone router (`account.liquid:790-794`) and big inline script (`account.liquid:1772-1778`) both fall back to an `alert("email hello@basenotescent.com")`. There is a `// TODO: Appstle API — pause subscription` comment in place of the real call. "Didn't work" is literal: the feature is a stub.

2. **Cancel button likely works** (handler intact in standalone router AND big inline script — both dispatch `cancellation:open`). Possible Jeff was confused by the modal appearing but not being submittable, or the cancellation-flow snippet itself has a bug. Needs reproduction before assuming it's broken.

3. **Skip button** (newly added by Jeff in this drift) is also an alert-only stub. Same Appstle TODO.

4. **Diagnostic banner is currently visible to customers in production** (Jeff re-enabled it; matches screenshots in tickets). Needs to be hidden once the underlying issues are fixed.

**Acceptance criteria.**
- "Pause" button on `/account` triggers a real Appstle pause API call; UI reflects new state; confirmation toast on success; error surfaced to user on failure.
- "Cancel" button triggers cancellation flow with confirm modal; cancellation takes effect on next renewal date (per business rule in `MEMORY.md`); handler is **dual-pathed** so it can't be killed by a parse error elsewhere in the file.
- Diagnostic banner (red/green ROUTER DIAG strip) hidden from production once both buttons verified working.
- Console shows zero parse errors on page load.

**Implementation notes.**
- Step 1: implement Pause via Appstle API. Reference `architecture_appstle_api.md` for the dual-source pattern. Endpoint: Appstle subscription contract `pause` action; needs customer access token. Confirmation modal: "Pause for 1 / 2 / 3 months?"
- Step 2: restore the cancel safety-net in the standalone router (the handler Jeff removed). This is the resilient layer — if the big inline script ever parse-errors again, the standalone router still catches the click.
- Step 3: extract the inline `<script>` block (~lines 1086–2135 of account.liquid) to `assets/account-actions.js`. Inline scripts of that size are fragile; an external file gets proper syntax checking and caching. This addresses the *recurring* parse-error class of bug, not just the current instance.
- Step 4: gate the diagnostic banner behind a `?diag=1` query param so Jeff can re-enable for debugging without exposing it to customers.
- DO NOT bypass Appstle — these flows must go through the subscription provider, not direct Shopify cancellation.

**Files touched.** `templates/customers/account.liquid`, possibly new `assets/account-actions.js`, possibly `snippets/account-subscription-card.liquid`.

**Agent.** `superpowers:systematic-debugging` (reproduce + root-cause first) → `senior-frontend` (fix).

**QA.** Active subscription on a real test customer: click Pause → verify in Appstle dashboard the contract is paused. Click Cancel → confirm modal → verify Appstle shows cancellation scheduled for next renewal. Cross-device retest.

---

## PRD-6 — Shipping FAQ (TX & Chicago inquiry)

**Problem.** Customer email (bennettadalynkaylee@gma...) asking *"do you currently offer shipping to locations in Texas and Chicago?"* signals that the site doesn't visibly answer "where do you ship." Even if Shopify zones are correct, the silence is costing conversions.

**Acceptance criteria.**
- A `/pages/shipping` page exists with: "We ship to all 50 US states" headline, free-shipping threshold (if any), expected delivery window, returns blurb.
- A one-line shipping reassurance on the PDP buy box: "Free shipping to all 50 US states." (or accurate copy).
- Footer link: `Help → Shipping & Returns`.
- An auto-reply email template handed to Jeff for hello@basenotescent.com inbox (Klaviyo or Gmail snippet).

**Implementation notes.**
- First, **verify in Shopify Admin → Settings → Shipping that all 50 states are actually covered.** TX and Chicago/IL specifically. If not, fix the zones before publishing the page (don't promise what we don't deliver).
- Use existing page template; copy can be drafted by `marketing-psychology` skill.
- This is a 1-hour task once the zones are confirmed.

**Files touched.** New: `templates/page.shipping.liquid` (or use `page.liquid`), Shopify Admin page entry. Edit: `sections/main-product.liquid` (one-line reassurance), `sections/footer.liquid` (footer link).

**Agent.** `frontend-design` for the page; `marketing-psychology` for the copy; Wilson manually verifies Shopify shipping zones.

**QA.** `/pages/shipping` resolves; PDP shows the one-liner; footer link works; Shopify shipping calculator at checkout accepts a TX address and a Chicago/IL address with valid rates.

---

## PRD-8 — ROSCA renewal disclosure regression (compliance) — **CLOSED, no action needed**

**Resolution (2026-04-30, end of session).** The session-start hook's working-tree diff appeared to show both `{% render 'subscription-renewal-disclosure' %}` calls removed from PDP and cart-drawer. Re-inspected at end of session: both are present in the current working tree at `sections/main-product.liquid:189` and `snippets/cart-drawer.liquid:164`, with **no diff vs HEAD**. Wilson confirmed Jeff did not edit. Best read is that the earlier "drift" diff I cited was either misread or an ephemeral state that reconciled. Closing without action.

---

## QA-7 — Post-deploy verification (after each PRD ships)

**Run for every PRD above:**
1. Pull latest live theme (`shopify theme pull --store base-note.myshopify.com --theme 158692901082`).
2. Diff against this branch — confirm only intended files changed.
3. Visual QA on the live store URL using a logged-in test customer.
4. Cross-device QA (desktop Chrome + iOS Safari) for anything customer-state related (PRD-1, PRD-4, PRD-5).
5. Console check: zero JS errors on `/account`, PDP, cart-drawer.
6. Log results back to `memory/project_session_2026_04_30.md`. If a PRD failed verification, **do not** mark its task `completed` — keep `in_progress` and report back to PM with reproduction steps.

**Agent.** `webapp-testing` skill, optionally `senior-qa`.

---

## Execution order (recommended)

| Order | PRD | Why this order | Blocking? |
|---|---|---|---|
| 1 | PRD-1 (reorder) | 5-minute fix, immediate user-visible win, low risk | no |
| 2 | PRD-6 (shipping FAQ) | Resolves an active customer email today | no |
| 3 | PRD-3 (application guide) | Pure content add, no data dependencies | no |
| 4 | PRD-5 (pause/cancel) | Customer-impacting bug, but needs careful debug | no |
| 5 | PRD-2 (fact sheets) | Phase 1 = Aventus only; bigger design work | no |
| 6 | **PRD-4 (queue persistence)** | **GATED on architecture sign-off from Wilson** | yes |
| 7 | QA-7 | After each above ships | runs continuously |

---

## Decisions needed from Wilson before agents are dispatched

1. **PRD-4: confirm Option A (App Proxy + Cloudflare Worker + customer metafields).** If yes, also confirm: (a) hosting on Cloudflare Workers free tier is fine, (b) we can create or repurpose a Shopify private/custom app to host the App Proxy.
2. **PRD-2: confirm Phase 1 scope = Aventus only this sprint.** Backfill rest of catalogue is Phase 2.
3. **PRD-3: confirm canonical URL** = `/pages/fragrance-application-guide` (vs. blog post).
4. **PRD-6: confirm Shopify shipping zones cover all 50 states** (Wilson to verify in Admin).
