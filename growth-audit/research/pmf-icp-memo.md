# Base Note — PMF / ICP memo (Task 4)
*Prepared 2026-08-16 from Admin API cohort data (46 customers), the verified growth-research fleet (`growth-memo.md`), and the Aug 15 conversation between Wilson and Jeff.*

## The verdict, first
**Jeff is not wrong that PMF is unproven — but the data cannot say it's absent, because there has been no market yet.** Fifteen of the 17 active subscribers ship to Illinois; the customer file is Jeff's and Alex's network plus one giveaway. That is not a PMF sample; it is a friends-and-family pilot. What it *does* say is encouraging: people who try Base Note keep it (actives average 4.1 orders / $84; the Jan–Mar cohorts are still paying five to seven months later). The unanswered question is not "do people like it?" — it's "can strangers find it, and will they start?" That is a distribution problem, and Wilson's read is the right one.

## What the numbers actually say (revealed behaviour, not surveys)
| Fact | Number | So what |
|---|---|---|
| Active subscribers | **17** (5 inactive, 3 paused; 25 ever-subscribed) | 32% ever-churn over ~5 months — inside category norms (10–15%/mo per Swell). Not a verdict. |
| Where actives live | **15 of 17 in Illinois** (Chicago suburbs) | Zero evidence of brand-driven acquisition outside the network. Nobody knows Base Note. |
| Actives' behaviour | avg **4.1 orders, $84** lifetime; Jan/Feb/Mar cohorts still active | Retention among people who start is *good*. The product isn't the leak. |
| July "spike" | 15 signups, **13 at $0** (free-5 ml giveaway) → **0 conversions** | The giveaway captured leads and then went silent — Klaviyo can't send (free plan over the profile cap), so nobody ever heard from us again. |
| Lifetime revenue, all customers | **~$1,880** | 60 members = ~$1,200 MRR. The Nov 30 goal is +43 in ~15 weeks vs a run-rate of ~2/month. Steep, and only traffic changes it. |
| Last new (paid) subscriber | 2026-07-25 | Before that, Jun 7. |

**The "savvy customer" (3 vials, then cancelled)** is a signal, not a leak: he read the blog, understood the value, and used the product as a discovery set. Productise exactly that.

## Why surveys will mislead here (Jeff is right about this part)
Sean Ellis called the 40% "very disappointed" threshold arbitrary himself; Buffer surveyed an ultra-engaged segment, got 78%, and the broader base never retained like that. Your 17 are the most selection-biased sample possible. Read renewal (the real survey), the first-90-days curve, and interviews — three people naming the same friction is saturation. Do not run a PMF survey on friends.

## Three ICP hypotheses and the cheapest test for each
| ICP | Hypothesis | Cheapest test (all $0) |
|---|---|---|
| **A. Under-40 discovery buyer** | Buys for variety and story, not savings (Millennials + Gen Z drive ~68% of niche sales — Free Yourself). | Two Pinterest pins, same image, one captioned on discovery, one on price; 2 weeks. |
| **B. Layering / "scent stacking" hobbyist** | Wants 3+ scents live at once (Pinterest 2026 forecast; *perfume layering combinations* +125% searches). | The pillar + skin-chemistry posts are built for this reader; watch rotation size for anyone who lands on them. |
| **C. Full-bottle-averse sampler** | Won't commit $200+; will buy once before subscribing (the savvy customer). | Ship the **Rotation Trio** as a one-time SKU; measure trio→subscribe rate and lag. |

## The Rotation Trio (move inventory, learn the ICP)
Three 5 ml atomizers, one-time purchase, no subscription. Pricing options grounded in Luckyscent's live discovery-set ladder ($18 BDK trio · $40 Mancera 5-piece · $65 Pazzaglia 10-piece):
- **$25 with a $25 credit toward month one** ← recommended (priced above the $18 floor to signal quality; the credit makes "subscribe" feel free, not discounted).
- $18 flat (max top-of-funnel, thinnest margin) · $35 no credit (only if unit economics demand).
Ops: it's a normal one-time product (no Appstle plan). Fulfilment identical. Instrument: trio→sub conversion, and separate voluntary vs payment-failure churn before reading anything as PMF. **Not created yet — needs your price call.**

## What we shipped/staged in this sprint that attacks the real problem (traffic)
1. **Content engine unblocked**: 14 finished posts that never published + 12 new + the pillar → 27 posts scheduled Mon/Wed/Fri through Nov 9 (pending your approval to write them to the store).
2. **Homepage growth band + referral** (`deploy/growth-goal`): live count vs 60, real deadline, share links; referrer reward is manual (a month on us) — 17 people, trivial ops.
3. **Fix the silent leak**: the giveaway list (13) and every future lead need *some* sender. Options, cheapest first: (a) Appstle → Marketing Integrations, switch back to native sending (free — verify the tab works outside the iframe); (b) Shopify Email (free to 10k sends/mo — the underused answer for a store this size); (c) Klaviyo paid tier. Recommendation: **(b) Shopify Email now** for the welcome/nurture; keep Klaviyo events firing.

## The honest read for Jeff
The pilot says the product retains. The store has had, in effect, zero strangers. Nov 30 is a fair deadline *if the next 15 weeks are the first real distribution test* — 27 posts, Reddit/TikTok routing to them, a referral loop, and a $25 Trio for people who won't subscribe blind. If that test runs and 60 doesn't come, the answer will be real. If it doesn't run, closing in November decides nothing.
