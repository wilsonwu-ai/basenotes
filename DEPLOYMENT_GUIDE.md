# Basenotes - Shopify Theme Deployment Guide

A premium fragrance subscription theme inspired by Scentbird, built for Shopify 2.0.

## Quick Start

### Option 1: Upload via Shopify Admin (Recommended)

1. **Zip the theme folder:**
   ```bash
   cd /Users/wilsonwu/Desktop/basenotes
   zip -r basenotes-theme.zip basenotes-theme
   ```

2. **Upload to Shopify:**
   - Go to your Shopify Admin → Online Store → Themes
   - Click "Add theme" → "Upload zip file"
   - Select `basenotes-theme.zip`
   - Click "Customize" to preview and edit

### Option 2: Using Shopify CLI

1. **Install Shopify CLI:**
   ```bash
   npm install -g @shopify/cli @shopify/theme
   ```

2. **Authenticate with your store:**
   ```bash
   shopify auth login --store your-store.myshopify.com
   ```

3. **Deploy the theme:**
   ```bash
   cd /Users/wilsonwu/Desktop/basenotes/basenotes-theme
   shopify theme push
   ```

4. **For live development:**
   ```bash
   shopify theme dev
   ```

---

## Post-Deployment Setup

### 1. Create Navigation Menus

Go to **Online Store → Navigation** and create:

**Main Menu:**
- Collection (link to /collections/all)
- How It Works (#how-it-works)
- Subscribe (#subscribe)
- Quiz (/pages/quiz)
- About (/pages/about)

**Footer Menus:**
- Shop Menu: All Fragrances, New Arrivals, Bestsellers
- Support Menu: FAQ, Shipping & Returns, Contact
- Company Menu: About, Careers, Press

### 2. Create Products (Your 10 Fragrances)

For each fragrance, add:
- **Title:** Fragrance name
- **Vendor:** Brand/house name
- **Description:** Rich description of the scent
- **Tags:** Add scent family tags (woody, oriental, floral, etc.)

**Recommended Metafields** (create in Settings → Metafields → Products):
- `custom.top_notes` (Single line text)
- `custom.heart_notes` (Single line text)
- `custom.base_notes` (Single line text)
- `custom.fragrance_notes` (Single line text - comma-separated)

### 3. Create Collections

- **All Fragrances** - Main collection with all 10 scents
- **New Arrivals** - For latest additions
- **Bestsellers** - For popular choices

### 4. Create Required Pages

Go to **Online Store → Pages**:

1. **Quiz Page:**
   - Title: Find Your Scent
   - Template: page.quiz

2. **About Page:**
   - Title: About Basenotes
   - Template: page (default)

3. **FAQ Page:**
   - Title: Frequently Asked Questions

4. **Terms of Service**
5. **Privacy Policy**

### 5. Configure Theme Settings

Go to **Online Store → Themes → Customize**:

1. **Theme Settings (gear icon):**
   - Set your brand colors (gold accent: #d4af37)
   - Configure subscription prices
   - Add social media links

2. **Homepage Sections:**
   - Hero: Add your background image/video
   - Featured Collection: Select your fragrance collection
   - Subscription Plans: Configure pricing and features
   - Testimonials: Add real customer reviews

3. **Header:**
   - Upload your logo
   - Select main menu

4. **Footer:**
   - Add tagline
   - Select footer menus
   - Add social links

### 6. Set Up Subscription (CRITICAL)

Shopify doesn't natively support subscriptions. Install one of these apps:

**Recommended Apps:**
1. **Recharge Subscriptions** - Most popular, robust features
2. **Bold Subscriptions** - Good alternative
3. **Seal Subscriptions** - Budget-friendly option

After installing:
- Create subscription selling plans (Monthly, Quarterly, Annual)
- Attach plans to your products
- Configure customer portal within the app

### 7. Configure Customer Accounts

Go to **Settings → Customer accounts:**
- Enable "Accounts are optional" or "Accounts are required"
- Enable customer login

### 8. Add Hero Images

Upload high-quality images for:
- Hero section background (2000x1200px recommended)
- Product images (800x1000px, 3:4 ratio)
- Collection images

**Free Stock Photo Sources:**
- Unsplash (search "perfume", "luxury fragrance")
- Pexels

---

## Theme Structure

```
basenotes-theme/
├── assets/
│   ├── base.css              # Core styles & utilities
│   ├── component-variables.css # Component-specific styles
│   └── theme.js              # JavaScript functionality
├── config/
│   ├── settings_schema.json  # Theme settings definition
│   └── settings_data.json    # Default settings values
├── layout/
│   └── theme.liquid          # Main layout wrapper
├── locales/
│   └── en.default.json       # English translations
├── sections/
│   ├── header.liquid         # Header navigation
│   ├── footer.liquid         # Footer with links
│   ├── hero.liquid           # Homepage hero banner
│   ├── featured-collection.liquid  # Product grid
│   ├── how-it-works.liquid   # Process steps
│   ├── subscription-plans.liquid   # Pricing cards
│   ├── testimonials.liquid   # Customer reviews
│   ├── newsletter.liquid     # Email signup
│   ├── scent-quiz.liquid     # Personalization quiz
│   ├── main-product.liquid   # Product page
│   └── main-collection.liquid # Collection page
├── snippets/
│   ├── product-card.liquid   # Reusable product card
│   ├── cart-drawer.liquid    # Slide-out cart
│   └── meta-tags.liquid      # SEO meta tags
└── templates/
    ├── index.json            # Homepage layout
    ├── product.json          # Product page layout
    ├── collection.json       # Collection page layout
    ├── page.liquid           # Default page
    ├── page.quiz.liquid      # Quiz page template
    ├── cart.liquid           # Cart page
    ├── 404.liquid            # Not found page
    └── customers/
        ├── login.liquid      # Customer login
        ├── register.liquid   # Account creation
        ├── account.liquid    # Account dashboard
        ├── addresses.liquid  # Address management
        └── order.liquid      # Order details
```

---

## Customization Tips

### Changing Colors
Edit `assets/base.css` CSS variables:
```css
:root {
  --color-primary: #1a1a1a;      /* Main dark color */
  --color-secondary: #c9a86c;    /* Gold accent */
  --color-accent: #d4af37;       /* Bright gold */
}
```

### Adding New Sections
1. Create a new `.liquid` file in `/sections`
2. Add a `{% schema %}` block at the bottom
3. Add `"presets"` to make it available in the customizer

### Modifying the Quiz
Edit `sections/scent-quiz.liquid`:
- Change questions in the HTML
- Update profile results in the JavaScript
- Connect to your actual products

---

## Support

For theme customization help:
- Shopify Theme Documentation: https://shopify.dev/themes
- Liquid Reference: https://shopify.dev/docs/api/liquid

---

## License

This theme was custom-built for Basenotes. All rights reserved.
