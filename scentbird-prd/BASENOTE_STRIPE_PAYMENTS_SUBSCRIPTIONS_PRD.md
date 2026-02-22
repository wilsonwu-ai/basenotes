# PRODUCT REQUIREMENTS DOCUMENT (PRD)

## Stripe Payment Integration & Subscription Auto-Renewal Billing for Base Note

---

**Document Version:** 1.0
**Date:** February 21, 2026
**Author:** Product Manager / Product Designer
**Status:** Ready for Implementation
**Platform:** Shopify 2.0 + Shopify Payments (Stripe-powered) + Subscription App
**Brand:** Base Note
**Founder:** Wilson Wu

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision: Why Shopify Payments (Not Stripe Direct)](#2-architecture-decision)
3. [Payment Gateway Setup — Shopify Payments](#3-payment-gateway-setup)
4. [Subscription App Selection & Configuration](#4-subscription-app-selection)
5. [Module 1: Payment Processing Flow](#5-module-1-payment-processing-flow)
6. [Module 2: Subscription Auto-Renewal Billing Engine](#6-module-2-subscription-auto-renewal-billing)
7. [Module 3: Opt-Out Model & Cancellation Window](#7-module-3-opt-out-model)
8. [Module 4: Dunning & Failed Payment Recovery](#8-module-4-dunning)
9. [Module 5: Stripe Dashboard Monitoring & Reporting](#9-module-5-stripe-dashboard)
10. [PCI Compliance & Data Security](#10-pci-compliance)
11. [Legal & FTC Compliance for Auto-Renewal](#11-legal-compliance)
12. [Fee Structure & Revenue Impact](#12-fee-structure)
13. [Implementation Phases](#13-implementation-phases)
14. [Appendix: Wireframes & Flow Diagrams](#14-appendix)

---

## 1. EXECUTIVE SUMMARY

This document outlines the complete payment integration and subscription billing system for Base Note, a luxury fragrance subscription platform on Shopify. The system connects Stripe-powered payment processing to an opt-out subscription model where every first purchase automatically enrolls the customer in monthly recurring billing.

**Five core capabilities:**

1. **Payment Gateway** — Shopify Payments (powered by Stripe under the hood) processes all credit/debit card transactions with zero third-party surcharges
2. **Subscription Billing Engine** — A Shopify subscription app (Appstle or Recharge) manages recurring charges via Shopify's Selling Plans API and Subscription Contracts
3. **Opt-Out Model** — Purchase = automatic enrollment. Customers are charged on the same calendar day each month unless they cancel before the renewal date
4. **Cancellation Window** — Same-day opt-out: if purchased Feb 21, the customer can cancel any time up to March 21. If they miss the window and are charged on March 22, no refund is issued but the order is fulfilled
5. **Dunning & Recovery** — Automated retry logic for failed payments using Stripe's Smart Retry system to recover up to 56% of failed charges

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Payment gateway | Shopify Payments (Stripe) | Lowest fees (no 3rd-party surcharge), native integration, PCI compliant |
| Subscription management | Shopify subscription app (Appstle recommended) | Native Selling Plans API, 0% transaction fee on free plan, Shopify-native checkout |
| Direct Stripe Billing? | NO | Adds 0.7% surcharge, requires custom order sync, not natively compatible with Shopify |
| Card storage | Stripe tokenization via Shopify Checkout | PCI Level 1 compliant, merchant never touches raw card data |
| Billing model | Same-day monthly recurring | Charge on anniversary date of first purchase |
| Refund policy | No refunds after billing date | Order is still fulfilled |

---

## 2. ARCHITECTURE DECISION: WHY SHOPIFY PAYMENTS (NOT STRIPE DIRECT)

### Critical Context: Shopify Payments IS Stripe

Shopify Payments is powered by Stripe's infrastructure. When you enable Shopify Payments, you are already using Stripe — Shopify acts as a branded wrapper over Stripe's payment rails. This means:

- All credit card processing flows through Stripe's secure network
- Stripe's fraud detection (Radar) protects every transaction
- Stripe's PCI Level 1 compliance covers all card storage
- You get Stripe's reliability without a separate Stripe account

### Why NOT Use Stripe as a Third-Party Gateway

| Factor | Shopify Payments | Stripe Direct (3rd Party) |
|--------|-----------------|--------------------------|
| Card processing fee (Basic plan) | 2.9% + $0.30 | 2.9% + $0.30 |
| Shopify transaction surcharge | **$0 (none)** | **+2.0%** |
| Total per $20 subscription charge | $0.88 | **$1.28** (+45% more) |
| Total per $408 full bottle | $12.13 | **$20.26** (+67% more) |
| Setup complexity | Built-in, 5-minute setup | Requires API keys, separate dashboard |
| Subscription compatibility | Full Selling Plans API support | Limited, varies by app |
| Shop Pay / Apple Pay / Google Pay | Included | Not available |

**Annual savings estimate** (100 subscribers at $20/month):
- Shopify Payments: $1,056/year in fees
- Stripe Direct: $1,536/year in fees
- **Savings: $480/year** (grows with subscriber base)

### Why NOT Use Stripe Billing Directly

Stripe Billing is Stripe's standalone subscription management product. It costs an additional 0.7% on all recurring charges and is designed for non-Shopify businesses. Using it with Shopify would require:
- Custom code to sync Stripe subscriptions with Shopify orders
- Manual fulfillment and inventory management
- No native customer portal in Shopify
- Double the complexity for zero benefit

**Verdict: Use Shopify Payments + a Shopify subscription app. Do NOT use Stripe Billing or Stripe as a third-party gateway.**

---

## 3. PAYMENT GATEWAY SETUP — SHOPIFY PAYMENTS

### 3.1 Prerequisites

Before enabling Shopify Payments:

- [ ] Shopify store is on an active paid plan (Basic, Shopify, or Advanced)
- [ ] Store is located in a Shopify Payments-supported country (US, CA, UK, AU, etc.)
- [ ] Business has a valid EIN/Tax ID (for US businesses)
- [ ] Business bank account is ready to receive payouts

### 3.2 Step-by-Step Activation

**Step 1: Navigate to Payment Settings**
```
Shopify Admin > Settings > Payments
```

**Step 2: Activate Shopify Payments**
- Click "Activate Shopify Payments" in the main payment section
- If you see "Complete account setup," click through and provide:
  - Business legal name and address
  - EIN / Tax Identification Number
  - Business type (sole proprietorship, LLC, corporation)
  - Owner/representative personal details (SSN last 4 digits for US)
  - Bank account and routing number for payouts

**Step 3: Configure Payment Methods**

Enable all relevant payment methods:

| Payment Method | Recommended | Notes |
|---------------|-------------|-------|
| Credit/Debit Cards | YES | Visa, Mastercard, Amex, Discover |
| Shop Pay | YES | Accelerated checkout, saves customer info |
| Apple Pay | YES | Mobile-first customers |
| Google Pay | YES | Android users |
| PayPal | OPTIONAL | Separate from Shopify Payments, adds 3rd-party fee |

**Step 4: Configure Payout Schedule**
```
Shopify Admin > Settings > Payments > Shopify Payments > Manage > Payout schedule
```

Options:
- **Daily (automatic)** — Recommended for cash flow
- **Weekly** — Payout every Monday (or chosen day)
- **Monthly** — Payout on the 1st of each month

**Step 5: Enable Fraud Prevention**
- Shopify Payments includes Stripe Radar (basic fraud detection) by default
- Review AVS (Address Verification System) settings
- Enable CVV verification (should be on by default)

### 3.3 Test Mode

Before going live:

1. Go to **Settings > Payments > Shopify Payments > Manage**
2. Enable **"Use test mode"**
3. Use Stripe test card numbers:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - Requires auth: `4000 0025 0000 3155`
4. Complete a test purchase through the full checkout flow
5. Verify the order appears in Shopify Admin > Orders
6. Disable test mode when ready to go live

---

## 4. SUBSCRIPTION APP SELECTION & CONFIGURATION

### 4.1 Recommended App: Appstle Subscriptions

| Feature | Appstle | Recharge | Seal | Bold |
|---------|---------|----------|------|------|
| Free plan | YES (0% fee) | NO ($99/mo min) | YES (0% fee) | NO ($49.99/mo) |
| Shopify Payments support | YES | YES | YES | YES |
| Selling Plans API | YES | YES | YES | YES |
| Customer portal | YES | YES | YES | YES |
| Dunning management | YES | YES | Basic | YES |
| Build-a-box / bundles | YES | YES (Pro) | Limited | YES |
| Shopify App Store rating | 4.9/5 | 4.6/5 | 4.9/5 | 4.2/5 |
| Best for | SMB to mid-market | Enterprise / Plus | Budget / starter | Mid-market |

**Recommendation: Start with Appstle (free plan, 0% transaction fee, full feature set).** Upgrade to Recharge if you scale past 1,000 subscribers and need advanced analytics/workflows.

### 4.2 Appstle Installation & Setup

**Step 1: Install from Shopify App Store**
```
Shopify Admin > Apps > Search "Appstle Subscriptions" > Install
```

**Step 2: Create a Selling Plan Group**

```
Appstle Dashboard > Subscription Plans > Create Plan
```

Configure the Base Note subscription plan:

| Setting | Value |
|---------|-------|
| Plan name | Base Note Monthly Subscription |
| Plan type | Pay-as-you-go (pay per delivery) |
| Billing interval | 1 month |
| Delivery interval | 1 month |
| Billing anchor | Same day as signup (anniversary billing) |
| Discount type | None (fixed $20/month) |
| Min cycles before cancel | 1 (first month is committed) |
| Allow skip | No (opt-out only, no skip) |
| Auto-renewal | YES |

**Step 3: Attach Selling Plan to Products**

```
Appstle Dashboard > Subscription Plans > [Your Plan] > Products
```

- Select ALL 5ml subscription variants across all products
- Do NOT attach selling plans to full-bottle variants ($408 one-time purchase)

**Step 4: Configure Customer Portal**

```
Appstle Dashboard > Customer Portal > Settings
```

| Portal Feature | Setting |
|---------------|---------|
| Cancel subscription | Enabled (with retention flow) |
| Skip next shipment | Disabled |
| Swap fragrance | Enabled |
| Change billing date | Disabled |
| Update payment method | Enabled |
| View order history | Enabled |
| Pause subscription | Disabled (opt-out only) |

**Step 5: Configure Dunning (Failed Payment Recovery)**

```
Appstle Dashboard > Settings > Dunning
```

| Retry | When | Action |
|-------|------|--------|
| 1st retry | 1 day after failure | Retry charge, send email to customer |
| 2nd retry | 3 days after failure | Retry charge, send reminder email |
| 3rd retry | 5 days after failure | Retry charge, send urgent email |
| Final | 7 days after failure | Cancel subscription, send cancellation notice |

---

## 5. MODULE 1: PAYMENT PROCESSING FLOW

### 5.1 Overview

The payment flow describes the complete journey from cart to successful charge. This covers both the initial subscription purchase ($20/month 5ml) and one-time full-bottle purchases ($408).

### 5.2 Flow Diagram

```
+-------------------+     +--------------------+     +---------------------+
|                   |     |                    |     |                     |
|   CART REVIEW     | --> |   CHECKOUT FORM    | --> |   PAYMENT SECTION   |
|   /cart           |     |   /checkout        |     |   (Stripe Elements) |
|                   |     |                    |     |                     |
|  - Line items     |     |  - Contact info    |     |  - Card number      |
|  - Subtotal       |     |  - Shipping addr   |     |  - Expiry           |
|  - Subscription   |     |  - Shipping method  |     |  - CVV              |
|    badge on 5ml   |     |  - Billing addr    |     |  - Shop Pay / Apple |
|                   |     |                    |     |    Pay / Google Pay  |
+-------------------+     +--------------------+     +---------------------+
                                                              |
                                                              v
+-------------------+     +--------------------+     +---------------------+
|                   |     |                    |     |                     |
|  ORDER CONFIRM    | <-- |  PAYMENT PROCESS   | <-- |  SUBSCRIPTION       |
|  /thank-you       |     |  (Stripe backend)  |     |  CONSENT CHECKBOX   |
|                   |     |                    |     |                     |
|  - Order number   |     |  - Tokenize card   |     |  [x] I agree to     |
|  - Email confirm  |     |  - Charge $20      |     |    monthly billing  |
|  - Next billing   |     |  - Vault payment   |     |    at $20/month.    |
|    date shown     |     |    method (token)  |     |    Cancel anytime   |
|  - Subscription   |     |  - Create order    |     |    before renewal.  |
|    details        |     |  - Create sub      |     |                     |
|                   |     |    contract        |     |  [COMPLETE ORDER]   |
+-------------------+     +--------------------+     +---------------------+
```

### 5.3 Step 1: Cart Review

**Route:** `/cart`

The cart page (or cart drawer) must clearly distinguish between subscription items and one-time purchases.

**Subscription item display:**
```
+------------------------------------------------------------------+
|  [IMG]  Creed Aventus - 5ml Atomizer                             |
|         SUBSCRIPTION: $20.00/month                               |
|         Ships monthly, cancel anytime before renewal              |
|                                                     [Remove]     |
+------------------------------------------------------------------+
|  [IMG]  Creed Aventus - 3.3 fl oz Full Bottle                   |
|         ONE-TIME: $408.00                                        |
|         Compare at: $510.00  (Save $102.00)                     |
|                                                     [Remove]     |
+------------------------------------------------------------------+
|                                                                  |
|  Subtotal ..................................... $428.00          |
|  Recurring charges: $20.00/month starting [date]                 |
|                                                                  |
|  [ PROCEED TO CHECKOUT ]                                         |
+------------------------------------------------------------------+
```

**Critical cart requirements:**
- Every subscription line item must show "SUBSCRIPTION: $X/month" badge
- Below the subtotal, display a recurring charges summary: "$20.00/month starting [next billing date]"
- One-time purchase items (full bottles) must show "ONE-TIME" badge
- Cart must never auto-add subscription items — customer makes the choice on the product page

### 5.4 Step 2: Checkout Form

**Route:** `/checkout` (Shopify-managed)

Shopify Checkout is a hosted experience. It collects:

1. **Contact Information** — Email address (required for order confirmation and subscription emails)
2. **Shipping Address** — Full address for fragrance delivery
3. **Shipping Method** — Standard / Express (free shipping for subscribers)
4. **Billing Address** — Same as shipping or different

### 5.5 Step 3: Payment Section

**The payment section is rendered by Shopify Checkout, which embeds Stripe Elements (secure card input fields hosted by Stripe).**

```
+------------------------------------------------------------------+
|  PAYMENT                                                          |
|                                                                   |
|  [Shop Pay]  [Apple Pay]  [Google Pay]                           |
|                                                                   |
|  ─── or pay with credit card ───                                 |
|                                                                   |
|  Card number:    [________________________]    [VISA] [MC] [AMEX]|
|  Expiration:     [MM / YY]   CVV: [___]                          |
|  Name on card:   [________________________]                      |
|                                                                   |
|  ┌──────────────────────────────────────────────────────────────┐|
|  │ SUBSCRIPTION DISCLOSURE (required by law)                    │|
|  │                                                              │|
|  │ By completing this purchase, you are enrolling in a monthly  │|
|  │ subscription at $20.00/month. Your payment method will be    │|
|  │ automatically charged on the same day each month (your next  │|
|  │ charge: [March 21, 2026]).                                   │|
|  │                                                              │|
|  │ You may cancel at any time before your next billing date     │|
|  │ through your account portal. Charges processed after your    │|
|  │ billing date are non-refundable.                             │|
|  │                                                              │|
|  │ By checking this box, you agree to the Subscription Terms    │|
|  │ and authorize recurring charges to your payment method.      │|
|  │                                                              │|
|  │ [x] I agree to the Subscription Terms and recurring billing  │|
|  └──────────────────────────────────────────────────────────────┘|
|                                                                   |
|  [         COMPLETE ORDER  —  $428.00         ]                  |
|                                                                   |
|  Recurring: $20.00/month starting Mar 21, 2026                   |
+------------------------------------------------------------------+
```

**Critical payment section requirements:**

- **Subscription disclosure box** — MUST be visible before the "Complete Order" button. Not hidden behind a link or collapsed section.
- **Affirmative consent checkbox** — Customer MUST check the box to agree to recurring billing. The box must NOT be pre-checked.
- **Next billing date** — Calculated dynamically: purchase date + 1 month (same calendar day). Example: Feb 21 purchase = March 21 next charge.
- **Terms link** — "Subscription Terms" links to `/pages/subscription-terms` (see Legal section)
- **Non-refundable notice** — Explicit statement that charges after billing date are non-refundable

### 5.6 Step 4: Payment Processing (Backend)

When the customer clicks "Complete Order," the following sequence occurs:

```
1. Shopify Checkout captures payment details
       |
2. Stripe Elements tokenizes the card
   (raw card data NEVER touches Shopify or Base Note servers)
       |
3. Stripe processes the charge ($20 + $408 = $428)
       |
4. Stripe vaults the payment method (stores encrypted token)
   - Token ID stored in Shopify for future recurring charges
   - Raw card number stored in Stripe's PCI Level 1 vault
   - Only last 4 digits + brand visible to merchant
       |
5. Shopify creates the Order (Order #XXXX)
       |
6. Subscription app receives webhook: SUBSCRIPTION_CONTRACTS_CREATE
       |
7. Subscription app creates a Subscription Contract:
   - Customer ID
   - Payment method token
   - Billing interval: 1 month
   - Anchor date: purchase date (e.g., Feb 21)
   - Next billing date: March 21
   - Status: ACTIVE
       |
8. Shopify sends Order Confirmation email
       |
9. Subscription app sends Subscription Welcome email
```

### 5.7 Step 5: Order Confirmation Page

**Route:** `/thank-you`

```
+------------------------------------------------------------------+
|                                                                   |
|  ✓  THANK YOU FOR YOUR ORDER                                     |
|                                                                   |
|  Order #BN-1042                                                  |
|  Confirmation email sent to: wilson@basenote.com                 |
|                                                                   |
|  ┌──────────────────────────────────────────────────────────────┐|
|  │  YOUR SUBSCRIPTION IS ACTIVE                                 │|
|  │                                                              │|
|  │  Plan: Base Note Monthly — $20.00/month                      │|
|  │  Next shipment: March 21, 2026                               │|
|  │  Next charge: March 21, 2026                                 │|
|  │                                                              │|
|  │  You can manage your subscription, swap fragrances, or       │|
|  │  cancel at any time from your account portal.                │|
|  │                                                              │|
|  │  [ MANAGE MY SUBSCRIPTION ]                                  │|
|  └──────────────────────────────────────────────────────────────┘|
|                                                                   |
|  ORDER SUMMARY                                                   |
|  Creed Aventus — 5ml Atomizer (Subscription)     $20.00         |
|  Creed Aventus — 3.3 fl oz Full Bottle           $408.00        |
|  Shipping                                        FREE            |
|  ────────────────────────────────────────────────                |
|  Total charged today                             $428.00         |
|                                                                   |
+------------------------------------------------------------------+
```

---

## 6. MODULE 2: SUBSCRIPTION AUTO-RENEWAL BILLING ENGINE

### 6.1 Billing Model: Anniversary Date Recurring

The subscription uses **anniversary billing** — the customer is charged on the same calendar day each month as their original purchase.

| Purchase Date | 1st Renewal | 2nd Renewal | 3rd Renewal |
|--------------|-------------|-------------|-------------|
| Feb 21 | Mar 21 | Apr 21 | May 21 |
| Jan 31 | Feb 28* | Mar 31 | Apr 30** |
| Mar 15 | Apr 15 | May 15 | Jun 15 |

*When the billing day doesn't exist in a shorter month, charge on the last day of that month.
**Same rule applies for 30-day months when anchor is 31st.

### 6.2 Auto-Renewal Sequence

Every month, on the customer's billing day, this sequence fires automatically:

```
BILLING DAY (e.g., March 21)
       |
       v
[1] Subscription app calls Shopify's SubscriptionBillingAttempt API
       |
       v
[2] Shopify retrieves the vaulted payment method token
       |
       v
[3] Shopify sends the charge to Stripe via Shopify Payments
       |
       v
[4] Stripe charges the customer's card: $20.00
       |
       v
[5] SUCCESS?
    |         \
   YES         NO --> [Dunning flow - see Module 4]
    |
    v
[6] Shopify creates a new Order automatically
       |
       v
[7] Order enters fulfillment queue
       |
       v
[8] Customer receives order confirmation email
       |
       v
[9] Staff fulfills order (ships fragrance)
       |
       v
[10] Subscription contract updated:
     - Last billed: March 21
     - Next billing: April 21
     - Status: ACTIVE
```

### 6.3 What Shopify Stores vs. What Stripe Stores

| Data | Where It Lives | Who Can Access |
|------|---------------|----------------|
| Full card number (encrypted) | Stripe's PCI vault | Stripe only (via token) |
| Payment method token | Shopify + Stripe | Shopify (for billing), subscription app (via API) |
| Last 4 digits + brand | Shopify Admin | Merchant (for display only) |
| Billing history | Shopify Orders + Stripe Dashboard | Merchant |
| Subscription contract | Shopify + subscription app | Merchant + subscription app |
| Customer email / address | Shopify | Merchant |

### 6.4 Payment Method Update Flow

When a customer's card expires or is replaced, they can update it through the customer portal:

```
Customer Portal > Subscription > Update Payment Method
       |
       v
Subscription app generates a Stripe-hosted secure form
       |
       v
Customer enters new card details (via Stripe Elements)
       |
       v
New card is tokenized and vaulted by Stripe
       |
       v
Subscription contract updated with new payment token
       |
       v
Confirmation email sent to customer
```

**This flow never exposes card data to the merchant or the subscription app.**

---

## 7. MODULE 3: OPT-OUT MODEL & CANCELLATION WINDOW

### 7.1 Core Business Rules

This is the most critical module for Base Note's business model. The rules are:

| Rule | Detail |
|------|--------|
| **Purchase = Subscription** | Every 5ml atomizer purchase automatically enrolls the customer in the monthly subscription |
| **Opt-out, not opt-in** | The customer must actively cancel. Doing nothing = continued billing |
| **Same-day cancellation window** | Customer can cancel any time BEFORE the next billing date |
| **Example timeline** | Purchased Feb 21 → Can cancel by March 21 → Charged March 22 if still active |
| **No refunds after charge** | Once the renewal charge is processed, it is non-refundable |
| **Order still fulfilled** | Even if the customer wanted to cancel but missed the window, the charged order IS fulfilled and shipped |
| **Immediate cancellation effect** | Cancellation takes effect at the END of the current billing period (customer keeps access until next billing date) |

### 7.2 Cancellation Window Timeline

```
FEB 21                                                MAR 21    MAR 22
  |                                                     |         |
  |  ◀──────── CANCELLATION WINDOW (29 days) ─────────▶|         |
  |                                                     |         |
  PURCHASE                                           DEADLINE   RENEWAL
  $20 charged                                        Cancel     $20 charged
  Card vaulted                                       by end     (non-refundable)
  Sub ACTIVE                                         of day     Order fulfilled

  ✓ Cancel here = no next charge                      ✗ Missed = charged
  ✓ Full month of access                              ✗ No refund
                                                      ✓ Order shipped
```

### 7.3 Cancellation Window Rules (Edge Cases)

| Scenario | Rule |
|----------|------|
| Customer cancels on Feb 21 (same day as purchase) | Cancel confirmed. No future charges. Current order still shipped. |
| Customer cancels on March 20 (1 day before renewal) | Cancel confirmed. No March charge. Sub ends March 21. |
| Customer cancels on March 21 (renewal day, before charge) | Cancel confirmed IF charge hasn't processed yet. Race condition — system should check charge status. |
| Customer cancels on March 22 (after charge) | Too late. March charge is non-refundable. Order is fulfilled. Customer can cancel for April. |
| Customer contacts support after missed window | Politely decline refund. Explain policy. Offer to ensure subscription is cancelled for next month. |

### 7.4 Cancellation Window Display in Customer Portal

```
+------------------------------------------------------------------+
|  YOUR SUBSCRIPTION                                                |
|                                                                   |
|  Status: ACTIVE                                                   |
|  Monthly charge: $20.00                                           |
|  Member since: February 21, 2026                                  |
|                                                                   |
|  ┌──────────────────────────────────────────────────────────────┐|
|  │  NEXT BILLING DATE                                           │|
|  │                                                              │|
|  │  March 21, 2026                                              │|
|  │                                                              │|
|  │  ⏰ You have 28 days remaining to make changes               │|
|  │     to your subscription before the next charge.             │|
|  │                                                              │|
|  │  To avoid being charged, cancel before March 21, 2026.       │|
|  │                                                              │|
|  │  [ SWAP FRAGRANCE ]   [ CANCEL SUBSCRIPTION ]               │|
|  └──────────────────────────────────────────────────────────────┘|
|                                                                   |
+------------------------------------------------------------------+
```

### 7.5 Post-Charge Scenario (Missed Window)

When a customer contacts support after being charged on a missed cancellation window:

**Support Script:**

> "Thank you for reaching out, [Name]. I can see your subscription renewed on [date] at $20.00. Per our subscription terms, charges that have been processed are non-refundable. However, your order will be fulfilled and shipped to you shortly.
>
> I have cancelled your subscription effective immediately, so you will NOT be charged again next month. Your subscription access remains active until [end of current period].
>
> Is there anything else I can help with?"

**Key: Always cancel going forward. Never leave a disappointed customer enrolled.**

---

## 8. MODULE 4: DUNNING & FAILED PAYMENT RECOVERY

### 8.1 Overview

Dunning is the process of handling failed recurring charges. Approximately 5-10% of subscription renewals fail due to expired cards, insufficient funds, or bank declines. Stripe's Smart Retry system can recover up to 56% of these.

### 8.2 Dunning Flow

```
BILLING DAY: Charge attempt #1
       |
       FAIL
       |
       v
Day +1: Smart Retry #1 (Stripe picks optimal time)
  + Email: "Your payment didn't go through"
       |
       FAIL
       |
       v
Day +3: Smart Retry #2
  + Email: "Action needed — update your payment method"
       |
       FAIL
       |
       v
Day +5: Smart Retry #3
  + Email: "Last chance to keep your subscription"
       |
       FAIL
       |
       v
Day +7: FINAL — Subscription cancelled
  + Email: "Your Base Note subscription has been cancelled"
  + Status: CANCELLED (payment_failure)
  + No order created
  + Win-back email queued for Day +14
```

### 8.3 Dunning Emails

**Email 1 — Day +1: Soft Reminder**

| Field | Value |
|-------|-------|
| Subject | Your Base Note payment needs attention |
| Tone | Friendly, helpful |
| CTA | [ UPDATE PAYMENT METHOD ] |
| Body | "We tried to process your $20.00 subscription payment, but it didn't go through. This can happen if your card expired or your bank flagged the transaction. Please update your payment method to continue receiving your monthly fragrance." |

**Email 2 — Day +3: Urgency**

| Field | Value |
|-------|-------|
| Subject | Action needed: Update your payment to keep your subscription |
| Tone | Slightly urgent |
| CTA | [ UPDATE PAYMENT METHOD ] |
| Body | "We've tried to charge your payment method twice now. To avoid losing access to your Base Note subscription, please update your card details. It only takes 30 seconds." |

**Email 3 — Day +5: Final Warning**

| Field | Value |
|-------|-------|
| Subject | Last chance: Your Base Note subscription will be cancelled |
| Tone | Urgent, clear consequence |
| CTA | [ SAVE MY SUBSCRIPTION ] |
| Body | "This is your final reminder. If we can't process your $20.00 payment within 2 days, your subscription will be automatically cancelled. Don't miss out on next month's fragrance." |

**Email 4 — Day +7: Cancellation Notice**

| Field | Value |
|-------|-------|
| Subject | Your Base Note subscription has been cancelled |
| Tone | Empathetic, open door |
| CTA | [ REACTIVATE SUBSCRIPTION ] |
| Body | "We're sorry to see you go. Your subscription has been cancelled due to payment issues. If you'd like to rejoin, you can reactivate at any time." |

### 8.4 Stripe Smart Retry Configuration

Stripe's Smart Retry uses machine learning to determine the optimal time to retry failed charges. It considers:
- Time of day when the bank is most likely to approve
- Day of week patterns
- Historical success patterns for similar cards

**Configuration in Shopify Payments:**
```
Shopify Admin > Settings > Payments > Shopify Payments > Manage
```

Smart Retry is enabled by default when using Shopify Payments. No additional configuration needed.

---

## 9. MODULE 5: STRIPE DASHBOARD MONITORING & REPORTING

### 9.1 Accessing Stripe Data

Even though you use Shopify Payments, the underlying Stripe dashboard is available:

1. Go to `Shopify Admin > Settings > Payments > Shopify Payments > View payouts`
2. For deeper Stripe analytics, Shopify provides a payments report:
   ```
   Shopify Admin > Analytics > Reports > Payments
   ```

### 9.2 Key Metrics to Monitor

| Metric | Where to Find | Target |
|--------|--------------|--------|
| Monthly Recurring Revenue (MRR) | Subscription app dashboard | Growing month-over-month |
| Churn rate | Subscription app dashboard | Below 5% monthly |
| Failed payment rate | Shopify Payments report | Below 10% |
| Recovery rate (dunning) | Subscription app dashboard | Above 50% |
| Average Revenue Per User (ARPU) | Custom calculation | $20+ |
| Lifetime Value (LTV) | Custom calculation | $120+ (6 months) |
| Payment dispute rate | Shopify Payments report | Below 0.5% |
| Payout timing | Shopify Payments > Payouts | Daily / as scheduled |

### 9.3 Dispute (Chargeback) Handling

If a customer files a chargeback:

1. **Shopify notifies you** via email and in the Orders admin
2. **$15 dispute fee** is charged by Stripe (refunded if you win)
3. **You have 7-21 days** to respond with evidence
4. **Submit evidence:**
   - Subscription consent proof (checkbox timestamp)
   - Subscription terms the customer agreed to
   - Delivery confirmation / tracking
   - Communication history
5. **Prevention:** The subscription disclosure checkbox and terms acceptance at checkout serve as strong evidence against "I didn't authorize this" disputes

---

## 10. PCI COMPLIANCE & DATA SECURITY

### 10.1 PCI Compliance Architecture

```
+-----------------+        +------------------+        +------------------+
|                 |        |                  |        |                  |
|  CUSTOMER       |  -->   |  SHOPIFY         |  -->   |  STRIPE          |
|  (Browser)      |        |  CHECKOUT        |        |  (PCI Level 1)   |
|                 |        |  (PCI Level 1)   |        |                  |
|  Types card #   |        |  Hosts checkout  |        |  Tokenizes card  |
|  into Stripe    |        |  page. NEVER     |        |  Stores card in  |
|  Elements       |        |  sees raw card   |        |  encrypted vault  |
|  iframe         |        |  data            |        |  (AES-256)       |
|                 |        |                  |        |                  |
+-----------------+        +------------------+        +------------------+

BASE NOTE (MERCHANT):
- NEVER sees full card numbers
- Only sees: Last 4 digits, card brand, expiry month/year
- Stores: Payment method TOKEN only (via Shopify)
- PCI responsibility: SAQ-A (simplest level)
```

### 10.2 What Base Note NEVER Has Access To

- Full credit card number
- CVV / CVC code (never stored anywhere, per PCI rules)
- Card magnetic stripe data
- Card PIN

### 10.3 Merchant Obligations

| Obligation | Status |
|-----------|--------|
| SAQ-A self-assessment | Required annually (Shopify simplifies this) |
| SSL/TLS on checkout | Handled by Shopify (all stores use HTTPS) |
| Never store raw card data | Enforced by architecture — impossible to access |
| Password policy for admin accounts | Use strong passwords + 2FA on Shopify Admin |
| Employee access controls | Limit Shopify Admin access to necessary staff only |

---

## 11. LEGAL & FTC COMPLIANCE FOR AUTO-RENEWAL

### 11.1 Applicable Laws

| Law | Jurisdiction | Status | Key Requirement |
|-----|-------------|--------|-----------------|
| ROSCA (Restore Online Shoppers' Confidence Act) | Federal (US) | Active & Enforced | Clear disclosure, informed consent, simple cancellation |
| FTC Act Section 5 | Federal (US) | Active & Enforced | No unfair or deceptive practices |
| FTC Click-to-Cancel Rule | Federal (US) | Vacated (Jul 2025), ANPRM filed Jan 2026 | Follow anyway as best practice |
| California Auto-Renewal Law (ARL) | California | Active (updated Jul 2025) | Annual reminders, easy online cancellation, notice before trial-to-paid |
| State auto-renewal laws | MA, NY, CO, and 20+ others | Active | Vary by state — most require easy cancellation |

### 11.2 Required Disclosures

The following disclosures MUST be present before collecting payment information:

**Disclosure 1: Recurring Charge Notice** (at checkout)
> "By completing this purchase, you are enrolling in a monthly subscription. Your payment method will be charged $20.00 on the same day each month until you cancel."

**Disclosure 2: Cancellation Instructions** (at checkout + confirmation email + customer portal)
> "You may cancel your subscription at any time before your next billing date by logging into your account at [store URL]/account or by contacting support@basenote.com."

**Disclosure 3: No-Refund Policy** (at checkout + subscription terms page)
> "Charges that have been processed are non-refundable. To avoid the next charge, cancel before your billing date."

**Disclosure 4: Annual Reminder** (California requirement — send email every 12 months)
> "This is a reminder that you have an active Base Note subscription at $20.00/month. Your next charge is on [date]. To cancel, visit [cancel URL]."

### 11.3 Subscription Terms Page

**Create a new page:** `Shopify Admin > Online Store > Pages > Add Page`

| Setting | Value |
|---------|-------|
| Title | Subscription Terms |
| URL handle | `subscription-terms` |
| Template | Default page template |

**Required content for the Subscription Terms page:**

1. What the subscription includes (5ml fragrance atomizer monthly)
2. Price and billing frequency ($20.00/month)
3. How billing works (charged on the same day each month)
4. How to cancel (customer portal URL, email, or phone)
5. Cancellation timing (cancel before billing date to avoid next charge)
6. Refund policy (non-refundable after charge is processed)
7. Order fulfillment (all charged orders are fulfilled and shipped)
8. Payment method storage (card tokenized by Stripe, PCI compliant)
9. How to update payment method (customer portal)
10. Contact information for questions

### 11.4 Compliance Checklist

- [ ] Subscription disclosure visible at checkout BEFORE payment
- [ ] Affirmative consent checkbox (not pre-checked) for recurring billing
- [ ] Subscription terms page created at `/pages/subscription-terms`
- [ ] Confirmation email includes subscription details and cancellation link
- [ ] Customer portal allows self-service cancellation (no phone call required)
- [ ] Annual reminder email configured (for California residents — best practice: send to all)
- [ ] Renewal reminder email sent 7 days before each billing date
- [ ] Support team trained on no-refund policy + always-cancel-forward protocol
- [ ] Record of customer consent stored (timestamp + checkbox state)

---

## 12. FEE STRUCTURE & REVENUE IMPACT

### 12.1 Shopify Payments Fee Breakdown

**Assuming Shopify Basic Plan (2.9% + $0.30 per transaction):**

| Transaction Type | Gross | Stripe/Shopify Fee | Net Revenue |
|-----------------|-------|--------------------|-------------|
| $20 subscription renewal | $20.00 | $0.88 (4.4%) | $19.12 |
| $408 full bottle one-time | $408.00 | $12.13 (2.97%) | $395.87 |
| $48 quarterly subscription | $48.00 | $1.69 (3.52%) | $46.31 |
| $168 annual subscription | $168.00 | $5.17 (3.08%) | $162.83 |

### 12.2 Revenue Projections (Subscription Only)

| Subscribers | Monthly Gross | Monthly Fees | Monthly Net | Annual Net |
|------------|--------------|-------------|-------------|------------|
| 50 | $1,000 | $44 | $956 | $11,472 |
| 100 | $2,000 | $88 | $1,912 | $22,944 |
| 250 | $5,000 | $220 | $4,780 | $57,360 |
| 500 | $10,000 | $440 | $9,560 | $114,720 |
| 1,000 | $20,000 | $880 | $19,120 | $229,440 |

### 12.3 Total Fee Stack

| Fee Type | Amount | Who Charges | Notes |
|----------|--------|-------------|-------|
| Credit card processing | 2.9% + $0.30 | Shopify Payments (Stripe) | Per transaction |
| Shopify 3rd-party surcharge | $0 | Shopify | Free with Shopify Payments |
| Subscription app | $0 | Appstle (free plan) | 0% transaction fee |
| Stripe Billing surcharge | $0 | N/A | Not using Stripe Billing directly |
| Chargeback/dispute fee | $15 per dispute | Stripe | Refunded if you win |
| Shopify plan | $39/month | Shopify | Basic plan |

**Effective total cost per $20 subscription charge: $0.88 (4.4%)**

### 12.4 Upgrading to Reduce Fees

| Shopify Plan | Monthly Cost | Card Rate | Fee per $20 charge | Break-even subscribers |
|-------------|-------------|-----------|--------------------|-----------------------|
| Basic | $39/mo | 2.9% + $0.30 | $0.88 | — |
| Shopify | $105/mo | 2.7% + $0.30 | $0.84 | 1,650+ |
| Advanced | $399/mo | 2.5% + $0.30 | $0.80 | Not practical until 500+ |

**Recommendation: Stay on Basic until you hit ~200 subscribers, then evaluate Shopify plan.**

---

## 13. IMPLEMENTATION PHASES

### Phase 1: Payment Gateway (Week 1)

- [ ] Activate Shopify Payments in Shopify Admin
- [ ] Complete business verification (EIN, bank account, owner details)
- [ ] Enable all payment methods (credit/debit, Shop Pay, Apple Pay, Google Pay)
- [ ] Configure payout schedule (daily recommended)
- [ ] Run test transactions using Stripe test cards
- [ ] Verify orders appear correctly in Shopify Admin
- [ ] Verify payout arrives in bank account (test mode, then first live transaction)

### Phase 2: Subscription App Setup (Week 1-2)

- [ ] Install Appstle Subscriptions from Shopify App Store
- [ ] Create "Base Note Monthly" selling plan ($20/month, anniversary billing)
- [ ] Attach selling plan to all 5ml subscription product variants
- [ ] Verify selling plan does NOT apply to full-bottle variants
- [ ] Test subscription checkout flow end-to-end
- [ ] Verify subscription contract is created after purchase
- [ ] Verify auto-renewal charges process correctly (use test mode)

### Phase 3: Customer Portal & Cancellation (Week 2-3)

- [ ] Configure customer portal in subscription app
- [ ] Enable: cancel, swap fragrance, update payment method, view history
- [ ] Disable: skip, pause, change billing date
- [ ] Implement cancellation retention flow (reason survey + retention offers)
- [ ] Test cancellation flow — verify subscription stops and no future charges
- [ ] Test payment method update flow — verify new card is vaulted

### Phase 4: Legal, Emails & Compliance (Week 2-3)

- [ ] Create `/pages/subscription-terms` with all required disclosures
- [ ] Add subscription disclosure box to checkout (via Shopify Checkout customization or app)
- [ ] Ensure affirmative consent checkbox is present and NOT pre-checked
- [ ] Configure dunning emails (4 emails over 7 days)
- [ ] Configure renewal reminder email (7 days before billing date)
- [ ] Configure annual reminder email (California compliance)
- [ ] Configure subscription welcome email (sent after first purchase)
- [ ] Test all email flows

### Phase 5: Go-Live & Monitoring (Week 3-4)

- [ ] Disable test mode on Shopify Payments
- [ ] Place a real test order with a real credit card
- [ ] Verify the charge appears in Shopify Payments and bank account
- [ ] Monitor first wave of subscription renewals
- [ ] Set up alerts for failed payments and disputes
- [ ] Train support team on subscription policies (no refund after charge, always cancel forward)
- [ ] Monitor churn rate, failed payment rate, and MRR weekly

---

## 14. APPENDIX: WIREFRAMES & FLOW DIAGRAMS

### 14.1 Complete Payment + Subscription Lifecycle

```
CUSTOMER JOURNEY
═══════════════

  Browse         Add to       Checkout      Payment       Order         Month 2
  Collection     Cart                       Processing    Confirmed     Renewal
  ─────────── → ────────── → ──────────── → ────────── → ──────────── → ──────────
                                                |                        |
                                                v                        v
                                          Card tokenized           Auto-charge
                                          by Stripe                via token
                                                |                        |
                                                v                        v
                                          Token vaulted            New order
                                          for recurring            created
                                                |                        |
                                                v                        v
                                          Subscription             Fulfilled
                                          contract created         & shipped
                                                                        |
                                                                        v
                                                                   Continue
                                                                   monthly...
```

### 14.2 Opt-Out Decision Tree

```
                        Is it before the billing date?
                                    |
                           +--------+--------+
                           |                 |
                          YES                NO
                           |                 |
                    Cancel confirmed    Has the charge
                    No future charges   been processed?
                    Current period          |
                    access continues   +----+----+
                                       |         |
                                      YES        NO
                                       |         |
                                  No refund   Cancel now
                                  Order is    Charge may
                                  fulfilled   still process
                                  Cancel for  (race condition)
                                  next month
```

### 14.3 Dunning Recovery Flow

```
Day 0: Charge FAILS
  │
  ├─ Day 1: Smart Retry #1 ─── SUCCESS? ─── YES → Order created, done
  │                                    │
  │                                    NO
  │                                    │
  ├─ Day 3: Smart Retry #2 ─── SUCCESS? ─── YES → Order created, done
  │                                    │
  │                                    NO
  │                                    │
  ├─ Day 5: Smart Retry #3 ─── SUCCESS? ─── YES → Order created, done
  │                                    │
  │                                    NO
  │                                    │
  └─ Day 7: CANCEL subscription
             Send cancellation email
             Queue win-back email (Day 14)
```

---

### ADDENDUM: Tax & Shipping Clarification (Feb 2026)

#### Sales Tax Sourcing
- **Destination-based sourcing** is used for all US orders (45/50 states)
- Tax rate is determined by the **shipping address**, NOT the billing address
- This is Shopify's default behavior and is legally correct
- The billing address is NOT used for tax calculation for physical goods
- Exception: If no shipping address is available (digital-only orders), billing address is used as fallback
- Shopify Payments handles tax calculation automatically at checkout

#### Free Shipping Rate
- A $0.00 "Free Shipping" rate must exist in Shopify Admin > Shipping settings
- This should apply to all domestic subscription orders
- The theme UI displays "FREE" shipping but the actual rate must be configured in Shopify Admin for it to apply at checkout

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 21, 2026 | Product Manager | Initial document |

---

*This document covers the complete payment and subscription billing integration for Base Note. It should be read alongside the Base Note Checkout & Subscriptions PRD (BASENOTES_CHECKOUT_SUBSCRIPTIONS_PRD.md) for the full customer journey specification.*
