# Subscriber Experience V2 — Design Spec

**Date:** 2026-04-04
**Requested by:** Jeff Theefs (cofounder)
**Status:** Approved

## Context

Jeff identified several gaps in the subscriber experience and provided a promotional flyer designed in Canva for physical distribution. This spec covers 5 changes: auto-selection system, pre-shipment notification, promotional flyer integration, staff FOTM reminders, and a payment update bug fix.

**Baseline:** All changes build on commit `ca0b1cd` (live theme pull 2026-04-04), which includes Jeff/Alex's recent selling plan fix, Appstle API integration, and scent quiz structured tag matching.

---

## Feature 1: Auto-Selection System (Queue + FOTM Fallback)

### Purpose
When a subscriber doesn't choose their next fragrance before the billing deadline, automatically select one for them so no shipment goes out blank.

### Selection Priority
1. **Rotation queue** — if the subscriber has fragrances in their `basenotes_queue` (localStorage), pop the first item
2. **Fragrance of the Month** — if the queue is empty, use the curated pick set by staff in the theme customizer
3. **Safety net** — if FOTM is not set or stale, default to the most popular product in the fragrances collection (highest order count)

### Auto-Selection Flow

```
Day 0:  Billing cycle starts
Day 23: Pre-shipment reminder email (7 days before)
Day 27: Auto-selection check (3 days before)
        ├─ Subscriber chose? → Send confirmation email
        └─ No choice? → Auto-select (queue → FOTM → popular)
           → Save to localStorage with { autoSelected: true }
           → Update UI badge to "AUTO-SELECTED" or "CURATED PICK"
           → POST to Appstle API to update subscription line item
           → Send confirmation email with auto-selected fragrance
Day 28: Last chance to swap/skip (2 days before)
Day 30: Billing + shipment processed
```

### Implementation Location
- Auto-selection logic: `templates/customers/account.liquid` (JS section)
- Triggered when account page loads AND subscriber has no `bn_next_shipment` in localStorage AND billing is within 3 days
- Uses existing state machine: ACTION NEEDED → AUTO-SELECTED / CURATED PICK

### Theme Customizer Settings (Fragrance of the Month)

| Setting ID | Type | Label | Notes |
|-----------|------|-------|-------|
| `fotm_product` | product | Fragrance of the Month | Product picker dropdown |
| `fotm_display_name` | text | Display Name Override | e.g., "April's Pick: Green Irish Tweed" |
| `fotm_month` | text | Month (YYYY-MM) | e.g., "2026-04" — used for staleness detection |
| `fotm_enabled` | checkbox | Enable FOTM | Default: true |

Settings go in `config/settings_schema.json` under a new "Fragrance of the Month" section.

### UI States (existing, extended)

| State | Badge | Color |
|-------|-------|-------|
| No selection, >3 days out | ACTION NEEDED | Amber |
| Subscriber chose | CONFIRMED | Green |
| Auto-selected from queue | AUTO-SELECTED | Gold |
| Auto-selected from FOTM | CURATED PICK | Gold |
| Skipped | SKIPPED | Grey |

---

## Feature 2: Pre-Shipment Confirmation Email (3-Day)

### Purpose
Notify every active subscriber 3 days before their shipment with their selection details, scent education, and a teaser for next month's curated pick.

### Template
**File:** `snippets/email-pre-shipment-confirmation.liquid`

This is a NEW template, distinct from:
- `email-pre-shipment.liquid` (7-day reminder, already exists)
- `email-urgency-reminder.liquid` (3-day "you haven't picked" reminder, already exists)

### Content Sections (top to bottom)

1. **Header:** BASE NOTE logo
2. **Hero:** "Your [Fragrance Name] ships in 3 days" + selection badge (Confirmed/Auto-Selected/Curated Pick)
3. **Fragrance Card:**
   - Image
   - Name + house/vendor
   - Scent notes: top, heart, base
   - Fragrance family
4. **"Perfect For" section:** Occasion tags (Office, Date Night, Events) with icons
5. **Action CTAs:** [Swap Fragrance] [Skip This Month]
6. **Divider**
7. **"Coming Next Month..." teaser:**
   - FOTM image (small)
   - Name + one-line description
   - Builds anticipation for next cycle
8. **Footer:** Manage subscription, unsubscribe links

### Klaviyo Merge Tags
- `{{ first_name }}`, `{{ fragrance_name }}`, `{{ fragrance_image }}`
- `{{ fragrance_house }}`, `{{ top_notes }}`, `{{ heart_notes }}`, `{{ base_notes }}`
- `{{ fragrance_family }}`, `{{ selection_type }}` (confirmed / auto-selected / curated)
- `{{ fotm_name }}`, `{{ fotm_image }}`, `{{ fotm_teaser }}`
- `{{ swap_url }}`, `{{ skip_url }}`, `{{ account_url }}`

### Design
- 600px width, brand colors (#2D4641 dark, #C9A962 gold, #FAF8F5 cream)
- Helvetica Neue body, Georgia serif headings
- Consistent with existing email templates (dunning, post-delivery)

---

## Feature 3: Promotional Flyer Integration

### Purpose
Incorporate Jeff's Canva promotional flyer ("Stylish men don't settle for just one fragrance") into the website across 3 placements to maximize visibility.

### Image Preparation
The source file (`WhatsApp Image 2026-04-04 at 20.26.24.jpeg`) is a phone screenshot of a Canva design. Before use:
- Crop to extract only the flyer artwork (remove phone status bar, browser chrome, Canva toolbar, surrounding whitespace)
- Export as optimized assets: `assets/promo-flyer.jpg` (full-res for pop-up/banner), `assets/promo-flyer-thumb.jpg` (thumbnail for social proof section)

### Placement A: First-Visit Pop-Up Modal

**Behavior:**
- Shows once per visitor (localStorage flag: `bn_promo_seen`)
- 3-second delay after page load
- Does NOT show if user is already a subscriber (check `customer` Liquid object or localStorage)
- Dismisses on: X button, outside click, Escape key

**Design:**
- Dark overlay backdrop (rgba(0,0,0,0.6))
- Modal: #2D4641 background, rounded corners (16px)
- Content: BASE NOTE logo, bottle silhouette or flyer image, tagline, gold CTA "Start Your Journey"
- Subtext: "25% off your first month" (matches current announcement bar promo)

**File:** New snippet `snippets/promo-popup.liquid` included via `layout/theme.liquid`

### Placement B: Homepage Banner Section

**Position:** Between hero and delivery-explainer sections in `templates/index.json`

**Design:**
- Full-width, dark green gradient background (#2D4641 → #1a332e)
- Left: flyer image or bottle visual
- Right: tagline + subtitle + gold CTA "Subscribe Now — $20/mo"

**File:** New section `sections/promotional-banner.liquid`

**Theme Customizer Settings:**

| Setting ID | Type | Label |
|-----------|------|-------|
| `promo_image` | image_picker | Banner Image |
| `promo_heading` | text | Heading |
| `promo_subheading` | text | Subheading |
| `promo_cta_text` | text | Button Text |
| `promo_cta_link` | url | Button Link |
| `promo_enabled` | checkbox | Show Banner |

### Placement C: "As Seen Around Town" Section

**Position:** After testimonials, before footer

**Design:**
- Cream background (#FAF8F5)
- Eyebrow: "FIND US" (gold)
- Heading: "As Seen Around Town"
- 3 cards showing miniature flyer images with location labels (Coffee Shops, Barbershops, Gyms & Lounges)
- CTA: "Scan the QR Code to Get Started"

**File:** New section `sections/social-proof-locations.liquid`

**Theme Customizer Settings:**
- Up to 3 location blocks, each with: image, location name, city
- Section heading, subheading, CTA text/link

---

## Feature 4: Staff FOTM Reminder System

### Purpose
Prevent the scenario where Jeff/Alex forget to set the Fragrance of the Month, which would break auto-selection for subscribers with empty queues.

### Staleness Detection
- Compare `fotm_month` setting (e.g., "2026-04") against current month
- If mismatched or blank → FOTM is stale

### Staff Notification Email
**File:** `snippets/email-staff-fotm-reminder.liquid`
**Recipients:** jeff@basenotescent.com, alex@basenotescent.com
**Trigger:** 1st of each month (Klaviyo flow or Shopify Flow)
**Subject:** "Action Needed: Pick this month's Fragrance of the Month"
**Body:**
- Warning that no FOTM is set
- Direct link to theme customizer
- Deadline: must be set before 3 days prior to any subscriber's billing date
- List of how many active subscribers have empty queues (would use FOTM as fallback)

### In-Page Warning (Staff Only)
- If a staff member (customer tagged "staff") visits the account page and FOTM is stale, show an alert banner at the top of the page
- "No Fragrance of the Month set for [current month]. Subscribers with empty queues won't receive an auto-selection."

### Safety Net Fallback
If FOTM is still not set at auto-selection time:
- Fetch products from the `fragrances` collection via `/collections/fragrances/products.json`
- Select the **first product** in the collection (collection sort order is managed by staff in Shopify admin, so the top product is always intentional)
- Use that as the auto-selection
- No subscriber ever gets a blank shipment

---

## Feature 5: Payment Update Bug Fix

### Bug
"Update Payment" button on My Subscription page (`account.liquid:345`) links to the same generic Appstle portal URL as "Change Plan" (`/apps/subscriptions`). This shows the raw Appstle portal with subscription details, not a payment update form.

### Root Cause
Both buttons use: `{{ settings.subscription_portal_url | default: settings.appstle_portal_url | default: '/apps/subscriptions' }}`

### Fix
1. Add `id="subUpdatePaymentBtn"` to the "Update Payment" `<a>` tag
2. Set default href to `/account` (safe fallback)
3. In the existing `fetchAppstleData()` success handler, dynamically set the correct URL:
   ```javascript
   var paymentBtn = document.getElementById('subUpdatePaymentBtn');
   if (paymentBtn && active.id) {
     paymentBtn.href = '/apps/subscriptions/update-payment-method?contractId=' + active.id;
   }
   ```
4. The Appstle payment update endpoint redirects to Shopify's native payment method update flow, which shows the actual card update form.

### Also Fix
"Change Plan" button — currently there is only one plan ($20/mo monthly). This button should either:
- Be hidden (since there's nothing to change to), OR
- Link to a contact/support flow ("Want to change your plan? Contact us")

**Decision:** Hide "Change Plan" since Base Note is monthly-only. Can be re-enabled if plans expand.

---

## Files Changed (Summary)

| File | Change |
|------|--------|
| `templates/customers/account.liquid` | Auto-selection logic, payment button fix, staff FOTM warning, hide Change Plan |
| `config/settings_schema.json` | FOTM settings section, promotional banner settings |
| `config/settings_data.json` | Default values for new settings |
| `snippets/promo-popup.liquid` | NEW — first-visit promotional pop-up modal |
| `sections/promotional-banner.liquid` | NEW — homepage banner section |
| `sections/social-proof-locations.liquid` | NEW — "As Seen Around Town" section |
| `templates/index.json` | Add banner + social proof sections to homepage order |
| `layout/theme.liquid` | Include promo-popup snippet |
| `snippets/email-pre-shipment-confirmation.liquid` | NEW — 3-day confirmation email template |
| `snippets/email-staff-fotm-reminder.liquid` | NEW — staff FOTM reminder email |
| `assets/promo-flyer.jpg` | NEW — cropped flyer image |
| `assets/promo-flyer-thumb.jpg` | NEW — thumbnail flyer image |

---

## Out of Scope
- Queue persistence to Shopify metafields (future: cross-device sync)
- Server-side auto-selection via webhooks (current approach is client-side)
- SMS notifications (email only for now)
- Fragrance of the Month display on homepage (can add later)
- Multiple subscription tiers (monthly only)
