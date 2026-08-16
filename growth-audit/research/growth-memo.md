# GROWTH MEMO — Base Note
**To:** Wilson · **Date:** 15 Aug 2026 · **Sources cited inline; corrected figures marked ⚑**

---

## 1. The goal counter — verdict

**Show both, but only inside a progress-to-goal frame, and only if you commit to a real price cap.** Never publish the raw count alone, and never publish "spots left" unless a spot is a literally true, enforced thing.

Why:
- **Gap-to-goal is the persuasive element, not the number.** Kivetz/Urminsky/Zheng (2006, *JMR*) found café customers buy faster the closer they are to the reward, and a **12-stamp card with 2 stamps pre-filled completes faster than an empty 10-stamp card** — so display 17/60, not "43 to go" from zero.
- **Kickstarter confirms the deadline matters.** Dai & Zhang (via UCLA Anderson Review) found the jump from 100%→105% funded took **twice the hours** of 95%→100%, and **14.69% of money / 15.68% of backers** arrive in the first period. An undated tally has no gradient to exploit — the Nov 30 date is doing the work.
- **The raw number alone is a live risk.** HubSpot's negative-social-proof case file (Wikipedia's "fewer than 2% give") and the Petrified Forest field study are the guardrail: ⚑the social-proof sign produced **~8% theft vs <2%** under a plain prohibition sign — roughly 4x worse. "17 subscribers" naked reads as *almost nobody joined*.
- **"Spots left" is an FTC surface.** The FTC's *Bringing Dark Patterns to Light* (Sept 2022) names false low-stock and false-demand claims as deceptive. Fabricated scarcity is not available to you. A **Founding Member price lock capped at 60** makes it true — and locked-rate framing is the standard SaaS pattern (Datadab) rather than a giveaway.

**Placement:** a single slim bar directly under the hero CTA, and repeated as one line in the footer. Not a popup, not a badge floating over product cards.

**Copy — pick one, A/B the other two:**
1. `17 of 60 Founding Members · You'd be #18 · Price locks at $20/mo until Nov 30`
2. `We're building this to 60 members by November 30. 17 are in. 43 seats left at the founding price.`
3. `43 seats to go. Founding Members keep $20/mo for as long as they stay.`

**The honesty line (no financials):**
> "60 members by November 30 is the number that makes one flat price work. We'll post where we are, honestly, every week — including the weeks it doesn't move."

Buffer's public revenue dashboard is the credible precedent for this posture: transparency works as a *living, moving* number, not a static badge (Buffer, *Introducing the Public Revenue Dashboard*). ⚑Note: that page credits ChartMogul, not Baremetrics — don't repeat the Baremetrics attribution.

---

## 2. Referral MVP — no email platform, manual reward

**Mechanic:** one unique Shopify discount code per subscriber, delivered on the account page as a `/discount/CODE` link plus a pre-filled WhatsApp share button. Reward is issued by hand by Jeff once the referred friend's **first paid order clears**.

**Incentive:** asymmetric — **referrer gets one free month ($20 credit on next renewal); friend gets $10 off month one.**

Why this exact shape:
- **Credit beats coupon.** ReferralCandy's benchmark set: cash/commission programs were **~2.2x** as likely to reach meaningful referral revenue and commission rewards ran **~2.7x the coupon-only baseline**. A free month behaves like credit, not a % code.
- **Direct chat is the channel.** Same source: chat apps + email = **69.2%** of tracked share-button clicks, and direct 1:1 sharing beat public social for **93.7%** of merchants. Build the WhatsApp button, skip Twitter/Facebook. `https://api.whatsapp.com/send?text=` needs no app and no phone number (Chatfuel).
- **Make tier one trivially reachable.** Harry's pre-launch ladder started at **5 referrals for shave cream** and pulled **77% of 100,000 emails** from referrals — the accessible floor drove participation, not the 50-referral ceiling. At n=17, your floor is **1**.
- **Fulfilment friction kills it.** Dropbox's double-sided storage reward had **no claim form, no manual approval**, produced **35% of daily signups** and a **permanent 60% volume bump**. You can't automate yet — so cap the promise at "credited within 48 hours" and actually hit it.
- **Guard the payout.** Require a completed paid order before crediting, matching the subscription-referral norm (Scentbird's own help content describes both parties needing active subscriptions — *unverified, treat as directional*).
- **Check first.** Dropbox's program amplified existing word-of-mouth — **a third of users already arrived by referral before launch**. Ask your 17 whether anyone already told a friend. If nobody has, fix the product story before building the mechanic.
- **Progress copy without email:** Morning Brew surfaces "you're only X away from Y" in every issue (⚑ladder is 1 / 3 / 7 / 10+ / 1,000, not the 5/10/15/25 version). You have no sender — so render that same line statically on the account page.
- **Automation later, free:** Shopify Flow's *Discount code created* trigger is free on all plans; Shopify Collabs is native but **not accepting new creator signups** right now, so don't design around it.

**Expect nothing for two weeks.** Median first referred sale lands at **day 14**, with **68% of programs** getting one inside month one (ReferralCandy).

---

## 3. Eight engagement patterns, ranked by impact ÷ effort

| # | Pattern | Evidence | Effort |
|---|---|---|---|
| 1 | **"Find Your Rotation" 3–5 question quiz** with a visible "Q2 of 4" progress bar | Quizzes convert **~10x a standard email popup** — ⚑**37.6% visitor-to-lead** across Interact's 80M+ submissions (Kinetic). Progress bars tested across **10 A/B tests, 148.8M+ visitors** (GoodUI #99, magnitudes paywalled) | M |
| 2 | **Scale + context shots on every PDP** — 5ml atomizer beside a full bottle and in-hand | **42% of users** try to judge size from images alone (Baymard) | S |
| 3 | **Filter by scent family** across the 22 SKUs | The four-family fragrance wheel is the shopper's native mental model (FragranceX) — and Le Labo/Byredo/Diptyque all navigate by format/use, not brand | M |
| 4 | **"Load more" + lazy-load** on the shop grid | Beat both pagination and infinite scroll in Smashing/Baymard-adjacent usability testing; pagination cuts products viewed, infinite scroll blocks the footer and hurt Etsy's search experience measurably | S |
| 5 | **"If you like X, try Y" rail** on each PDP | NN/g's product-page report (108 guidelines) names *comparisons* and *related products* as core pillars; 22 SKUs is small enough to hand-curate | S |
| 6 | **Promote the guest-accessible "My Rotation" save** as a stated feature | **89% of sites** don't let guests use Save/wishlist; **21% of shoppers** rely on it (Baymard). You already have it in localStorage — say so | S |
| 7 | **Browse by occasion** (date night / office / gift) collections | Aesop organizes by real-world use — travel, home, hand — not taxonomy (Brand Vision, *unverified*) | S |
| 8 | **Inline validation** on quiz + email capture | Directionally supported only; the "22% faster correction" figure is a secondary blog paraphrasing NN/g — **do not quote it externally** | S |

---

## 4. Facelift brief — 12 bullets

What the comps actually do: video-first heroes (Gentle Monster, ⚑hero/campaign sections specifically, with poster fallbacks), minimal cards with one affordance (Gentle Monster: image, short descriptor, single *Add to Wishlist*), soft CTAs on browse (Diptyque's "Découvrir" instead of Add to Cart), horizontal carousels over grids and 3:4 credited campaign imagery (Loewe), numbered apothecary naming plus a personalization step (Le Labo's SANTAL 33 / SHIU 25), two-colour restraint with GSAP motion (⚑Jacquemus, **7.46/10** on Awwwards, gray `#9C9C9C` + white), and AVIF-optimized hero imagery (Byredo).

**Design brief for Base Note:**
1. One autoplaying 6–10s hero loop (pour/spray), poster-image fallback, muted, no controls.
2. Convert "Trending" from static grid to horizontal scroll-carousel.
3. Two-colour system: off-white + near-black, **one** accent drawn from the vial.
4. Kill all house-brand colour and logo lockups from the grid — one catalogue, not 22 brand pages.
5. Strict type hierarchy: black primary, gray secondary. Nothing else.
6. Number the catalogue: `CREED AVENTUS — No. 01`. Zero copywriting cost, instant system.
7. Cards carry name, house, one CTA. Nothing more.
8. CTA verb on the grid is **"Add to Rotation"**, never "Subscribe now".
9. Nav gains one facet — scent family or occasion — alongside house; search promoted to a visible nav item.
10. 3:4 campaign crop for all hero/lifestyle imagery; one styled shot per fragrance.
11. Ship AVIF/WebP + responsive `srcset` **before** the video, or mobile load tanks the Reddit/TikTok click-through you depend on.
12. Motion: scroll-triggered fades and eased page transitions only. Use `gsap-scrolltrigger`, already in the stack.

*(Aesop's Work&Co case-study details and the SSENSE typeface story were unverifiable at source — treated as directional, not cited as evidence.)*

---

## 5. ICP / PMF

**Three hypotheses, cheapest test each:**

| ICP | Hypothesis | Cheapest test |
|---|---|---|
| **A. Under-40 discovery buyer** | Buys for variety and story, not savings. ⚑Millennials + Gen Z drive **68% of niche perfume sales** (Free Yourself). *(The "67% Euromonitor" figure in circulation is unsupported — do not use it.)* | Two Pinterest pins, identical image, one captioned on discovery, one on price. 2 weeks, $0. |
| **B. The layering/stacking hobbyist** | Wants 3+ scents live at once. Pinterest 2026 forecast names **"Scent Stacking"**; searches: *niche perfume collection* **+500%**, *perfume layering combinations* **+125%**, *scent layering* **+75%** (GCI). | Publish the layering pillar post; measure rotation-size behaviour of anyone who lands on it. |
| **C. The full-bottle-averse gifter** | Won't commit $200+; buys once before subscribing. | Ship the Trio as a one-time SKU and watch the trio→subscribe rate. |

**Rotation Trio — pricing, against Luckyscent's live ladder** (35+ discovery sets: **$18** BDK Absolu Trio, **$40** Mancera 5-piece, **$65** Lorenzo Pazzaglia 10-piece, **$275** Zoologist):
- **$18** — matches the observed floor exactly; maximum top-of-funnel, thinnest margin.
- **$25 with $25 credit toward month one** — my pick. Priced above the floor (signals quality), and the credit makes the subscribe step feel free rather than discounted.
- **$35 no credit** — only if unit economics demand it; sits between BDK and Mancera and will convert fewer cold visitors.

**Instrument:** trio→subscription conversion rate and lag; day-0/30/60/90 retention per cohort; **payment-failure churn separated from voluntary churn** before any of it is read as a PMF signal.

**Why surveys mislead here.** Sean Ellis called the 40% threshold **"a bit arbitrary"** himself and notes humans forecast their own behaviour badly (Justin Jackson). Buffer sent it to an ultra-engaged segment, got **78% "very disappointed,"** and the broader base didn't retain anywhere near that (Zonka). Your 17 are friends, Reddit regulars and team network — the most selection-biased sample possible. Run it and you'll get a rosy number that predicts nothing.

**Read revealed behaviour instead, with 46 customers:**
- **Renewal is the survey.** ⚑Category churn runs **10–15%/month**, top performers **under 3%** (Swell). At n=17, two lost subs is ~12% — one month of category-average, not a verdict.
- **The first 90 days decide it** — nearly half of subscription-box cancellations happen inside that window (Swell).
- **Rule out involuntary churn first** via Appstle dunning logs; ⚑the "68% of churn is payment failure" figure is low-confidence, but at n=17 one misattributed decline distorts everything.
- **Interview now, don't wait.** 20–50 interviews is the standard range but pattern saturation arrives at **three people naming the same friction** (Koji). You have enough humans today; qualitative gives the "why," the survey only ever gives the "how many" (Mercury) — defer it.

---

## 6. Distribution — what to do the day each of the 15+ posts ships

**Cadence first:** 1–2 posts/week, not a 14-post dump. Publishing frequency correlates with traffic **only when quality is held constant** — one high-information-gain article/week beats seven generic ones (Digital Applied). And front-load *now*: SEO content takes **3–6 months to reach its ceiling**, with one documented site growing **92→119 daily visits (+29%) over four months with zero new edits** (Inblog). August publishing is what lands before Nov 30.

**Day-of checklist, per post:**
1. Open each H2 with a **40–60 word standalone answer**, headers phrased as real queries (NameSilo). AI Overviews appear on **60%+ of informational queries**, **68% of searches end without a click**, but cited pages see **+35% CTR** — and **99.5% of AI Overview citations come from the top 10 organic results** (Omnibound). Rank first, then get cited.
2. Link **bidirectionally** to its pillar and sideways to two siblings. **86% of AI citations** come from sites with 5+ interconnected pages on a topic; bidirectional linking raises citation probability **2.7x** (Yext study via Digital Applied). Build two pillars: *Build a Fragrance Rotation* and *Luxury Fragrance Cost Comparison*.
3. Byline it to Jeff or Alex with a real author page and credentials — Helpful Content is now a continuous core signal, and E-E-A-T rewards first-hand experience with specific, verifiable detail. Include actual wear notes (hour 3 vs hour 8) and original vial photos, not stock.
4. Alt-text every image: `[type] + [subject] + [action] + [keyword]`, 50–125 chars.
5. **Request indexing in GSC immediately.** 3–5 days average; cap is **~10–12 URLs/property/day** — another reason not to batch-publish.
6. Pin the hero image to Pinterest with the title overlaid (long content lifespan; rides the Scent Stacking trend).
7. Cut the post's video footage into **5–7 short clips with different hooks** — the efficient ratio is 5–7 posts from 2–3 original pieces (ScaleLab).
8. **Reddit: never the same link to two subs the same day.** The 9:1 rule is gone, replaced by "be a genuine participant"; duplicate cross-posting is a shadowban trigger, and a silent ban kills the whole channel. Use per-person accounts, disclose affiliation.
9. **Skip FAQPage and HowTo schema as SEO tactics** — FAQ rich results were dropped **7 May 2026** (reporting gone June, API August); HowTo desktop died **Sept 2023**. Keep the Q&A format for readability and AI extraction only.

*(~2,150 words.)*