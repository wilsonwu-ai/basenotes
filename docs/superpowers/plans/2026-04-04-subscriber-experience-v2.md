# Subscriber Experience V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-selection system with FOTM fallback, promotional flyer integration (pop-up + banner + social proof), pre-shipment confirmation email, staff FOTM reminders, and fix the payment update button bug.

**Architecture:** All features are Shopify theme-side (Liquid + vanilla JS). Auto-selection runs client-side on account page load when billing is within 3 days. FOTM is a theme customizer setting. Promotional flyer uses 3 placements: pop-up snippet, banner section, and social proof section. Payment fix uses the existing Appstle API integration to construct the correct URL.

**Tech Stack:** Shopify Liquid, vanilla JavaScript, CSS, Klaviyo email templates (HTML table layout)

**CRITICAL:** Before starting ANY task, pull the latest live theme:
```bash
shopify theme pull --store base-note.myshopify.com --theme 158692901082
```
Commit the pulled changes as a baseline before making edits.

---

### Task 1: Fix Payment Update Button + Hide Change Plan

**Files:**
- Modify: `templates/customers/account.liquid:341-348` (Subscription Actions HTML)
- Modify: `templates/customers/account.liquid:966-1055` (fetchAppstleData JS)

- [ ] **Step 1: Update the "Change Plan" and "Update Payment" HTML**

In `templates/customers/account.liquid`, find the Subscription Actions section (around line 340). Replace the Change Plan and Update Payment buttons:

```liquid
            <div class="sub-actions">
              {%- comment -%}Change Plan hidden — monthly-only model. Re-enable if plans expand.{%- endcomment -%}
              <a href="/account" id="subUpdatePaymentBtn" class="sub-action-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Update Payment
              </a>
```

This replaces the old code at lines 340-348 which had both a "Change Plan" `<a>` tag and an "Update Payment" `<a>` tag sharing the same `settings.subscription_portal_url` href. The Change Plan button is removed (monthly-only model), and Update Payment now has `id="subUpdatePaymentBtn"` with a safe `/account` fallback href.

- [ ] **Step 2: Add payment URL update to fetchAppstleData**

In the `fetchAppstleData()` function (around line 966), inside the `.then(function(contracts) {` success handler, after the billing date update block and before the next shipment product update block, add:

```javascript
        // ── Update payment button URL with contract ID ──
        var paymentBtn = document.getElementById('subUpdatePaymentBtn');
        if (paymentBtn && active.id) {
          paymentBtn.href = '/apps/subscriptions/update-payment-method?contractId=' + active.id;
        }
```

Insert this after the line `if (statEl) statEl.textContent = nextBill.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });` (around line 1025) and before the comment `// ── Update next shipment product from Appstle ──` (around line 1028).

- [ ] **Step 3: Verify in browser**

Open `https://basenotescent.com/account#subscription` logged in as Jeff (or a test subscriber). Confirm:
- "Change Plan" button is gone
- "Update Payment" button is visible
- After page loads (Appstle API returns), clicking "Update Payment" goes to a payment method update form, NOT the raw Appstle portal

- [ ] **Step 4: Commit**

```bash
git add templates/customers/account.liquid
git commit -m "Fix payment update button URL and hide Change Plan

Payment button now links to Appstle's payment-method update endpoint
using the contract ID from the API. Change Plan hidden since Base Note
is monthly-only."
```

---

### Task 2: Add FOTM Theme Customizer Settings

**Files:**
- Modify: `config/settings_schema.json:563-564` (add new section after Subscription Portal)

- [ ] **Step 1: Add FOTM settings section to schema**

In `config/settings_schema.json`, find the closing `]` of the "Subscriptions" section (line 563: `    ]`), and the opening `{` of the "Subscription Plans" section (line 565: `  {`). Between these two sections (after the Subscriptions section closes at line 564, before the Subscription Plans section opens at line 565), add a new settings section:

```json
  {
    "name": "Fragrance of the Month",
    "settings": [
      {
        "type": "header",
        "content": "Monthly Curated Pick"
      },
      {
        "type": "checkbox",
        "id": "fotm_enabled",
        "label": "Enable Fragrance of the Month",
        "default": true,
        "info": "When enabled, subscribers who don't choose a fragrance will receive this month's curated pick"
      },
      {
        "type": "product",
        "id": "fotm_product",
        "label": "Fragrance of the Month"
      },
      {
        "type": "text",
        "id": "fotm_display_name",
        "label": "Display name override",
        "info": "e.g., \"April's Pick: Green Irish Tweed\". Leave blank to use product title."
      },
      {
        "type": "text",
        "id": "fotm_month",
        "label": "Month (YYYY-MM)",
        "info": "e.g., 2026-04. Used to detect if FOTM is stale. Staff will be warned if this doesn't match the current month.",
        "placeholder": "2026-04"
      }
    ]
  },
```

Insert this JSON object between the closing `}` of the "Subscriptions" section and the opening `{` of the "Subscription Plans" section. Make sure the comma separating sections is correct.

- [ ] **Step 2: Verify in theme customizer**

```bash
shopify theme push --store base-note.myshopify.com --theme 158692901082 --only config/settings_schema.json
```

Open the theme customizer at `https://base-note.myshopify.com/admin/themes/158692901082/editor` and verify the "Fragrance of the Month" section appears in theme settings with all 4 fields.

- [ ] **Step 3: Commit**

```bash
git add config/settings_schema.json
git commit -m "Add Fragrance of the Month theme customizer settings

Adds product picker, display name override, month field for staleness
detection, and enable/disable toggle."
```

---

### Task 3: Add Auto-Selection Logic to Account Page

**Files:**
- Modify: `templates/customers/account.liquid:628-642` (serverSubData — add FOTM data)
- Modify: `templates/customers/account.liquid:850-856` (renderNextShipment — add auto-select)

- [ ] **Step 1: Inject FOTM data into serverSubData**

In `templates/customers/account.liquid`, find the `serverSubData` object (around line 629). After the `portalUrl` line (line 641), add FOTM data from the theme settings:

```javascript
    portalUrl: {{ settings.appstle_portal_url | default: '/apps/subscriptions' | json }},
    fotmEnabled: {{ settings.fotm_enabled | default: false | json }},
    fotmMonth: {{ settings.fotm_month | json }},
    {%- if settings.fotm_product -%}
    fotmProduct: {
      title: {{ settings.fotm_product.title | json }},
      image: {{ settings.fotm_product.featured_image | image_url: width: 200 | json }},
      vendor: {{ settings.fotm_product.vendor | json }},
      handle: {{ settings.fotm_product.handle | json }},
      variantId: {{ settings.fotm_product.selected_or_first_available_variant.id | json }},
      {%- if settings.fotm_product.selling_plan_groups.size > 0 -%}
      sellingPlanId: {{ settings.fotm_product.selling_plan_groups[0].selling_plans[0].id | json }},
      {%- endif -%}
    },
    {%- endif -%}
    fotmDisplayName: {{ settings.fotm_display_name | json }},
    isStaff: {{ customer.tags | join: ',' | downcase | contains: 'staff' | json }}
  };
```

This replaces the old `portalUrl` line and closing `};`. The `portalUrl` line now has a trailing comma since new properties follow it.

- [ ] **Step 2: Add auto-selection function**

In `templates/customers/account.liquid`, after the `renderNextShipment();` call (around line 888) and before the `/* ── Billing Countdown ── */` comment (around line 890), add the auto-selection function:

```javascript

  /* ── Auto-Selection Logic ── */
  function autoSelectFragrance() {
    if (!serverSubData.isSubscriber) return;

    // Skip if user already chose or skipped
    var existing = null;
    try { existing = JSON.parse(localStorage.getItem('bn_next_shipment') || 'null'); } catch(e) {}
    if (existing && (existing.fragrance || existing.status === 'skipped')) return;

    // Only auto-select within 3 days of billing
    var nextBill = getNextBillingDate();
    var now = new Date();
    var daysUntilBill = Math.ceil((nextBill - now) / 86400000);
    if (daysUntilBill > 3) return;

    // Priority 1: Rotation queue
    var queue = [];
    try { queue = JSON.parse(localStorage.getItem('basenotes_queue') || '[]'); } catch(e) {}
    if (queue.length > 0) {
      var nextItem = queue.shift();
      localStorage.setItem('basenotes_queue', JSON.stringify(queue));
      var selection = {
        fragrance: {
          title: nextItem.title || nextItem.name,
          image: nextItem.image || nextItem.featured_image,
          family: nextItem.vendor || nextItem.family || '',
          handle: nextItem.handle || ''
        },
        autoSelected: true,
        source: 'queue',
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('bn_next_shipment', JSON.stringify(selection));
      renderNextShipment();
      // Update queue count badge
      var queueCountEl = document.querySelector('[data-queue-count]');
      if (queueCountEl) queueCountEl.textContent = queue.length;
      return;
    }

    // Priority 2: Fragrance of the Month
    var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    if (serverSubData.fotmEnabled && serverSubData.fotmProduct && serverSubData.fotmMonth === currentMonth) {
      var fotm = serverSubData.fotmProduct;
      var selection = {
        fragrance: {
          title: serverSubData.fotmDisplayName || fotm.title,
          image: fotm.image,
          family: fotm.vendor || '',
          handle: fotm.handle || ''
        },
        autoSelected: true,
        source: 'fotm',
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('bn_next_shipment', JSON.stringify(selection));
      renderNextShipment();
      return;
    }

    // Priority 3: Safety net — first product from fragrances collection
    fetch('/collections/fragrances/products.json?limit=1')
      .then(function(r) { return r.ok ? r.json() : Promise.reject('no-collection'); })
      .then(function(data) {
        if (!data.products || !data.products.length) return;
        var prod = data.products[0];
        var selection = {
          fragrance: {
            title: prod.title,
            image: prod.images && prod.images.length ? prod.images[0].src : '',
            family: prod.vendor || '',
            handle: prod.handle || ''
          },
          autoSelected: true,
          source: 'popular',
          timestamp: new Date().toISOString()
        };
        localStorage.setItem('bn_next_shipment', JSON.stringify(selection));
        renderNextShipment();
      })
      .catch(function() {});
  }

  autoSelectFragrance();
```

- [ ] **Step 3: Update renderNextShipment to show CURATED PICK badge**

In the `renderNextShipment` function, find the block that handles `data && data.fragrance` (around line 817-828). Update the badge logic to distinguish between queue auto-select and FOTM:

```javascript
    if (data && data.fragrance) {
      var isAuto = data.autoSelected;
      var badgeText = 'Confirmed';
      var badgeClass = 'ns-confirmed';
      if (isAuto && data.source === 'fotm') {
        badgeText = 'Curated Pick';
        badgeClass = 'ns-auto';
      } else if (isAuto) {
        badgeText = 'Auto-Selected';
        badgeClass = 'ns-auto';
      }
      nsStatusBadge.textContent = badgeText;
      nsStatusBadge.className = 'ns-status-badge ' + badgeClass;
```

This replaces the existing lines 818-820.

- [ ] **Step 4: Verify auto-selection logic**

Test in browser:
1. Clear `bn_next_shipment` from localStorage
2. Set a billing date within 3 days (or use Appstle test data)
3. Verify auto-selection triggers from queue (if items exist) or FOTM (if set in customizer)
4. Verify correct badge text appears

- [ ] **Step 5: Commit**

```bash
git add templates/customers/account.liquid
git commit -m "Add auto-selection logic for next shipment

When billing is within 3 days and subscriber hasn't chosen:
1. Pop next item from rotation queue
2. Fall back to Fragrance of the Month (theme setting)
3. Safety net: first product from fragrances collection
Shows CURATED PICK or AUTO-SELECTED badge accordingly."
```

---

### Task 4: Add Staff FOTM Warning to Account Page

**Files:**
- Modify: `templates/customers/account.liquid` (add staff warning banner + JS)

- [ ] **Step 1: Add staff warning HTML**

In `templates/customers/account.liquid`, find the opening of the account content area. Look for the first `<div data-view="dashboard"` (it should be early in the HTML structure). Just BEFORE it, add:

```liquid
          {%- comment -%}Staff FOTM warning — only shown to staff-tagged customers{%- endcomment -%}
          <div id="staffFotmWarning" style="display:none;margin-bottom:1.5rem;padding:1rem 1.25rem;background:#FFF3CD;border:1px solid #FFD93D;border-radius:10px;color:#856404;">
            <strong>Staff Alert:</strong> No Fragrance of the Month set for <span id="staffFotmMonth"></span>.
            Subscribers with empty queues won't receive an auto-selection.
            <a href="https://base-note.myshopify.com/admin/themes/158692901082/editor" target="_blank" style="color:#2D4641;font-weight:600;text-decoration:underline;margin-left:4px;">Set it now in Theme Customizer &rarr;</a>
          </div>
```

- [ ] **Step 2: Add staff warning JS logic**

In the JavaScript section, after the `autoSelectFragrance();` call, add:

```javascript

  /* ── Staff FOTM Warning ── */
  (function checkFotmStaleness() {
    if (!serverSubData.isStaff) return;
    var now = new Date();
    var currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    if (!serverSubData.fotmMonth || serverSubData.fotmMonth !== currentMonth) {
      var warningEl = document.getElementById('staffFotmWarning');
      var monthEl = document.getElementById('staffFotmMonth');
      if (warningEl) {
        warningEl.style.display = 'block';
        if (monthEl) monthEl.textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
      }
    }
  })();
```

- [ ] **Step 3: Verify staff warning**

To test, temporarily add the "staff" tag to a test customer in Shopify admin, then visit the account page. The yellow warning should appear if FOTM month doesn't match the current month.

- [ ] **Step 4: Commit**

```bash
git add templates/customers/account.liquid
git commit -m "Add staff FOTM staleness warning on account page

Shows yellow alert banner for staff-tagged customers when Fragrance
of the Month is not set for the current month, with link to theme
customizer."
```

---

### Task 5: Create Staff FOTM Reminder Email Template

**Files:**
- Create: `snippets/email-staff-fotm-reminder.liquid`

- [ ] **Step 1: Create the email template**

Create `snippets/email-staff-fotm-reminder.liquid` following the same design pattern as existing email templates (600px width, table layout, brand colors):

```html
{% comment %}
  Email Reference: Staff FOTM Reminder
  PURPOSE: Klaviyo design reference — NOT rendered by the theme.
  TRIGGER: 1st of each month via Klaviyo flow
  RECIPIENTS: jeff@basenotescent.com, alex@basenotescent.com

  Merge tags use Klaviyo syntax: {{ current_month }}, {{ theme_editor_url }}
{% endcomment %}

<!-- STAFF FOTM REMINDER EMAIL -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Action Needed: Pick This Month's Fragrance</title>
</head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#2D4641;">
    <tr>
      <td align="center" style="padding:24px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#fff;letter-spacing:0.05em;">BASE NOTE</span>
        <br>
        <span style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.1em;">Staff Notification</span>
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">

          <!-- Warning accent bar -->
          <tr><td style="height:4px;background:#FF9800;"></td></tr>

          <!-- Content -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#FF9800;margin:0 0 16px;">Action Required</p>
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#2D4641;margin:0 0 16px;line-height:1.3;">
                Pick {{ current_month }}'s Fragrance of the Month
              </h1>
              <p style="font-size:14px;color:#666;line-height:1.6;margin:0 0 24px;">
                No Fragrance of the Month has been set for <strong style="color:#2D4641;">{{ current_month }}</strong>. Subscribers who haven't chosen a fragrance and have an empty rotation queue will not receive an auto-selection.
              </p>

              <!-- Stats box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:16px;background:#FAF8F5;border-radius:8px;">
                    <p style="font-size:13px;color:#666;margin:0 0 8px;">
                      <strong style="color:#2D4641;">Active subscribers:</strong> {{ active_subscriber_count }}
                    </p>
                    <p style="font-size:13px;color:#666;margin:0;">
                      <strong style="color:#2D4641;">With empty queues:</strong> {{ empty_queue_count }} (would use FOTM as fallback)
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Deadline -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:12px 16px;background:#FFF3CD;border-radius:8px;border:1px solid #FFD93D;">
                    <p style="font-size:13px;color:#856404;margin:0;">
                      <strong>Deadline:</strong> Must be set before 3 days prior to the earliest subscriber billing date this month.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://base-note.myshopify.com/admin/themes/158692901082/editor" style="display:inline-block;padding:16px 48px;background:#2D4641;color:#fff;font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;text-decoration:none;border-radius:6px;">
                      Open Theme Customizer
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size:13px;color:#999;text-align:center;margin:20px 0 0;">
                Go to Theme Settings &rarr; Fragrance of the Month &rarr; Select a product and set the month.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background:#FAF8F5;border-top:1px solid #E8E6E3;">
              <p style="font-size:12px;color:#999;text-align:center;margin:0;">
                This is an internal Base Note staff notification. If you received this in error, please ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add snippets/email-staff-fotm-reminder.liquid
git commit -m "Add staff FOTM reminder email template

Klaviyo reference template sent on 1st of each month to staff.
Shows warning, subscriber stats, deadline, and direct link to
theme customizer."
```

---

### Task 6: Crop Promotional Flyer Image

**Files:**
- Source: `WhatsApp Image 2026-04-04 at 20.26.24.jpeg`
- Create: `assets/promo-flyer.jpg`
- Create: `assets/promo-flyer-thumb.jpg`

- [ ] **Step 1: Crop the flyer from the screenshot**

The source image is a phone screenshot of a Canva design. Use `sips` (macOS built-in) or ImageMagick to crop out only the flyer artwork, removing the phone status bar (top ~100px), Canva toolbar (bottom ~80px), and browser chrome.

First, check the image dimensions:

```bash
sips -g pixelHeight -g pixelWidth "WhatsApp Image 2026-04-04 at 20.26.24.jpeg"
```

Then crop based on the dimensions. The flyer content starts after the Canva toolbar at top and ends before the template bar at bottom. The exact crop values depend on the image size, but approximately:

```bash
# Crop: remove top 280px (status bar + canva bar), bottom 160px (canva toolbar), and side padding
sips -c <cropped_height> <cropped_width> --cropOffset <top> <left> "WhatsApp Image 2026-04-04 at 20.26.24.jpeg" --out assets/promo-flyer.jpg
```

Verify the crop visually — the result should show only the dark green flyer with BASE NOTE logo, bottle, tagline, subtitle, and QR code. No phone UI, no Canva UI.

- [ ] **Step 2: Create thumbnail version**

```bash
sips -Z 400 assets/promo-flyer.jpg --out assets/promo-flyer-thumb.jpg
```

This creates a 400px-max-dimension thumbnail for the social proof section cards.

- [ ] **Step 3: Verify both images look correct**

Open both files and confirm:
- `promo-flyer.jpg`: Clean flyer, no phone/Canva chrome, good resolution
- `promo-flyer-thumb.jpg`: Same content, smaller size

- [ ] **Step 4: Commit**

```bash
git add assets/promo-flyer.jpg assets/promo-flyer-thumb.jpg
git commit -m "Add cropped promotional flyer images

Extracted flyer artwork from Canva screenshot. Full-res for
pop-up/banner, thumbnail for social proof cards."
```

---

### Task 7: Create Promotional Pop-Up Snippet

**Files:**
- Create: `snippets/promo-popup.liquid`
- Modify: `layout/theme.liquid:155` (include the snippet)

- [ ] **Step 1: Create the pop-up snippet**

Create `snippets/promo-popup.liquid`:

```liquid
{% comment %}
  Promotional Pop-Up Modal
  Shows once per visitor (localStorage: bn_promo_seen)
  Skips subscribers and logged-in customers with orders
  3-second delay after page load
{% endcomment %}

{%- unless customer and customer.orders_count > 0 -%}
<div id="promoPopup" class="promo-popup" style="display:none;" role="dialog" aria-modal="true" aria-label="Promotional offer">
  <div class="promo-popup__overlay" id="promoOverlay"></div>
  <div class="promo-popup__modal">
    <button class="promo-popup__close" id="promoClose" aria-label="Close">&times;</button>

    <div class="promo-popup__image">
      <img src="{{ 'promo-flyer.jpg' | asset_url }}" alt="Base Note - A new luxury scent every month" loading="lazy">
    </div>

    <div class="promo-popup__content">
      <p class="promo-popup__eyebrow">Limited Time Offer</p>
      <h2 class="promo-popup__heading">Stylish men don't settle for <em>just</em> one fragrance.</h2>
      <div class="promo-popup__divider"></div>
      <p class="promo-popup__subtext">A new luxury scent, every month<br>Keep the compliments coming</p>
      <a href="/collections/fragrances" class="promo-popup__cta">Start Your Journey</a>
      <p class="promo-popup__offer">25% off your first month</p>
    </div>
  </div>
</div>

<style>
  .promo-popup {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .promo-popup__overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    cursor: pointer;
  }
  .promo-popup__modal {
    position: relative;
    background: #2D4641;
    border-radius: 16px;
    max-width: 420px;
    width: calc(100% - 32px);
    overflow: hidden;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
    animation: promoSlideUp 0.4s ease-out;
  }
  @keyframes promoSlideUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .promo-popup__close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: #fff;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }
  .promo-popup__close:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .promo-popup__image {
    width: 100%;
    max-height: 280px;
    overflow: hidden;
  }
  .promo-popup__image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .promo-popup__content {
    padding: 28px 30px 32px;
    text-align: center;
  }
  .promo-popup__eyebrow {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #C9A962;
    margin: 0 0 12px;
  }
  .promo-popup__heading {
    font-family: var(--font-heading, Georgia, serif);
    font-size: 20px;
    font-weight: 400;
    color: #fff;
    line-height: 1.4;
    margin: 0 0 16px;
  }
  .promo-popup__heading em {
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: #C9A962;
  }
  .promo-popup__divider {
    width: 40px;
    height: 2px;
    background: #C9A962;
    margin: 0 auto 16px;
  }
  .promo-popup__subtext {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.7;
    margin: 0 0 24px;
  }
  .promo-popup__cta {
    display: inline-block;
    padding: 14px 40px;
    background: #C9A962;
    color: #2D4641;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    text-decoration: none;
    border-radius: 6px;
    transition: background 0.2s;
  }
  .promo-popup__cta:hover {
    background: #d4b56e;
  }
  .promo-popup__offer {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    margin: 14px 0 0;
  }
  @media (max-width: 480px) {
    .promo-popup__modal {
      max-width: 340px;
    }
    .promo-popup__image {
      max-height: 200px;
    }
    .promo-popup__heading {
      font-size: 18px;
    }
    .promo-popup__content {
      padding: 20px 24px 28px;
    }
  }
</style>

<script>
  (function() {
    if (localStorage.getItem('bn_promo_seen')) return;

    var popup = document.getElementById('promoPopup');
    var overlay = document.getElementById('promoOverlay');
    var closeBtn = document.getElementById('promoClose');
    if (!popup) return;

    function closePopup() {
      popup.style.display = 'none';
      localStorage.setItem('bn_promo_seen', '1');
    }

    setTimeout(function() {
      popup.style.display = 'flex';
    }, 3000);

    closeBtn.addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && popup.style.display === 'flex') closePopup();
    });
  })();
</script>
{%- endunless -%}
```

- [ ] **Step 2: Include snippet in theme.liquid**

In `layout/theme.liquid`, find line 155 (`{% render 'cookie-consent' %}`). After it, add:

```liquid
  {% comment %} Promotional Pop-Up for New Visitors {% endcomment %}
  {% render 'promo-popup' %}
```

- [ ] **Step 3: Verify pop-up**

Clear `bn_promo_seen` from localStorage, refresh homepage. After 3 seconds the pop-up should appear. Verify:
- Close on X button, overlay click, and Escape key
- Does NOT reappear on refresh after dismissal
- Does NOT show for logged-in subscribers
- Mobile layout looks correct

- [ ] **Step 4: Commit**

```bash
git add snippets/promo-popup.liquid layout/theme.liquid
git commit -m "Add first-visit promotional pop-up modal

Shows flyer image with CTA on first visit after 3s delay.
Skips subscribers. Remembers dismissal via localStorage."
```

---

### Task 8: Create Promotional Banner Section

**Files:**
- Create: `sections/promotional-banner.liquid`
- Modify: `templates/index.json` (add to section order)

- [ ] **Step 1: Create the banner section**

Create `sections/promotional-banner.liquid`:

```liquid
{% comment %}
  Promotional Banner Section
  Full-width banner with flyer image and CTA
  Configurable via theme customizer
{% endcomment %}

{%- if section.settings.enabled -%}
<section class="promo-banner">
  <div class="promo-banner__inner">
    {%- if section.settings.image != blank -%}
    <div class="promo-banner__image">
      {{ section.settings.image | image_url: width: 600 | image_tag: alt: section.settings.heading, loading: 'lazy' }}
    </div>
    {%- else -%}
    <div class="promo-banner__image promo-banner__image--placeholder">
      <div class="promo-banner__bottle"></div>
    </div>
    {%- endif -%}

    <div class="promo-banner__content">
      <p class="promo-banner__eyebrow">{{ section.settings.eyebrow | default: 'New' }}</p>
      <h2 class="promo-banner__heading">{{ section.settings.heading | default: "Stylish men don't settle for <em>just</em> one fragrance." }}</h2>
      <div class="promo-banner__divider"></div>
      <p class="promo-banner__subtext">{{ section.settings.subheading | default: 'A new luxury scent, every month' }}</p>
      {%- if section.settings.cta_text != blank -%}
      <a href="{{ section.settings.cta_link | default: '/collections/fragrances' }}" class="promo-banner__cta">
        {{ section.settings.cta_text }}
      </a>
      {%- endif -%}
    </div>
  </div>
</section>

<style>
  .promo-banner {
    background: linear-gradient(135deg, #2D4641 0%, #1a332e 100%);
    overflow: hidden;
  }
  .promo-banner__inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 48px;
    padding: 64px 40px;
  }
  .promo-banner__image {
    flex-shrink: 0;
    width: 260px;
  }
  .promo-banner__image img {
    width: 100%;
    height: auto;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  .promo-banner__image--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 360px;
  }
  .promo-banner__bottle {
    width: 100px;
    height: 160px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 4px 4px 8px 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .promo-banner__content {
    max-width: 440px;
  }
  .promo-banner__eyebrow {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2.5px;
    color: #C9A962;
    margin: 0 0 16px;
  }
  .promo-banner__heading {
    font-family: var(--font-heading, Georgia, serif);
    font-size: clamp(22px, 3vw, 28px);
    font-weight: 400;
    font-style: italic;
    color: #fff;
    line-height: 1.4;
    margin: 0 0 20px;
  }
  .promo-banner__heading em {
    font-weight: 700;
    text-decoration: underline;
    text-decoration-color: #C9A962;
  }
  .promo-banner__divider {
    width: 40px;
    height: 2px;
    background: #C9A962;
    margin: 0 0 20px;
  }
  .promo-banner__subtext {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: rgba(255, 255, 255, 0.6);
    margin: 0 0 28px;
    line-height: 1.6;
  }
  .promo-banner__cta {
    display: inline-block;
    padding: 14px 36px;
    background: #C9A962;
    color: #2D4641;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    text-decoration: none;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .promo-banner__cta:hover {
    background: #d4b56e;
  }
  @media (max-width: 768px) {
    .promo-banner__inner {
      flex-direction: column;
      text-align: center;
      padding: 48px 24px;
      gap: 32px;
    }
    .promo-banner__image {
      width: 200px;
    }
    .promo-banner__divider {
      margin: 0 auto 20px;
    }
  }
</style>
{%- endif -%}

{% schema %}
{
  "name": "Promotional Banner",
  "settings": [
    {
      "type": "checkbox",
      "id": "enabled",
      "label": "Show banner",
      "default": true
    },
    {
      "type": "image_picker",
      "id": "image",
      "label": "Banner image"
    },
    {
      "type": "text",
      "id": "eyebrow",
      "label": "Eyebrow text",
      "default": "New"
    },
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "Stylish men don't settle for <em>just</em> one fragrance."
    },
    {
      "type": "text",
      "id": "subheading",
      "label": "Subheading",
      "default": "A new luxury scent, every month"
    },
    {
      "type": "text",
      "id": "cta_text",
      "label": "Button text",
      "default": "Subscribe Now — $20/mo"
    },
    {
      "type": "url",
      "id": "cta_link",
      "label": "Button link",
      "default": "/collections/fragrances"
    }
  ],
  "presets": [
    {
      "name": "Promotional Banner"
    }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Add section to homepage order**

In `templates/index.json`, add the promotional-banner section. Insert it in the `"sections"` object and update the `"order"` array to place it between "hero" and "delivery-explainer":

Add to the `"sections"` object:

```json
    "promotional-banner": {
      "type": "promotional-banner",
      "settings": {
        "enabled": true,
        "eyebrow": "New",
        "heading": "Stylish men don't settle for <em>just</em> one fragrance.",
        "subheading": "A new luxury scent, every month",
        "cta_text": "Subscribe Now — $20/mo",
        "cta_link": "/collections/fragrances"
      }
    },
```

Update the `"order"` array to:

```json
  "order": [
    "hero",
    "promotional-banner",
    "delivery-explainer",
    "featured-collection",
    "how-it-works",
    "subscription-plans",
    "testimonials",
    "newsletter"
  ]
```

- [ ] **Step 3: Verify banner on homepage**

Open the homepage and confirm:
- Banner appears between hero and delivery explainer
- Placeholder bottle shows (until Jeff uploads the flyer image via customizer)
- Responsive on mobile (stacks vertically)
- CTA links to /collections/fragrances

- [ ] **Step 4: Commit**

```bash
git add sections/promotional-banner.liquid templates/index.json
git commit -m "Add promotional banner section to homepage

Full-width dark green banner between hero and delivery explainer.
Image, heading, CTA all configurable via theme customizer."
```

---

### Task 9: Create "As Seen Around Town" Social Proof Section

**Files:**
- Create: `sections/social-proof-locations.liquid`
- Modify: `templates/index.json` (add to section order)

- [ ] **Step 1: Create the social proof section**

Create `sections/social-proof-locations.liquid`:

```liquid
{% comment %}
  Social Proof Locations Section
  Shows where Base Note flyers are displayed in the real world
  Up to 6 location blocks with images
{% endcomment %}

<section class="social-proof section section--cream">
  <div class="container" style="max-width:1200px;margin:0 auto;padding:0 2rem;">
    {%- if section.settings.eyebrow != blank -%}
    <p class="social-proof__eyebrow">{{ section.settings.eyebrow }}</p>
    {%- endif -%}
    <h2 class="social-proof__heading">{{ section.settings.heading | default: 'As Seen Around Town' }}</h2>
    {%- if section.settings.description != blank -%}
    <p class="social-proof__description">{{ section.settings.description }}</p>
    {%- endif -%}

    <div class="social-proof__grid">
      {%- for block in section.blocks -%}
      <div class="social-proof__card" {{ block.shopify_attributes }}>
        <div class="social-proof__card-image">
          {%- if block.settings.image != blank -%}
            {{ block.settings.image | image_url: width: 400 | image_tag: alt: block.settings.location_name, loading: 'lazy' }}
          {%- else -%}
            <div class="social-proof__card-placeholder">
              <div style="font-family:var(--font-heading, Georgia, serif);font-size:12px;color:white;letter-spacing:1px;margin-bottom:10px;">BASE NOTE</div>
              <div style="width:30px;height:50px;margin:0 auto 10px;background:rgba(255,255,255,0.08);border-radius:2px 2px 4px 4px;border:1px solid rgba(255,255,255,0.1);"></div>
              <p style="font-family:var(--font-heading, Georgia, serif);font-style:italic;font-size:9px;color:white;margin:0;">A new scent, every month</p>
            </div>
          {%- endif -%}
        </div>
        <div class="social-proof__card-body">
          <p class="social-proof__card-name">{{ block.settings.location_name }}</p>
          {%- if block.settings.city != blank -%}
          <p class="social-proof__card-city">{{ block.settings.city }}</p>
          {%- endif -%}
        </div>
      </div>
      {%- endfor -%}
    </div>

    {%- if section.settings.cta_text != blank -%}
    <div class="social-proof__cta-wrap">
      <a href="{{ section.settings.cta_link | default: '/collections/fragrances' }}" class="social-proof__cta">
        {{ section.settings.cta_text }}
      </a>
    </div>
    {%- endif -%}
  </div>
</section>

<style>
  .social-proof {
    padding: 64px 0;
    text-align: center;
    background: #FAF8F5;
  }
  .social-proof__eyebrow {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: #C9A962;
    margin: 0 0 8px;
  }
  .social-proof__heading {
    font-family: var(--font-heading, Georgia, serif);
    font-size: clamp(24px, 3vw, 30px);
    color: #2D4641;
    margin: 0 0 8px;
  }
  .social-proof__description {
    font-size: 14px;
    color: #888;
    margin: 0 0 36px;
  }
  .social-proof__grid {
    display: flex;
    gap: 24px;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 36px;
  }
  .social-proof__card {
    width: 200px;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .social-proof__card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
  }
  .social-proof__card-image {
    overflow: hidden;
  }
  .social-proof__card-image img {
    width: 100%;
    height: 200px;
    object-fit: cover;
    display: block;
  }
  .social-proof__card-placeholder {
    background: #2D4641;
    padding: 36px 16px;
    text-align: center;
    height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .social-proof__card-body {
    padding: 14px 16px;
    text-align: center;
  }
  .social-proof__card-name {
    font-size: 13px;
    font-weight: 600;
    color: #2D4641;
    margin: 0;
  }
  .social-proof__card-city {
    font-size: 11px;
    color: #999;
    margin: 4px 0 0;
  }
  .social-proof__cta-wrap {
    text-align: center;
  }
  .social-proof__cta {
    display: inline-block;
    padding: 14px 36px;
    background: #2D4641;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    text-decoration: none;
    border-radius: 4px;
    transition: background 0.2s;
  }
  .social-proof__cta:hover {
    background: #3a5a53;
  }
  @media (max-width: 640px) {
    .social-proof__card {
      width: 160px;
    }
    .social-proof__card-image img,
    .social-proof__card-placeholder {
      height: 160px;
    }
  }
</style>

{% schema %}
{
  "name": "Social Proof Locations",
  "settings": [
    {
      "type": "text",
      "id": "eyebrow",
      "label": "Eyebrow text",
      "default": "Find Us"
    },
    {
      "type": "text",
      "id": "heading",
      "label": "Heading",
      "default": "As Seen Around Town"
    },
    {
      "type": "text",
      "id": "description",
      "label": "Description",
      "default": "Discover Base Note at these locations"
    },
    {
      "type": "text",
      "id": "cta_text",
      "label": "Button text",
      "default": "Start Your Journey"
    },
    {
      "type": "url",
      "id": "cta_link",
      "label": "Button link",
      "default": "/collections/fragrances"
    }
  ],
  "blocks": [
    {
      "type": "location",
      "name": "Location",
      "settings": [
        {
          "type": "image_picker",
          "id": "image",
          "label": "Location image"
        },
        {
          "type": "text",
          "id": "location_name",
          "label": "Location name",
          "default": "Coffee Shops"
        },
        {
          "type": "text",
          "id": "city",
          "label": "City",
          "default": "Chicago, IL"
        }
      ]
    }
  ],
  "max_blocks": 6,
  "presets": [
    {
      "name": "Social Proof Locations",
      "blocks": [
        {
          "type": "location",
          "settings": {
            "location_name": "Coffee Shops",
            "city": "Chicago, IL"
          }
        },
        {
          "type": "location",
          "settings": {
            "location_name": "Barbershops",
            "city": "Park Ridge, IL"
          }
        },
        {
          "type": "location",
          "settings": {
            "location_name": "Gyms & Lounges",
            "city": "Chicagoland"
          }
        }
      ]
    }
  ]
}
{% endschema %}
```

- [ ] **Step 2: Add section to homepage order**

In `templates/index.json`, add to the `"sections"` object:

```json
    "social-proof-locations": {
      "type": "social-proof-locations",
      "blocks": {
        "loc-1": {
          "type": "location",
          "settings": {
            "location_name": "Coffee Shops",
            "city": "Chicago, IL"
          }
        },
        "loc-2": {
          "type": "location",
          "settings": {
            "location_name": "Barbershops",
            "city": "Park Ridge, IL"
          }
        },
        "loc-3": {
          "type": "location",
          "settings": {
            "location_name": "Gyms & Lounges",
            "city": "Chicagoland"
          }
        }
      },
      "block_order": ["loc-1", "loc-2", "loc-3"],
      "settings": {
        "eyebrow": "Find Us",
        "heading": "As Seen Around Town",
        "description": "Discover Base Note at these locations",
        "cta_text": "Start Your Journey",
        "cta_link": "/collections/fragrances"
      }
    },
```

Update the `"order"` array (should now include the earlier promotional-banner too):

```json
  "order": [
    "hero",
    "promotional-banner",
    "delivery-explainer",
    "featured-collection",
    "how-it-works",
    "subscription-plans",
    "testimonials",
    "social-proof-locations",
    "newsletter"
  ]
```

- [ ] **Step 3: Verify section on homepage**

Scroll to bottom of homepage. Confirm:
- "As Seen Around Town" section appears after testimonials
- 3 placeholder cards show (Coffee Shops, Barbershops, Gyms & Lounges)
- Cards are responsive on mobile
- CTA button links correctly

- [ ] **Step 4: Commit**

```bash
git add sections/social-proof-locations.liquid templates/index.json
git commit -m "Add 'As Seen Around Town' social proof section

Shows up to 6 location cards where Base Note flyers are displayed.
Placed after testimonials on homepage. Fully configurable via
theme customizer."
```

---

### Task 10: Create Pre-Shipment Confirmation Email Template

**Files:**
- Create: `snippets/email-pre-shipment-confirmation.liquid`

- [ ] **Step 1: Create the email template**

Create `snippets/email-pre-shipment-confirmation.liquid`:

```html
{% comment %}
  Email Reference: Pre-Shipment Confirmation (3 days before)
  PURPOSE: Klaviyo design reference — NOT rendered by the theme.
  TRIGGER: 3 days before billing for ALL active subscribers
  DISTINCT FROM:
    - email-pre-shipment.liquid (7-day reminder)
    - email-urgency-reminder.liquid (3-day "you haven't picked" warning)

  This email confirms what IS shipping, with scent education and next month teaser.

  Merge tags use Klaviyo syntax.
{% endcomment %}

<!-- PRE-SHIPMENT CONFIRMATION EMAIL -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Fragrance Ships in 3 Days</title>
</head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#2D4641;">
    <tr>
      <td align="center" style="padding:24px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#fff;letter-spacing:0.05em;">BASE NOTE</span>
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">

          <!-- Green accent bar -->
          <tr><td style="height:4px;background:#4CAF50;"></td></tr>

          <!-- Hero -->
          <tr>
            <td style="padding:40px 40px 24px;text-align:center;">
              <p style="font-size:14px;color:#666;margin:0 0 8px;">Hey {{ first_name }},</p>
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#2D4641;margin:0 0 16px;line-height:1.3;">
                Your {{ fragrance_name }} ships in 3 days
              </h1>
              <!-- Selection badge -->
              <span style="display:inline-block;padding:6px 16px;background:{% if selection_type == 'confirmed' %}#E8F5E9;color:#2E7D32{% elsif selection_type == 'fotm' %}#FFF8E1;color:#F9A825{% else %}#FFF8E1;color:#F9A825{% endif %};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-radius:20px;">
                {% if selection_type == 'confirmed' %}Confirmed{% elsif selection_type == 'fotm' %}Curated Pick{% else %}Auto-Selected{% endif %}
              </span>
            </td>
          </tr>

          <!-- Fragrance Card -->
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="width:140px;vertical-align:top;">
                    <img src="{{ fragrance_image }}" alt="{{ fragrance_name }}" style="width:140px;height:180px;object-fit:cover;display:block;">
                  </td>
                  <td style="padding:20px 24px;vertical-align:top;">
                    <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#2D4641;margin:0 0 4px;">{{ fragrance_name }}</h2>
                    <p style="font-size:13px;color:#C9A962;font-weight:600;margin:0 0 16px;">{{ fragrance_house }}</p>

                    <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 4px;">Top Notes</p>
                    <p style="font-size:13px;color:#2D4641;margin:0 0 12px;">{{ top_notes }}</p>

                    <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 4px;">Heart Notes</p>
                    <p style="font-size:13px;color:#2D4641;margin:0 0 12px;">{{ heart_notes }}</p>

                    <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 4px;">Base Notes</p>
                    <p style="font-size:13px;color:#2D4641;margin:0;">{{ base_notes }}</p>
                  </td>
                </tr>
              </table>

              <!-- Fragrance family tag -->
              <p style="text-align:center;margin:12px 0 0;">
                <span style="display:inline-block;padding:4px 12px;background:#2D4641;color:#fff;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-radius:4px;">{{ fragrance_family }}</span>
              </p>
            </td>
          </tr>

          <!-- Perfect For -->
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#C9A962;margin:0 0 12px;text-align:center;">Perfect For</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px;background:#FAF8F5;border-radius:8px;width:33%;">
                    <span style="font-size:20px;display:block;margin-bottom:4px;">&#127970;</span>
                    <span style="font-size:11px;color:#2D4641;font-weight:600;">Office</span>
                  </td>
                  <td width="8"></td>
                  <td align="center" style="padding:8px;background:#FAF8F5;border-radius:8px;width:33%;">
                    <span style="font-size:20px;display:block;margin-bottom:4px;">&#127749;</span>
                    <span style="font-size:11px;color:#2D4641;font-weight:600;">Date Night</span>
                  </td>
                  <td width="8"></td>
                  <td align="center" style="padding:8px;background:#FAF8F5;border-radius:8px;width:33%;">
                    <span style="font-size:20px;display:block;margin-bottom:4px;">&#127881;</span>
                    <span style="font-size:11px;color:#2D4641;font-weight:600;">Events</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action CTAs -->
          <tr>
            <td style="padding:0 40px 32px;text-align:center;">
              <a href="{{ swap_url }}" style="display:inline-block;padding:14px 36px;background:#2D4641;color:#fff;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;text-decoration:none;border-radius:6px;margin-right:8px;">Swap Fragrance</a>
              <a href="{{ skip_url }}" style="display:inline-block;padding:14px 36px;background:transparent;color:#2D4641;font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;text-decoration:none;border-radius:6px;border:2px solid #E8E6E3;">Skip This Month</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:#E8E6E3;"></div>
            </td>
          </tr>

          <!-- Coming Next Month Teaser -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#C9A962;margin:0 0 16px;text-align:center;">Coming Next Month...</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="width:80px;">
                    <img src="{{ fotm_image }}" alt="{{ fotm_name }}" style="width:80px;height:80px;object-fit:cover;display:block;">
                  </td>
                  <td style="padding:16px 20px;">
                    <p style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#2D4641;margin:0 0 4px;font-weight:600;">{{ fotm_name }}</p>
                    <p style="font-size:13px;color:#666;margin:0;line-height:1.4;">{{ fotm_teaser }}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background:#FAF8F5;border-top:1px solid #E8E6E3;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="text-align:center;">
                    <a href="{{ account_url }}" style="font-size:12px;color:#2D4641;text-decoration:underline;margin:0 12px;">Manage Subscription</a>
                    <a href="{{ unsubscribe_url }}" style="font-size:12px;color:#999;text-decoration:underline;margin:0 12px;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
              <p style="font-size:11px;color:#999;text-align:center;margin:12px 0 0;">
                Base Note &middot; {{ shop_address }}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add snippets/email-pre-shipment-confirmation.liquid
git commit -m "Add pre-shipment confirmation email template

3-day confirmation email with fragrance card, scent notes,
occasion tags, swap/skip CTAs, and next month FOTM teaser.
Klaviyo reference template."
```

---

### Task 11: Push to Shopify and QA

**Files:** All modified files

- [ ] **Step 1: Push all changes to live theme**

```bash
shopify theme push --store base-note.myshopify.com --theme 158692901082
```

- [ ] **Step 2: QA Payment Update**

On mobile (or mobile emulator), navigate to:
`https://basenotescent.com/account#subscription`

Verify:
- "Change Plan" button is gone
- "Update Payment" button exists and links to Appstle payment update (not the raw portal)
- Other actions (Skip, Pause, Cancel) still work

- [ ] **Step 3: QA Promotional Pop-Up**

Open `https://basenotescent.com` in incognito/private window:
- Pop-up appears after 3 seconds
- Flyer image loads (or placeholder shows until image is uploaded)
- Close on X, overlay click, and Escape all work
- Pop-up does NOT reappear on page refresh
- Pop-up does NOT show when logged in as a subscriber

- [ ] **Step 4: QA Homepage Sections**

Scroll through `https://basenotescent.com`:
- Promotional banner appears between hero and delivery explainer
- "As Seen Around Town" section appears after testimonials
- Both sections are responsive on mobile
- CTAs link correctly

- [ ] **Step 5: QA FOTM Settings**

Open theme customizer:
`https://base-note.myshopify.com/admin/themes/158692901082/editor`

- "Fragrance of the Month" section appears in theme settings
- Can select a product, set display name, set month
- Save and verify it persists

- [ ] **Step 6: QA Auto-Selection**

On the account page:
- Clear `bn_next_shipment` from localStorage via browser console
- Set billing date within 3 days (may need test data)
- Verify auto-selection triggers
- Verify correct badge (AUTO-SELECTED or CURATED PICK)

- [ ] **Step 7: Commit QA completion note**

If any fixes were needed during QA, commit them:

```bash
git add -A
git commit -m "QA fixes for subscriber experience v2"
```

---

### Task 12: Push Final Changes to GitHub

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Verify deployment**

Check that all commits are visible at `https://github.com/wilsonwu-ai/basenotes`.
