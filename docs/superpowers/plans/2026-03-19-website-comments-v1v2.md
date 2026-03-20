# Website Comments V1 & V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 17 feedback items from Jeff's website_comments_v1.docx and v2.docx across 4 sequential batches.

**Architecture:** Shopify Liquid theme (Dawn-based). Changes are text/copy edits, component removals, product tag additions via Admin API, filter/card rendering updates, and mobile CSS fixes. Each batch is a single commit. Theme push happens after all batches pass review.

**Tech Stack:** Shopify Liquid, CSS, vanilla JS, Shopify CLI 3.x, Shopify Admin GraphQL API

**Spec:** `docs/superpowers/specs/2026-03-19-website-comments-v1v2-design.md`

**Important:** Before starting, always pull the latest live theme:
```bash
shopify theme pull --store base-note.myshopify.com --theme 158692901082
```

**Note on code snippets:** Throughout this plan, `{# OLD #}`, `{# NEW #}`, and `{# REMOVE #}` are instructional markers for the implementer. Do NOT insert these into the actual code. They indicate what to find and what to replace it with.

---

## Task 1: Batch 1 — Quick Text/Copy Fixes (Items 1, 2, 10, 12)

**Files:**
- Modify: `sections/main-product.liquid:194` (spray count)
- Modify: `templates/cart.liquid:81` (spray count)
- Modify: `snippets/cart-drawer.liquid:6-53` (free shipping bar)
- Modify: `sections/main-product.liquid:197-203` (subscription pricing display)
- Modify: `templates/cart.liquid:217-227` (30-day satisfaction perk)

### Item 1: Change spray count

- [ ] **Step 1:** In `sections/main-product.liquid`, line 194, change `~30 sprays` to `~45 sprays`:

```liquid
{# OLD #}
<span class="bottle-sprays">~30 sprays</span>

{# NEW #}
<span class="bottle-sprays">~45 sprays</span>
```

- [ ] **Step 2:** In `templates/cart.liquid`, line 81, change `~30 sprays` to `~45 sprays`:

```liquid
{# OLD #}
<p class="cart-item__size">5ml Atomizer (~30 sprays)</p>

{# NEW #}
<p class="cart-item__size">5ml Atomizer (~45 sprays)</p>
```

### Item 2: Remove free shipping threshold messaging

- [ ] **Step 3:** In `snippets/cart-drawer.liquid`, remove lines 6-11 (threshold calculation) and lines 36-53 (the shipping progress bar section). Delete these two blocks:

Lines 6-11 to remove:
```liquid
{%- assign free_shipping_threshold = settings.cart_free_shipping_threshold | default: '50' | times: 100 -%}
{%- assign remaining_for_free_shipping = free_shipping_threshold | minus: cart.total_price -%}
{%- assign shipping_progress = cart.total_price | times: 100 | divided_by: free_shipping_threshold -%}
{%- if shipping_progress > 100 -%}
  {%- assign shipping_progress = 100 -%}
{%- endif -%}
```

Lines 36-53 to remove (the entire `{% comment %} Free Shipping Progress {% endcomment %}` block through closing `</div>`):
```liquid
      {% comment %} Free Shipping Progress {% endcomment %}
      <div class="cart-drawer__shipping-progress">
        ... (entire block through closing </div>)
      </div>
```

**Also:** Remove the second `free_shipping_threshold` assignment and conditional in the cart drawer footer section. At line 253, remove the variable assignment, and at lines 262-266 replace the shipping conditional with a static "FREE" since all purchases have free shipping:

```liquid
{# OLD (lines 253, 262-266) #}
        {%- assign free_shipping_threshold = settings.cart_free_shipping_threshold | default: '50' | times: 100 -%}
        ...
              {%- if cart.total_price >= free_shipping_threshold -%}
                <span style="color: var(--color-secondary); font-weight: 600;">FREE</span>
              {%- else -%}
                Calculated at checkout
              {%- endif -%}

{# NEW (remove line 253 entirely, replace lines 262-266 with) #}
              <span style="color: var(--color-secondary); font-weight: 600;">FREE</span>
```

**Also:** Remove "Free atomizer case included" from `sections/subscription-landing.liquid:109`. Delete the entire `<li>`:

```liquid
{# REMOVE line 109 #}
            <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Free atomizer case included</li>
```

### Item 10: Update subscription pricing display

- [ ] **Step 4:** In `sections/main-product.liquid`, lines 197-203, update the subscription box pricing to show full bottle comparison. Replace the pricing div:

```liquid
{# OLD #}
            <div class="subscription-box__pricing">
              <div class="price-main">
                <span class="price-amount">{{ settings.subscription_price | default: '$20' }}</span>
                <span class="price-period">/ month</span>
              </div>
              <p class="price-note">Month-to-month subscription. Cancel anytime.</p>
            </div>

{# NEW #}
            <div class="subscription-box__pricing">
              <div class="price-main">
                <span class="price-amount">{{ settings.subscription_price | default: '$20' }}</span>
                <span class="price-period">/ month</span>
              </div>
              {%- if product.compare_at_price > product.price -%}
                <p class="price-note">Retail: {{ product.compare_at_price | money }} — yours for {{ settings.subscription_price | default: '$20' }}/month</p>
              {%- else -%}
                <p class="price-note">Month-to-month subscription. Cancel anytime.</p>
              {%- endif -%}
            </div>
```

### Item 12: Remove 30-day satisfaction perk

- [ ] **Step 5:** In `templates/cart.liquid`, remove lines 217-227 (the entire 4th cart-perk div containing "30-day satisfaction guarantee"):

```liquid
{# REMOVE this entire block #}
                <div class="cart-perk">
                  <div class="cart-perk__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                  <div>
                    <strong>30-day satisfaction guarantee</strong>
                    <p>Not happy? We'll make it right</p>
                  </div>
                </div>
```

This leaves 3 perks: Free shipping, Swap/skip/cancel, Free travel case.

### Commit Batch 1

- [ ] **Step 6:** Verify all changes by grepping:

```bash
grep -n "30 sprays" sections/main-product.liquid templates/cart.liquid
# Expected: no matches (should be "45 sprays" now)

grep -n "free_shipping_threshold" snippets/cart-drawer.liquid
# Expected: no matches

grep -n "30-day satisfaction" templates/cart.liquid
# Expected: no matches
```

- [ ] **Step 7:** Commit:

```bash
git add sections/main-product.liquid templates/cart.liquid snippets/cart-drawer.liquid sections/subscription-landing.liquid
git commit -m "Batch 1: Update spray count, remove shipping bar, update pricing display, remove 30-day perk

- Change ~30 sprays to ~45 sprays (main-product, cart)
- Remove free shipping threshold progress bar and footer conditional (cart-drawer)
- Update subscription box to show full bottle retail comparison
- Remove 30-day satisfaction guarantee perk (all sales final)
- Remove free atomizer case mention from subscription landing page

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Batch 2 — UI Component Removals (Items 4, 5, 11)

**Files:**
- Modify: `sections/main-product.liquid:477-505` (social sharing widget)
- Modify: `sections/footer.liquid:153-166` (legal links)
- Modify: `snippets/cart-drawer.liquid:161-249` (upsells + subscription upsell)

### Item 4: Remove social sharing widget

- [ ] **Step 1:** In `sections/main-product.liquid`, remove lines 477-505 (the entire `{% comment %} Social Sharing {% endcomment %}` block including the `<div class="product-share">` and all its contents through the closing `</div>`):

```liquid
{# REMOVE this entire block (lines 477-505) #}
        {% comment %} Social Sharing {% endcomment %}
        <div class="product-share">
          <span class="product-share__label">Share this fragrance:</span>
          <div class="product-share__buttons">
            ... (Facebook, Twitter, Pinterest, Copy Link buttons)
          </div>
        </div>
```

Also search for and remove any `.product-share` CSS styles in the same file's `<style>` block if they exist.

### Item 5: Fix footer legal links

- [ ] **Step 2:** In `sections/footer.liquid`, lines 153-166, update the legal links to use Shopify's auto-generated policy pages as fallbacks. Replace the `footer__legal` div:

```liquid
{# OLD #}
        <div class="footer__legal">
          {%- if section.settings.privacy_link != blank -%}
            <a href="{{ section.settings.privacy_link }}">Privacy Policy</a>
          {%- endif -%}
          {%- if section.settings.terms_link != blank -%}
            <a href="{{ section.settings.terms_link }}">Terms of Service</a>
          {%- endif -%}
          {%- if section.settings.refund_link != blank -%}
            <a href="{{ section.settings.refund_link }}">Refund Policy</a>
          {%- endif -%}
          {%- if section.settings.shipping_link != blank -%}
            <a href="{{ section.settings.shipping_link }}">Shipping Policy</a>
          {%- endif -%}
        </div>

{# NEW #}
        <div class="footer__legal">
          <a href="{{ section.settings.privacy_link | default: policies.privacy_policy.url }}">Privacy Policy</a>
          <a href="{{ section.settings.terms_link | default: policies.terms_of_service.url }}">Terms of Service</a>
          <a href="{{ section.settings.refund_link | default: policies.refund_policy.url }}">Refund Policy</a>
          <a href="{{ section.settings.shipping_link | default: policies.shipping_policy.url }}">Shipping Policy</a>
        </div>
```

This ensures links always render (using Shopify's built-in policy URLs as fallbacks) and removes the conditional hiding that caused broken empty links.

### Item 11: Remove upsells and subscription upsell from cart drawer

- [ ] **Step 3:** In `snippets/cart-drawer.liquid`, remove the "Complete Your Collection" upsell section (lines 161-213 including the `{% if settings.cart_upsells_enabled %}` wrapper) AND the "Subscription Upsell" section (lines 215-249 including the `{% unless has_subscription %}` wrapper). Remove both entire blocks:

Block 1 — lines 161-213:
```liquid
{# REMOVE: Complete Your Collection upsell #}
      {% comment %} Upsell Section {% endcomment %}
      {%- if settings.cart_upsells_enabled != false -%}
        ... (entire upsell grid)
      {%- endif -%}
```

Block 2 — lines 215-249:
```liquid
{# REMOVE: Subscription Upsell #}
      {% comment %} Subscription Upsell {% endcomment %}
      {%- assign has_subscription = false -%}
      ... (entire subscription upsell prompt)
      {%- endunless -%}
```

### Commit Batch 2

- [ ] **Step 4:** Verify:

```bash
grep -n "product-share" sections/main-product.liquid
# Expected: no matches (or only CSS cleanup remnants)

grep -n "Complete Your Collection" snippets/cart-drawer.liquid
# Expected: no matches

grep -n "MONTHLY FRAGRANCE SUBSCRIPTION" snippets/cart-drawer.liquid
# Expected: no matches
```

- [ ] **Step 5:** Commit:

```bash
git add sections/main-product.liquid sections/footer.liquid snippets/cart-drawer.liquid
git commit -m "Batch 2: Remove social sharing, fix footer links, remove cart upsells

- Remove social sharing widget (no social accounts yet)
- Fix footer legal links with Shopify policy URL fallbacks
- Remove 'Complete Your Collection' upsell from cart drawer
- Remove 'Add Monthly Subscription' upsell from cart drawer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Batch 3 Prerequisite — Add Product Tags via Shopify Admin API

**Files:**
- No theme files modified — this is a Shopify Admin API operation

This task MUST complete before Task 4. Products need `season:X`, `event:Y`, and `origin:Z` tags for filters, cards, and seasonal recommendations to work.

- [ ] **Step 1:** Get all product IDs from the store:

```bash
shopify theme console --store base-note.myshopify.com <<'EOF'
products = ShopifyAPI::Product.all
products.each { |p| puts "#{p.id}: #{p.title} [#{p.tags}]" }
EOF
```

If the console command doesn't work, use the GraphQL Admin API approach. Create a script:

```bash
# Alternative: use the Shopify CLI to run a GraphQL query
# First, get the product list and their current tags
```

- [ ] **Step 2:** For each product, add the structured tags. This can be done via the Shopify Admin web UI at `https://base-note.myshopify.com/admin/products` or via CSV re-import with updated tags.

Tags to add per product (append to existing tags, do not replace):

| Product | Tags to Add |
|---------|-------------|
| Creed Aventus | `season:spring, season:fall, origin:france, event:office, event:date-night` |
| MFK Baccarat Rouge 540 | `season:fall, season:winter, origin:france, event:date-night, event:evening-out` |
| PdM Layton | `season:fall, season:winter, origin:france, event:date-night, event:evening-out` |
| Tom Ford Ombre Leather | `season:fall, season:winter, origin:usa, event:date-night, event:evening-out` |
| PdM Perseus | `season:spring, season:summer, origin:france, event:office, event:daytime` |
| Creed Green Irish Tweed | `season:spring, season:summer, origin:france, event:office, event:daytime` |
| Bond No 9 Lafayette St | `season:spring, season:summer, origin:usa, event:daytime, event:evening-out` |
| PdM Althair | `season:fall, season:winter, origin:france, event:evening-out, event:date-night` |
| PdM Pegasus | `season:spring, season:fall, origin:france, event:office, event:date-night` |

- [ ] **Step 3:** Verify tags were applied by checking a product:

```bash
# Verify via Shopify admin or theme console
# Each product should now have both its original tags AND the new structured tags
```

---

## Task 4: Batch 3 — Product Data & Filters (Items 3, 9, 15, 16, 17, 18)

**Files:**
- Modify: `snippets/product-card.liquid:173-178` (remove intensity dots)
- Modify: `snippets/product-card.liquid:182-183` (add origin below title)
- Modify: `sections/main-collection.liquid:128-192` (filter adjustments)
- Modify: `templates/cart.liquid:9-14` (remove quarterly/annual pricing variables)
- Modify: `templates/cart.liquid:149-178` (remove plan selector, replace with monthly display)
- Modify: `templates/cart.liquid` (add ship date + seasonal recs section)
- Modify: `templates/cart.liquid` (add cancellation policy to FTC disclosure)
- Modify: `sections/footer.liquid` (add cancellation policy text)
- Modify: `config/settings_data.json` (remove quarterly/annual pricing settings)

### Item 17: Remove intensity dots from product cards

- [ ] **Step 1:** In `snippets/product-card.liquid`, remove lines 173-178 (the intensity dots block):

```liquid
{# REMOVE this entire block #}
      {% comment %} Intensity Dots - Bottom Right {% endcomment %}
      <div class="product-card__intensity" title="Intensity: {{ intensity }}/5">
        {%- for i in (1..5) -%}
          <span class="product-card__intensity-dot{% if i <= intensity %} is-filled{% endif %}"></span>
        {%- endfor -%}
      </div>
```

Also remove the intensity variable assignment at lines 12-24 of `product-card.liquid` (the block that assigns `intensity` from `product.metafields.fragrance.intensity` or `intensity:N` tags with a default of 3). And search for any `.product-card__intensity` CSS styles in the file and remove them too.

### Item 16: Add country of origin to product cards

- [ ] **Step 2:** In `snippets/product-card.liquid`, after line 183 (the product title `<h3>`), add origin display. Insert after `<h3 class="product-card__title">{{ product.title }}</h3>`:

```liquid
      {%- assign origin_country = '' -%}
      {%- for tag in product.tags -%}
        {%- if tag contains 'origin:' -%}
          {%- assign origin_country = tag | split: ':' | last | strip -%}
        {%- endif -%}
      {%- endfor -%}
      {%- if origin_country != '' -%}
        <p class="product-card__origin">Made in {{ origin_country | capitalize }}</p>
      {%- endif -%}
```

Add CSS for the origin text (in the `<style>` block of `product-card.liquid` or in the existing styles area):

```css
.product-card__origin {
  font-size: 11px;
  color: var(--color-text-light, #888);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 2px 0 0;
}
```

### Item 3: Update collection filters

- [ ] **Step 3:** In `sections/main-collection.liquid`, the filters use Shopify's native `collection.filters` which auto-generates from product data. The structured `season:X` and `event:Y` tags added in Task 3 should create new filter groups automatically.

Check if there is any hardcoded intensity filter rendering. Search for "intensity" in the file:

```bash
grep -n -i "intensity" sections/main-collection.liquid
```

If there is a hardcoded intensity filter, remove it. The native `collection.filters` loop (lines 128-188) should handle the new season/event filters automatically.

If the Shopify Search & Discovery app is not installed or filters aren't showing, add manual tag-based filtering as a fallback. Add a custom filter section before the existing filter form:

```liquid
      {%- comment -%} Season Filter {%- endcomment -%}
      <details class="collection__filter-group" open>
        <summary class="collection__filter-heading">Season</summary>
        <div class="collection__filter-options">
          {%- for season in "spring,summer,fall,winter" | split: ',' -%}
            <label class="collection__filter-option">
              <input type="checkbox" name="tag" value="season:{{ season }}" class="collection__filter-input" data-filter-input>
              <span>{{ season | capitalize }}</span>
            </label>
          {%- endfor -%}
        </div>
      </details>
```

### Item 9: Simplify to monthly-only subscription

- [ ] **Step 4:** In `templates/cart.liquid`, remove the quarterly and annual pricing variable assignments at lines 9-14. Keep only the monthly variables:

```liquid
{# OLD (lines 9-14) #}
{%- assign monthly_price = settings.sub_plan_monthly_price | default: '$20' -%}
{%- assign monthly_per_mo = settings.sub_plan_monthly_per_month | default: '$20/mo' -%}
{%- assign quarterly_price = settings.sub_plan_quarterly_price | default: '$48' -%}
{%- assign quarterly_per_mo = settings.sub_plan_quarterly_per_month | default: '$16/mo' -%}
{%- assign annual_price = settings.sub_plan_annual_price | default: '$168' -%}
{%- assign annual_per_mo = settings.sub_plan_annual_per_month | default: '$14/mo' -%}

{# NEW — keep only monthly #}
{%- assign monthly_price = settings.sub_plan_monthly_price | default: '$20' -%}
{%- assign monthly_per_mo = settings.sub_plan_monthly_per_month | default: '$20/mo' -%}
```

- [ ] **Step 5:** In `templates/cart.liquid`, remove the entire plan selector section (the `<div class="plan-selector">` containing Monthly/Quarterly/Annual radio buttons, lines 149-178). Replace with a simple monthly subscription display:

```liquid
{# REMOVE: entire <div class="plan-selector"> block (lines 149-178) containing
   Monthly/Quarterly/Annual radio buttons and savings badges #}

{# NEW — simple monthly display #}
            <div class="plan-display">
              <p class="plan-display__label">Monthly Subscription &mdash; {{ monthly_per_mo }}</p>
            </div>
```

Add CSS for the plan display (in cart.liquid `<style>` block):

```css
.plan-display { padding: var(--spacing-sm) var(--spacing-md); background: var(--color-background-alt, #f9f9f7); border-radius: var(--radius-sm); margin: var(--spacing-sm) 0; }
.plan-display__label { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); margin: 0; }
```

- [ ] **Step 6:** In `config/settings_data.json`, remove the quarterly and annual pricing settings. Search for and update any pricing keys:

```bash
grep -n "subscription_price\|sub_plan" config/settings_data.json
```

Remove or zero-out all quarterly/annual keys:
- Remove `sub_plan_quarterly_price`, `sub_plan_quarterly_per_month`
- Remove `sub_plan_annual_price`, `sub_plan_annual_per_month`
- Remove old `subscription_price_quarterly`, `subscription_price_annual` keys
- Keep `sub_plan_monthly_price`: `$20` and `sub_plan_monthly_per_month`: `$20/mo`

### Item 18: Add cancellation policy language

- [ ] **Step 6b:** In `templates/cart.liquid`, find the FTC disclosure/terms checkbox area and add cancellation policy text. Insert the following after the existing FTC disclosure text:

```liquid
              <p class="cart-ftc__cancellation">
                Subscriptions renew monthly from your first purchase date. You will be notified 7 days before renewal. Cancellations on the renewal date take effect the following month.
              </p>
```

- [ ] **Step 6c:** In `sections/footer.liquid`, add a "Cancellations" link or inline cancellation policy text in the `footer__legal` div (alongside Privacy Policy, Terms of Service, etc.):

```liquid
{# Add after the existing legal links, inside the <div class="footer__legal"> #}
          <a href="#cancellation-policy" class="footer__cancellation-link">Cancellations</a>

{# And add the cancellation policy disclosure as a new element after the footer__legal div #}
        <div class="footer__cancellation-disclosure" id="cancellation-policy">
          <p>Subscriptions renew monthly from your first purchase date. You will be notified 7 days before renewal. Cancellations on the renewal date take effect the following month.</p>
        </div>
```

Add CSS for the cancellation disclosure:

```css
.footer__cancellation-disclosure { font-size: 11px; color: var(--color-text-light, #888); margin-top: var(--spacing-xs); max-width: 600px; }
.footer__cancellation-disclosure p { margin: 0; }
```

### Item 15: Add ship date, seasonal recs, and "View All" link

- [ ] **Step 7:** In `templates/cart.liquid`, add a ship date line inside the "Your Next Fragrance" section. Find the section header area (around lines 44-49) and add after the heading:

```liquid
              {%- assign current_day = 'now' | date: '%d' | plus: 0 -%}
              {%- if current_day <= 25 -%}
                {%- assign ship_date = 'now' | date: '%B 25, %Y' -%}
              {%- else -%}
                {%- assign next_month_ts = 'now' | date: '%s' | plus: 2592000 -%}
                {%- assign ship_date = next_month_ts | date: '%B 25, %Y' -%}
              {%- endif -%}
              <p class="cart-section__ship-date">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Expected ship date: <strong>{{ ship_date }}</strong>
              </p>
```

- [ ] **Step 8:** In `templates/cart.liquid`, add a seasonal recommendations section after the rotation list section (after line ~147). Insert before the plan selector:

```liquid
            {%- comment -%} Seasonal Recommendations {%- endcomment -%}
            {%- assign current_month = 'now' | date: '%m' | plus: 0 -%}
            {%- if current_month >= 3 and current_month <= 5 -%}
              {%- assign current_season = 'spring' -%}
              {%- assign season_label = 'Spring' -%}
              {%- assign season_months = 'Mar - May' -%}
            {%- elsif current_month >= 6 and current_month <= 8 -%}
              {%- assign current_season = 'summer' -%}
              {%- assign season_label = 'Summer' -%}
              {%- assign season_months = 'Jun - Aug' -%}
            {%- elsif current_month >= 9 and current_month <= 11 -%}
              {%- assign current_season = 'fall' -%}
              {%- assign season_label = 'Fall' -%}
              {%- assign season_months = 'Sep - Nov' -%}
            {%- else -%}
              {%- assign current_season = 'winter' -%}
              {%- assign season_label = 'Winter' -%}
              {%- assign season_months = 'Dec - Feb' -%}
            {%- endif -%}

            <div class="cart-seasonal">
              <h3 class="cart-seasonal__heading">{{ season_label }} Picks ({{ season_months }})</h3>
              <div class="cart-seasonal__grid">
                {%- assign season_tag = 'season:' | append: current_season -%}
                {%- assign seasonal_count = 0 -%}
                {%- for product in collections.all.products limit: 20 -%}
                  {%- if product.tags contains season_tag and seasonal_count < 3 -%}
                    {%- assign in_cart = false -%}
                    {%- for item in cart.items -%}
                      {%- if item.product.id == product.id -%}
                        {%- assign in_cart = true -%}
                        {%- break -%}
                      {%- endif -%}
                    {%- endfor -%}
                    {%- unless in_cart -%}
                      <a href="{{ product.url }}" class="cart-seasonal__item">
                        {%- if product.featured_image -%}
                          <img src="{{ product.featured_image | image_url: width: 80 }}" alt="{{ product.title }}" loading="lazy">
                        {%- endif -%}
                        <span>{{ product.title | truncate: 25 }}</span>
                      </a>
                      {%- assign seasonal_count = seasonal_count | plus: 1 -%}
                    {%- endunless -%}
                  {%- endif -%}
                {%- endfor -%}
              </div>
              <a href="/collections/all" class="cart-seasonal__view-all">View All Fragrances &rarr;</a>
            </div>
```

Add CSS for the seasonal section (in cart.liquid `<style>` block or at the end):

```css
.cart-seasonal { margin: var(--spacing-md) 0; padding: var(--spacing-md); background: var(--color-background-alt, #f9f9f7); border-radius: var(--radius-md); }
.cart-seasonal__heading { font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--spacing-sm); }
.cart-seasonal__grid { display: flex; gap: var(--spacing-sm); overflow-x: auto; }
.cart-seasonal__item { display: flex; flex-direction: column; align-items: center; gap: 4px; text-decoration: none; color: inherit; font-size: 12px; min-width: 80px; }
.cart-seasonal__item img { width: 60px; height: 60px; object-fit: cover; border-radius: var(--radius-sm); }
.cart-seasonal__view-all { display: block; text-align: center; margin-top: var(--spacing-sm); font-size: var(--font-size-sm); color: var(--color-secondary, #d4af37); text-decoration: none; }
.cart-section__ship-date { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); color: var(--color-text-light); margin: var(--spacing-xs) 0; }
```

### Commit Batch 3

- [ ] **Step 9:** Verify:

```bash
grep -n "intensity" snippets/product-card.liquid
# Expected: no matches for intensity dots rendering

grep -n "origin:" snippets/product-card.liquid
# Expected: matches showing the new origin tag display

grep -n "plan-selector\|quarterly\|annual" templates/cart.liquid
# Expected: no matches (plan selector removed, no quarterly/annual references)

grep -n "plan-display" templates/cart.liquid
# Expected: matches showing the new simple monthly display

grep -n "seasonal" templates/cart.liquid
# Expected: matches showing the new seasonal section

grep -n "cancellation" templates/cart.liquid sections/footer.liquid
# Expected: matches in both files showing cancellation policy text
```

- [ ] **Step 10:** Commit:

```bash
git add snippets/product-card.liquid sections/main-collection.liquid templates/cart.liquid sections/footer.liquid config/settings_data.json
git commit -m "Batch 3: Update product cards, filters, simplify to monthly subscription, add cancellation policy

- Remove intensity dots from product cards
- Add 'Made in [Country]' origin display on product cards
- Simplify subscription to monthly-only ($20/mo) — remove quarterly and annual plans
- Replace plan selector with simple monthly subscription display
- Add cancellation policy to cart FTC disclosure and footer
- Add expected ship date to cart
- Add seasonal fragrance recommendations to cart
- Add 'View All Fragrances' link

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Batch 4 — Mobile & Checkout Fixes (Items 6, 7, 8, 13, 14)

**Files:**
- Modify: `sections/header.liquid:633-649` (mobile header CSS)
- Modify: `sections/main-product.liquid:280-326` (remove one-time purchase option)
- Investigate: Shopify admin (mobile checkout, subscription display, free trials)

### Item 6: Fix mobile cart icon cutoff

- [ ] **Step 1:** In `sections/header.liquid`, update the mobile CSS (around lines 633-649). The current styles already attempt to fix this with `gap: 0` and `margin-right: -4px`. The issue is likely the header container having `overflow: hidden` or the logo/nav taking too much space. Update the mobile media query:

```css
/* Find the existing @media (max-width: 768px) block and replace */
  @media (max-width: 768px) {
    .header__actions {
      gap: 0;
      margin-right: 0;
      flex-shrink: 0;
    }

    .header__action-btn {
      width: 36px;
      height: 36px;
      padding: 0;
    }

    .header__action-btn svg {
      width: 18px;
      height: 18px;
    }

    .header .container {
      padding-left: 8px;
      padding-right: 8px;
    }
  }
```

Also check if the header's `.container` or `.header` element has `overflow: hidden`. If so, change to `overflow: visible`:

```bash
grep -n "overflow" sections/header.liquid
```

### Item 7: Remove one-time purchase option (subscription-only)

- [ ] **Step 2:** In `sections/main-product.liquid`, find the native selling plan selector (around lines 284-316). Remove the "One-time purchase" radio option (lines 289-295). Keep only the monthly subscription plan option:

```liquid
{# REMOVE: the "One-time purchase" radio button (lines 289-295) #}
{# This block renders a radio for "One-time purchase" with value="" #}
              <label class="selling-plan-option">
                <input type="radio" name="selling_plan" value="" checked>
                <span>One-time purchase</span>
              </label>
```

Ensure the monthly subscription radio is pre-selected (add `checked` attribute if not present). Since there is no one-time purchase option, the subscription plan should always be selected.

- [ ] **Step 3:** Ensure the Add to Cart button always says "Add to My Queue" (never "Add to Cart"). In `sections/main-product.liquid`, find the button text and hardcode it:

```liquid
{# Ensure the button always says "Add to My Queue" #}
<span id="addToCartText">Add to My Queue</span>
```

In `assets/theme.js`, remove or simplify the selling plan change handler that toggles between "Add to Cart" and "Add to My Queue". Since subscription is the only option, the button text should be static:

```javascript
// Remove the selling plan radio change handler that toggles button text
// The button should always say "Add to My Queue" since all products are subscription-only
```

### Items 8, 13, 14: Investigation tasks

- [ ] **Step 4:** **Item 8 — Mobile checkout:** Test the checkout flow. Shopify checkout is hosted and not controlled by theme code. Check:
  1. Open `https://basenotescent.com` on mobile (or use Chrome DevTools mobile emulation)
  2. Add a product to cart
  3. Proceed to checkout
  4. Check browser console for JS errors
  5. If checkout fails, the issue is likely in Shopify Payments configuration (Settings > Payments in Shopify admin), not theme code

Document findings and flag to Wilson if it's an admin config issue.

- [ ] **Step 5:** **Item 13 — Subscription not showing:** Check if Appstle is properly integrated:

```bash
grep -n "appstle" sections/main-product.liquid assets/theme.js config/settings_data.json
```

Check if the Appstle subscription widget container at `main-product.liquid:281` is rendering. The issue may be that the Appstle app isn't installed or configured. Flag to Wilson if it requires Appstle app configuration.

- [ ] **Step 6:** **Item 14 — Free trials:** This requires a business decision. Document the three options for Wilson/Jeff:
  - Option A: Create a `$0` "Free Trial" variant on select products
  - Option B: Create an automatic discount code for first-time subscribers
  - Option C: Create separate "Trial" product listings at $0

No theme changes needed for any option — this is Shopify admin configuration.

### Commit Batch 4

- [ ] **Step 7:** Commit the code changes (Items 6 and 7):

```bash
git add sections/header.liquid sections/main-product.liquid assets/theme.js
git commit -m "Batch 4: Fix mobile cart icon, remove one-time purchase option

- Reduce mobile header button sizes and padding to prevent cart cutoff
- Remove one-time purchase radio from selling plan selector (subscription-only)
- Hardcode button text to 'Add to My Queue' (no more 'Add to Cart')
- Remove selling plan toggle JS handler (no longer needed)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final Verification & Push

- [ ] **Step 1:** Run a full grep to verify all 17 items are addressed:

```bash
echo "=== Item 1: Spray count ==="
grep -rn "30 sprays" sections/ templates/ snippets/
echo "(should show 0 matches for '30 sprays')"

echo "=== Item 2: Free shipping bar ==="
grep -rn "free_shipping_threshold" snippets/cart-drawer.liquid
echo "(should show 0 matches)"

echo "=== Item 4: Social sharing ==="
grep -rn "product-share" sections/main-product.liquid
echo "(should show 0 matches)"

echo "=== Item 11: Cart upsells ==="
grep -rn "Complete Your Collection" snippets/cart-drawer.liquid
echo "(should show 0 matches)"

echo "=== Item 12: 30-day satisfaction ==="
grep -rn "30-day satisfaction" templates/cart.liquid
echo "(should show 0 matches)"

echo "=== Item 17: Intensity dots ==="
grep -rn "intensity-dot\|intensity.*filled" snippets/product-card.liquid
echo "(should show 0 matches)"

echo "=== New features ==="
grep -rn "origin:" snippets/product-card.liquid
grep -rn "cart-seasonal" templates/cart.liquid
grep -rn "ship-date" templates/cart.liquid
echo "(should show matches for each)"
```

- [ ] **Step 2:** Preview the theme:

```bash
shopify theme dev --store base-note.myshopify.com --theme 158692901082
```

Open the preview URL and check:
1. Product page: ~45 sprays, no social sharing, retail value comparison
2. Collection page: Season/event filters (if tags were added), no intensity dots
3. Product cards: "Made in France/USA" shown, season icons visible
4. Cart drawer: No shipping bar, no upsells
5. Cart page: Monthly-only subscription ($20/mo), no plan selector, ship date, seasonal recs, 3 perks (no 30-day guarantee), cancellation policy in FTC disclosure
6. Footer: All 4 legal links work, cancellation policy text visible
7. Mobile: Cart icon visible in header
8. Product page: No one-time purchase option, button says "Add to My Queue"

- [ ] **Step 3:** Push to live theme:

```bash
shopify theme push --store base-note.myshopify.com --theme 158692901082
```

- [ ] **Step 4:** Update MEMORY.md pricing:

Update the subscription pricing in MEMORY.md from "Plans: Monthly ($20), Quarterly ($48), Annual ($168)" to "Plans: Monthly only ($20/mo). No quarterly or annual options. No one-time purchase." Also add: "Cancellation policy: cancellations on renewal date take effect the following month. Renewal notification: 7 days before via Klaviyo."

---

## Items Requiring Manual Action (Not Code)

These items need Wilson or Jeff to handle in Shopify admin:

| Item | Action | Who |
|------|--------|-----|
| 8 | Check Shopify Payments configuration for mobile | Wilson |
| 13 | Verify Appstle subscription app is installed and configured | Wilson |
| 14 | Decide on free trial mechanism (discount code vs $0 variant) | Wilson + Jeff |
| 3 (partial) | Verify Search & Discovery app is installed for tag-based filtering | Wilson |
| Tags | If API approach fails, manually add tags to 9 products in Shopify admin | Wilson |
| Klaviyo | Configure 7-day pre-renewal notification email flow in Klaviyo, triggered by Appstle subscription events | Wilson |
| Appstle | Remove quarterly and annual selling plans from Appstle subscription settings (keep monthly only) | Wilson |
