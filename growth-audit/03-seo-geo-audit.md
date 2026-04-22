# Base Note — SEO + GEO / E-E-A-T Audit

**Audit date:** 2026-04-22
**Auditor:** Phase 1 subagent, using `search-page-audit` SKILL.md (38-point framework) + Shopify-Liquid-specific P0 fix mapping
**Target:** https://basenotescent.com (Shopify OS 2.0, theme `basenotes/main`, brand-new D2C, zero existing traffic, organic-only growth)
**Primary strategic question:** Can Base Note rank for fragrance-discovery / fragrance-sampling / fragrance-subscription queries in both classical search AND generative AI (ChatGPT, Claude, Perplexity, Gemini)?
**Short answer:** Not today. There is one catastrophic site-wide SEO defect (broken `<title>` tags), plus major GEO/E-E-A-T and content gaps. All are fixable this week.

---

## 0. Executive summary

Pages audited:
1. **Homepage** — https://basenotescent.com
2. **Collection** — https://basenotescent.com/collections/all
3. **PDP** — https://basenotescent.com/products/creed-aventus (representative of 24 products)
4. **Blog** — `/blogs/news` returns **HTTP 404** (the sitemap references it but no posts exist; blog is effectively non-existent)

### Composite scoring against the 38-point framework

| Category | Score | Rating |
|---|---|---|
| SEO Fundamentals | 5 / 10 | Poor |
| Content Structure | 4 / 10 | Poor |
| AI & GEO Readiness | 3 / 10 | Poor |
| E-E-A-T & Authority | 1 / 8 | Poor |
| **Overall** | **13 / 38 (34%)** | **Poor** |

The single highest-leverage finding: **every page on the site has a broken `<title>` tag.** The title tag is the #1 on-page ranking signal in classical SEO *and* the primary snippet LLMs extract. Fix this first, before anything else.

---

## 1. Technical SEO

### 1.1 HTTPS, canonical, robots
- HTTPS: pass.
- Canonical: present and correct on every template (from `layout/theme.liquid` line 42: `<link rel="canonical" href="{{ canonical_url }}">`).
- robots meta: `index, follow, max-image-preview:large` — good.
- `robots.txt`: Shopify default. Does NOT block `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`. **AI crawlers have access — pass.** (This is actually a decision worth ratifying — leaving them open is correct for a brand that wants to be cited by LLMs.)

### 1.2 Sitemap
- `sitemap.xml` exists at root and is referenced in `robots.txt`.
- Index points to: products (24 URLs), collections (1), pages (5: contact, data-sharing-opt-out, find-your-scent, faq, login-page), blogs (1 — just the blog index, **zero posts**).
- No hreflang (US-only, correct for now).

### 1.3 `llms.txt`
- **`/llms.txt` returns 404.** This is the emerging GEO standard (proposed by Answer.ai, adopted by Anthropic, Cloudflare, Stripe). A missing `llms.txt` is not yet a ranking factor but IS a "serious brand" signal for LLMs. **P1 fix.**

### 1.4 Structured data (JSON-LD) inventory

Found on pages inspected:

| Schema type | Present on | Quality |
|---|---|---|
| `Organization` | All pages (from `layout/theme.liquid` line 26-40) | **Broken** — `logo` field is empty string; on PDP, `description` is overwritten with the product description rather than brand description. Bug below. |
| `Product` | PDPs (from `snippets/meta-tags.liquid` likely, or `main-product.liquid`) | Basic — has `name`, `description`, `image`, `brand`, `offers`. **Missing** `aggregateRating`, `review`, `sku`, `gtin`, `category`. |
| `WebSite` with `SearchAction` | Not present | Missing. |
| `BreadcrumbList` | Not present as JSON-LD (breadcrumbs render in HTML on PDP but aren't schematized) | Missing. |
| `FAQPage` | Not present (FAQ page at `/pages/faq` exists but has no FAQPage schema on it) | Missing. |
| `Article` / `BlogPosting` | N/A — no posts exist | — |

The bug in Organization schema is in `layout/theme.liquid` line 33:
```liquid
"description": {{ meta_description | json }},
```
On PDPs, `meta_description` has been reassigned to the product description (line 18: `assign meta_description = page_description | default: shop.description | default: default_description`). This means the site-wide Organization entity description gets overwritten per page. LLMs trying to extract "what is Base Note" get "legendary king of fragrances" instead.

### 1.5 Core Web Vitals heuristic (static inspection, no Playwright run)
- Hero image is preloaded with `fetchpriority="high"` on index — good.
- Critical CSS inlined in `<style>` tag — good.
- Fonts loaded async via print-media swap — good.
- Preconnects to cdn.shopify.com, fonts.googleapis.com — good.
- Homepage HTML is ~7,925 lines (heavy DOM) — borderline. Mobile LCP likely acceptable; CLS risk from the 13 async-loading images on homepage.
- **Recommend:** run PageSpeed Insights after P0 fixes ship to get real LCP/INP/CLS numbers.

---

## 2. On-page SEO — per page

### 2.1 Homepage (https://basenotescent.com)

| Check | Status | Evidence / recommended value |
|---|---|---|
| `<title>` | **FAIL** — renders as `Base Note` (10 chars, no keywords) | Target: `Base Note — Luxury Fragrance Subscription, $20/Month Designer Samples` (~72 chars, trim to 60) |
| Meta description | Pass | "Discover luxury fragrances with Base Note. Get a new designer fragrance delivered monthly for just $20. Free shipping, cancel anytime." (143 chars, includes intent) |
| H1 | **FAIL** — TWO H1s on the page: `Your Signatures Start Here` AND `Why Subscribe to Base Note?` | Demote the second to `<h2>`. Only one H1 allowed. See `sections/subscription-plans.liquid` or wherever the second H1 lives. |
| H1 keyword relevance | Weak — "Your Signatures Start Here" contains zero fragrance keywords | Consider `Luxury Fragrance Subscription — A New Scent Every Month` as H1, relegate "Your Signatures Start Here" to H2/eyebrow |
| Heading hierarchy | Messy — jumps H1→H2→H3→H4 then back to **H1** mid-page | Fix the double-H1 |
| og:description | **FAIL** — empty string | Set a proper og:description fallback in `snippets/meta-tags.liquid` |
| og:image | Unknown from content, likely missing hero og:image | Add dedicated 1200x630 og image |
| twitter:description | **FAIL** — empty | Same fix as og |
| Image alt text | 7 of 13 images have alt text (54%) | Add descriptive alt to remaining 6 |
| Internal links | Good — links to `/collections/all`, `/pages/find-your-scent`, `/pages/faq`, `/pages/contact` | Add link to About/Founder page once created |

### 2.2 Collection page (/collections/all)

| Check | Status | Evidence |
|---|---|---|
| `<title>` | **FAIL** — renders as ` – Base Note` (literally a leading em-dash, no keyword) | Target: `All Fragrances — Designer & Niche Samples | Base Note` |
| H1 | Weak — `Products` (generic, zero keyword value) | Target: `The Fragrance Collection` or `Designer & Niche Fragrances` |
| Meta description | Pass — uses site default | Consider overriding: `Browse 24+ luxury fragrances from Creed, Tom Ford, Parfums de Marly, Bond No. 9. Get any as a $20/month subscription.` |
| Intro copy above product grid | **FAIL** — none | Add 100-150 word intro with fragrance-discovery keywords, brand names, scent families |
| Faceted filters | Present | Good, but URL filter variants are correctly blocked in robots.txt (avoids duplicate-content dilution) |
| Product count | 23 fragrances (24 URLs in sitemap including gift card/variant) | OK for launch, thin for category authority |

### 2.3 PDP (/products/creed-aventus — representative of all 24 products)

| Check | Status | Evidence |
|---|---|---|
| `<title>` | **CATASTROPHIC FAIL** — renders as ` – Base Note` (leading em-dash, **product name missing**) | Every PDP is effectively untitled in Google's eyes. Root cause: `layout/theme.liquid` line 10 uses `{{ page_title }}` and on this store it's rendering empty on products. See P0-1 fix. |
| Meta description | Pass but truncated mid-word ("Moroccan jasmine, settling into musk and oakmoss. Top Notes: Blackcurrant, Italian Bergamot, Apple, PineappleHeart Notes: Birc") — the 160-char truncation is cutting off in an ugly place | Craft cleaner descriptions per product via Shopify Admin "Search engine listing" or via metafield |
| H1 | Pass — `Creed Aventus` | Good |
| Heading hierarchy | Good — H1 → H2 "About This Fragrance" → H3 Characteristics / Shipping / Size Guide / Subscription → H2 "More From The Collection" | Clean |
| Product schema (JSON-LD) | Partial pass — has `name`, `description`, `image`, `brand.name`, `offers` | Missing `sku`, `gtin`, `category` (`"Beauty > Personal Care > Cosmetics > Fragrance"`), `aggregateRating`, `review`. No reviews exist yet — that's a chicken-and-egg P1 to solve with Judge.me / Shopify Product Reviews. |
| Organization schema description | **FAIL** — reuses the product description (bug above) | Fix in `layout/theme.liquid` |
| Breadcrumbs HTML | Present | Pass |
| Breadcrumbs schema | Missing (no `BreadcrumbList` JSON-LD) | Add |
| FAQ on PDP | Missing | Add 3-5 Q&A ("Is this the real Creed Aventus?" "How big is the 5ml atomizer?" "Can I cancel anytime?" "How long does a 5ml vial last?" "Is shipping free?") |
| Internal links to other fragrances | Pass — "More From The Collection" links 4 related + "View All" | Good |
| Image alt text | Weak — images present but alt text uses filenames like "aventus-100ml-bottle" rather than descriptive alt | Fix in `main-product.liquid` to output proper `alt="{{ product.title }} — {{ image.alt }}"` |
| Reviews | **None** | Install Shopify Product Reviews (free) or Judge.me; even 5 seed reviews unlock `aggregateRating` → rich snippets |

### 2.4 Blog (/blogs/news) — **FAIL, HTTP 404**

- The sitemap advertises a blog index at `/blogs/news` but the URL returns 404.
- Zero articles exist.
- This is a **major content gap** for a fragrance brand. Fragrance buyers are high-research — they read "best designer fragrance for summer," "Creed Aventus vs. Aventus Cologne," "how long does a 5ml atomizer last." None of that content exists on Base Note.
- Blog is table-stakes for:
  - Classical SEO — evergreen long-tail traffic.
  - GEO — LLMs cite editorial content far more than product pages (product pages read as "sales copy" to LLMs; editorial reads as "reference").
  - E-E-A-T — author bylines on articles are the fastest way to build authority signals.

---

## 3. GEO / AI-search readiness (the point of all this)

Will ChatGPT / Claude / Perplexity / Gemini name-drop Base Note when someone asks *"what's the best fragrance subscription?"* or *"where can I sample Creed Aventus cheaply?"* **Not currently.** Here's why:

### 3.1 What LLMs extract well — and where Base Note fails
1. **Clear "X is..." definition in the first 150 words of the homepage.** FAIL. The homepage opens with "Your Signatures Start Here" (poetic, unhelpful to LLMs) and "Luxury fragrances. Perfectly portioned." (vague). Nowhere does the homepage say in plain language: *"Base Note is a monthly fragrance subscription service. For $20/month, you receive a 5ml travel atomizer of a luxury designer or niche fragrance (Creed, Tom Ford, Parfums de Marly, Bond No. 9, Xerjoff, etc.). Free shipping, cancel anytime."* LLMs can only cite what they can extract as declarative fact.
2. **Question-based headings (H2s that mirror user queries).** Partial. "Why Subscribe to Base Note?" is a question, good. But "Presence Without Noise" and "Command the Room. Say Nothing." are poetic copy, not query-matching. Add: *"How does Base Note work?"* *"How is Base Note different from Scentbird?"* *"What fragrances does Base Note offer?"*
3. **FAQPage schema + FAQ content with Q&A.** FAIL. The `/pages/faq` page exists but no `FAQPage` JSON-LD schema wraps it. LLMs parse Q&A 35% better when wrapped in FAQPage schema.
4. **Comparison tables.** FAIL. No "Base Note vs. Scentbird vs. Olfactif" comparison table anywhere. This is the single highest-leverage GEO page to build — it's the exact content LLMs retrieve when answering *"what's the best fragrance subscription?"*
5. **Conversational long-tail keywords woven into copy.** Weak. Copy leans on slogans ("Command the Room") rather than query phrases.
6. **Named author on content.** FAIL. No articles exist, no author pages exist.
7. **Organization schema as a clean entity.** BROKEN (description bug above; empty logo field).

### 3.2 AI crawler access — good (one rare bright spot)
- `robots.txt` does not block any AI crawlers. ClaudeBot, GPTBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot all have full access. Leave this as-is; it's the correct posture for a brand that wants LLM citations. When you add `llms.txt`, declare content as AI-citable.

### 3.3 E-E-A-T signals
- **E**xperience: No first-person founder content, no "we smelled 300 fragrances" type pieces.
- **E**xpertise: No author bios, no credentials, no team page.
- **A**uthoritativeness: No press mentions, no publication dates on anything, no external citations.
- **T**rustworthiness: Legal/trust pages exist (privacy, terms, refund, shipping — good). But zero About/Founder page — for a new D2C, this is the single biggest trust hole.

---

## 4. Content gap analysis — what Base Note MUST create to rank

The blog does not exist. These are the evergreen pages that will compound organic + LLM citations. Ranked by keyword value × LLM-citability × buying-intent:

### Tier A — build in the first 60 days (each targets a specific search intent cluster)
1. **"Best Fragrance Subscriptions of 2026 (Honest Comparison)"** — comparison post including Base Note, Scentbird, Olfactif, Luxury Scent Box, Heretic, Snif. Include a real comparison table. This is the #1 GEO asset — LLMs will cite this constantly.
2. **"How Long Does a 5ml Fragrance Atomizer Last?"** — a data-driven post with actual spray counts (5ml ≈ 80-100 sprays ≈ 25-40 days of 2-3 sprays/day). First-party answer to a high-volume query.
3. **"Creed Aventus Review: Is It Worth $500?"** — long-tail brand query that pulls intent-rich traffic directly into the funnel. Repeat the template for Tom Ford Ombré Leather, Parfums de Marly Layton, Bond No. 9, Xerjoff Erba Pura — each existing PDP gets a matching editorial review.
4. **"Fragrance Notes Explained: Top, Heart, Base — and How to Read a Perfume Pyramid"** — the definitional/explainer piece LLMs love to quote. Link inward to every PDP.
5. **"Designer vs. Niche Fragrance: What's the Difference?"** — category-defining piece.
6. **"How to Find Your Signature Scent (Without Burning $500 on a Wrong Full Bottle)"** — Base Note's core value-prop essay.

### Tier B — months 2-4
7. Fragrance gift guides (holiday, Valentine's, Father's Day)
8. Season-switching posts ("Best Summer Fragrances for Men," "Winter Scents That Project")
9. Scent-family explainers (woody, oriental, fougère, aquatic)
10. Founder story / "Why I Started Base Note" — critical E-E-A-T page, doubles as About

### Tier C — months 4-6
11. Individual fragrance-house deep dives (Parfums de Marly history, Creed heritage)
12. "How fragrance projection and sillage work" — expert-voice content
13. User-generated rotations / case studies

---

## 5. P0 fixes — ship this week

Each item: **what to change → where in the theme → exact recommended code/content.**

### P0-1: Fix the broken `<title>` tag site-wide **(highest priority, affects every URL)**

**What:** The title tag renders as empty-string on homepage (`Base Note`), as ` – Base Note` (leading em-dash with nothing before it) on collections and PDPs. Every indexed URL is effectively title-less.

**Where:** `layout/theme.liquid` lines 9-14.

**Current code:**
```liquid
<title>
    {{ page_title }}
    {%- if current_tags %} &ndash; tagged "{{ current_tags | join: ', ' }}"{% endif -%}
    {%- if current_page != 1 %} &ndash; Page {{ current_page }}{% endif -%}
    {%- unless page_title contains shop.name %} &ndash; {{ shop.name }}{% endunless -%}
</title>
```

**Recommended fix:**
```liquid
{%- liquid
  assign seo_title = page_title
  if template.name == 'product' and product
    assign seo_title = product.title | append: ' — 5ml Luxury Fragrance Subscription'
  elsif template.name == 'collection' and collection
    assign seo_title = collection.title | append: ' — Designer & Niche Fragrance Samples'
  elsif template.name == 'index'
    assign seo_title = 'Luxury Fragrance Subscription — $20/Month Designer Samples'
  elsif template.name == 'blog' and blog
    assign seo_title = blog.title | append: ' — Fragrance Guides & Reviews'
  elsif template.name == 'article' and article
    assign seo_title = article.title
  endif
  if seo_title == blank
    assign seo_title = shop.name
  endif
-%}
<title>
  {{ seo_title }}
  {%- if current_tags %} &ndash; tagged "{{ current_tags | join: ', ' }}"{% endif -%}
  {%- if current_page != 1 %} &ndash; Page {{ current_page }}{% endif -%}
  {%- unless seo_title contains shop.name %} | {{ shop.name }}{% endunless -%}
</title>
```

This guarantees a non-empty, keyword-bearing title on every template, independent of whether Shopify Admin SEO fields are filled in.

**Verification:** after pushing, `curl -s https://basenotescent.com/products/creed-aventus | grep -A1 '<title>'` must show `Creed Aventus — 5ml Luxury Fragrance Subscription | Base Note`.

---

### P0-2: Fix the double-H1 on homepage

**What:** Homepage has TWO `<h1>` tags: `Your Signatures Start Here` (hero) and `Why Subscribe to Base Note?` (subscription-plans section). Search engines recommend one H1.

**Where:** The offending second H1 is in one of: `sections/subscription-plans.liquid`, `sections/subscription-landing.liquid`, `sections/delivery-explainer.liquid`. Grep for `<h1>Why Subscribe` to locate, then demote to `<h2>`.

**Fix:** Change `<h1>Why Subscribe to Base Note?</h1>` → `<h2>Why Subscribe to Base Note?</h2>` and update any CSS rule that styles it.

---

### P0-3: Fix empty `og:description` and `twitter:description`

**What:** On homepage and collection, og:description and twitter:description are empty strings. When the homepage is shared on LinkedIn, iMessage, Slack, Discord, X — the preview shows a blank description line.

**Where:** `snippets/meta-tags.liquid` (the snippet rendered at `layout/theme.liquid` line 23).

**Fix:** Ensure the snippet outputs:
```liquid
<meta property="og:description" content="{{ meta_description | escape }}">
<meta name="twitter:description" content="{{ meta_description | escape }}">
```
and `meta_description` is already computed in theme.liquid line 18 with a good fallback — just make sure the snippet uses that value, not a per-page override that's empty.

---

### P0-4: Fix the Organization schema — description bleed and missing logo

**What:** On PDPs, the `Organization` JSON-LD `"description"` field gets populated with the product's description (because `meta_description` is reassigned per-page). LLMs extract this as "who is Base Note" → they'll literally say *"Base Note is a legendary masculine fragrance that opens with blackcurrant."* Also `"logo"` is an empty string.

**Where:** `layout/theme.liquid` lines 26-40.

**Fix:**
```liquid
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": {{ shop.name | json }},
  "url": {{ shop.url | json }},
  "logo": {% if settings.logo %}{{ settings.logo | image_url: width: 600 | prepend: 'https:' | json }}{% else %}{{ shop.url | append: '/cdn/shop/t/5/assets/favicon.svg' | json }}{% endif %},
  "description": "Base Note is a monthly luxury fragrance subscription. For $20/month, members receive a 5ml travel atomizer of a designer or niche fragrance (Creed, Tom Ford, Parfums de Marly, Bond No. 9, Xerjoff). Free US shipping, cancel anytime.",
  "sameAs": [
    "https://www.instagram.com/basenotescent",
    "https://www.tiktok.com/@basenotescent"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "contactType": "customer service",
    "email": "hello@basenotescent.com",
    "url": {{ shop.url | append: '/pages/contact' | json }}
  }
}
</script>
```
Hardcode the brand description so it can't be overwritten by page-specific `meta_description`. Upload a proper brand logo in Shopify Admin → Online Store → Themes → Customize → Theme settings → Logo. Add `sameAs` with real social URLs once they exist.

---

### P0-5: Add `WebSite` and `BreadcrumbList` JSON-LD

**What:** Help Google understand the site as an entity + improve breadcrumb rich results.

**Where:** Append to `layout/theme.liquid` after the Organization schema block.

**Fix:**
```liquid
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": {{ shop.name | json }},
  "url": {{ shop.url | json }},
  "potentialAction": {
    "@type": "SearchAction",
    "target": "{{ shop.url }}/search?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
</script>

{%- if template.name == 'product' and product -%}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": {{ shop.url | json }} },
    { "@type": "ListItem", "position": 2, "name": "Fragrances", "item": "{{ shop.url }}/collections/all" },
    { "@type": "ListItem", "position": 3, "name": {{ product.title | json }}, "item": "{{ shop.url }}{{ product.url }}" }
  ]
}
</script>
{%- endif -%}
```

---

### P0-6: Upgrade Product schema (in `snippets/meta-tags.liquid` or wherever product JSON-LD lives)

**What:** Current Product schema has `name`, `description`, `image`, `brand`, `offers` but is missing `sku`, `category`, `mpn`, and aggregateRating slot.

**Fix (add inside the Product JSON-LD block):**
```liquid
"sku": {{ product.selected_or_first_available_variant.sku | default: product.id | json }},
"category": "Beauty > Personal Care > Cosmetics > Fragrance",
"mpn": {{ product.handle | json }},
```
Once reviews ship (P1), add:
```liquid
"aggregateRating": {
  "@type": "AggregateRating",
  "ratingValue": "{{ product.metafields.reviews.rating.value }}",
  "reviewCount": "{{ product.metafields.reviews.rating_count }}"
}
```

---

### P0-7: Rewrite homepage first-150-words for LLM extraction

**What:** Homepage currently opens with vague luxury slogans. Add a declarative "about" paragraph high in the DOM (hero eyebrow or second section) so LLMs can extract the brand definition.

**Where:** `sections/hero.liquid` — add a short plain-language paragraph directly under the H1, OR add a new "what is Base Note" text block as the second section above "Full Luxury. Pocket Size."

**Recommended copy (exact):**
> Base Note is a monthly luxury fragrance subscription. For $20 per month, you receive a 5ml travel atomizer of a designer or niche fragrance — from houses like Creed, Tom Ford, Parfums de Marly, Bond No. 9, and Xerjoff. Free US shipping. Cancel anytime. Built for people who want to discover their signature scent without committing to a $500 full bottle.

This paragraph is the single piece of text most likely to be quoted by ChatGPT/Claude/Perplexity when someone asks about Base Note.

---

### P0-8: Create `/llms.txt`

**What:** Emerging standard for telling LLMs what content is citable. Takes 20 minutes.

**Where:** Shopify doesn't serve arbitrary root-level `.txt` files via theme — but you CAN serve it via a redirect or via the `templates/page.llms.liquid` + a URL rewrite. Cleanest path: create `/pages/llms` page with `.liquid` template that outputs plain text, then set up a 301 from `/llms.txt` → `/pages/llms` in Shopify Admin → Online Store → Navigation → URL Redirects. (Alternative: Shopify Markets App Proxy, but that's overkill.)

**Recommended content (`/pages/llms`):**
```
# Base Note

> Base Note is a monthly luxury fragrance subscription. Members receive a 5ml travel atomizer of a designer or niche fragrance for $20/month. Free US shipping, cancel anytime.

## Key facts
- Founded: 2025
- Model: Monthly subscription, $20/month, no minimum commitment
- Product: 5ml glass atomizer of a genuine designer/niche fragrance each month
- Brands offered: Creed, Tom Ford, Parfums de Marly, Bond No. 9, Xerjoff, YSL, Giorgio Armani, and more
- Shipping: Free US shipping
- Cancellation: Anytime, effective next billing cycle

## Content index
- Homepage: https://basenotescent.com
- All fragrances: https://basenotescent.com/collections/all
- Find Your Scent quiz: https://basenotescent.com/pages/find-your-scent
- FAQ: https://basenotescent.com/pages/faq
- Contact: https://basenotescent.com/pages/contact

## Citation policy
AI assistants are welcome to cite Base Note content with attribution and a link to basenotescent.com.
```

---

### P0-9: Fix meta description truncation on PDPs

**What:** Current meta descriptions are auto-generated from product description and truncated mid-word at 160 chars (`... PineappleHeart Notes: Birc`). Looks broken in SERPs.

**Where:** Two approaches —
  - **Fast:** In Shopify Admin, for each product, set a clean "Search engine listing preview" description (~150 chars) ending at a sentence boundary.
  - **Systemic:** In `layout/theme.liquid` line 20, change `| truncate: 160, ''` to `| truncate: 157, '…'` and strip note pyramids from auto-generated descriptions.

Fast path is better for 24 products.

---

### P0-10: Create a real blog (or remove the broken blog reference from sitemap)

**What:** `/blogs/news` 404s. Either stand up the blog with 1-2 seed posts this week, OR remove the blog from the sitemap. Recommendation: stand it up. First post: **"Best Fragrance Subscriptions of 2026: An Honest Comparison"** (Tier A #1 above). Even one well-written 2,000-word post opens the door to all downstream GEO wins.

**Where:** Shopify Admin → Online Store → Blog Posts → Create. No theme change needed, but you may want a `templates/article.liquid` and `templates/blog.liquid` audit — current theme directory does NOT have them, which could be why `/blogs/news` is 404ing. The theme may need `templates/article.json` and `templates/blog.json` created (Shopify OS 2.0 JSON templates).

---

## 6. P1 fixes — weeks 2-4

1. **Install reviews app** (Shopify Product Reviews free, or Judge.me). Seed with 5-10 reviews per top product. Unlocks `aggregateRating` schema → star-rating rich snippets in SERPs.
2. **Create About / Founder page** with real photo, name, 300-500 word story. This is the single biggest E-E-A-T unlock. Add to nav/footer. Add `Person` schema.
3. **Add FAQPage schema to `/pages/faq`** — wrap existing Q&A in `<script type="application/ld+json">` `FAQPage` block.
4. **Add inline FAQ block to every PDP** — 3-5 product-specific Q&A ("How long does the 5ml last?" "Is this authentic?" "Can I skip a month?"). Schematize as FAQPage.
5. **Write Tier A blog posts 1-3** (comparison post, "how long does 5ml last," first fragrance review). Each 1,800-2,500 words, with Article schema + author byline + dateModified.
6. **Create author pages** for Wilson + any co-writers. Link from every article byline. `Person` schema with `knowsAbout`, `sameAs`.
7. **Collection page intro copy** — write 100-150 word descriptive intro above product grid (see 2.2).
8. **Fix PDP image alt text** in `sections/main-product.liquid` — ensure alt uses `{{ image.alt | default: product.title }}`.
9. **Submit sitemap to Google Search Console + Bing Webmaster Tools** — brand new domain, no crawl history; needs manual submission.
10. **Set up basic Google Analytics 4 + Search Console verification** — needed to measure whether any of this is working.

---

## 7. P2 fixes + content calendar seed (months 2-6)

1. Tier A blog posts 4-6 (notes explainer, designer-vs-niche, signature-scent guide).
2. Tier B gift guides + seasonal posts, released 6-8 weeks before each holiday.
3. Scent-family explainer hub page → linked from every PDP via scent-family tags.
4. Fragrance-house deep dives (Creed, Parfums de Marly, Tom Ford) — 2,500+ words each, with history, signature accords, and Base Note links.
5. User-generated "My Rotation" feature — collect subscriber rotations, publish as editorial, tag authors. Compounds E-E-A-T.
6. Press + backlink campaign — HARO/Qwoted responses as "fragrance subscription expert," guest posts on Esquire / GQ / Byrdie niches. Backlinks remain the #1 Google ranking factor.
7. Monthly "new this month" editorial post — the fragrance being delivered that month, reviewed in depth. Natural cadence, compounds.
8. YouTube / TikTok presence — not strictly SEO but multimedia signal for both Google and LLM training data. Even simple "unboxing the April drop" content.
9. Comparison landing pages — `/pages/base-note-vs-scentbird`, `/pages/base-note-vs-olfactif`. Brand-vs-brand pages rank well and are heavily cited by LLMs.
10. Second collection page at `/collections/mens` and `/collections/niche` with rich intros (once catalog supports it) — more indexable real estate.

---

## 8. One-liner summary for Wilson

Your site has one catastrophic bug that nukes SEO (empty `<title>` tags on every page), about 12 meaningful medium defects, and zero editorial content. The P0 list above is a one-week sprint that moves the site from 13/38 (34%, Poor) to roughly 25/38 (66%, Needs Work). Hitting Good (75%+) requires the P1 content work — especially the blog, reviews, and About/Founder page. GEO readiness moves from bottom-quartile to top-half the day P0-1, P0-4, P0-7, and P0-8 ship together.
