# Base Note - Product Variant Display Bug Fix Instructions

**Date:** February 21, 2026
**Reported by:** Jeff
**Priority:** HIGH - Directly affects revenue (full bottle sales at $408)
**Status:** Ready for Development

---

## Table of Contents

1. [Bug Summary](#1-bug-summary)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Evidence (Screenshots from Jeff)](#3-evidence)
4. [Detailed Fix Instructions](#4-detailed-fix-instructions)
5. [File-by-File Changes](#5-file-by-file-changes)
6. [Testing Checklist](#6-testing-checklist)
7. [Shopify Admin Verification](#7-shopify-admin-verification)

---

## 1. Bug Summary

**What's happening:** When a product has multiple variants (e.g., Creed Aventus with both a 5ml atomizer at $20/month and a 3.3 fl oz full bottle at $408), the product page ALWAYS displays the subscription view ($20/month, "Add to My Queue" button, 5ml atomizer visual, subscription benefits) — even when the customer selects the "3.3 fl oz" full bottle variant from the dropdown.

**Expected behavior:** When a customer selects the full bottle variant (3.3 fl oz / $408), the product page should:
- Display the full retail price ($408.00) with compare-at price ($510.00) showing a savings badge
- Show an "Add to Cart" button instead of "Add to My Queue"
- Hide the subscription-specific elements (5ml atomizer visual, subscription benefits list, "month-to-month" text)
- Display a standard one-time purchase layout

**Impact:** Customers who want to buy the full bottle ($408) cannot see the correct price or add-to-cart experience. This directly blocks a high-value revenue stream.

---

## 2. Root Cause Analysis

The bug is located in **one file**: `sections/main-product.liquid`

### Problem #1: Hardcoded Subscription UI (Lines 162-311)

The entire product info right-side panel is wrapped in a single `subscription-box` div that always renders:
- A 5ml atomizer SVG bottle visual (hardcoded "5ml" text and "BN" branding)
- Subscription pricing from `settings.subscription_price` (defaults to "$20")
- "/ month" period text
- "Month-to-month subscription. Cancel anytime." note
- A 4-item subscription benefits list (free shipping, swap fragrances, exclusive scents, earn rewards)
- An "Add to My Queue" button

**There is NO conditional logic** to detect whether the selected variant is a subscription (5ml) or a one-time purchase (full bottle).

### Problem #2: No Variant Change JavaScript Handler (Lines 1420-1524)

The JavaScript section handles:
- Gallery thumbnail clicks
- Add-to-cart form submission
- Copy link button

**But it does NOT:**
- Listen for changes on the `.variant-select` dropdown
- Update the hidden `#variantId` input when the variant changes
- Update the price display when variants change
- Toggle between subscription view and one-time purchase view
- Update the button text based on variant type
- Update the product image when variant-specific images exist

### Problem #3: No Variant Data Available to JavaScript

Shopify product variant data (prices, compare-at prices, availability, option values) is not being passed to the JavaScript. Without this data, the frontend cannot dynamically update when the variant dropdown changes.

---

## 3. Evidence

### Screenshot 1 — Frontend Bug (Image from iOS (2).jpg)
- Shows the Creed Aventus product page on the live website
- The SIZE dropdown shows **"Creed Aventus Eau de Parfum, 3.3 fl oz"** is selected
- Despite selecting the full bottle, the page still shows:
  - 5ml atomizer bottle visual
  - "$20 / month" pricing
  - "Month-to-month subscription. Cancel anytime."
  - Subscription benefits list
  - "ADD TO MY QUEUE" button

### Screenshot 2 — Shopify Admin Confirmation (Image from iOS (3).jpg)
- Shows the Shopify admin product editor for Creed Aventus
- The 3.3 fl oz variant is correctly configured:
  - **Price:** $408.00
  - **Compare at price:** $510.00
  - **Cost per item:** $240.00
  - **Unit price:** $123.64 / oz
- Two variants visible: "5ml" and "3.3 fl oz"

**Conclusion:** The data is correct in Shopify. The problem is 100% in the frontend template rendering.

---

## 4. Detailed Fix Instructions

### Overview of Changes

The fix requires modifying **one file** (`sections/main-product.liquid`) in three areas:

| Area | What to Change | Lines |
|------|---------------|-------|
| **A. Liquid Template** | Add conditional rendering for subscription vs. one-time purchase views | Lines 162-311 |
| **B. CSS Styles** | Add styles for the new one-time purchase view | After line 1418 |
| **C. JavaScript** | Add variant change handler + pass variant data to JS | Lines 1420-1524 |

---

## 5. File-by-File Changes

### File: `sections/main-product.liquid`

---

### CHANGE A: Add Variant Detection Logic at the Top

**Location:** After line 58 (after the closing `-%}` of the opening Liquid block), add variant detection logic.

**Find this code (around line 1-58):**
```liquid
{%- liquid
  assign current_variant = product.selected_or_first_available_variant
  assign featured_image = current_variant.featured_image | default: product.featured_image
  ... (existing season/intensity logic) ...
-%}
```

**Add this INSIDE the `{%- liquid ... -%}` block, right before the closing `-%}`:**

```liquid
  # Detect if current variant is a subscription (5ml) or one-time purchase (full bottle)
  assign is_subscription_variant = false
  assign variant_title_lower = current_variant.title | downcase
  if variant_title_lower contains '5ml' or variant_title_lower contains '5 ml' or variant_title_lower contains 'atomizer' or variant_title_lower contains 'subscription'
    assign is_subscription_variant = true
  endif

  # Check if product has BOTH subscription and full-bottle variants
  assign has_multiple_purchase_types = false
  assign has_subscription_variant = false
  assign has_fullbottle_variant = false
  for variant in product.variants
    assign v_title = variant.title | downcase
    if v_title contains '5ml' or v_title contains '5 ml' or v_title contains 'atomizer' or v_title contains 'subscription'
      assign has_subscription_variant = true
    else
      assign has_fullbottle_variant = true
    endif
  endfor
  if has_subscription_variant and has_fullbottle_variant
    assign has_multiple_purchase_types = true
  endif
```

---

### CHANGE B: Replace the Subscription Box Section with Conditional Rendering

**Location:** Replace lines 162-311 (the entire `subscription-box` div and its contents)

**Find this code (lines 162-311):**
```liquid
        {% comment %} Subscription Box {% endcomment %}
        <div class="subscription-box">
          ... (everything through to the closing) ...
          <p class="subscription-box__note">
            ...
            Ships within 1-2 business days
          </p>
        </div>
```

**Replace with the following:**

```liquid
        {% comment %} Purchase Box - Conditionally renders subscription OR one-time purchase view {% endcomment %}

        {%- comment -%} SUBSCRIPTION VIEW (5ml atomizer variant) {%- endcomment -%}
        <div class="subscription-box" id="subscriptionView" {% unless is_subscription_variant %}style="display:none"{% endunless %}>
          <div class="subscription-box__header">
            <div class="subscription-box__bottle">
              <div class="bottle-visual">
                <svg viewBox="0 0 50 90" fill="none">
                  <rect x="18" y="0" width="14" height="8" rx="2" fill="#c9a86c"/>
                  <rect x="20" y="8" width="10" height="5" fill="#555"/>
                  <rect x="10" y="13" width="30" height="70" rx="4" fill="url(#bottleGradient)" stroke="#c9a86c" stroke-width="0.5"/>
                  <rect x="15" y="28" width="20" height="30" rx="2" fill="#222"/>
                  <text x="25" y="46" text-anchor="middle" fill="#c9a86c" font-size="10" font-weight="600">BN</text>
                  <text x="25" y="55" text-anchor="middle" fill="#888" font-size="5">5ml</text>
                  <defs>
                    <linearGradient id="bottleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#1a1a1a"/>
                      <stop offset="100%" stop-color="#2a2a2a"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <span class="bottle-label">5ml Atomizer</span>
              <span class="bottle-sprays">~30 sprays</span>
            </div>

            <div class="subscription-box__pricing">
              <div class="price-main">
                <span class="price-amount">{{ settings.subscription_price | default: '$20' }}</span>
                <span class="price-period">/ month</span>
              </div>
              <p class="price-note">Month-to-month subscription. Cancel anytime.</p>
            </div>
          </div>

          <ul class="subscription-box__benefits">
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Free shipping every month</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Swap to any fragrance anytime</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Access to exclusive scents</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Earn rewards on every order</span>
            </li>
          </ul>
        </div>

        {%- comment -%} ONE-TIME PURCHASE VIEW (Full bottle variant) {%- endcomment -%}
        <div class="purchase-box" id="purchaseView" {% if is_subscription_variant %}style="display:none"{% endif %}>
          <div class="purchase-box__header">
            <div class="purchase-box__pricing">
              <div class="price-main">
                <span class="price-amount" id="purchasePrice">{{ current_variant.price | money }}</span>
              </div>
              {%- if current_variant.compare_at_price > current_variant.price -%}
                <div class="purchase-box__compare">
                  <span class="compare-price" id="comparePrice">{{ current_variant.compare_at_price | money }}</span>
                  <span class="savings-badge" id="savingsBadge">
                    Save {{ current_variant.compare_at_price | minus: current_variant.price | money }}
                  </span>
                </div>
              {%- endif -%}
            </div>
          </div>

          <div class="purchase-box__details">
            <div class="purchase-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
              <span>Full-size bottle</span>
            </div>
            <div class="purchase-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>One-time purchase — no subscription</span>
            </div>
            <div class="purchase-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="3" width="15" height="13"/>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                <circle cx="5.5" cy="18.5" r="2.5"/>
                <circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
              <span>Free standard shipping</span>
            </div>
          </div>
        </div>

        {%- comment -%} SHARED FORM (used by both views) {%- endcomment -%}
        {%- form 'product', product, id: 'productForm', class: 'product-purchase-form', data-product-form: '', data-productid: product.id -%}
          <input type="hidden" name="id" value="{{ current_variant.id }}" id="variantId">

          {%- if product.variants.size > 1 -%}
            <div class="product-variants">
              {%- for option in product.options_with_values -%}
                <div class="variant-selector">
                  <label for="option-{{ option.name | handle }}">{{ option.name }}</label>
                  <select id="option-{{ option.name | handle }}" data-option-index="{{ forloop.index0 }}" class="variant-select">
                    {%- for value in option.values -%}
                      <option value="{{ value }}"{% if option.selected_value == value %} selected{% endif %}>
                        {{ value }}
                      </option>
                    {%- endfor -%}
                  </select>
                </div>
              {%- endfor -%}
            </div>
          {%- endif -%}

          {% comment %} Appstle Subscription Widget Container {% endcomment %}
          <div id="appstle_subscription_widget" data-product-id="{{ product.id }}" data-variant-id="{{ current_variant.id }}"></div>

          {% comment %} Native Shopify Selling Plan Support (fallback) {% endcomment %}
          {%- if product.selling_plan_groups.size > 0 -%}
            <div class="selling-plan-selector" id="sellingPlanSelector">
              {%- for group in product.selling_plan_groups -%}
                <fieldset class="selling-plan-group">
                  <legend class="selling-plan-group__title">{{ group.name }}</legend>
                  <label class="selling-plan-option">
                    <input type="radio" name="selling_plan" value="" checked>
                    <span class="selling-plan-option__content">
                      <span class="selling-plan-option__name">One-time purchase</span>
                      <span class="selling-plan-option__price">{{ current_variant.price | money }}</span>
                    </span>
                  </label>
                  {%- for plan in group.selling_plans -%}
                    {%- assign plan_allocation = current_variant.selling_plan_allocations | where: "selling_plan_id", plan.id | first -%}
                    <label class="selling-plan-option selling-plan-option--subscription">
                      <input type="radio" name="selling_plan" value="{{ plan.id }}">
                      <span class="selling-plan-option__content">
                        <span class="selling-plan-option__name">{{ plan.name }}</span>
                        {%- if plan_allocation -%}
                          <span class="selling-plan-option__price">
                            {{ plan_allocation.price | money }}
                            {%- if plan_allocation.compare_at_price > plan_allocation.price -%}
                              <span class="selling-plan-option__savings">
                                Save {{ plan_allocation.compare_at_price | minus: plan_allocation.price | money }}
                              </span>
                            {%- endif -%}
                          </span>
                        {%- endif -%}
                      </span>
                    </label>
                  {%- endfor -%}
                </fieldset>
              {%- endfor -%}
            </div>
          {%- endif -%}

          {%- comment -%} Dynamic Button: "Add to My Queue" for subscription, "Add to Cart" for full bottle {%- endcomment -%}
          <button
            type="submit"
            class="add-to-queue-btn"
            id="addToCartButton"
            {% unless current_variant.available %}disabled{% endunless %}
            data-add-to-cart
          >
            {%- if current_variant.available -%}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              <span id="addToCartText">
                {%- if is_subscription_variant -%}
                  Add to My Queue
                {%- else -%}
                  Add to Cart
                {%- endif -%}
              </span>
            {%- else -%}
              <span>Sold Out</span>
            {%- endif -%}
          </button>
        {%- endform -%}

        <p class="subscription-box__note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          Ships within 1-2 business days
        </p>
```

---

### CHANGE C: Add New CSS Styles for Purchase Box

**Location:** Add these styles BEFORE the closing `</style>` tag (before line 1418). Insert after the existing `.subscription-box__note svg` styles around line 1018.

```css
  /* =============================================
     ONE-TIME PURCHASE BOX (Full Bottle Variant)
     ============================================= */

  .purchase-box {
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--spacing-xl);
    margin-bottom: var(--spacing-lg);
  }

  .purchase-box__header {
    padding-bottom: var(--spacing-lg);
    border-bottom: 1px solid var(--color-border);
    margin-bottom: var(--spacing-lg);
  }

  .purchase-box__pricing .price-amount {
    font-size: var(--font-size-3xl);
    font-weight: 700;
    color: var(--color-primary);
  }

  .purchase-box__compare {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-xs);
  }

  .compare-price {
    font-size: var(--font-size-lg);
    color: var(--color-text-muted);
    text-decoration: line-through;
  }

  .savings-badge {
    display: inline-block;
    padding: 4px 10px;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: #4caf50;
    background: rgba(76, 175, 80, 0.1);
    border-radius: var(--radius-full);
  }

  .purchase-box__details {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  }

  .purchase-detail {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--color-text);
  }

  .purchase-detail svg {
    width: 18px;
    height: 18px;
    color: var(--color-secondary);
    flex-shrink: 0;
  }

  /* Shared form styling (moved outside subscription-box) */
  .product-purchase-form {
    margin: var(--spacing-lg) 0;
  }

  @media (max-width: 768px) {
    .purchase-box__header {
      text-align: center;
    }

    .purchase-box__compare {
      justify-content: center;
    }
  }
```

---

### CHANGE D: Replace the Entire JavaScript Section

**Location:** Replace everything between `<script>` and `</script>` (lines 1420-1523)

**Replace the existing script with:**

```html
<script>
  document.addEventListener('DOMContentLoaded', function() {

    // ===================================================
    // 1. VARIANT DATA - Pass Shopify variant data to JS
    // ===================================================
    const productVariants = [
      {%- for variant in product.variants -%}
        {
          id: {{ variant.id }},
          title: {{ variant.title | json }},
          price: {{ variant.price }},
          priceFormatted: {{ variant.price | money | json }},
          compareAtPrice: {{ variant.compare_at_price | default: 0 }},
          compareAtPriceFormatted: {{ variant.compare_at_price | money | json }},
          available: {{ variant.available }},
          options: {{ variant.options | json }},
          featuredImage: {{ variant.featured_image | image_url: width: 1000 | json | default: 'null' }},
          featuredImageSrcset: {{ variant.featured_image | image_url: width: 500 | append: ' 500w, ' | append: '' | json | default: 'null' }}
        }{%- unless forloop.last -%},{%- endunless -%}
      {%- endfor -%}
    ];

    const productOptions = {{ product.options | json }};

    // ===================================================
    // 2. HELPER - Determine if a variant is subscription
    // ===================================================
    function isSubscriptionVariant(variant) {
      const title = (variant.title || '').toLowerCase();
      return title.includes('5ml') || title.includes('5 ml') ||
             title.includes('atomizer') || title.includes('subscription');
    }

    // ===================================================
    // 3. HELPER - Format money (cents to dollars)
    // ===================================================
    function formatMoney(cents) {
      return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
    }

    // ===================================================
    // 4. VARIANT CHANGE HANDLER
    // ===================================================
    function onVariantChange() {
      // Get selected options from all dropdowns
      const selects = document.querySelectorAll('.variant-select');
      const selectedOptions = [];
      selects.forEach(select => {
        selectedOptions.push(select.value);
      });

      // Find the matching variant
      const matchedVariant = productVariants.find(variant => {
        return variant.options.every((opt, index) => opt === selectedOptions[index]);
      });

      if (!matchedVariant) return;

      // Update the hidden variant ID input
      const variantInput = document.getElementById('variantId');
      if (variantInput) {
        variantInput.value = matchedVariant.id;
      }

      // Update the Appstle widget variant
      const appstleWidget = document.getElementById('appstle_subscription_widget');
      if (appstleWidget) {
        appstleWidget.setAttribute('data-variant-id', matchedVariant.id);
      }

      // Determine if this is subscription or one-time purchase
      const isSub = isSubscriptionVariant(matchedVariant);

      // Toggle views
      const subscriptionView = document.getElementById('subscriptionView');
      const purchaseView = document.getElementById('purchaseView');

      if (subscriptionView) {
        subscriptionView.style.display = isSub ? '' : 'none';
      }
      if (purchaseView) {
        purchaseView.style.display = isSub ? 'none' : '';
      }

      // Update button text
      const buttonText = document.getElementById('addToCartText');
      if (buttonText) {
        buttonText.textContent = isSub ? 'Add to My Queue' : 'Add to Cart';
      }

      // Update button state (available/sold out)
      const addBtn = document.getElementById('addToCartButton');
      if (addBtn) {
        if (matchedVariant.available) {
          addBtn.disabled = false;
          if (buttonText) {
            buttonText.textContent = isSub ? 'Add to My Queue' : 'Add to Cart';
          }
        } else {
          addBtn.disabled = true;
          if (buttonText) {
            buttonText.textContent = 'Sold Out';
          }
        }
      }

      // Update one-time purchase pricing
      if (!isSub) {
        const priceEl = document.getElementById('purchasePrice');
        if (priceEl) {
          priceEl.textContent = matchedVariant.priceFormatted;
        }

        const compareEl = document.getElementById('comparePrice');
        const savingsEl = document.getElementById('savingsBadge');
        const compareContainer = compareEl ? compareEl.closest('.purchase-box__compare') : null;

        if (matchedVariant.compareAtPrice > matchedVariant.price) {
          if (compareContainer) compareContainer.style.display = '';
          if (compareEl) compareEl.textContent = matchedVariant.compareAtPriceFormatted;
          if (savingsEl) {
            const savings = matchedVariant.compareAtPrice - matchedVariant.price;
            savingsEl.textContent = 'Save ' + formatMoney(savings);
          }
        } else {
          if (compareContainer) compareContainer.style.display = 'none';
        }
      }

      // Update product image if variant has a specific image
      const mainImage = document.getElementById('mainProductImage');
      if (mainImage && matchedVariant.featuredImage && matchedVariant.featuredImage !== 'null') {
        mainImage.src = matchedVariant.featuredImage;
      }

      // Update URL without page reload (for shareable links)
      const url = new URL(window.location);
      url.searchParams.set('variant', matchedVariant.id);
      window.history.replaceState({}, '', url);
    }

    // ===================================================
    // 5. BIND VARIANT SELECTORS
    // ===================================================
    const variantSelects = document.querySelectorAll('.variant-select');
    variantSelects.forEach(select => {
      select.addEventListener('change', onVariantChange);
    });

    // ===================================================
    // 6. GALLERY THUMBNAILS
    // ===================================================
    const thumbnails = document.querySelectorAll('.product-gallery__thumb');
    const mainImage = document.getElementById('mainProductImage');

    thumbnails.forEach(thumb => {
      thumb.addEventListener('click', function() {
        thumbnails.forEach(t => t.classList.remove('is-active'));
        this.classList.add('is-active');
        if (mainImage) {
          mainImage.src = this.dataset.imageUrl;
          mainImage.srcset = this.dataset.imageSrcset;
        }
      });
    });

    // ===================================================
    // 7. ADD TO CART FUNCTIONALITY
    // ===================================================
    const productForm = document.querySelector('[data-product-form]');
    const addToCartBtn = document.querySelector('[data-add-to-cart]');

    if (productForm && addToCartBtn) {
      productForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const formData = new FormData(productForm);
        const variantId = formData.get('id');
        const sellingPlan = formData.get('selling_plan');

        addToCartBtn.classList.add('is-loading');
        const buttonTextEl = document.getElementById('addToCartText');
        const originalText = buttonTextEl ? buttonTextEl.textContent : 'Add to Cart';

        const cartPayload = {
          id: variantId,
          quantity: 1
        };

        if (sellingPlan) {
          cartPayload.selling_plan = sellingPlan;
        }

        fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cartPayload)
        })
        .then(response => response.json())
        .then(data => {
          addToCartBtn.classList.remove('is-loading');
          addToCartBtn.classList.add('is-added');
          if (buttonTextEl) {
            buttonTextEl.textContent = 'Added!';
          }

          fetch('/cart.js')
            .then(res => res.json())
            .then(cart => {
              const cartCount = document.querySelector('[data-cart-count]');
              if (cartCount) {
                cartCount.textContent = cart.item_count;
                cartCount.classList.remove('is-hidden');
              }
              const cartDrawer = document.querySelector('[data-cart-drawer]');
              if (cartDrawer) {
                cartDrawer.classList.add('is-open');
                document.body.style.overflow = 'hidden';
              }
            });

          setTimeout(() => {
            addToCartBtn.classList.remove('is-added');
            if (buttonTextEl) {
              buttonTextEl.textContent = originalText;
            }
          }, 2000);
        })
        .catch(error => {
          console.error('Error:', error);
          addToCartBtn.classList.remove('is-loading');
        });
      });
    }

    // ===================================================
    // 8. COPY LINK BUTTON
    // ===================================================
    document.querySelectorAll('[data-copy-link]').forEach(btn => {
      btn.addEventListener('click', function() {
        const url = this.dataset.copyLink;
        navigator.clipboard.writeText(url).then(() => {
          const originalIcon = this.innerHTML;
          this.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg>';
          setTimeout(() => {
            this.innerHTML = originalIcon;
          }, 2000);
        });
      });
    });

  });
</script>
```

---

## 6. Testing Checklist

After making the changes, test the following scenarios:

### Scenario 1: Product with ONLY 5ml variant (most products)
- [ ] Page loads with subscription view (5ml atomizer, $20/month, benefits list)
- [ ] "Add to My Queue" button is shown
- [ ] No variant dropdown is displayed (only 1 variant)
- [ ] Add to cart works correctly

### Scenario 2: Product with BOTH 5ml and full bottle variants (Creed Aventus)
- [ ] Page loads with the correct view for the default/first variant
- [ ] Variant dropdown is displayed with both options
- [ ] **Selecting "5ml":**
  - [ ] Shows subscription view (5ml atomizer, $20/month, benefits list)
  - [ ] Button says "Add to My Queue"
- [ ] **Selecting "3.3 fl oz":**
  - [ ] Hides subscription view
  - [ ] Shows one-time purchase view with $408.00 price
  - [ ] Shows compare-at price $510.00 with strikethrough
  - [ ] Shows savings badge "Save $102.00"
  - [ ] Button says "Add to Cart"
  - [ ] "One-time purchase - no subscription" text visible
- [ ] Switching back and forth between variants updates correctly
- [ ] Add to cart works for both variant types

### Scenario 3: URL with variant parameter
- [ ] Loading `/products/creed-aventus?variant=[full-bottle-id]` shows the correct full bottle view
- [ ] Loading `/products/creed-aventus?variant=[5ml-id]` shows the subscription view

### Scenario 4: Sold Out variant
- [ ] If the full bottle variant is out of stock, button shows "Sold Out" and is disabled
- [ ] If the 5ml variant is out of stock, button shows "Sold Out" and is disabled

### Scenario 5: Mobile responsive
- [ ] Purchase box looks correct on mobile (375px width)
- [ ] Variant dropdown is usable on mobile
- [ ] Price and savings badge are properly visible

---

## 7. Shopify Admin Verification

Before deploying the code fix, verify in Shopify Admin that:

### For Creed Aventus (and any product with full-bottle variants):

1. **Go to Products > Creed Aventus > Variants**
2. Confirm two variants exist:
   - **5ml** — Price: $20.00 (or $0 if subscription-only)
   - **3.3 fl oz** — Price: $408.00, Compare at: $510.00
3. Both variants should have:
   - [x] "Track quantity" enabled
   - [x] Stock levels set correctly
   - [x] SKUs assigned
4. The variant option name should be **"Size"** (this is what appears as the dropdown label)

### Naming Convention (IMPORTANT):

The JavaScript detection relies on variant title matching. Ensure:
- Subscription variants contain one of: `5ml`, `5 ml`, `atomizer`, or `subscription` in the variant title
- Full bottle variants should NOT contain those keywords (e.g., use "3.3 fl oz", "100ml", "Full Size", etc.)

If Jeff or anyone adds new full-bottle variants to other products in the future, follow this same naming convention and the fix will automatically work for those products too.

---

## Quick Reference: What Changes Where

| What | Before (Bug) | After (Fix) |
|------|-------------|-------------|
| **5ml variant selected** | Shows $20/month, 5ml visual, "Add to My Queue" | Same as before (no change) |
| **Full bottle variant selected** | Shows $20/month, 5ml visual, "Add to My Queue" (BUG) | Shows $408.00, compare at $510, savings badge, "Add to Cart" |
| **Variant dropdown change** | Only updates hidden input (no visual change) | Updates entire purchase box, price, button text, and URL |
| **JavaScript** | No variant change handler | Full variant change handler with view toggling |
| **CSS** | Only subscription box styles | Added purchase-box styles for one-time purchase view |

---

## Summary

This is a **single-file fix** in `sections/main-product.liquid` with 4 changes:
1. **Liquid logic** — Detect variant type (subscription vs full bottle)
2. **HTML** — Add a new one-time purchase view alongside the existing subscription view, with toggle visibility
3. **CSS** — Add styles for the purchase box
4. **JavaScript** — Add variant change handler that toggles views, updates prices, and updates the button

The fix is backward-compatible — all existing products with only 5ml variants will continue to work exactly as before. The new behavior only activates when a product has multiple variant types.
