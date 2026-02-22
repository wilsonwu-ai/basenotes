# Base Note — QA Checklist

> Last Updated: 2026-02-22
> Version: 2.0 (Post-Jeff Feedback)

## Pre-QA Requirements
- [ ] Theme code is deployed to Shopify (matches local repo)
- [ ] Shopify Admin tax settings are enabled
- [ ] Shopify Admin free shipping rate is configured
- [ ] Staff notification emails are added in Shopify Admin
- [ ] Test customer account exists

---

## 1. Sales Tax

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 1.1 | Add subscription item to cart and complete checkout with a US shipping address | Tax line item appears on checkout page based on shipping address state/city rate | |
| 1.2 | Enter billing address in different state than shipping address | Tax is calculated based on **shipping** address, NOT billing | |
| 1.3 | Ship to a state with no sales tax (e.g., Oregon, Montana) | No tax charged regardless of billing address | |
| 1.4 | Ship to a state with sales tax (e.g., Illinois, New York, California) | Correct state + local tax rate applied | |
| 1.5 | Check order confirmation email | Tax amount is displayed correctly | |

## 2. Cart / Queue — Single Item Enforcement

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 2.1 | Add 1 subscription fragrance to queue | Item appears in cart drawer and cart page | |
| 2.2 | Try to add a 2nd subscription fragrance | Prompted to swap current selection OR item added to rotation list (not cart) | |
| 2.3 | Add a full-bottle (non-subscription) product while subscription item is in cart | Both items coexist in cart (no conflict) | |
| 2.4 | View cart page with 1 subscription item | Shows "Your Next Fragrance" with single item and plan selector | |
| 2.5 | View rotation list on cart page | Shows saved fragrances for future months (from localStorage) | |

## 3. Cart Drawer

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 3.1 | Click cart icon in header (empty cart) | Cart drawer opens showing "Your Queue is Empty" | |
| 3.2 | Click cart icon in header (with items) | Cart drawer opens showing items with correct count | |
| 3.3 | Add item from product page | Cart drawer opens automatically, shows added item | |
| 3.4 | Click "X" or overlay to close drawer | Drawer closes smoothly | |
| 3.5 | Press Escape key while drawer is open | Drawer closes | |
| 3.6 | Subscription item in drawer | Shows subscription badge, no quantity increase button | |
| 3.7 | Click "View Cart" in drawer | Navigates to cart page with items intact | |
| 3.8 | Click "Review Subscription" / "Checkout" | Navigates to appropriate page with items intact | |

## 4. Add to Cart / Queue

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 4.1 | Click "Add to My Queue" on subscription variant | Item added to Shopify cart with selling plan, button shows "Added to Queue!" | |
| 4.2 | Click "Add to Cart" on full-bottle variant | Item added to Shopify cart without selling plan, button shows "Added to Cart!" | |
| 4.3 | Add item when variant doesn't exist / sold out | Error message shown, button does NOT show "Added!" | |
| 4.4 | Cart count badge updates after add | Badge shows correct count immediately | |
| 4.5 | Quick Add button on collection page | Works same as product page add | |

## 5. Checkout Flow

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 5.1 | Proceed from cart page to Shopify checkout | All cart items appear in checkout | |
| 5.2 | Subscription disclosure checkbox | Must be checked before "Proceed to Checkout" is enabled | |
| 5.3 | Free shipping shown at checkout | $0.00 shipping for subscription orders (actual Shopify rate, not just UI) | |
| 5.4 | Tax shown at checkout | Tax calculated correctly based on shipping address | |
| 5.5 | Complete purchase | Order created successfully, redirect to thank-you page | |
| 5.6 | Thank-you page for subscription | Shows subscription confirmation, next billing date, "What Happens Next" | |

## 6. Free Shipping

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 6.1 | Subscription order at checkout | Free shipping option available and auto-selected | |
| 6.2 | Cart drawer shipping progress bar | Shows "You've unlocked FREE shipping!" for subscription items | |
| 6.3 | Cart page shipping line | Shows "FREE" in green | |
| 6.4 | One-time purchase below threshold | Shipping calculated at checkout (not free) | |
| 6.5 | One-time purchase above threshold ($50+) | Free shipping available | |

## 7. Order Notifications

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 7.1 | Place a test order | wilson@basenotescent.com receives notification | |
| 7.2 | Place a test order | jeff@basenotescent.com receives notification | |
| 7.3 | Place a test order | alex@basenotescent.com receives notification | |
| 7.4 | Notification content | Includes: order #, customer name, items, total, shipping address | |

## 8. Product Page

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 8.1 | Load product with subscription variant (5ml) | Subscription box shown with $20/mo pricing | |
| 8.2 | Load product with full-bottle variant | Purchase box shown with full price | |
| 8.3 | Switch between variants | View toggles between subscription/purchase correctly | |
| 8.4 | Selling plan selector visible for subscription variant | Shows plan options or Appstle widget | |
| 8.5 | Selling plan selector hidden for full-bottle variant | No subscription options shown | |

## 9. Plan Selector (Cart Page)

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 9.1 | Monthly plan selected (default) | Shows monthly price, "Then $X/month" renewal text | |
| 9.2 | Switch to Quarterly | Updates summary to quarterly pricing with "SAVE 20%" badge | |
| 9.3 | Switch to Annual | Updates summary to annual pricing with "BEST VALUE" badge | |
| 9.4 | Plan selection persisted | Selected plan stored in localStorage for checkout | |

## 10. Account & Login

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 10.1 | Login with valid credentials | Redirects to account dashboard | |
| 10.2 | Guest tries to checkout | Redirected to register/login first | |
| 10.3 | Account dashboard loads | Shows subscription status, order history | |

## 11. Mobile Responsiveness

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 11.1 | Cart page on mobile (< 768px) | Single column layout, all elements accessible | |
| 11.2 | Cart drawer on mobile | Full-width drawer, scrollable items | |
| 11.3 | Product page on mobile | Gallery stacks above info, subscription box usable | |
| 11.4 | Plan selector on mobile | Single column, all plans visible and tappable | |

## 12. Theme Deployment

| # | Test Case | Expected Result | Status |
|---|-----------|-----------------|--------|
| 12.1 | Compare local code to live theme | All files match (no drift) | |
| 12.2 | Shopify theme editor loads | No Liquid errors in admin | |
| 12.3 | All pages load without console errors | No JS errors in browser dev tools | |

---

## QA Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Developer | | | |
| QA Tester | | | |
| Product Owner | | | |
