# Analytics Setup — GA4 + Google Search Console

> **Purpose:** Unblock real baseline metrics for the Base Note growth sprint. Without these, every "did this work?" question is blind. Both are free, both take <30 min end-to-end. Jeff has domain admin, so coordinate with him.
> **Customer domain:** `basenotescent.com` (NOT `base-note.myshopify.com` — that's the Shopify backend URL).

---

## Step 1 — Google Analytics 4 (GA4)

**Goal:** measure traffic, behavior, conversion events (Add to Cart, Begin Checkout, Purchase, Subscription Start).

### 1a. Create the GA4 property

1. Go to [analytics.google.com](https://analytics.google.com) → sign in with a Google account Jeff/Wilson both have access to (ideally a shared `analytics@basenotescent.com` group alias, but a personal account works).
2. Admin (gear bottom left) → **Create Property**.
3. Name: `Base Note`. Timezone: your reporting TZ. Currency: USD.
4. Industry: `Shopping`. Business size: small.
5. Platform: **Web**. Website URL: `https://basenotescent.com`. Stream name: `Base Note Web`.
6. Copy the **Measurement ID** (looks like `G-XXXXXXXXXX`). You'll need it for step 1b.

### 1b. Connect GA4 to Shopify (native, no code)

Two paths — pick one. Path A is newer and better.

**Path A — Google & YouTube sales channel app (recommended):**
1. Shopify admin → Sales channels → `Add sales channel` → Google & YouTube (free).
2. Connect the Google account from step 1a.
3. Inside the Google & YouTube app → **Analytics** → connect your GA4 property (Measurement ID `G-XXXXXXXXXX`).
4. Enable **Enhanced e-commerce events** (page_view, view_item, add_to_cart, begin_checkout, purchase — auto-fired by Shopify).

**Path B — manual tag in theme (fallback if Path A has any issue):**
1. Shopify admin → Online Store → Themes → `basenotes/main` → Actions → Edit code.
2. Open `layout/theme.liquid`.
3. In `<head>`, paste the GA4 snippet from your GA4 property → Admin → Data Streams → Web → View tag instructions → Install manually.
4. Save and publish.

### 1c. Configure conversions (critical — default events aren't enough)

In GA4 → Admin → Events → mark these as conversions:
- `purchase` (auto-fired by Shopify when a subscription order completes)
- `begin_checkout`
- `add_to_cart`
- `subscribe` (custom — see below)

Create a **custom event** for subscription start:
- GA4 → Admin → Events → Create Event.
- Name: `subscribe`. Condition: `event_name = purchase AND item_category contains 'subscription'` (adjust once we know exact product taxonomy).
- Mark as conversion.

### 1d. Link to Search Console (step 2 below must be done first)

GA4 → Admin → Product Links → **Search Console links** → link. Adds organic-keyword reports to GA4.

---

## Step 2 — Google Search Console (GSC)

**Goal:** see what Google thinks Base Note is about, which queries drive clicks, and what's indexed.

### 2a. Add the property

1. [search.google.com/search-console](https://search.google.com/search-console) → Add Property.
2. Choose **Domain** property (recommended — covers `www`, `https`, subdomains). Enter: `basenotescent.com`.
3. Google shows a **DNS TXT record** to add. Copy it.

### 2b. Add DNS TXT record (needs Jeff — registrar access)

- Jeff logs into wherever `basenotescent.com` is registered (common: Namecheap, GoDaddy, Cloudflare, Shopify Domains).
- DNS settings → Add record → type `TXT`, name `@` (or leave blank), value = the TXT string from GSC.
- Save. Back in GSC click **Verify**. DNS usually propagates in <5 min but can take up to 24 hrs.

### 2c. Submit the sitemap

1. In GSC → Sitemaps.
2. Add: `sitemap.xml` (Shopify auto-generates this at `https://basenotescent.com/sitemap.xml`).
3. Submit. Google starts crawling.

### 2d. Link GSC to GA4 (see 1d above)

---

## Step 3 — Bonus: Bing Webmaster Tools (5 min, high ROI)

Bing powers ChatGPT search. **This directly affects GEO (LLM discoverability).**

1. [bing.com/webmasters](https://www.bing.com/webmasters).
2. Import from GSC (one-click if GSC is verified).
3. Submit sitemap.

---

## Step 4 — What to check 7 days after setup

All numbers here are baselines we'll improve against — no targets yet.

- GA4 → Reports → Acquisition → Traffic acquisition. Note sessions by source/medium. Expected: mostly `(direct)` and `(organic)` for a brand-new store.
- GA4 → Reports → Engagement → Events. Verify `page_view`, `add_to_cart`, `begin_checkout`, `purchase`, `subscribe` are firing.
- GA4 → Monetization → Ecommerce purchases. Should reconcile with Shopify order count for the same 7-day window.
- GSC → Performance → Queries. Probably empty or sparse at week 1 for a new brand — that's fine. Baseline.
- GSC → Pages → Indexed. Confirm homepage + main collection + PDPs are indexed.

**If any of these come back unexpected, flag it — it's a real Phase 4 measurement issue, not a cosmetic one.**

---

## Step 5 — When this is done, tell me

Once GA4 + GSC are verified and firing, tell me and I'll:
1. Use the `google_search_console-automation` skill (already installed) to pull current GSC data on-demand.
2. Layer real baseline metrics into the Phase 1 conversion audit + SEO audit findings (right now those are heuristic-based).
3. Define Phase 4 measurement plan: what we check 2 weeks after shipping P0 fixes.

---

## Access & permissions — who gets what

- **Jeff**: Owner/admin on GA4 property, GSC, Google & YouTube Shopify app.
- **Wilson**: Editor on GA4, full access on GSC.
- **Alex**: Viewer on both.
- **Claude (me)**: No direct login — I access via the `google_search_console-automation` skill on-demand, triggered by you granting the session permission to call it.

No sharing credentials with me. All auth flows go through the skill's OAuth flow when/if invoked.
