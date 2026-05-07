## Post-deploy QA (2026-05-07)

**Summary:** 1/6 checks passing — 5 blocked by HTTP 403 (storefront/WAF on basenotescent.com).

### CHECK 1 — Worker GET /apps/basenote/queue: FAIL
- HTTP 403 — all anonymous requests to basenotescent.com return 403 (storefront password or WAF).
- Cannot distinguish 401 (Worker deployed, HMAC working) from 404 (not deployed).
- **Blocker:** No `worker/queue-proxy/` directory found in this repo. The Worker code has not been committed. Wilson needs to deploy per `worker/queue-proxy/README.md` step 4 — that path does not yet exist in the repo.

### CHECK 2 — Theme CDN (queue-scheduler.js / `pullFromServer`): BLOCKED
- HTTP 403 — storefront blocked; cannot verify live asset.
- Repo check: `assets/queue-scheduler.js` contains `pullFromServer` at line 327 — PRD-4 sync layer code is present in the repo.
- Cannot confirm theme has been pushed to Shopify live. Wilson to verify via Shopify Admin → Themes.

### CHECK 3a — `/pages/fragrance-application-guide`: BLOCKED
- HTTP 403 — storefront blocked; cannot verify live page.
- Repo check PASS: `templates/page.fragrance-application-guide.json` and `sections/fragrance-application-guide.liquid` both present. `'The Art of'` at line 513; `'Pulse Points'` at lines 181/524/533.
- Cannot confirm Shopify Admin Page was created (Admin → Pages).

### CHECK 3b — `/pages/shipping`: BLOCKED
- HTTP 403 — storefront blocked; cannot verify live page.
- Repo check PASS: `templates/page.shipping.json` and `sections/shipping-faq.liquid` both present. `'Where do you ship'` at line 75.
- Cannot confirm Shopify Admin Page was created.

### CHECK 3c — `/pages/fact-sheet-aventus` (also tried `/pages/aventus-fact-sheet`): BLOCKED
- HTTP 403 — storefront blocked; cannot verify live page.
- Repo check PASS: `templates/page.fact-sheet-aventus.json` present with `"title": "AVENTUS"` and `"notes_top": "Bergamot, Black Currant, Apple, Pink Pepper"`.
- Cannot confirm Shopify Admin Page was created.

### CHECK 4 — Account layout (account.liquid PRD-1 order): PASS ✓
- `templates/customers/account.liquid` line 975: `// Upcoming / Queue (rendered before Shipped per PM PRD-1 — Apr 30 2026)` — **FOUND**
- `templates/customers/account.liquid` line 1003: `// Past shipments (rendered after Upcoming per PM PRD-1 — Apr 30 2026)` — **FOUND**

---

**Root blocker:** `basenotescent.com` returns HTTP 403 for all anonymous requests (homepage, /password, asset URLs, app proxy). This is consistent with Shopify storefront password being enabled. Live HTTP probes cannot proceed until the storefront password is disabled or the store goes live.

**Action items for Wilson:**
1. Disable storefront password (Shopify Admin → Preferences → Password protection) or confirm store is live.
2. Commit and deploy the Cloudflare Worker — add `worker/queue-proxy/` directory with Worker code and README.
3. Confirm the three Shopify Pages were created in Admin (fragrance-application-guide, shipping, fact-sheet-aventus).
4. Confirm theme was pushed to live (Shopify Admin → Themes → Publish).
5. Re-run QA once above are resolved: https://claude.ai/code/session_012aFnnnZkWAxUgeGpFnoBEE
