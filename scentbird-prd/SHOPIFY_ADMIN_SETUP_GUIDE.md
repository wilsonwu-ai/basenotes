# Base Note — Shopify Admin Setup Guide

> These settings must be configured manually in Shopify Admin.
> They cannot be set via theme code.
> Last Updated: 2026-02-22

---

## 1. Enable Sales Tax

Sales tax is calculated based on the **shipping address** (destination-based sourcing), which is the legal standard in 45/50 US states. Shopify handles this automatically.

### Steps:
1. Go to **Shopify Admin** → **Settings** → **Taxes and duties**
2. Under **Countries/regions**, click **United States**
3. Verify that **"Charge tax"** is enabled
4. Ensure you have tax registration for states where you have nexus (physical presence or economic nexus)
5. Under **Tax calculations**, ensure:
   - "Automatically calculate tax" is ON
   - "Charge tax based on customer's shipping address" is the default (do NOT change this)
6. Click **Save**

### Important Notes:
- Tax is based on **shipping address**, NOT billing address
- This is legally correct — do not override
- If the customer lives in Illinois but ships to New York, New York tax rates apply
- States with no sales tax (Oregon, Montana, Delaware, New Hampshire, Alaska) will show $0 tax

---

## 2. Configure Free Shipping

The theme UI shows "FREE shipping" but this must also be configured as an actual shipping rate.

### Steps:
1. Go to **Shopify Admin** → **Settings** → **Shipping and delivery**
2. Under **General shipping rates**, click **Manage**
3. For the **Domestic** shipping zone:
   - Click **Add rate**
   - Set rate name: **"Free Shipping"**
   - Set price: **$0.00**
   - Under conditions, you can either:
     - **Option A:** Apply to all orders (simplest for subscription model)
     - **Option B:** Apply to orders over $0 with specific conditions
4. Click **Done**, then **Save**

### For Subscription Orders Specifically:
- If using Appstle or another subscription app, the app may handle shipping rates separately
- Verify that subscription renewal orders also receive free shipping
- Test a checkout to confirm $0 shipping appears

---

## 3. Add Staff Order Notification Emails

All team members should receive email notifications when a new order is placed.

### Steps:
1. Go to **Shopify Admin** → **Settings** → **Notifications**
2. Scroll to **Staff order notifications**
3. Click **Add recipient** and add each email:
   - `wilson@basenotescent.com`
   - `jeff@basenotescent.com`
   - `alex@basenotescent.com`
4. Ensure these notification types are enabled for each recipient:
   - **New order** — Sent when a customer places an order
   - **New order (mobile)** — Push notification (optional)
5. Click **Save**

### Verify:
- Place a test order
- Confirm all 3 team members receive the notification email
- Check spam/junk folders if not received

### Optional — Klaviyo Integration:
A custom staff notification email template is available at:
`snippets/email-staff-order-notification.liquid`

To use with Klaviyo:
1. Create a new Flow in Klaviyo triggered by "Placed Order"
2. Add an Email action
3. Copy the HTML from the template
4. Set recipients to: wilson@basenotescent.com, jeff@basenotescent.com, alex@basenotescent.com

---

## 4. Deploy Latest Theme Code

The live theme may not reflect the latest code changes.

### Steps:

#### Option A: Shopify CLI (Recommended)
```bash
shopify theme push --store base-note.myshopify.com --theme 158692901082
```

This pushes the local `basenote` directory to the live theme (ID: 158692901082).

#### Option B: Shopify Admin Upload
1. Go to **Shopify Admin** → **Online Store** → **Themes**
2. Click **"..."** on the live theme → **Edit code**
3. Manually update files that have changed

#### After Deployment:
- Clear Shopify's theme cache (if applicable)
- Visit the live site in an incognito window to verify changes
- Run through the QA Checklist (`scentbird-prd/QA_CHECKLIST.md`)

---

## 5. Verify Checkout Settings

### Steps:
1. Go to **Shopify Admin** → **Settings** → **Checkout**
2. Under **Customer accounts**, verify:
   - "Require customer accounts" or "Accounts are optional" (per your preference)
3. Under **Order processing**:
   - Verify address autocomplete is enabled
4. Under **Additional scripts** (Order status page):
   - Ensure the checkout-thank-you.liquid and checkout-subscription-scripts.liquid content is pasted here
   - These scripts show subscription confirmation on the thank-you page

---

## Quick Reference

| Setting | Location | Action |
|---------|----------|--------|
| Sales Tax | Settings > Taxes | Verify enabled, destination-based |
| Free Shipping | Settings > Shipping | Add $0 rate for domestic |
| Staff Notifications | Settings > Notifications | Add 3 team emails |
| Theme Deploy | Online Store > Themes | Push via CLI |
| Checkout Scripts | Settings > Checkout > Additional scripts | Paste thank-you/subscription scripts |
