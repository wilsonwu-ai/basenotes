# OAuth / Social Login Setup — Pick a Path

**Status:** Buttons currently hidden in `templates/customers/login.liquid`. This doc explains the three real options to enable them.

**Short answer:** Shopify does NOT provide Google / Apple / Facebook sign-in natively on classic customer accounts (the account system Base Note uses today). You either install a third-party Shopify app that adds it, or you migrate to Shopify's new customer accounts which replaces passwords with a Shopify-hosted sign-in flow.

---

## Option A — Install a social-login Shopify app (Recommended)

Keeps the classic customer account system you have today. Adds real Google / Apple / Facebook buttons that actually sign people in. This is what Wilson is asking for.

### App picks (ranked)

| App | Free tier | Paid | Supports |
|---|---|---|---|
| **Loginify** (SuccessCart) | Free up to 25 logins / mo | $4.99 → $9.99 / mo | Google, Facebook, Apple, Twitter, Amazon, LinkedIn |
| **Oxi Social Login** | Free tier | $4.99 → $9.99 / mo | Google, Facebook, Apple, Twitter, LinkedIn, Amazon |
| **Shop Social Login** | Free up to 50 / mo | $9 / mo | Google, Facebook, Apple |
| **Customer Accounts Concierge** | — | $19 → $79 / mo | Google, Facebook + full account-page rebuild |

**My pick for Base Note:** **Loginify** — free tier covers early volume, supports all three providers (Google + Apple + Facebook), and injects buttons that slot into an existing theme via CSS class targeting.

### Step-by-step setup (Loginify)

**Part 1 — Install the app (5 min)**

1. In Shopify admin, go to **Apps** → **Visit the Shopify App Store**.
2. Search for **"Loginify"** (by SuccessCart). Install it.
3. Open the app from your Apps list. Pick the Free plan or Basic.

**Part 2 — Set up Google OAuth (10 min)**

1. Go to <https://console.cloud.google.com/> (sign in with your Google account).
2. Create a new project (top-left dropdown → New Project → name it "Base Note Login").
3. Left sidebar → **APIs & Services** → **OAuth consent screen**.
   - User Type: **External**
   - App name: **Base Note**
   - User support email: `wilson@basenotescent.com` (or your support address)
   - App logo: upload Base Note logo (optional)
   - Authorized domains: `basenotescent.com`, `base-note.myshopify.com`
   - Developer contact: same email
   - Save + Continue through the scopes (leave default) + test users (skip) + publish.
4. Sidebar → **Credentials** → **Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: "Base Note Storefront"
   - Authorized JavaScript origins: `https://basenotescent.com`, `https://base-note.myshopify.com`
   - Authorized redirect URIs: **Loginify will give you this exact URL** — copy from the Loginify admin's Google tab and paste here.
5. Click Create. Copy the **Client ID** and **Client secret**.
6. Paste them into Loginify's Google tab. Save.

**Part 3 — Set up Apple OAuth (15–20 min, requires Apple Developer account)**

1. Apple OAuth requires a paid **Apple Developer account** ($99/year). If you don't already have one: <https://developer.apple.com/programs/enroll/>. Enrollment can take 24–48 hours for approval.
2. Once enrolled: go to <https://developer.apple.com/account/resources/identifiers/list>.
3. Create a new **Services ID** (this is Apple's OAuth client):
   - Description: "Base Note Sign In"
   - Identifier: `com.basenotescent.signin` (reverse-DNS style)
   - Enable **Sign In with Apple**, click Configure:
     - Primary App ID: select your App ID (create one if needed)
     - Domains and Subdomains: `basenotescent.com`, `base-note.myshopify.com`
     - Return URLs: paste the URL Loginify gives you in its Apple tab.
4. Create a **Sign In with Apple Key**:
   - Sidebar → Keys → Create a key → name it "Sign In with Apple Key"
   - Enable Sign In with Apple, configure with the Primary App ID above.
   - Download the `.p8` file. **You only get to download this once — save it somewhere safe.**
5. Note down: Services ID, Team ID, Key ID. Paste all three plus the `.p8` contents into Loginify's Apple tab.

**Part 4 — Set up Facebook OAuth (10 min)**

1. Go to <https://developers.facebook.com/apps/> (sign in with a Facebook account; use your personal since business needs verification).
2. Create a new App → **Consumer** type → name "Base Note".
3. In the app dashboard, add the **Facebook Login** product.
4. In Facebook Login settings:
   - Valid OAuth Redirect URIs: paste Loginify's Facebook redirect URL.
   - Deauthorize Callback URL: Loginify's URL (same tab).
5. App Settings → Basic:
   - App Domains: `basenotescent.com`
   - Privacy Policy URL: `https://basenotescent.com/policies/privacy-policy`
6. Copy App ID and App Secret → paste into Loginify's Facebook tab.
7. In Facebook's App Review, request basic `email` + `public_profile` permissions (usually auto-approved).

**Part 5 — Re-enable the theme buttons (5 min, I'll do this)**

Once all three providers are configured in Loginify:

- I'll remove the `display:none;` from `templates/customers/login.liquid` lines 186 and 192.
- I'll wire the existing `[data-social-auth="google|apple|facebook"]` buttons to call Loginify's JS (typically `Loginify.login('google')` or similar — exact syntax depends on Loginify's API; I'll adapt to match their docs when you're ready).
- Push live.

**Total time:** ~45 min if Apple Developer account is already approved; 2–3 days if you need to wait for Apple approval.

**Ongoing cost:** $0 until you exceed 25 logins/mo, then $4.99–$9.99 depending on plan.

---

## Option B — Migrate to Shopify New Customer Accounts

Free, native, modern. Replaces the classic username+password flow entirely. Uses email + 6-digit code (passwordless) OR Apple / Google SSO if the customer is signed into those already. No Facebook.

**Trade-offs:**
- Switches the account UI away from your theme — login and account pages move to `shop.app` or Shopify-hosted equivalent. The account.liquid / addresses.liquid work we've done would no longer render; subscribers would see Shopify's stock account UI.
- Cleaner security (passkeys, no password storage).
- No Google / Apple branded buttons on YOUR login page — instead, customers tap "Continue with email" and if they're signed in to Google/Apple on their device, it auto-fills.
- Can't do Facebook.

**How to enable:**

1. Shopify admin → **Settings** → **Customer accounts**.
2. Switch from "Classic customer accounts" to "New customer accounts".
3. Optionally customize the account-page branding (logo, colors only).

**Note:** This is a one-way migration with UX consequences for your existing queue / journey / dashboard work. I'd **not recommend this** unless you want to abandon the custom account page.

---

## Option C — Leave OAuth off (Status quo)

Customers sign in with email + password only. Buttons stay hidden. Zero setup, zero cost, zero maintenance. Shopify passwords are fine for most ecom stores.

Most Shopify merchants under 5,000 customers skip OAuth. It's a nice-to-have, not a conversion driver at Base Note's current scale.

---

## My recommendation

**Start with Option C (do nothing).** Email+password works. Revisit OAuth when you have signal that signup friction is meaningfully hurting conversion — e.g., if you run a paid campaign that lands on the account page and the sign-up rate is noticeably lower than industry (~65% typical).

If you want to push forward anyway: **Option A with Loginify**, start with only **Google** (covers ~70% of OAuth users, takes 10 min, needs no Apple Developer fee, can add Apple + Facebook later).

---

## What I need from you to execute Option A

Tell me:
1. **Which app you picked** (Loginify vs Oxi vs other).
2. **Which providers** (Google first, all three, etc.).
3. **When you've configured it in the app's admin** — I'll re-enable the theme buttons + wire them to the app's API and push live.

For the dev-console steps (Google, Apple, Facebook), I can walk you through each one live if you'd rather do them together — just say the word.
