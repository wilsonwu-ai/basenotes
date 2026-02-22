# PRODUCT REQUIREMENTS DOCUMENT (PRD)
## Base Note — Checkout, Client Portal, Subscription Reminders & Churn Reduction
---

**Document Version:** 1.0
**Date:** February 21, 2026
**Author:** Product Manager & Product Designer (UX/UI)
**Status:** Draft for Engineering & Stakeholder Review
**Platform:** Shopify 2.0 + Recharge Subscriptions
**Brand:** Base Note (basenote.com)
**Founder:** Wilson Wu

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Business Context & Model](#2-business-context--model)
3. [Module 1: Checkout Flow](#3-module-1-checkout-flow)
4. [Module 2: Client Portal & Fragrance History](#4-module-2-client-portal--fragrance-history)
5. [Module 3: Subscription Reminder Emails](#5-module-3-subscription-reminder-emails)
6. [Module 4: Cancellation & Churn Reduction](#6-module-4-cancellation--churn-reduction)
7. [Module 5: HQ Staff Portal (Shopify Admin)](#7-module-5-hq-staff-portal-shopify-admin)
8. [Auto-Pilot Rotation System](#8-auto-pilot-rotation-system)
9. [Design System & UI Patterns](#9-design-system--ui-patterns)
10. [Legal & FTC Compliance](#10-legal--ftc-compliance)
11. [Email Template Specifications](#11-email-template-specifications)
12. [Success Metrics & KPIs](#12-success-metrics--kpis)
13. [Implementation Priority & Phasing](#13-implementation-priority--phasing)
14. [Appendix: Wireframes](#14-appendix-wireframes)

---

## 1. EXECUTIVE SUMMARY

This PRD covers four interconnected modules that form the post-browse customer experience for Base Note:

1. **Checkout Flow** — Every purchase automatically enrolls the user in a recurring monthly subscription (opt-out model). The checkout must clearly disclose this per FTC regulations while making the value proposition compelling.

2. **Client Portal** — A subscriber dashboard where users view their fragrance history (which fragrance they received each month), manage their subscription, and select upcoming fragrances. HQ staff populate fragrance assignment data from the Shopify admin.

3. **Subscription Reminders** — A 4-email engagement sequence triggered 7 days before each monthly shipment. Users can confirm their pre-selected fragrance, browse the library to swap, or skip. If they take no action, the auto-pilot rotation system selects for them.

4. **Cancellation & Churn Reduction** — A thoughtful multi-step cancellation flow that surveys the user on why they're leaving, presents a contextual retention offer based on their reason, and captures data for product improvement. Includes a post-cancellation win-back email sequence.

### Key Architectural Decisions
| Decision | Rationale |
|----------|-----------|
| Purchase = auto-subscription | Core business model — every buyer becomes a subscriber |
| Opt-out (not opt-in) renewal | Industry standard for subscription boxes; FTC-compliant with proper disclosure |
| Pre-checked newsletter | Maximizes email list; compliant under CAN-SPAM (US market only) |
| Mandatory terms agreement | Legal requirement — NOT pre-checked |
| 4-step cancellation with retention | Reduces churn without being manipulative; captures actionable data |
| Auto-pilot rotation | Reduces friction for passive subscribers; increases retention |
| HQ staff enters fragrance data | Centralized control via Shopify admin; ensures data accuracy |

---

## 2. BUSINESS CONTEXT & MODEL

### 2.1 The Base Note Difference
Base Note is NOT another Scentbird clone. Key differentiators:
- **10 exclusive fragrances** crafted in-house (vs. 800+ licensed designer scents)
- **Premium positioning** — retail equivalents are $245-$300 per bottle
- **Curated, not overwhelming** — the power of a focused collection
- **5ml atomizers** (~30 sprays, 1 month supply)

### 2.2 Subscription Plans

| Plan | Price | Per Month | Savings | Perks |
|------|-------|-----------|---------|-------|
| Monthly | $20/mo | $20 | — | Free shipping, swap anytime |
| Quarterly | $48/3mo | $16 | 20% | + Free travel case |
| Annual | $168/yr | $14 | 2 months free | + Travel case + exclusive gifts |

### 2.3 Revenue Model
- Primary: Monthly recurring subscription revenue
- Secondary: Full-size bottle purchases by subscribers
- Retention levers: Engagement emails, personalization, loyalty perks

### 2.4 The Fragrance Library

| # | Name | Family | Retail |
|---|------|--------|--------|
| 1 | Midnight Oud | Woody/Oud | $295 |
| 2 | Velvet Noir | Leather/Oriental | $275 |
| 3 | Garden of Hesperides | Fresh/Citrus | $245 |
| 4 | Rose Immortelle | Floral/Rose | $285 |
| 5 | Tobacco & Honey | Sweet/Tobacco | $265 |
| 6 | White Suede | Musk/Clean | $255 |
| 7 | Bois Sauvage | Woody/Aromatic | $280 |
| 8 | Ambre Celeste | Amber/Oriental | $290 |
| 9 | Jasmine Dreams | Floral/Jasmine | $270 |
| 10 | Nomad's Path | Spicy/Exotic | $300 |

---

## 3. MODULE 1: CHECKOUT FLOW

### 3.1 Critical Business Rule
**Every purchase = automatic subscription enrollment.** The moment a user completes checkout, they are an active subscriber billed on a recurring basis. This MUST be clearly disclosed.

### 3.2 Step 1: Cart Review Page

**Route:** `/cart`
**Trigger:** User selects a fragrance + plan from product page or subscription plans section

#### Layout

```
+================================================================+
|                     YOUR SUBSCRIPTION                           |
|                Review your selection before checkout             |
+================================================================+
|                                                                  |
|  +----------------------------------------------------------+  |
|  | [product img]  Midnight Oud — 5ml Atomizer (~30 sprays)  |  |
|  |                $295.00 retail value                        |  |
|  |                [SUBSCRIPTION badge]                        |  |
|  +----------------------------------------------------------+  |
|                                                                  |
|  SELECT YOUR PLAN                                               |
|  +----------------+  +------------------+  +-----------------+  |
|  |   MONTHLY      |  |   QUARTERLY      |  |    ANNUAL       |  |
|  |   $20/mo       |  |   $16/mo         |  |    $14/mo       |  |
|  |                |  |   [SAVE 20%]     |  |    [BEST VALUE] |  |
|  |                |  |   $48 / 3 months |  |    $168 / year  |  |
|  +----------------+  +------------------+  +-----------------+  |
|                                                                  |
|  WHAT'S INCLUDED                                                |
|  [truck] Free shipping, always                                  |
|  [refresh] Swap, skip, or cancel anytime                        |
|  [gift] Free travel case (quarterly & annual)                   |
|  [shield] 30-day satisfaction guarantee                         |
|                                                                  |
|  +----------------------------------------------------------+  |
|  | Promo code      [____________] [APPLY]                    |  |
|  |                                                            |  |
|  | Midnight Oud (5ml)                         Included       |  |
|  | Monthly Plan                                $20.00        |  |
|  | Shipping                                    FREE          |  |
|  | ------------------------------------------------          |  |
|  | TOTAL TODAY                                  $20.00       |  |
|  |                                                            |  |
|  | Then $20.00/month starting Mar 1, 2026.                   |  |
|  | Cancel anytime.                                           |  |
|  +----------------------------------------------------------+  |
|                                                                  |
|  +----------------------------------------------------------+  |
|  |              PROCEED TO CHECKOUT                          |  |
|  +----------------------------------------------------------+  |
+================================================================+
```

### 3.3 Step 2: Checkout Form

**Route:** `/checkout` (Shopify native checkout with customizations)
**Layout:** Two-column — Form (left 60%) | Order Summary (right 40%, sticky)

#### Left Column: Form Sections

**Section 1 — Contact Information**
- Email field (required)
- Newsletter opt-in checkbox: "Email me with news, exclusive offers, and fragrance recommendations"
  - **DEFAULT: CHECKED** (opt-out pattern)
  - Compliance: Permitted under CAN-SPAM for US market
- Account login prompt for returning users

**Section 2 — Shipping Address**
- Standard Shopify address fields
- Country limited to: United States, Canada
- "Save this information for next time" checkbox (default: checked)
- Address autocomplete via Google Places API

**Section 3 — Payment**
- Credit card (Visa, Mastercard, Amex, Discover via Shopify Payments)
- Shop Pay (accelerated checkout)
- PayPal
- Apple Pay (Safari/iOS)
- Google Pay (Chrome/Android)

**Section 4 — Subscription Disclosure (CRITICAL)**

This section MUST appear directly above the submit button and be clearly visible:

```
+----------------------------------------------------------+
| ⚠ SUBSCRIPTION TERMS                                     |
|                                                            |
| By completing this purchase, you are subscribing to a     |
| MONTHLY PLAN at $20.00/month. Your subscription will      |
| automatically renew and your payment method will be        |
| charged on March 1, 2026.                                 |
|                                                            |
| You may cancel, skip a month, or swap your fragrance at   |
| any time from your account dashboard.                     |
|                                                            |
| [ ] I understand this is a recurring subscription and     |
|     agree to the Terms of Service and Privacy Policy.     |
|                                                            |
| (amber/yellow background, clearly distinct from rest)     |
+----------------------------------------------------------+
```

- **Checkbox DEFAULT: UNCHECKED** — User must actively agree
- **Required:** Cannot proceed without checking
- Links to Terms of Service and Privacy Policy
- **FTC Compliance:** Clear and conspicuous disclosure of: (1) charges are recurring, (2) the amount, (3) the frequency, (4) how to cancel

**Submit Button:**
- Label: `SUBSCRIBE & PAY $20.00`
- Style: Full-width, black background, white text, large (18px), uppercase
- Disabled state until all fields valid + terms checked
- Loading state: spinner + "Processing..."

#### Right Column: Sticky Order Summary
- Product thumbnail + name + variant
- Plan badge (e.g., "Monthly Plan — $20/mo")
- Subtotal, Shipping (FREE), Taxes, Total
- Renewal reminder: "Renews Mar 1, 2026 at $20.00/month"
- Satisfaction guarantee badge

### 3.4 Step 3: Order Confirmation

**Route:** `/checkout/thank-you`

**Content:**
- "Welcome to Base Note!" heading
- "Your fragrance journey begins now." subheading
- Order number + confirmation email notice
- **What Happens Next** (4-step visual):
  1. Your first 5ml atomizer ships within 1-2 business days
  2. You'll receive tracking via email
  3. 7 days before your next shipment, we'll email you to confirm or swap
  4. Manage everything from your account dashboard
- CTA: "SET UP YOUR ACCOUNT" (primary) | "BROWSE MORE FRAGRANCES" (secondary)
- Subscription summary card (plan, next billing, next fragrance)

**Transactional Email:**
- Subject: "Welcome to Base Note — Your first fragrance is on its way!"
- Includes: Order summary, fragrance details with notes pyramid, plan details, management links

---

## 4. MODULE 2: CLIENT PORTAL & FRAGRANCE HISTORY

### 4.1 Customer Dashboard

**Route:** `/account`

#### Sidebar Navigation
| Label | Icon | Route |
|-------|------|-------|
| Dashboard | home | /account |
| My Subscription | refresh | /account/subscription |
| Fragrance History | clock | /account/history |
| Next Shipment | package | /account/next-shipment |
| Browse Library | grid | /collections/all |
| Orders | receipt | /account/orders |
| Addresses | map-pin | /account/addresses |
| Account Settings | settings | /account/settings |
| Help & Support | help-circle | /pages/faq |

#### Dashboard Home

**Welcome Banner:**
- "Welcome back, {first_name}!"
- "Member since {date} — {X} months of fragrance discovery"

**Quick Stats Row:**
| Stat | Example |
|------|---------|
| Fragrances Discovered | 6 |
| Current Plan | Monthly |
| Next Shipment | Mar 1, 2026 |
| Status | Active (green badge) |

**Upcoming Shipment Card:**
- Fragrance image + name + family
- Ships on {date}
- Status badge: CONFIRMED / AUTO-SELECTED / ACTION NEEDED
- Actions: "Swap Fragrance" | "Skip This Month"

**Recent Activity Feed:**
- Timeline of shipments, selections, and billing events

### 4.2 Fragrance History (KEY FEATURE)

**Route:** `/account/history`

This is the feature where users see every fragrance they've received, month by month. HQ staff enters this data from the Shopify admin.

#### Layout: Vertical Timeline (newest first)

```
+================================================================+
|                   YOUR FRAGRANCE JOURNEY                        |
|           Every scent you've discovered with Base Note          |
+================================================================+
|                                                                  |
|  FEBRUARY 2026                                                  |
|  +----------------------------------------------------------+  |
|  | [product img]                                              |  |
|  |                                                            |  |
|  | MIDNIGHT OUD                                               |  |
|  | Woody / Oud                                                |  |
|  |                                                            |  |
|  | Top: Saffron, Bulgarian Rose, Pink Pepper                  |  |
|  | Heart: Cambodian Oud, Incense, Orris                       |  |
|  | Base: Amber, Sandalwood, Musk                              |  |
|  |                                                            |  |
|  | Your Rating: ★★★★☆  [click to rate]                       |  |
|  |                                                            |  |
|  | Your Notes:                                                |  |
|  | [Rich, complex, perfect for winter evenings...]            |  |
|  | [Edit notes]                                               |  |
|  |                                                            |  |
|  | [Get this again]  [Buy full size ($295)]  [View order]    |  |
|  +----------------------------------------------------------+  |
|                                                                  |
|  JANUARY 2026                                                   |
|  +----------------------------------------------------------+  |
|  | [product img]                                              |  |
|  |                                                            |  |
|  | VELVET NOIR                                                |  |
|  | Leather / Oriental                                         |  |
|  | ...                                                        |  |
|  +----------------------------------------------------------+  |
```

**Each Timeline Card Contains:**
- Month/year label
- Fragrance product image
- Fragrance name and scent family
- Full notes pyramid (Top / Heart / Base)
- User rating (5-star clickable, saves to customer metafield)
- User personal notes (expandable textarea)
- "Get this again" button (adds to next month queue)
- "Buy full size" button (links to product page — conditional on availability)
- "View order" link (order details page)

**Empty State:**
- "Your journey starts soon!" heading
- "Once your first fragrance arrives, you'll see your complete scent journey here."
- CTA: "BROWSE COLLECTION"

**Data Source:** Customer metafield `subscription.fragrance_history` — populated by HQ staff via Shopify admin (see Module 5).

### 4.3 Next Shipment Management

**Route:** `/account/next-shipment`

**Status States:**

| State | Badge | Description | Actions |
|-------|-------|-------------|---------|
| User Selected | CONFIRMED (green) | You've chosen {fragrance} | Swap, Skip |
| Auto-Pilot Assigned | AUTO-SELECTED (gold) | We've selected {fragrance} for you | Confirm, Swap, Skip |
| Awaiting Selection | ACTION NEEDED (amber) | Choose before {deadline}! | Browse & Select, Auto-pilot |
| Skipped | SKIPPED (grey) | No charge, no shipment | Undo skip |

**Fragrance Selector (Modal/Page):**
- Grid of all 10 fragrances
- Each card: image, name, family, top notes preview
- Badges: "You've tried this" (if previously received), "Your rating: X stars"
- Filters: All | Not yet tried | Highest rated by you | By scent family
- Recommendation section: "Recommended for you" (top 3 based on quiz + ratings)
- CTA per card: "SELECT THIS FRAGRANCE"

### 4.4 Subscription Management

**Route:** `/account/subscription`

**Sections:**
1. **Your Plan** — Plan name, price, next billing date, payment method + change options
2. **Shipping Address** — Current address + edit
3. **Subscription Actions:**
   - Skip next month (outlined button)
   - Pause subscription (outlined button)
   - Cancel subscription (small text link, bottom, red — intentionally de-emphasized)

**Important UX Note:** The cancel link is intentionally small and positioned at the bottom. This is NOT a dark pattern — it's visible and functional — but the visual hierarchy prioritizes positive actions (skip, pause) over permanent cancellation. This is industry-standard subscription UX.

---

## 5. MODULE 3: SUBSCRIPTION REMINDER EMAILS

### 5.1 Overview
A 4-email engagement sequence designed to keep subscribers active and connected to the platform. The primary goal is to get users to log into their account and interact with the fragrance library.

### 5.2 Email Sequence Timeline

```
Day -7  ─────  Email 1: Pre-shipment reminder (confirm/swap/skip)
   |
Day -3  ─────  Email 2: Urgency reminder (if no action taken)
   |
Day 0   ─────  Email 3: Shipment confirmation + tracking
   |
Day +5  ─────  Email 4: Post-delivery feedback request
(after
delivery)
```

### 5.3 Key Dates

| Event | Day of Month |
|-------|-------------|
| Selection deadline | 24th |
| Auto-pilot assignment (if no selection) | 25th |
| Shipment lock (no more changes) | 28th |
| Shipment | 1st |
| Reminder Email 1 | 24th of prior month (7 days before shipment) |
| Reminder Email 2 | 27th of prior month (3 days before, if no action) |

### 5.4 Email 1: Pre-Shipment Reminder (7 Days Before)

**Trigger:** 7 days before scheduled shipment
**Audience:** All active subscribers (not paused, not canceled)

**Three Scenarios:**

#### Scenario A: User Already Selected
- **Subject:** "You're all set! {fragrance_name} ships in 7 days"
- **Heading:** "You're all set, {first_name}!"
- **Body:** Confirmation of their selection with fragrance card (image, name, notes)
- **CTAs:** View selection | Changed your mind? Swap → | Skip this month

#### Scenario B: Auto-Pilot Assigned (No User Selection)
- **Subject:** "We picked something special for you, {first_name}"
- **Heading:** "We picked something special for you"
- **Body:** Shows the auto-selected fragrance with reasoning ("Based on your love for Midnight Oud, we think you'll enjoy...")
- **CTAs:** CONFIRM THIS SELECTION | BROWSE & SWAP | Skip this month
- **Urgency:** "Deadline to change: {date}"
- **No-action behavior:** "Love our pick? Do nothing — it ships automatically."

#### Scenario C: No Selection Yet (Early Window)
- **Subject:** "Choose your {month} fragrance, {first_name}!"
- **Heading:** "Choose your {month} fragrance!"
- **Body:** Prompts user to browse library. Shows 3 recommended fragrances.
- **CTAs:** CHOOSE MY FRAGRANCE | Surprise me — let Base Note pick | Skip this month

### 5.5 Email 2: Urgency Reminder (3 Days Before)

**Trigger:** 3 days before shipment AND user has NOT confirmed/selected
**Subject:** "Last chance to pick your fragrance!"
- Shows the auto-assigned fragrance
- Countdown: "3 DAYS LEFT"
- CTAs: Confirm | Swap | (no-action = auto-ships)

### 5.6 Email 3: Shipment Confirmation

**Trigger:** Order ships / tracking number generated
**Subject:** "Your {month} fragrance is on its way!"
- Tracking number + link
- Estimated delivery window
- Fragrance details with notes pyramid
- Pro tip on how to wear/apply
- "Already thinking about next month? Browse the library →"

### 5.7 Email 4: Post-Delivery Feedback

**Trigger:** 5 days after estimated delivery
**Subject:** "How are you liking {fragrance_name}?"
- Rating CTA: 5 clickable stars directly in email
- Invitation to write personal notes in their fragrance history
- "Love it? Get it again next month" CTA
- "Want to try something new? Browse →"
- **Purpose:** Drives platform engagement + feeds data to auto-pilot algorithm

### 5.8 Design Principles for All Emails
- **Branded:** Base Note wordmark header, gold accent color (#c9a86c)
- **Clean:** Minimal layout, generous whitespace, single-column
- **Mobile-first:** 90%+ of email opens are mobile
- **Dark mode compatible:** Test all templates in dark mode
- **CAN-SPAM compliant:** Physical address, unsubscribe link in footer
- **Personalized:** First name, fragrance name, account-specific details

---

## 6. MODULE 4: CANCELLATION & CHURN REDUCTION

### 6.1 Philosophy
**Be transparent, not manipulative.** The cancellation flow should feel like a genuine conversation, not an obstacle course. Users should always be able to cancel without excessive friction — but we owe it to ourselves and our subscribers to understand why they're leaving and offer genuine alternatives.

### 6.2 Four-Step Cancellation Flow

#### Step 1: Value Reminder (Soft Gate)

**Type:** Modal overlay
**Trigger:** Click "Cancel subscription" from /account/subscription

```
+----------------------------------------------------------+
|                                                            |
|  We're sorry to see you go, {first_name}                 |
|                                                            |
|  Before you cancel, here's what you'll lose:              |
|                                                            |
|  [gift]    Access to 10 exclusive luxury fragrances       |
|  [truck]   Free shipping on every order                   |
|  [clock]   Your 6-month fragrance history & ratings       |
|  [percent] Subscriber-only pricing on full-size bottles   |
|                                                            |
|  +----------------------------------------------+        |
|  |         KEEP MY SUBSCRIPTION                  |        |
|  +----------------------------------------------+        |
|                                                            |
|          I still want to cancel                           |
|                                                            |
+----------------------------------------------------------+
```

- Primary CTA: "KEEP MY SUBSCRIPTION" (gold button)
- Secondary: "I still want to cancel" (small text link)

#### Step 2: Cancellation Reason Survey

**Heading:** "Help us improve — why are you canceling?"

| Reason | Icon | Retention Strategy |
|--------|------|--------------------|
| Too expensive | $ | 30% off for 3 months |
| Not using fast enough | pause | Offer to pause 1-2 months |
| Haven't liked the fragrances | thumbs-down | Free 1-on-1 scent consultation + free month |
| Tried all the scents I wanted | check | Teaser of upcoming new fragrances |
| Switching to competitor | arrow | 40% off loyalty discount + competitive feedback capture |
| Financial reasons | wallet | Downgrade to annual plan ($14/mo) |
| Shipping/delivery problems | truck | Escalate to support + free month comp |
| Other | message | 25% off for 2 months |

**Optional feedback textarea:** "Anything else you'd like us to know?" (max 500 chars)

#### Step 3: Contextual Retention Offer

Based on the reason selected in Step 2, present ONE targeted retention offer:

**Example — "Too Expensive" Offer:**
```
+----------------------------------------------------------+
|                                                            |
|  How about 30% off your next 3 months?                   |
|                                                            |
|  We'd hate to lose you over price. Stay with Base Note   |
|  and enjoy 30% off for the next 3 months — that's just   |
|  $14/month for luxury fragrances worth up to $300.        |
|                                                            |
|  Was: $20/mo                                              |
|  Now: $14/mo (for 3 months)                              |
|                                                            |
|  +----------------------------------------------+        |
|  |    YES, KEEP MY SUBSCRIPTION AT $14/MO       |        |
|  +----------------------------------------------+        |
|                                                            |
|       No thanks, continue canceling                       |
|                                                            |
+----------------------------------------------------------+
```

**Example — "Haven't Liked Scents" Offer:**
```
+----------------------------------------------------------+
|                                                            |
|  Let us get it right — free personalized consultation     |
|                                                            |
|  Our scent curator will personally select your next 3     |
|  fragrances based on a quick chat about your preferences. |
|  Plus, your next month is on us.                          |
|                                                            |
|  What you get:                                            |
|  [check] 1-on-1 scent consultation                       |
|  [check] Personally curated next 3 months                |
|  [check] Next month FREE                                 |
|                                                            |
|  +----------------------------------------------+        |
|  |       YES, LET'S FIND MY SCENT               |        |
|  +----------------------------------------------+        |
|                                                            |
|       No thanks, continue canceling                       |
|                                                            |
+----------------------------------------------------------+
```

**Example — "Financial Reasons" Offer:**
```
+----------------------------------------------------------+
|                                                            |
|  We understand — let's find a plan that fits              |
|                                                            |
|  Current: Monthly          $20/mo     ($240/yr)           |
|  Quarterly                 $16/mo     ($192/yr)  Save $48 |
|  Annual [BEST VALUE]       $14/mo     ($168/yr)  Save $72 |
|                                                            |
|  +----------------------------------------------+        |
|  |    SWITCH TO ANNUAL ($14/MO)                  |        |
|  +----------------------------------------------+        |
|                                                            |
|       No thanks, continue canceling                       |
|                                                            |
+----------------------------------------------------------+
```

#### Step 4: Final Cancellation Confirmation

```
+----------------------------------------------------------+
|                                                            |
|  Confirm cancellation                                     |
|                                                            |
|  Your subscription will be canceled at the end of your    |
|  current billing period (March 1, 2026).                  |
|                                                            |
|  - You'll still receive your February fragrance           |
|  - Account access until March 1, 2026                     |
|  - Fragrance history and ratings are saved                |
|                                                            |
|  +----------------------------------------------+        |
|  | Wait — keep my subscription                   |        |
|  +----------------------------------------------+        |
|                                                            |
|  +----------------------------------------------+        |
|  |       CONFIRM CANCELLATION                    |  (red) |
|  +----------------------------------------------+        |
|                                                            |
+----------------------------------------------------------+
```

- "Keep my subscription" — outlined button, positioned ABOVE cancel
- "CONFIRM CANCELLATION" — red button, positioned below
- Confirms at end of billing period (not immediate)

### 6.3 Post-Cancellation

**Confirmation Page:**
- "Your subscription has been canceled"
- End date + what they still have access to
- "RESUBSCRIBE ANYTIME" link
- Warm, non-guilt-inducing tone

**Confirmation Email:**
- Subject: "Your Base Note subscription has been canceled"
- Tone: Grateful, not guilt-tripping
- Includes: End date, access details, resubscribe link

### 6.4 Win-Back Email Sequence

| Email | Delay | Subject | Offer |
|-------|-------|---------|-------|
| Win-back 1 | 14 days post-cancel | "We miss you — 25% off to come back" | 25% off 3 months |
| Win-back 2 | 30 days post-cancel | "New fragrance alert: {name}" | Teaser of new arrivals |
| Win-back 3 | 60 days post-cancel | "Your scent journey doesn't have to end" | 50% off first month back |

**Rules:**
- Maximum 3 win-back emails
- Stop immediately if user resubscribes
- Stop if user unsubscribes from marketing
- Each email must have unsubscribe link

### 6.5 Churn Data Collection

Every cancellation captures:
- Reason selected (from survey)
- Optional freeform feedback
- Retention offer shown + whether accepted
- Months subscribed at time of cancellation
- Total fragrances received
- Average fragrance rating given
- Last fragrance received
- Plan type at cancellation

**Analytics Dashboard Metrics:**
- Monthly churn rate (%)
- Cancellation reason distribution
- Retention offer acceptance rate (by offer type)
- Average subscriber lifetime (months)
- Churn by plan type
- Correlation: low fragrance ratings ↔ churn
- Win-back email conversion rate

---

## 7. MODULE 5: HQ STAFF PORTAL (SHOPIFY ADMIN)

### 7.1 Purpose
HQ/merchant staff use the Shopify admin + Recharge dashboard to:
1. View all active subscriber orders for the upcoming month
2. Assign/confirm fragrance selections for each subscriber
3. Record shipment details (tracking, dates)
4. Populate the customer's fragrance history (which feeds the client portal)

### 7.2 Staff Workflow

```
[View upcoming subscription orders in Recharge]
            |
[Verify fragrance assignment for each subscriber]
  - User-selected: Confirm selection
  - Auto-pilot: Review system recommendation
  - Manual override: Assign specific fragrance
            |
[Process orders and generate shipments]
            |
[Update customer metafields with fragrance history data]
            |
[Customer sees updated history in their portal]
```

### 7.3 Metafield Schema

**Per-Order Metafields:**

| Namespace | Key | Type | Example |
|-----------|-----|------|---------|
| subscription | month | single_line_text | February 2026 |
| subscription | fragrance_name | single_line_text | Midnight Oud |
| subscription | fragrance_id | product_reference | gid://product/123 |
| subscription | selection_method | single_line_text | user_selected / auto_pilot / hq_assigned |
| subscription | tracking_number | single_line_text | 1Z999AA1... |
| subscription | shipped_date | date | 2026-02-01 |

**Per-Customer Metafield (Fragrance History):**

| Namespace | Key | Type |
|-----------|-----|------|
| subscription | fragrance_history | json |

**JSON Schema:**
```json
[
  {
    "month": "February 2026",
    "fragrance_id": "gid://product/123",
    "fragrance_name": "Midnight Oud",
    "order_id": "gid://order/456",
    "selection_method": "user_selected",
    "shipped_date": "2026-02-01",
    "user_rating": 4,
    "user_notes": "Rich and complex, perfect for winter"
  }
]
```

### 7.4 Staff Access
- **Authentication:** Shopify admin staff login (separate from customer accounts)
- **Permissions:** Staff accounts with "Orders" and "Customers" permissions
- **Tool:** Recharge admin dashboard for subscription management; Shopify admin for metafield updates
- **Workflow Tool (Optional):** Consider building a custom Shopify admin app or using a tool like Matrixify for bulk metafield updates

---

## 8. AUTO-PILOT ROTATION SYSTEM

### 8.1 Purpose
When a subscriber does NOT select a fragrance by the deadline (24th of the month), the system automatically assigns one. This reduces friction for passive subscribers and ensures every active subscriber receives a shipment.

### 8.2 Selection Algorithm (Priority Order)

| Priority | Rule | Rationale |
|----------|------|-----------|
| 1 | Quiz-matched fragrance not yet tried | Most likely to satisfy based on stated preferences |
| 2 | Highest community-rated fragrance not yet tried | Social proof maximizes satisfaction |
| 3 | Different family than last 2 shipments | Ensures variety and discovery |
| 4 | New releases or seasonal picks | Keeps experience fresh |
| 5 | Random from untried catalog | Fallback for exhausted rules |

### 8.3 Constraints
- **NEVER** send the same fragrance received in the last 3 months
- **NEVER** send a fragrance the user has rated 1-2 stars
- Staff can manually override any auto-pilot selection before shipment lock (28th)

### 8.4 Edge Case: All 10 Tried
When a long-term subscriber has received all 10 fragrances:
- Prioritize their highest-rated fragrances for repeat
- Exclude any rated 1-2 stars
- Consider seasonal appropriateness (light/citrus in summer, warm/oud in winter)

---

## 9. DESIGN SYSTEM & UI PATTERNS

### 9.1 Color Palette (Base Note Brand)

| Token | Hex | Usage |
|-------|-----|-------|
| Primary Dark | #1a1a1a | Buttons, headings, text |
| Gold Accent | #c9a86c | Links, badges, interactive elements |
| Bright Gold | #d4af37 | Highlights, premium indicators |
| Background | #faf9f6 | Page background (warm off-white) |
| Card Background | #ffffff | Cards, modals, form sections |
| Text Secondary | #666666 | Captions, help text |
| Border Light | #e5e5e5 | Dividers, input borders |
| Error Red | #c0392b | Cancel, error states |
| Success Green | #27ae60 | Confirmed badges, success states |
| Warning Amber | #f39c12 | Action needed, urgency |

### 9.2 Typography
- **Headings:** Serif typeface (editorial, luxury feel)
- **Body:** Clean sans-serif (Inter, Helvetica Neue)
- **Fragrance names:** Uppercase, letter-spaced, gold color
- **CTA buttons:** Uppercase, letter-spaced, 600 weight
- **Legal/disclosure text:** 0.85rem, text_secondary color

### 9.3 Button Hierarchy

| Type | Style | Usage |
|------|-------|-------|
| Primary | bg: #1a1a1a, color: white | Main CTAs (Subscribe, Checkout, Confirm) |
| Accent | bg: #c9a86c, color: white | Retention offers, highlighted actions |
| Outlined | border: 1px #1a1a1a, transparent bg | Secondary actions (Swap, Skip) |
| Destructive | bg: #c0392b, color: white | Cancel confirmation only |
| Text Link | color: #c9a86c, no border | Tertiary actions (continue canceling) |

### 9.4 Card Patterns
- **Fragrance History Card:** Large image left, content right, rating stars, expandable notes
- **Upcoming Shipment Card:** Compact, status badge prominent, action buttons below
- **Plan Selection Card:** Horizontal row, border on selected, badge overlay for savings
- **Retention Offer Card:** Centered, generous padding, clear value proposition

### 9.5 Status Badge Styles

| Badge | Background | Text | Usage |
|-------|-----------|------|-------|
| CONFIRMED | #27ae60 | white | User has confirmed selection |
| AUTO-SELECTED | #c9a86c | white | System assigned fragrance |
| ACTION NEEDED | #f39c12 | white | User should select/confirm |
| SKIPPED | #666666 | white | Month skipped |
| SUBSCRIPTION | #1a1a1a | white | Product type indicator |
| SAVE 20% | #c9a86c | white | Plan savings badge |
| BEST VALUE | #d4af37 | white | Best plan badge |

### 9.6 Email Design System
- **Width:** 600px max (standard email width)
- **Header:** Base Note wordmark, centered, gold accent line below
- **Fragrance Card:** Product image (200px wide) + name + family + notes
- **Buttons:** Rounded corners (4px), min-height 48px, centered
- **Footer:** Social icons + address + unsubscribe link
- **Dark mode:** Test all templates; use transparent PNGs for logo

---

## 10. LEGAL & FTC COMPLIANCE

### 10.1 FTC Negative Option Rule (Auto-Renewal)

The FTC requires clear and conspicuous disclosure for any subscription with automatic renewal:

| Requirement | Our Implementation |
|-------------|-------------------|
| Disclose recurring nature | Subscription Terms box above submit button |
| Disclose amount charged | Dynamic price shown in disclosure |
| Disclose frequency | "Monthly" / "Every 3 months" / "Annually" explicitly stated |
| Disclose how to cancel | "Cancel anytime from your account dashboard" + direct link |
| Obtain affirmative consent | Unchecked checkbox that user must actively check |
| Provide simple cancellation | In-app cancellation from /account/subscription — no phone call required |

### 10.2 Newsletter Opt-In

| Jurisdiction | Our Approach | Compliant? |
|-------------|-------------|------------|
| US (CAN-SPAM) | Pre-checked, easy unsubscribe | Yes |
| California (CCPA) | Opt-out mechanism provided | Yes |
| EU (GDPR) | N/A — we only ship to US + Canada | N/A currently |
| Canada (CASL) | Pre-checked may not be compliant | Review needed if expanding to Canadian marketing |

### 10.3 Cancellation Compliance
- Cancel button is accessible (not hidden behind phone calls or chat)
- Cancellation effective at end of billing period (no partial refunds needed)
- Confirmation email sent immediately
- User can resubscribe at any time
- Survey is optional — user can skip directly to cancel confirmation

---

## 11. EMAIL TEMPLATE SPECIFICATIONS

### 11.1 Transactional Emails (Required)

| Email | Trigger | Platform |
|-------|---------|----------|
| Order Confirmation | Purchase complete | Shopify / Recharge |
| Shipping Confirmation | Tracking generated | Shopify |
| Subscription Created | First checkout | Recharge |
| Subscription Canceled | Cancel confirmed | Recharge |
| Payment Failed | Charge declined | Recharge |
| Payment Method Expiring | 14 days before expiry | Recharge |

### 11.2 Engagement Emails (Marketing)

| Email | Trigger | Tool |
|-------|---------|------|
| Pre-shipment Reminder (7 days) | Cron: 24th of month | Klaviyo / Recharge |
| Urgency Reminder (3 days) | Cron: 27th + no action | Klaviyo |
| Post-Delivery Feedback | Delivery + 5 days | Klaviyo |
| Win-back 1 | Cancel + 14 days | Klaviyo |
| Win-back 2 | Cancel + 30 days | Klaviyo |
| Win-back 3 | Cancel + 60 days | Klaviyo |

### 11.3 Recommended Email Platform
**Klaviyo** — Best-in-class for Shopify + Recharge integration. Supports:
- Shopify customer data sync
- Recharge subscription event triggers
- Advanced segmentation (active, paused, canceled)
- A/B testing for subject lines
- Flow builder for automated sequences
- Revenue attribution per email

---

## 12. SUCCESS METRICS & KPIs

### 12.1 Checkout Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Cart-to-checkout rate | > 70% | Users who view cart and proceed |
| Checkout completion rate | > 55% | Users who start checkout and complete |
| Terms agreement drop-off | < 5% | Users who abandon at terms checkbox |
| Newsletter opt-out rate | < 15% | Users who uncheck the pre-checked box |

### 12.2 Engagement Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Reminder email open rate | > 45% | Email 1 (7-day reminder) |
| Reminder email click rate | > 15% | Any CTA click |
| Fragrance self-selection rate | > 40% | Users who actively choose (vs auto-pilot) |
| Post-delivery rating rate | > 25% | Users who rate their fragrance |
| Client portal monthly active users | > 60% | Subscribers who log in at least once/month |

### 12.3 Churn Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| Monthly churn rate | < 5% | Industry avg for subscription boxes: 7-10% |
| Retention offer acceptance rate | > 30% | Across all offer types |
| Average subscriber lifetime | > 8 months | Revenue: 8 x $20 = $160 LTV |
| Win-back conversion rate | > 8% | Within 60 days of cancellation |
| Survey completion rate | > 80% | Cancelers who select a reason |

### 12.4 Revenue Metrics

| Metric | Formula |
|--------|---------|
| Monthly Recurring Revenue (MRR) | Active subscribers x plan price |
| Customer Lifetime Value (LTV) | Avg months subscribed x avg plan price |
| Churn Revenue Impact | Churned subscribers x remaining LTV |
| Retention Offer ROI | Revenue saved by retention / discount cost |

---

## 13. IMPLEMENTATION PRIORITY & PHASING

### Phase 1: MVP (Weeks 1-4)
- [ ] Checkout flow with subscription disclosure
- [ ] Basic customer account dashboard
- [ ] Subscription management (skip, cancel — basic)
- [ ] Order confirmation page + email

### Phase 2: Engagement (Weeks 5-8)
- [ ] Pre-shipment reminder emails (7-day + 3-day)
- [ ] Fragrance selector (next shipment page)
- [ ] Auto-pilot rotation logic (basic version)
- [ ] Shipment confirmation email

### Phase 3: Retention (Weeks 9-12)
- [ ] Multi-step cancellation flow with survey
- [ ] Contextual retention offers
- [ ] Post-delivery feedback email
- [ ] Win-back email sequence

### Phase 4: History & Polish (Weeks 13-16)
- [ ] Fragrance history timeline (client portal)
- [ ] HQ staff metafield workflow
- [ ] User ratings and notes system
- [ ] Analytics dashboard for churn data
- [ ] A/B testing on retention offers

---

## 14. APPENDIX: WIREFRAMES

### 14.1 Checkout — Subscription Disclosure Section

```
+----------------------------------------------------+
| ⚠  SUBSCRIPTION TERMS                              |
|    ──────────────────                               |
|                                                      |
|    By completing this purchase, you are              |
|    subscribing to a MONTHLY PLAN at $20.00/month.   |
|    Your subscription automatically renews and your   |
|    payment method will be charged on March 1, 2026.  |
|                                                      |
|    Cancel, skip, or swap anytime from your           |
|    account dashboard.                                |
|                                                      |
|    [ ] I understand this is a recurring subscription |
|        and agree to the Terms of Service and         |
|        Privacy Policy.                               |
|                                                      |
|    (amber background, 1px amber border)              |
+----------------------------------------------------+
|                                                      |
| +--------------------------------------------------+|
| |         SUBSCRIBE & PAY $20.00                    ||
| +--------------------------------------------------+|
+------------------------------------------------------+
```

### 14.2 Cancellation Flow — Step 2 (Reason Survey)

```
+----------------------------------------------------+
|                                                      |
|  Help us improve — why are you canceling?           |
|  Your feedback directly shapes our product.          |
|                                                      |
|  +-----------------------------------------------+  |
|  | [$] It's too expensive                         |  |
|  +-----------------------------------------------+  |
|  | [||] I'm not using fragrances fast enough      |  |
|  +-----------------------------------------------+  |
|  | [👎] I haven't liked the fragrances            |  |
|  +-----------------------------------------------+  |
|  | [✓] I've tried all the scents I wanted        |  |
|  +-----------------------------------------------+  |
|  | [→] I'm switching to another service           |  |
|  +-----------------------------------------------+  |
|  | [W] Financial reasons / budgeting              |  |
|  +-----------------------------------------------+  |
|  | [T] Shipping or delivery problems              |  |
|  +-----------------------------------------------+  |
|  | [?] Other reason                               |  |
|  +-----------------------------------------------+  |
|                                                      |
|  Anything else you'd like us to know? (optional)    |
|  [                                            ]     |
|                                                      |
|  [          CONTINUE          ]                     |
|                                                      |
+----------------------------------------------------+
```

### 14.3 Client Portal — Fragrance History Timeline

```
+====================================================+
|  YOUR FRAGRANCE JOURNEY                             |
|  Every scent you've discovered with Base Note       |
+====================================================+
|                                                      |
|  ● FEBRUARY 2026                                    |
|  |                                                   |
|  |  +---------------------------------------------+ |
|  |  | [img]  MIDNIGHT OUD                          | |
|  |  |        Woody / Oud                           | |
|  |  |                                              | |
|  |  |  Top:   Saffron, Bulgarian Rose, Pink Pepper | |
|  |  |  Heart: Cambodian Oud, Incense, Orris        | |
|  |  |  Base:  Amber, Sandalwood, Musk              | |
|  |  |                                              | |
|  |  |  Your Rating: ★★★★☆                         | |
|  |  |  Your Notes: "Rich, complex..."  [Edit]      | |
|  |  |                                              | |
|  |  |  [Get again] [Full size $295] [View order]   | |
|  |  +---------------------------------------------+ |
|  |                                                   |
|  ● JANUARY 2026                                     |
|  |                                                   |
|  |  +---------------------------------------------+ |
|  |  | [img]  VELVET NOIR                           | |
|  |  |        Leather / Oriental                    | |
|  |  |        ...                                   | |
|  |  +---------------------------------------------+ |
|  |                                                   |
+======================================================+
```

---

### ADDENDUM: Jeff's Feedback Fixes (Feb 2026)

#### Sales Tax Configuration
- US sales tax must be calculated based on the **shipping address** (destination-based sourcing), per federal/state law
- 45 out of 50 US states use destination-based sourcing
- Billing address is only used as fallback for digital goods with no shipping address
- Shopify's default behavior (tax based on shipping address) is legally correct
- **Action:** Verify tax registration is active in Shopify Admin > Settings > Taxes
- Sources: Stripe, TaxJar, Avalara tax guidance

#### Single-Item Cart Enforcement
- The cart must enforce a maximum of **1 subscription item** at checkout
- The subscription model = 1 fragrance per month
- If a customer already has a subscription item in cart and tries to add another, they should be prompted: "You already have a fragrance selected for this month. Would you like to swap it?"
- Non-subscription (full-bottle) purchases can coexist with the subscription item
- Additional fragrance picks are saved to the **Rotation List** (not the cart) for future months

#### Queue / Rotation System
- "My Rotation" is a list of fragrances the customer wants to receive in future months
- Stored in localStorage (`basenotes_queue`) for immediate UX, synced to customer metafields when logged in
- Each month, the next fragrance from the rotation is auto-selected for the upcoming shipment
- Customers can reorder their rotation, add/remove items, or manually override the next shipment selection
- The "Add to Queue" button on product pages: adds the FIRST item to cart, subsequent items go to rotation list

#### Staff Order Notifications
- All new orders must trigger email notifications to the entire Base Note team:
  - wilson@basenotescent.com
  - jeff@basenotescent.com
  - alex@basenotescent.com
- Configure in Shopify Admin > Settings > Notifications > Staff order notifications
- Additionally, a staff notification email template is provided for Klaviyo integration

#### Free Shipping Configuration
- Free shipping must be configured as an actual shipping rate in Shopify Admin, not just displayed in theme UI
- Settings > Shipping and delivery > Add "Free Shipping" rate for all domestic orders
- Subscription orders always qualify for free shipping regardless of order value

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-21 | PM/UX Team | Initial PRD for checkout, portal, reminders, retention |

---

*This document was produced for the Base Note fragrance subscription platform. All specifications reference the Shopify 2.0 + Recharge Subscriptions technology stack and the brand's existing catalog of 10 exclusive fragrances.*
