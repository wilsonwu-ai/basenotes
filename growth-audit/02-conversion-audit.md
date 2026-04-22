# Conversion Audit Report — Base Note

**URLs audited:**
- Homepage: https://basenotescent.com
- PDP: https://basenotescent.com/products/creed-aventus
- Cart (empty state): https://basenotescent.com/cart
- Quiz entry (hero): https://basenotescent.com/pages/find-your-scent (works)
- Quiz entry (cart empty state): https://basenotescent.com/pages/quiz (**404 — broken**)

**Date:** 2026-04-22
**Overall Score:** 22 / 53 — **Needs Rework** (42%)

**Business context applied to evaluation:**
- Product: $20/month 5ml atomizer subscription (designer/luxury fragrance decant)
- Goal: subscription signup (not one-time)
- Traffic: organic only, new brand, 3-person team — bottleneck is traffic, but we must stop leaks before pouring traffic in
- Stack: Shopify theme + Appstle subscriptions + Klaviyo email
- Cart model intentionally limits 1 subscription item; overflow = "My Rotation" queue (localStorage). Not scored as a bug.

---

## 1. Customer Focus & Framing (2/8)

✗ **Customer is the star** — Page is dominated by product ("Base Note Experience," "Full Luxury. Pocket Size.," "Why Pay More?"). The customer is barely visible. Every section headline names the brand or the product, not the buyer or the buyer's situation.
✗ **Opens with the customer's world** — Hero opens with "Your Signatures Start Here" (product-centered) and jumps straight to "Luxury fragrances. Perfectly portioned." Description is about the product's attributes — nothing about who the buyer is, where they are in their day, or what they're trying to achieve.
✗ **Uses customer language** — Copy reads like agency-written luxury spec-sheet ("Presence Without Noise," "Command the Room. Say Nothing.") — more brand-voice flourish than actual buyer vernacular. What a guy shopping for a signature scent actually says: "I don't want to drop $400 on a bottle I'll get tired of," "I want to smell expensive," "I want compliments," "I want something women notice." None of that language is on the page.
✓ **Single audience focus** — Target is reasonably clear: men buying designer fragrances (all testimonials are male; featured fragrances are Aventus, Sauvage, Ombre Leather — classic men's). That's consistent.
✗ **Problem is named before product** — No pain stated anywhere. The page jumps directly into product feature-listing. Missing: the cost of getting it wrong ($300 blind-buy regret), the tyranny of one bottle for every occasion, the flat-feeling cologne aisle at Sephora.
✗ **No premature product reveal** — "Base Note" appears in the nav, hero, and every section header. The product is introduced before the reader has a reason to care.
✗ **Emotional core identified** — No emotion. Fragrance is bought for confidence, identity, attraction, status, self-expression. The page mentions "Command the Room" and "Presence Without Noise" as section decoration but never connects them to a real customer emotion. Emotion Audit fails: "Nobody buys fragrance for sprays-per-bottle. They buy it to feel attractive, confident, and like the sharpest version of themselves." The page does not activate those feelings.
✓ **Frame is set and maintained** — "Luxury fragrance, affordable monthly" is a consistent frame throughout. Credit where due.

## 2. Narrative Arc — Pain → Dream → Fix (2/10)

✗ **Pain section exists** — No pain section. "Why Pay More?" gestures at it ($500 bottle comparison) but only from a price-logic angle, not emotional pain.
✓ **Dream section exists** — "Command the Room. Say Nothing." and "Presence Without Noise" are dream fragments, though thin.
✓ **Fix section exists** — "How It Works" is a functional fix section.
✗ **Pain → Dream → Fix order** — Out of order. The page opens with fix/features, then sprinkles dream fragments, and never establishes pain.
✗ **Obliteration pattern present** — No pain → no obliteration possible. Dream words float free.
✗ **Sandwiches create transitions** — Sections are stacked like a feature list. No transitional tension between Pain, Dream, Fix.
✗ **Narrative builds to the CTA** — CTAs are scattered and identical ("Find Your Scent," "Start Your Subscription," "Start Your Journey," "Get Started"). No earned moment.
✗ **Fix is earned, not assumed** — Product is introduced before any emotional investment from the reader.
✗ **Active frame progression** — Copy stays in passive brand-voice throughout ("Presence Without Noise"). Never shifts to imperative, active, buyer-forward language by the CTA.
✗ **Not a feature list** — This IS a feature list. 11 sections, each describing a facet of the product, none telling a story.

## 3. Crispy Copy (3/8)

✓ **Specific claims over vague ones** — "~45 sprays per vial," "5ml," "$20/month," "25% off first month" — these are concrete. Good.
✗ **Pain details are crispy** — No pain = no crispy pain. Missed opportunity: "You spent $340 on Aventus last year and wore it twelve times." That's crispy. "Why Pay More?" is not.
✗ **Dream details are crispy** — "Command the Room. Say Nothing." is a tagline, not a dream. No sensory detail. No moment. Missing: "Walking into a wedding and three women ask what you're wearing. The next day at work, your VP stands a half-step closer in the elevator."
✓ **Fix details are crispy** — Product mechanics are specific: "5ml atomizer, ~45 sprays, 30 days, TSA-compliant, month-to-month."
✓ **Clear, not clever** — The core pitch (luxury fragrance, monthly, $20) is legible in 5 seconds. Good.
✗ **No buzzword soup** — "Elite fragrance," "crafted into a sleek, precision atomizer," "presence without noise" — luxury-brand-soup. Not as bad as SaaS-soup but not crispy either.
✗ **Copy is scannable** — The repeated section-headers-on-top-of-blocks pattern works for scanning section titles, but most sections have thin body content and too-similar CTAs — a scanner can't actually identify the one thing to do.
✗ **Appropriate copy length** — Too long *and* too thin simultaneously. 11 sections that each say almost the same thing in different words. Cut by 40% and tighten.

## 3b. Emotional Resonance (0/3)

✗ **Emotion Audit applied** — Fragrance is purchased for *feeling*: confidence, magnetism, identity, nostalgia, sexual signaling, self-reward. Base Note's copy activates none of these. It sells a price-value logic puzzle.
✗ **Identity purchase recognized** — The page does not show the buyer who he becomes. "Command the Room. Say Nothing." is close but floats without context — no character, no moment, no mirror for the reader.
✗ **Story over specs** — Specs win. 11 sections, near-zero story.

## 4. Design & Readability (5/8)

✓ **Single column layout** — Yes.
✓ **Left-aligned body text** — Mostly, from observation.
✓ **Comfortable line width** — Appears reasonable.
✗ **No content jiggle** — Home has alternating image/text blocks ("Full Luxury. Pocket Size." vs "A scent for every moment" etc.) — this creates the classic Shopify theme zig-zag that reads as "generic template."
✓ **Above-fold earns the scroll** — The atomizer hero image is strong and the "new scent every month" hook is clear enough to scroll.
✗ **Every visual element serves the pitch** — Redundant icon rows and sub-section headers that don't add to the narrative. The "Subscription Benefits" icon row is generic.
✓ **50ms visual trust** — Design is clean and doesn't scream "Shopify template knockoff." Photography-forward, decent type. This is a genuine strength.
✗ **Whitespace and breathing room** — Opposite problem: too much repetition fills the page. 11 sections on the homepage is excessive and feels bloated.

## 5. CTA & Commitment Architecture (2/8)

✗ **CTA copy is outcome-focused** — "Find Your Scent" (hero) is decent. But "Add to My Queue" on the PDP is catastrophic for a first-time visitor — "Queue" is internal jargon that means nothing to a buyer who's never heard of the rotation model. No visitor decodes "Add to My Queue" as "subscribe."
✗ **Reason to act now** — "25% off for new subscribers" is present, which is good — but it's shown identically on every page load with no expiration, no scarcity mechanic, no visible count. It becomes wallpaper.
✓ **CTA visually unique** — Buttons are visually distinct from body content.
✓ **CTA looks like a button** — Yes.
✗ **CTA placement follows narrative** — No narrative exists for the CTA to follow. CTAs are sprinkled every 1-2 sections asking for the same commitment at every touchpoint, which signals desperation more than confidence.
✗ **Max 2 CTA types** — I count at least 6 distinct CTA strings across the homepage: "Find Your Scent," "Start Your Subscription," "View Details," "Add to Queue," "View All Fragrances," "Get Started," "Browse Fragrances," "Start Your Journey." This is decision-noise.
✗ **CTA hierarchy matches buying behaviour** — First-time buyers of a $20/month subscription typically want: (1) understand the model, (2) pick the first scent, (3) start. Current page conflates browse/quiz/subscribe/queue and never anchors one primary path.
✗ **Minimal form friction** — The quiz at `/pages/find-your-scent` apparently does NOT capture email before showing results ("No account required, saved locally"). That is a huge Klaviyo lead-capture miss — visitors get the personalization payoff, leave, and are never remarketable.

## 6. Proof & Objection Handling (3/8)

✓ **Testimonials cite specific results** — Testimonials name specific fragrances (Aventus, Layton, Ombre Leather). That's more specific than average.
✗ **Testimonials have attribution** — First-name + city only ("David R., NYC"). No photos, no last name, no verifiable attribution. Reads as fabricated unless proven otherwise.
✗ **Social proof has depth and volume** — Three testimonials total on the homepage. No star ratings on the PDP. No review count anywhere. No press logos. No UGC. For a brand-new D2C with no recognition, this is the single biggest trust hole.
✗ **Proof placement is layered** — Proof only appears at the bottom of the homepage. No proof above the fold. No proof on the PDP at all.
✗ **Objections addressed directly** — Main objections for a fragrance decant subscription are NOT addressed: (1) "Is this real fragrance or a knockoff?" (the footer disclaimer "Base Note repackages genuine fragrances. Not associated with designers." is a correct legal statement but is a trust hit, buried in the footer where the skeptic can't find it when they need it); (2) "What if I hate it?" (there is NO return policy — PDP states "All sales are final and non-refundable" — this is a serious conversion killer and needs a risk-reversal mechanic); (3) "How does the rotation work?" (quiz, cart, and homepage all use the word "Queue" without explaining it).
✗ **Risk reversal present** — Opposite. The PDP explicitly states "All sales are final and non-refundable." For a blind-buy luxury fragrance subscription from an unknown brand, this is the conversion-killer of the page. Even a "love it or swap it next month, no charge" style policy — which Appstle makes trivial — would 2-3x confidence.
✓ **Proof is proportional to the ask** — The ask is low ($20/month, cancel anytime), so the proof-gap is mitigated somewhat. But still insufficient for a new brand.
✓ **No fake urgency** — "25% off first month" is a legitimate new-customer offer, not fake urgency. Good.

---

## Score Summary

| Category | Score | Rating |
|----------|-------|--------|
| Customer Focus & Framing | 2/8 | Needs Rework |
| Narrative Arc (Pain → Dream → Fix) | 2/10 | Needs Rework |
| Crispy Copy | 3/8 | Leaking |
| Emotional Resonance | 0/3 | Needs Rework |
| Design & Readability | 5/8 | Leaking |
| CTA & Commitment Architecture | 2/8 | Needs Rework |
| Proof & Objection Handling | 3/8 | Leaking |
| **Overall** | **22/53 (42%)** | **Needs Rework** |

---

## Critical Findings / Broken Experience

1. **`/pages/quiz` returns 404.** The empty-cart page CTA "Take the Scent Quiz" links to a dead URL. The working quiz lives at `/pages/find-your-scent`. This means every visitor who empties-cart-abandons and clicks the fallback CTA hits a 404 — unknown conversion impact but non-zero and embarrassing.
2. **The quiz does not capture email.** Per site copy: "No account required. Saved locally." Visitors get the personalization payoff, then leave and are un-remarketable. Klaviyo is installed — this is leaving lead-gen on the table on the highest-intent surface of the site.
3. **"Add to My Queue" is the primary PDP CTA.** "Queue" is internal-team jargon. A first-time visitor does not decode this as "start my subscription." They read it as "wishlist" or "save for later" — which kills purchase intent mid-click.
4. **PDP has no reviews / no star ratings.** Zero social proof on the purchase page of a brand-new D2C fragrance brand.
5. **"All sales are final and non-refundable"** sits on every PDP with no counter-balancing risk-reversal language. For a subscription from an unknown brand offering decants of luxury fragrance, this is the single most damaging line of copy on the site.

---

## Priority Fixes

### P0 — Ship this week (3–6 highest-ROI)

**P0.1 — Fix broken quiz link in empty cart**
*Problem:* Empty-cart CTA links to `/pages/quiz` which 404s. Users hit a dead end.
*Location:* `templates/cart.liquid` (or `sections/cart-empty.liquid` / `sections/main-cart-empty.liquid` depending on theme structure). Search the repo for the string `/pages/quiz` and change to `/pages/find-your-scent`.
*Fix:* Change `href="/pages/quiz"` to `href="/pages/find-your-scent"`. Also audit all internal links site-wide for the same dead URL (grep the theme for `/pages/quiz`).

**P0.2 — Rename "Add to My Queue" to a CTA a first-time buyer understands**
*Problem:* "Queue" is internal jargon. First-time visitor intent: subscribe. CTA reads like a wishlist. This is the #1 on-PDP conversion leak.
*Location:* `sections/main-product.liquid` (button block) + `assets/theme.js` (any labels) + any snippet that renders `add-to-cart` / `add-to-queue` buttons. Also check product-card snippets (`snippets/card-product.liquid` or similar) for the collection-page "Add to Queue."
*Recommended copy:*
- Primary button when subscription variant selected: `Start My Subscription — $20/month`
- Secondary (if already subscribed): `Add to My Rotation (next month)` with a tooltip: "You can only receive one fragrance per month — we'll queue this one up next."
- Product-card CTA: `Choose This Scent`
The word "Queue" can remain internally and on the account page where the mental model is already built, but not on the first-time PDP or collection card.

**P0.3 — Add a risk-reversal line to every PDP and swap the "all sales final" language for something that reflects the actual subscription model**
*Problem:* "All sales are final and non-refundable" is a conversion-killer on a blind-buy purchase from an unknown brand. Appstle supports skip / swap / cancel — use that.
*Location:* `sections/main-product.liquid` — the product-info block. Likely a `<p class="product__terms">` or similar where the refund-policy text currently lives. Also any shared `snippets/product-subscription-terms.liquid`.
*Recommended copy (replaces "all sales are final"):*
> **Love it or swap next month.** Try a fragrance for 30 days. Don't love it? Skip, swap, or cancel next month's shipment anytime before your renewal date — takes 15 seconds in your account.
Keep a compliance line in footer for returns, but strike the "non-refundable" line from the PDP — it's doing more damage than the ~$4 COGS saved per refund prevented.

**P0.4 — Add star rating + review count to every PDP above the fold (even if low/seeded)**
*Problem:* Zero social proof on purchase page. Buyer has no reason to trust an unknown brand.
*Location:* `sections/main-product.liquid` — above the price block. Integrate Shopify Product Reviews (free), Judge.me, or Stamped. If review volume is near-zero, seed the first 30 reviews by emailing current subscribers via Klaviyo with a review-request flow (takes ~2 hours to set up). You can also display *category-level* proof: "4.8 stars from 2,341 Creed Aventus wearers" — true of the underlying fragrance, not the decant.
*Recommended copy (even without reviews yet):* A trust-bar above or below the price: `Loved by 500+ subscribers · Avg 4.8 stars · Free shipping · Cancel anytime` — provided 500+ is truthful. Replace the subscriber count with the real number.

**P0.5 — Add email capture to the Scent Quiz before revealing results**
*Problem:* Highest-intent on-site interaction (finished 5-question quiz) ends with zero lead-capture. Klaviyo is installed. This is free leverage.
*Location:* `templates/page.find-your-scent.liquid` OR `sections/scent-quiz.liquid` OR wherever the quiz JS lives (likely `assets/quiz.js` or an inline `<script>`). Before the results-render step, show an email gate: "See your scent profile." Push captured email to Klaviyo via the `/client/subscriptions/` endpoint with the `$source = quiz` property and the quiz answers as custom properties.
*Recommended copy for the gate:*
> **Your scent profile is ready.**
> Enter your email to see your top 3 matches — plus 25% off your first month.
> `[email input] [See My Matches]`
> *No spam. Unsubscribe in one click.*
Then fire a Klaviyo flow: quiz result email + 3-email nurture sequence + abandoned-quiz flow at hr 1 / day 1 / day 3.

**P0.6 — Cut the homepage from 11 sections to 6 and re-sequence as Pain → Dream → Fix → Proof → Offer → CTA**
*Problem:* 11 sections of repeating feature-voice. No narrative. No buyer-centricity.
*Location:* `templates/index.json` (section order) — disable/delete: "Why Pay More?" (merges into Fix), "Presence Without Noise" (merge into Dream), and one of the two sub-section Dream fragments. `sections/` for hero + testimonials + custom text sections.
*Recommended new section order and headlines:*
1. **Hero (keep, rewrite headline):** `The best fragrances you own shouldn't sit in a box. Wear a different one every month.` / Subhead: `5ml atomizer. A new luxury scent every 30 days. $20/month. Cancel anytime.` / CTA: `Find My Scent` (→ quiz).
2. **Pain (new):** `The $400 Aventus in your closet has been worn twelve times.` Follow with: blind-buying full bottles is expensive, boring, and you end up wearing the same thing for two years. Crispy and buyer-mirror.
3. **Dream (rewrite "Command the Room"):** The version of you who walks into a room, gets the second glance, and never answers "Dior Sauvage" when someone asks. A signature that rotates with your life — Aventus for the pitch, Layton for the date, Silver Mountain Water for Saturday.
4. **Fix ("How It Works"):** 3 steps, visual — Pick / Receive / Rotate.
5. **Proof (new):** Testimonials with photos + star bar + quiz-output examples.
6. **Offer + CTA:** `Start with 25% off your first month. Skip, swap, or cancel anytime.` Single CTA.

### P1 — Ship this month

- **P1.1 — Rewrite PDP above-the-fold copy to lead with emotion, not spec.** Current: "The legendary king of fragrances…" — brand-voice copy lifted from the Creed press kit. Rewrite with the customer's moment: "Creed Aventus — for the day you need everyone in the room to notice." Location: `sections/main-product.liquid` product description block, or product metafields if copy lives in metafields. Consider populating metafields like `custom.moment_description` and `custom.who_wears_this` for every fragrance so the PDP narrates a character, not a spec sheet.
- **P1.2 — Add a sticky mobile PDP CTA.** 60–80% of traffic on D2C is mobile. A sticky bottom bar with `Start Subscription — $20/month` that stays pinned on scroll is a 5–15% mobile conversion lift pattern. Location: new `snippets/product-sticky-cta.liquid`, rendered inside `sections/main-product.liquid` behind a mobile-only media query.
- **P1.3 — Add an FAQ / objections section to the PDP.** The fragrance-decant category has predictable objections — address them visibly. Location: `sections/main-product.liquid`, new block or `snippets/product-faq.liquid`. Questions to answer: "Is this real Creed Aventus?" "How much is 5ml really?" "What if I want to keep getting the same one?" "What happens if I hate the scent?" "When does the 25% off end?" "Can I gift this?"
- **P1.4 — Testimonial attribution: add last-initial + photo.** Currently "David R., NYC" — reads fake. Get 10 real subscriber quotes with headshots (reach out via Klaviyo to current base). Location: `sections/testimonials.liquid` or similar.
- **P1.5 — Announcement bar: add a real scarcity mechanic or remove the fake timer.** Current: "25% off for new subscribers | Free Shipping 05:00" — the "05:00" looks like a countdown that doesn't reset / isn't tied to anything. Either make it genuine (end of month, limited cohort) or remove it. Fake urgency is a trust leak. Location: `sections/announcement-bar.liquid` and `config/settings_data.json`.
- **P1.6 — Second PDP CTA block near the bottom.** After fragrance notes + FAQ, re-anchor the subscribe button. Currently the only PDP CTA is top-of-page.
- **P1.7 — Explain the Rotation / Queue model inline on the homepage and cart.** Rather than a `(?)` tooltip on the cart label, dedicate one homepage section to "How Base Note Works" with the single-subscription-per-month + rotation model explained with one diagram. This also obviates the "Add to Queue" confusion.
- **P1.8 — Exit-intent email capture (desktop) + scroll-50% email capture (mobile) via Klaviyo.** Free leverage.

### P2 — Backlog

- **P2.1 — Reviews import / seed** — Set up a post-purchase Klaviyo flow requesting reviews at day 14 of first month. Offer a free upgrade or credit for photo reviews.
- **P2.2 — Press / founder story / "About" page narrative** — Helps credibility for an unknown brand. Repackaging-disclosure language in the footer should be rephrased into a confident "Why we do it this way" paragraph on the About page, not left as a defensive disclaimer.
- **P2.3 — Trust bar in site header** — "Free shipping · Cancel anytime · 10,000+ sprays shipped" or similar running claim, proportional to reality.
- **P2.4 — Build a `/pages/how-it-works` dedicated explainer page** — link from hero as secondary CTA, link from nav. Helps with SEO (informational intent) and solves the Queue-confusion.
- **P2.5 — A/B test hero headline** — Current ("Your Signatures Start Here") vs. pain-forward alternate ("The $400 bottle in your closet has been worn twelve times.") vs. dream-forward alternate ("A new signature scent. Every month. $20.").
- **P2.6 — Product-card CTA consistency across the site** — Standardize on one verb (e.g., "Choose This Scent" or "Try This Month"), never mix "View Details" / "Add to Queue" / "Add to Cart" in the same card grid.
- **P2.7 — Klaviyo flows for:** abandoned-quiz, abandoned-cart (even though cart is localStorage-based, fire a browse-abandon email), post-first-shipment NPS, pre-renewal reminder (already exists per memory), win-back at month-3 churn.
- **P2.8 — Add gift subscriptions** — Fragrance is one of the top 5 gifted D2C categories; this is found-money.

---

## Summary for the owner

The brand has good bones: the design doesn't look amateur, the core offer is crisp ($20/month, luxury scent, cancel anytime), and the target audience signal (men, classic masculine designer fragrances) is coherent. Below that, the funnel is leaking at three specific points that can be fixed this week without a redesign:

1. **Buyer-jargon CTA** ("Add to My Queue") needs to become a subscribe CTA.
2. **"All sales final" on every PDP** has to be swapped for the actual Appstle-enabled skip/swap flexibility.
3. **The scent quiz has no email gate** — the single highest-intent interaction on the site produces zero remarketable leads.

Fix those three before spending a dollar on acquisition. The 2 hour/week version of this plan: Monday = P0.1 + P0.2, Tuesday = P0.3, Wednesday = P0.4, Thursday = P0.5, Friday = P0.6.
