# PRODUCT REQUIREMENTS DOCUMENT (PRD)
## Scentbird Checkout Flow — Customer Journey Replication
---

**Document Version:** 1.0
**Date:** February 21, 2026
**Author:** Product Manager & Product Designer (UX/UI)
**Status:** Draft for Engineering Review
**Reference Site:** https://www.scentbird.com

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Product Overview & Business Context](#2-product-overview--business-context)
3. [User Personas & Target Audience](#3-user-personas--target-audience)
4. [Complete Customer Journey Map](#4-complete-customer-journey-map)
5. [Phase 1: Product Browsing (PLP)](#5-phase-1-product-browsing-plp)
6. [Phase 2: Product Detail (PDP)](#6-phase-2-product-detail-pdp)
7. [Phase 3: Add to Cart & Cart Drawer](#7-phase-3-add-to-cart--cart-drawer)
8. [Phase 4: Mandatory Registration / Sign-Up](#8-phase-4-mandatory-registration--sign-up)
9. [Phase 5: Login (Passwordless)](#9-phase-5-login-passwordless)
10. [Phase 6: Cookie Consent & Privacy Compliance](#10-phase-6-cookie-consent--privacy-compliance)
11. [Design System & UI Fundamentals](#11-design-system--ui-fundamentals)
12. [Legal & Compliance Requirements](#12-legal--compliance-requirements)
13. [Technical Architecture Notes](#13-technical-architecture-notes)
14. [Success Metrics & KPIs](#14-success-metrics--kpis)
15. [Appendix: Wireframe Descriptions](#15-appendix-wireframe-descriptions)

---

## 1. EXECUTIVE SUMMARY

This PRD documents the complete customer journey for a fragrance subscription e-commerce platform modeled after Scentbird's checkout workflow. The key architectural decisions that define this product are:

- **Mandatory Account Creation:** No guest checkout exists. Users MUST create an account (via email or social auth) before accessing the payment page.
- **Social Authentication:** Google, Facebook, and Apple sign-up/sign-in options are prominently featured as the primary signup mechanism.
- **Passwordless Login:** Returning users authenticate via magic link (email) rather than traditional passwords.
- **Pre-checked Newsletter Opt-in:** The marketing email checkbox is checked by default (opt-out pattern).
- **Explicit Terms Agreement:** The Terms & Conditions checkbox is NOT pre-checked and requires active user consent.
- **Dual Commerce Model:** A subscription queue system for monthly fragrance deliveries AND a traditional one-time purchase cart coexist.
- **Aggressive Conversion Tactics:** Countdown timers, subscription upsells in cart, and sticky CTAs drive urgency.

---

## 2. PRODUCT OVERVIEW & BUSINESS CONTEXT

### 2.1 Business Model
The platform operates as a **monthly fragrance subscription service** ($17.95/month, with a promotional first month at $8.97) that also supports one-time purchases of travel-size and mini-bottle fragrances.

### 2.2 Core Value Proposition
- Access to 800+ designer fragrances at a fraction of retail price
- 8 mL monthly fragrance vial (~120 sprays, 30-day supply)
- Free refillable fragrance case with first order
- Cancel anytime policy

### 2.3 Revenue Streams
| Stream | Description | Price Point |
|--------|-------------|-------------|
| Monthly Subscription | Base plan, 1 fragrance/month | $17.95/mo ($8.97 first month) |
| Premium Fragrances | Additional charge on top of subscription | +$5, +$10, +$20 |
| One-time Purchases | Sample vials and mini bottles | $4.95 - $39.00 |
| Travel-size Bundle | Buy 4 get 1 free travel vials | $21.95 each |

### 2.4 Key Business Decision: No Guest Checkout
Scentbird deliberately gates the checkout behind account creation. This is a strategic choice:
- **Pros:** Higher lifetime value (LTV), email capture for remarketing, subscription funnel optimization, personalization data collection
- **Cons:** Higher cart abandonment rate at registration gate, friction for one-time purchasers
- **Mitigation:** Social auth buttons reduce friction significantly

---

## 3. USER PERSONAS & TARGET AUDIENCE

### Persona 1: "The Explorer" (Primary)
- **Demographics:** Female, 25-40, moderate disposable income
- **Behavior:** Wants to try designer fragrances without committing to full-size bottles
- **Journey:** Browses catalog -> Reads reviews -> Subscribes for first month at discount
- **Pain Points:** High retail fragrance prices, can't try before committing

### Persona 2: "The Gift Giver"
- **Demographics:** Any gender, 25-55
- **Behavior:** Looking for unique gift options
- **Journey:** Lands via gift guide -> Explores products -> One-time purchase
- **Pain Points:** Forced to create account for a single gift purchase

### Persona 3: "The Loyalist"
- **Demographics:** Existing subscriber
- **Behavior:** Queues monthly fragrances, occasionally buys full-size or extras
- **Journey:** Logs in -> Queues scent -> Adds one-time purchase -> Checks out

---

## 4. COMPLETE CUSTOMER JOURNEY MAP

```
[Landing/Browse] -> [Product Detail] -> [Add to Cart/Queue]
                                              |
                                    +---------+---------+
                                    |                   |
                              [Cart Drawer]      [Subscription Queue]
                                    |                   |
                              [CHECKOUT]          [SUBSCRIBE]
                                    |                   |
                                    +------- + ---------+
                                             |
                                    [REGISTRATION GATE]
                                    (mandatory sign-up)
                                             |
                                    +--------+---------+
                                    |                  |
                              [Email Form]      [Social Auth]
                              + T&C agree       (Google/FB/Apple)
                              + Newsletter
                                    |                  |
                                    +--------+---------+
                                             |
                                    [PAYMENT PAGE]
                                    /subscription/payment
                                             |
                                    [ORDER CONFIRMATION]
```

---

## 5. PHASE 1: PRODUCT BROWSING (PLP)

### 5.1 Page: Product Listing Page
**Route:** `/subscription/perfumes` (or `/subscription/colognes`)

### 5.2 Layout Structure

#### 5.2.1 Global Promotional Banner (Sticky Top)
- **Content:** "Get 50% off your first month of Scentbird" with arrow CTA
- **Design:** Full-width, background: brand gold (#C4853C), white text
- **Position:** Fixed to top of viewport, persists during scroll
- **Link:** Directs to `/subscribe` (which redirects to registration)

#### 5.2.2 Main Navigation Bar
- **Logo:** "SCENTBIRD NEW YORK" wordmark, left-aligned
- **Primary Nav:** Perfumes | Colognes | Premium | Beauty | Shop | Discover | Gifting
- **Right Actions:**
  - Queue icon (with red badge count)
  - Cart icon (with red badge count) — opens cart drawer
  - Search icon — opens search overlay
  - "Log in" text link
  - "Try now" pill button (black bg, white text, rounded)

#### 5.2.3 Category Toggle Header
- **Format:** "BROWSE **PERFUMES** OR COLOGNES"
- **Active State:** Gold underline on selected category
- **Behavior:** Switches between perfume and cologne catalogs

#### 5.2.4 Visual Discovery Categories
- **Layout:** 5 equal-width image cards in horizontal row
- **Categories:** Scent type | Occasion | Personality | Fragrance family | Season
- **Each Card:** Lifestyle photography with category label below
- **Interaction:** Opens filter/quiz modal for that category

#### 5.2.5 Results Header
- **Left:** "Now browsing **802** perfumes" (count in gold)
- **Right:** `[Filter (icon)]` or `[Personalize (icon)]` buttons

#### 5.2.6 Product Card Grid
- **Layout:** 3-column grid (desktop), 2-column (tablet), 1-column (mobile)
- **Card Anatomy:**

```
+----------------------------------+
| [NEW]  [LIMITED TIME]   [+$5.00] |  <- Badges (top-left) + Premium price (top-right)
| [BEST SELLER]                    |
|                                  |
|     [Product Image 1:1]         |  <- Square product photo
|                                  |
|        BRAND NAME                |  <- Uppercase, gold, letter-spaced
|       Product Name               |  <- Normal case, dark text
|     ★★★★☆  4.4 out of 5        |  <- Star rating image
|                                  |
| Cedarwood  Amber  Lemon  Rose    |  <- Scent notes, small grey text
|                                  |
|       [Add to queue  →]         |  <- CTA button, full-width
+----------------------------------+
```

**Badge Types:**
| Badge | Icon | Meaning |
|-------|------|---------|
| NEW | Diamond outline | Recently added fragrance |
| LIMITED TIME | Clock icon | Temporary availability |
| BEST SELLER | Star outline | High popularity |
| Exclusive | Text only | Platform exclusive |

**Premium Pricing:**
- Products with `+$5.00`, `+$10.00`, or `+$20.00` tags cost extra above the base subscription
- Displayed as a small gold text indicator on the card's top-right corner

#### 5.2.7 Promotional Interstitials
Promo cards are inserted within the product grid at regular intervals:
- **Travel-size bundle:** "Buy any 4 travel-size fragrances, Get the 5th for free"
- **Neiman's Select:** Curated premium collection partnership
- **Scentbird Select:** In-house curated premium selection

#### 5.2.8 Sticky Bottom Subscribe Bar
- **Content:** "Subscribe for **$8.97** ~~$17.95~~"
- **Sub-text:** "Get 50% off your first month and a free case in MM:SS"
- **Countdown Timer:** Minutes:Seconds format, creates urgency
- **Position:** Fixed to bottom of viewport

---

## 6. PHASE 2: PRODUCT DETAIL (PDP)

### 6.1 Page: Product Detail Page
**Route:** `/perfume/{brand-slug}-{product-slug}-{id}`

### 6.2 Layout Structure

#### 6.2.1 Sticky Subscription Promotion Bar
- **Content:** "Get 50% off and a free case in your first month" + countdown timer + CTA button
- **CTA:** "SUBSCRIBE FOR $8.97 ~~$17.95~~"
- **Design:** Full-width, gold background, white text, fixed to top during scroll
- **Countdown:** Digital clock style boxes showing MM : SS

#### 6.2.2 Breadcrumb Navigation
- **Format:** Perfumes / Versace / Bright Crystal
- **Links:** Category and brand are clickable (gold text), current product is plain text
- **Position:** Below navigation bar

#### 6.2.3 Product Hero Section (Two-Column)

**Left Column (55% width):**
- Stacked product badges (top-left): LIMITED TIME, BEST SELLER
- Large hero product bottle image (centered, high-resolution)

**Right Column (45% width):**

**Product Identity:**
- Brand name: Large, bold, uppercase (e.g., "VERSACE")
- Product name: Gold colored, 1.5rem (e.g., "Bright Crystal")
- Meta line: "Eau de Toilette, Female, $128 Retail value"
- Rating: Star images + "152835 ratings" count

**Purchase Options (stacked sections):**

**A) Subscription Box (highlighted, cream background):**
```
+--------------------------------------------------+
|  Subscription                                      |
|  [vial icon]  $17.95  0.27 oz vial                |
|               30-day supply          [SUBSCRIBE    |
|                                       FOR $8.97]   |
|                                                    |
|  Limited time offer:           +------+   +------+ |
|  50% off your first month      | 04   | : | 19   | |
|  + Save 10% on one-time        | min  |   | sec  | |
|    purchases when you subscribe +------+   +------+ |
+--------------------------------------------------+
```

**B) One-time Purchase Options:**
| Size | Price | CTA |
|------|-------|-----|
| 1.5 ml vial | $4.95 | ADD TO CART (outlined) |
| 0.27 oz vial (30-day) | $21.95 | ADD TO CART (outlined) |

**C) Mini Bottle:**
| Size | Price | Badge | CTA |
|------|-------|-------|-----|
| 20 ml vial | $39.00 | "Subscribe & get 10% off" | ADD TO CART (outlined) |

#### 6.2.4 Upsell Banner
- **Tag:** "NEW AT SCENTBIRD"
- **Headline:** "BUY 4, **GET 1 FREE**" (free text in gold)
- **Body:** Mix and match travel-size fragrances offer
- **Visual:** 4 vial illustrations + FREE label
- **CTA:** "SHOP NOW" (black button)
- **Background:** Cream/beige

#### 6.2.5 Product Description
- Brand + Product heading
- Paragraph description of the fragrance profile
- Expandable "Disclaimer" link

#### 6.2.6 How It Works Section
- **Tagline:** "INTRIGUED? WE GET IT"
- **Heading:** "HERE'S HOW IT WORKS"
- **3-Step Cards (horizontal):**
  1. **PICK A SCENT** — Choose from best sellers. Full catalog at $17.95/month.
  2. **ACTIVATE YOUR SUBSCRIPTION** — 8 mL bottles, ~120 sprays, sleek refillable case.
  3. **RECEIVE YOUR FRAGRANCE** — Free case with first order. Cancel anytime.
- Each card has a lifestyle photograph and step number badge

#### 6.2.7 Social Proof Section
- "JOIN OVER 1,000,000 FRAGRANCE FANATICS"
- Pricing callout: $8.97 first month, $17.95 second month
- Subscribe CTA button
- Cream/beige background

#### 6.2.8 Featured Fragrance Notes
- Circular note images (e.g., Mahogany, Magnolia, Amber, Yuzu, Pomegranate)
- Each clickable to explore fragrances with that note
- "EXPLORE ALL NOTES" button

#### 6.2.9 Fragrance Family Card
- Full-width lifestyle image with dark overlay
- Family name (e.g., "FLORAL FRUITY GREEN")
- Description paragraph
- "LEARN MORE" link

#### 6.2.10 Community Reviews Section
**Categorization by community:**
| Category | Value |
|----------|-------|
| Scent type | FRESH |
| Occasion | EVERYDAY |
| Personality | ELEGANT |
| Fragrance family | FLORAL |
| Season | SPRING |
| Complexity | EASY-GOING |

**Reviews:**
- Total count heading (e.g., "63987 REVIEWS")
- Average rating with star breakdown bar chart
- "WRITE A REVIEW" button (requires login)
- Filter dropdowns: Most recent, All ratings
- Individual review cards with avatar, username, date, stars, body text

---

## 7. PHASE 3: ADD TO CART & CART DRAWER

### 7.1 Trigger
User clicks any "ADD TO CART" button on the PDP (one-time purchase options only).

### 7.2 Cart Drawer Behavior
- **Animation:** Slide-in panel from right edge of viewport
- **Width:** ~420px
- **Backdrop:** Semi-transparent dark overlay on rest of page
- **Close:** X button in top-right corner

### 7.3 Cart Drawer Layout

```
+-------------------------------------------+
|  X                                         |
|  Your cart total - $9.90                   |
|                                            |
|  +--------------------------------------+ |
|  | ONE-TIME PURCHASE                     | |
|  | [img] Versace                  $4.95  | |
|  |       Bright Crystal by Versace       | |
|  |       1.5 ml                          | |
|  |       [−]  1  [+]                     | |
|  +--------------------------------------+ |
|                                            |
|  +--------------------------------------+ |
|  | WOULD YOU LIKE TO ADD A MONTHLY       | |
|  | FRAGRANCE SUBSCRIPTION?               | |
|  |                                       | |
|  | A month-to-month subscription to      | |
|  | Scentbird. Billed monthly, renews     | |
|  | automatically.                        | |
|  |                                       | |
|  | [vial] Your choice of one 8ml        | |
|  |        fragrance a month, with a      | |
|  |        free case included             | |
|  |                                       | |
|  | [NO THANKS]    [YES, ADD IT!]        | |
|  +--------------------------------------+ |
|                                            |
|  Subtotal                        $4.95    |
|  Shipping                        $4.95    |
|  Total                           $9.90    |
|                                            |
|  +--------------------------------------+ |
|  |            CHECKOUT                   | |
|  +--------------------------------------+ |
|                                            |
|  Add $45.05 to your order for             |
|  FREE SHIPPING                             |
+-------------------------------------------+
```

### 7.4 Key UX Elements

#### 7.4.1 Subscription Upsell (CRITICAL)
- **Purpose:** Convert one-time purchasers into subscribers
- **Display Logic:** Only shown when user has no subscription in cart
- **Headline:** "WOULD YOU LIKE TO ADD A MONTHLY FRAGRANCE SUBSCRIPTION?"
- **Value Props:** Monthly fragrance choice + free case
- **CTAs:** "NO THANKS" (outlined) | "YES, ADD IT!" (gold filled)
- **Design Note:** This is the most visually prominent element in the cart drawer after the checkout button

#### 7.4.2 Quantity Controls
- Minus (−) and Plus (+) circular buttons
- Numeric display between buttons
- Minimum quantity: 1

#### 7.4.3 Order Summary
- Subtotal in gold text
- Shipping cost displayed (not hidden)
- Total in bold gold text

#### 7.4.4 Free Shipping Threshold
- Dynamic calculation: "Add ${remaining} to your order for **FREE SHIPPING**"
- Threshold: $50.00
- "FREE SHIPPING" text in gold

#### 7.4.5 Checkout Button
- **Label:** "CHECKOUT"
- **Style:** Full-width, black background, white text, uppercase
- **Behavior:** Links to `/subscription/payment`
- **AUTH GATE:** If user is NOT logged in, redirects to `/register?redirect=%2Fsubscription%2Fpayment`

---

## 8. PHASE 4: MANDATORY REGISTRATION / SIGN-UP

### 8.1 Critical Business Rule
**There is NO guest checkout.** Account creation is MANDATORY before a user can access the payment page. This applies to BOTH subscription sign-ups AND one-time purchases.

### 8.2 Page: Registration
**Route:** `/register?redirect={encoded_destination_path}`

### 8.3 Urgency Banner (Fixed Top)
- **Content:** "Get 50% off your first month. Offer ends in MM min, SS.S sec"
- **Design:** Gold background, white text, full-width
- **Timer Precision:** Seconds shown to one decimal place
- **Behavior:** Countdown timer (resets on page reload — artificial urgency)

### 8.4 Two-Column Layout

#### 8.4.1 Left Column: Email Registration Form (~55% width)

**Heading:** "Create your account"

**Field 1: Scent Preference (Visual Radio Group)**
- Question: "Which type of scents do you prefer?"
- Options displayed as two card-style buttons side-by-side:
  - **Feminine** — Female silhouette sketch, DEFAULT SELECTED, green checkmark badge
  - **Masculine** — Male silhouette sketch
- Border highlights on selected card
- Used for: Catalog personalization and initial product recommendations

**Field 2: Email Input**
- Standard email input field
- Placeholder: "Email"
- Validation: Valid email format required
- Full-width

**Field 3: Newsletter Opt-in Checkbox**
- Label: "Sign me up for updates from Scentbird"
- **DEFAULT STATE: CHECKED (pre-selected)**
- **UX Pattern: OPT-OUT** — User must actively UNCHECK to decline
- Visual: Gold-filled checkbox when checked
- This is a MARKETING consent checkbox

**Field 4: Terms & Conditions Agreement Checkbox**
- Label: "I agree to the Scentbird Terms and Conditions, including the arbitration provision, and that I have read and understand the Privacy Policy and CA Notice of Financial Incentive."
- **DEFAULT STATE: UNCHECKED**
- **REQUIRED: Must be checked to proceed**
- Contains 3 hyperlinks:
  1. "Terms and Conditions" -> `/terms`
  2. "Privacy Policy" -> `/privacy`
  3. "CA Notice of Financial Incentive" -> `/privacy#california`
- Link text styled in gold color

**Submit Button:**
- Label: "SIGN UP"
- Style: Full-width, black background, white text, uppercase
- Disabled until: Valid email entered AND Terms checkbox checked
- Action: Creates account, then redirects to {redirect} parameter

### 8.4.2 Right Column: Social Authentication (~45% width)

**Heading:** "Or quickly sign up"

**Social Auth Buttons (stacked vertically):**

| # | Provider | Label | Icon | Style |
|---|----------|-------|------|-------|
| 1 | Google | Sign up with Google | Google multicolor G | Outlined, white bg |
| 2 | Facebook | Sign up with Facebook | Facebook blue F | Outlined, white bg |
| 3 | Apple | Sign up with Apple | Apple black logo | Outlined, white bg |

**Button Design:**
- Full-width within column
- 1px border, light gray (#E5E5E5)
- White background
- Provider icon on left, label centered
- Generous padding (~14px vertical)
- Stack spacing: ~16px between buttons

**Important Legal Note:**
Social sign-up bypasses the explicit email form fields. When a user signs up via Google/Facebook/Apple, the platform must determine how Terms acceptance and newsletter opt-in are handled. Options:
1. Implicit acceptance (legally risky, especially for GDPR)
2. Post-auth modal asking for explicit consent
3. Terms embedded in social signup flow text

### 8.5 Login Toggle
- **Position:** Top-right of the form area
- **Text:** "Log in" in gold
- **Link:** `/register/log-in?redirect={same_redirect}`

---

## 9. PHASE 5: LOGIN (PASSWORDLESS)

### 9.1 Page: Login
**Route:** `/register/log-in?redirect={encoded_destination}`

### 9.2 Authentication Method
**PASSWORDLESS** — Scentbird does not use passwords at all. Login is accomplished via:
1. **Magic Link:** A secure link sent to the user's email address
2. **Social OAuth:** Google, Facebook, or Apple sign-in

### 9.3 Login Page Layout

**Centered single card (~500px max-width):**

```
+------------------------------------------+
|                                          |
|          SCENTBIRD                       |
|          NEW YORK                        |
|                                          |
|  Log in to your account.                |
|                                          |
|  +------------------------------------+ |
|  |  Email                              | |
|  +------------------------------------+ |
|                                          |
|  To finalize your log in, a secure      |
|  link will be sent to your email        |
|  address                                |
|                                          |
|  +------------------------------------+ |
|  |        SEND LOG IN LINK            | |
|  +------------------------------------+ |
|                                          |
|       Don't have an account?            |
|                                          |
|  Or log in with one of these            |
|  platforms:                             |
|                                          |
|  +------------------------------------+ |
|  |  G  Sign in with Google            | |
|  +------------------------------------+ |
|  +------------------------------------+ |
|  |  f  Sign in with Facebook          | |
|  +------------------------------------+ |
|  +------------------------------------+ |
|  |     Sign in with Apple            | |
|  +------------------------------------+ |
|                                          |
+------------------------------------------+
```

### 9.4 Key Design Decisions
- **No password field exists** — eliminates password-related friction, forgotten passwords, security concerns
- **Magic link text explicitly stated** — reduces confusion about what will happen
- **"Don't have an account?"** link routes to registration page with same redirect parameter
- **Social buttons labeled "Sign in with..."** (vs "Sign up with..." on registration page)

---

## 10. PHASE 6: COOKIE CONSENT & PRIVACY COMPLIANCE

### 10.1 Cookie Consent Banner
- **Trigger:** First visit or cleared cookies
- **Position:** Bottom of viewport, floating dialog
- **Content:** "We use cookies and pixels to enhance your shopping experience, ensure site functionality, and deliver relevant ads."
- **Policy Links:** Privacy Policy, Terms & Conditions
- **Action Buttons:**
  1. **Accept** — Accepts all cookies
  2. **Reject** — Rejects optional cookies
  3. **Manage cookie settings** — Opens configuration modal

### 10.2 Cookie Settings Modal
**Categories:**

| Category | Default | Description |
|----------|---------|-------------|
| Analytics | OFF | Performance and visitor interaction tracking |
| Marketing | OFF | Targeted advertising delivery |
| Personalization | OFF | Preference remembering (language, region) |

**Actions:** "Save changes" | "Cancel"

**Compliance Note:** All optional cookie categories default to OFF, compliant with GDPR's requirement for explicit consent. Essential/necessary cookies are not listed as they don't require consent.

---

## 11. DESIGN SYSTEM & UI FUNDAMENTALS

### 11.1 Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Primary Gold | #C4853C | CTAs, links, active states, brand accent |
| Primary Black | #1A1A1A | Buttons, headings, body text |
| Background Light | #F5F3F0 | Page background |
| Background White | #FFFFFF | Cards, modals, inputs |
| Text Secondary | #6B6B6B | Captions, meta info |
| Border Light | #E5E5E5 | Input borders, card borders, dividers |
| Badge BG Cream | #FDF5EC | Subscription boxes, promo sections |
| Alert Red | #D94545 | Badge counts, error states |
| Success Green | #4CAF50 | Checkmarks, success indicators |

### 11.2 Typography

| Element | Font | Weight | Size | Style |
|---------|------|--------|------|-------|
| Page Headings | Serif (editorial) | 700 | 2.5rem | Uppercase |
| Section Headings | Serif | 600 | 1.75rem | Uppercase |
| Brand Names | Sans-serif | 600 | 1rem | Uppercase, letter-spacing: 0.1em |
| Product Names | Sans-serif | 400 | 1rem | Sentence case, gold color |
| Body Text | Sans-serif | 400 | 0.95rem | Normal |
| CTA Buttons | Sans-serif | 600 | 0.85rem | Uppercase, letter-spacing: 0.08em |
| Badges | Sans-serif | 700 | 0.65rem | Uppercase |
| Captions | Sans-serif | 400 | 0.8rem | Secondary color |

### 11.3 Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Badge internal padding |
| sm | 8px | Between inline elements |
| md | 16px | Form field gaps, card internal padding |
| lg | 24px | Between cards in grid |
| xl | 32px | Button padding, section internal |
| 2xl | 48px | Between major sections |
| 3xl | 64px | Between page-level sections |

### 11.4 Button Styles

**Primary CTA (Subscribe/Sign Up/Checkout):**
- Background: #1A1A1A (black)
- Color: #FFFFFF (white)
- Border-radius: 0px (sharp rectangular)
- Padding: 14px 32px
- Text: Uppercase, letter-spaced, 600 weight
- Full-width in forms

**Secondary CTA (Add to Cart/No Thanks):**
- Background: transparent
- Border: 1px solid #1A1A1A
- Color: #1A1A1A
- Border-radius: 0px
- Same text treatment as primary

**Accent CTA (Yes, Add It!):**
- Background: #C4853C (gold)
- Color: #FFFFFF
- Border-radius: 0px

**Social Auth Buttons:**
- Background: #FFFFFF
- Border: 1px solid #E5E5E5
- Border-radius: 4px
- Icon left-aligned, text centered
- Full-width within column

**Pill Button (Try Now in nav):**
- Background: #1A1A1A
- Color: #FFFFFF
- Border-radius: 24px (fully rounded)
- Padding: 8px 20px

### 11.5 Card Design Patterns

**Product Card:**
- Background: white
- Border: none (clean, borderless)
- Shadow: none (flat design)
- Hover: subtle elevation or border highlight
- Sharp corners (0px radius)

**Registration Form Card:**
- Background: white
- Border: 1px solid #E5E5E5
- Padding: 40px
- Sharp corners

**Cart Item Card:**
- Background: white
- Border: 1px solid #E5E5E5
- Padding: 16px

### 11.6 Iconography
- **Style:** Thin line icons, monochrome
- **Queue icon:** Calendar/list hybrid with badge
- **Cart icon:** Shopping bag with badge
- **Search icon:** Magnifying glass
- **Badge icons:** Diamond (new), Clock (limited), Star (bestseller)
- **Quantity controls:** Circle buttons with +/- symbols

### 11.7 Image Treatment
- **Product images:** 1:1 aspect ratio, soft gradient backgrounds matching product color palette
- **Lifestyle images:** Full-width or card-width, professional photography
- **Fragrance note images:** Circular crop, natural ingredient photography
- **Silhouette illustrations:** Hand-drawn sketch style for gender selection

### 11.8 Responsive Breakpoints

| Breakpoint | Width | Grid Columns |
|------------|-------|--------------|
| Desktop | 1200px+ | 3-column product grid |
| Tablet | 768px - 1199px | 2-column product grid |
| Mobile | < 768px | 1-column product grid |

---

## 12. LEGAL & COMPLIANCE REQUIREMENTS

### 12.1 Newsletter Opt-In (Pre-checked)

**Current Implementation:** Checkbox is pre-checked (opt-out pattern).

**Compliance Analysis:**

| Jurisdiction | Status | Notes |
|--------------|--------|-------|
| US (CAN-SPAM) | Compliant | Pre-checked opt-in permitted; must honor unsubscribe |
| California (CCPA) | Caution | Must provide clear opt-out mechanism |
| EU (GDPR) | NON-COMPLIANT | Pre-checked boxes are NOT valid consent per GDPR |
| Canada (CASL) | NON-COMPLIANT | Requires express consent (not implied) |

**Recommendation:** Implement geo-based logic — uncheck by default for EU/Canada visitors.

### 12.2 Terms & Conditions Agreement

**Current Implementation:** Checkbox is NOT pre-checked. User must explicitly agree.

**Compliance:** This pattern is compliant across all major jurisdictions. Key elements:
- Explicit action required (checking the box)
- Links to full legal documents are provided inline
- Specifically mentions arbitration provision
- References Privacy Policy and CA Notice of Financial Incentive separately

### 12.3 Cookie Consent

**Current Implementation:** Three-option banner (Accept/Reject/Manage) with all optional categories defaulting to OFF in the management panel.

**Compliance:** GDPR-compliant pattern. Meets requirements for:
- Granular consent per category
- Clear accept/reject options
- Easy-to-access management interface
- No pre-checked optional categories

### 12.4 Required Legal Pages
1. **Terms & Conditions** (`/terms`) — Last updated April 2025
2. **Privacy Policy** (`/privacy`) — Last updated April 21, 2025
3. **CCPA "Don't sell my info"** (`/ccpa`)
4. **Accessibility** (`/accessibility`)
5. **CA Notice of Financial Incentive** (`/privacy#california`)

---

## 13. TECHNICAL ARCHITECTURE NOTES

### 13.1 Authentication Architecture
```
Authentication Flow:
  |
  +-- Email Registration
  |     |-> POST /api/register (email, scent_pref, newsletter, terms)
  |     |-> Create account -> Set session cookie -> Redirect
  |
  +-- Social OAuth
  |     |-> Redirect to provider (Google/FB/Apple)
  |     |-> Callback -> Create/link account -> Set session cookie -> Redirect
  |
  +-- Magic Link Login
        |-> POST /api/auth/magic-link (email)
        |-> Send email with secure link
        |-> User clicks link -> Verify token -> Set session cookie -> Redirect
```

### 13.2 Cart Architecture
- **Two separate systems:**
  - **Queue** (subscription): Manages monthly fragrance selections for subscribers
  - **Cart** (one-time): Traditional e-commerce cart for individual purchases
- Cart is session-based, persists across page navigation
- Cart drawer is a client-side UI component (no page reload)

### 13.3 Redirect Pattern
- All authenticated-only pages check auth state
- If unauthenticated: `redirect to /register?redirect={encoded_current_path}`
- After successful auth: `redirect to decoded {redirect} parameter`
- Examples:
  - Checkout: `/register?redirect=%2Fsubscription%2Fpayment`
  - Subscribe: `/register?redirect=%2Fsubscribe`

### 13.4 Urgency Timer
- Countdown timer appears on multiple surfaces (PDP, registration page, sticky bars)
- Timer likely resets on page load (artificial urgency technique)
- Shown to one decimal place precision on seconds (registration page)
- Used to drive conversion urgency, not tied to actual inventory scarcity

---

## 14. SUCCESS METRICS & KPIs

### 14.1 Conversion Funnel Metrics
| Stage | Metric | Target |
|-------|--------|--------|
| PLP -> PDP | Click-through rate | > 15% |
| PDP -> Add to Cart | Add to cart rate | > 8% |
| Cart -> Checkout | Cart progression rate | > 60% |
| Registration -> Payment | Registration completion | > 40% |
| Payment -> Order | Purchase completion | > 70% |

### 14.2 Registration Metrics
| Metric | Description |
|--------|-------------|
| Social vs Email signup ratio | % using Google/FB/Apple vs email form |
| Newsletter opt-out rate | % who uncheck the pre-checked newsletter box |
| Terms agreement bounce | % who abandon at terms checkbox |
| Registration drop-off | % who start registration but don't complete |

### 14.3 Cart Metrics
| Metric | Description |
|--------|-------------|
| Subscription upsell acceptance | % who click "YES, ADD IT!" in cart |
| Average cart value | Mean one-time purchase value |
| Free shipping threshold conversion | % who add items to reach $50 threshold |

---

## 15. APPENDIX: WIREFRAME DESCRIPTIONS

### 15.1 Registration Page Wireframe

```
+================================================================+
| [  Get 50% off your first month. Offer ends in 05:30.0     ]  | <- Gold urgency banner
+================================================================+
|                                                    [Log in]    |
|                                                                |
|  +----------------------------+   +---------------------------+|
|  |                            |   |                           ||
|  |  Create your account       |   |  Or quickly sign up       ||
|  |                            |   |                           ||
|  |  Which type of scents      |   |  +---------------------+ ||
|  |  do you prefer?            |   |  | G  Sign up with      | ||
|  |                            |   |  |    Google             | ||
|  |  +----------+ +----------+|   |  +---------------------+ ||
|  |  | [female] | | [male]   ||   |                           ||
|  |  | Feminine | | Masculine||   |  +---------------------+ ||
|  |  |    [x]   | |          ||   |  | f  Sign up with      | ||
|  |  +----------+ +----------+|   |  |    Facebook           | ||
|  |                            |   |  +---------------------+ ||
|  |  +----------------------+ |   |                           ||
|  |  |  Email               | |   |  +---------------------+ ||
|  |  +----------------------+ |   |  |    Sign up with      | ||
|  |                            |   |  |    Apple             | ||
|  |  [x] Sign me up for       |   |  +---------------------+ ||
|  |      updates from          |   |                           ||
|  |      Scentbird             |   |                           ||
|  |                            |   |                           ||
|  |  [ ] I agree to the       |   |                           ||
|  |      Scentbird Terms and   |   |                           ||
|  |      Conditions, including |   |                           ||
|  |      the arbitration...    |   |                           ||
|  |                            |   |                           ||
|  |  +----------------------+ |   |                           ||
|  |  |      SIGN UP         | |   |                           ||
|  |  +----------------------+ |   |                           ||
|  |                            |   |                           ||
|  +----------------------------+   +---------------------------+|
|                                                                |
+================================================================+
```

### 15.2 Cart Drawer Wireframe

```
                              +-------------------------------+
                              | X                              |
                              | Your cart total - $9.90        |
                              |                                |
                              | +----------------------------+ |
                              | | ONE-TIME PURCHASE          | |
                              | | [img] Versace       $4.95 | |
                              | |       Bright Crystal       | |
                              | |       1.5 ml               | |
                              | |       [-]  1  [+]          | |
                              | +----------------------------+ |
                              |                                |
                              | +----------------------------+ |
                              | | WOULD YOU LIKE TO ADD A    | |
                              | | MONTHLY SUBSCRIPTION?      | |
                              | |                            | |
                              | | A month-to-month sub...    | |
                              | |                            | |
                              | | [vial] Your choice of     | |
                              | |        one 8ml fragrance   | |
                              | |        per month + case    | |
                              | |                            | |
                              | | [NO THANKS] [YES, ADD IT!]| |
                              | +----------------------------+ |
                              |                                |
                              | Subtotal              $4.95   |
                              | Shipping              $4.95   |
                              | Total                 $9.90   |
                              |                                |
                              | +----------------------------+ |
                              | |        CHECKOUT            | |
                              | +----------------------------+ |
                              |                                |
                              | Add $45.05 for FREE SHIPPING  |
                              +-------------------------------+
```

---

## DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-21 | PM/UX Team | Initial PRD based on Scentbird live site analysis |

---

*This document was produced through direct analysis of scentbird.com's live production environment on February 21, 2026. All observations reflect the site's state at the time of analysis.*
