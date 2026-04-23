# 11 — AI Content Research (Loom + X + Tool Catalog)

**Compiled:** 2026-04-22
**Purpose:** Reference doc for Wilson (Base Note) to evaluate AI-image / AI-video tooling for founder-run branded content on TikTok, Instagram, and product pages. Covers a Loom video, a referenced X post, a tool catalog, and a shortlist of what's safe to ship this week.

---

## 1. Loom Video Capture

**URL:** https://www.loom.com/share/2c9efa9f5b224ef7a5a1fc9efec51384
**Video Title (visible in page metadata):** `Claude Code + ChatGPT Images 2.0`
**Creator:** Not visible on the public page.

### Transcript

**TRANSCRIPT NOT ACCESSIBLE.** Every fetch of the Loom URL returned a service status page: *"Loom is running a bit slower than usual. Contact support if this issue persists."* No transcript, description, og-tags, or creator name rendered. I retried with two different extraction prompts — same result. I did not fabricate transcript content.

### What IS visible / can be inferred

1. **Page title only:** `Claude Code + ChatGPT Images 2.0 | Loom`.
2. **Subject matter (strongly inferred from the title + current ecosystem):** The video is almost certainly a walkthrough of using the **`gpt-image-2-skill`** — a Claude Code skill published by **RoboNuggets** (MIT-licensed, public on GitHub) that wraps **OpenAI's GPT Image 2 model via fal.ai's API** inside Claude Code. The skill name maps 1:1 to the Loom title ("ChatGPT Images 2.0" is the marketing name for `gpt-image-2`).
3. **Skill repo confirmed live:** https://github.com/robonuggets/gpt-image-2-skill — README-verified details below.

### Reconstructed workflow (from the underlying skill, NOT from the video)

Based on the `gpt-image-2-skill` README, the workflow a creator would demo in a video of this title is:

1. Install the skill: copy `SKILL.md` into `<project>/.claude/skills/gpt-image-2/`.
2. Get a fal.ai API key at https://fal.ai/dashboard/keys and add to `.env`: `FAL_KEY=...`.
3. In Claude Code, describe the image you want (natural language). Claude invokes the skill, which calls fal.ai's `openai/gpt-image-2` (text-to-image) or `openai/gpt-image-2/edit` (edit with mask) endpoint.
4. Outputs (up to 4 per call, up to 3840×2160) save to the project directory.
5. Quality tiers: Low ~$0.02, Medium ~$0.05, High ~$0.18 per image.

### Prompt patterns the skill's README showcases (verbatim examples)

- Text-to-image: *"Create a vintage diner chalkboard reading 'TODAY SPECIAL — Lobster Roll $24'"*
- Edit: *"Modify this photo — same scene but everyone is on their phones now"*

**Why this matters:** GPT Image 2's primary differentiator is **legible text rendering inside images** (chalkboards, signage, menu boards, label mockups). That's a direct match for a fragrance brand shipping label-heavy product shots and infographic posts.

### Platform-posting tactics mentioned

None visible. The page never rendered. **No TikTok / IG tactics could be extracted, so no TOS flags to raise from the Loom itself.**

---

## 2. X / Twitter Post Capture

**URL:** https://x.com/simonecanciello/status/2046992660230287814

### Result: BLOCKED

- Direct `x.com` fetch returned **HTTP 402 Payment Required** (X's anti-scraping response for unauthenticated requests).
- `xcancel.com` (nitter mirror) returned **HTTP 503**.
- `nitter.net` mirror returned an empty body.
- Web searches for the account handle + status-ID combo returned no cached preview.

### What's known about the author

- **Handle:** `@simonecanciello`
- **Real name:** Simone Canciello
- **Public identity:** Founder of **Supaworkout** (per Crunchbase/web-search surface). Active on X posting mobile-app niche ideas. Instagram handle `@simonecanc`.
- **Relevance to AI content:** Not a known AI-content-marketing figure based on public search. Any content in the linked post cannot be verified from here without authenticated access.

### Ethical flags from the post

**Cannot be evaluated — post content is inaccessible.** If you can screenshot or paste the post text, I can evaluate tactics against TOS / FTC disclosure rules in a follow-up pass.

---

## 3. Tool Catalog (named or implied across the sources)

Pricing as of April 2026. All "per-image" costs are for a single 1K-resolution render unless noted.

| Tool | What it is | Cost | Needs separate signup? | API? |
|---|---|---|---|---|
| **GPT Image 2 (gpt-image-2 / "ChatGPT Images 2.0")** | OpenAI's top-tier image model. Best-in-class for legible on-image typography (labels, menus, signage), product photography, magazine-style layouts. Released April 2026. | ~$0.053 medium / $0.21 high per image via OpenAI API. Instant mode free in ChatGPT. Thinking mode requires ChatGPT Plus ($20/mo). | Yes — OpenAI account **or** fal.ai account. | Yes — OpenAI Image API, OpenAI Responses API, **or** fal.ai's `openai/gpt-image-2` endpoint. |
| **fal.ai** | API aggregator: single key, 600+ image/video models including GPT Image 2, Nano Banana 2, Flux, Seedream, Kling, Veo. Pay-per-use, no GPU mgmt. | Variable per model. $0.05/img medium-quality GPT Image 2. | Yes — fal.ai account + `FAL_KEY`. | Yes — REST; sync endpoints (no polling) for many models. |
| **Nano Banana 2 (Google Gemini image model)** | Google's fast image gen + edit. Much cheaper and faster than GPT Image 2; slightly lower aesthetic/text-rendering quality. Native to Gemini. | $0.067/img 1K via Gemini API; $0.08/img edit via fal.ai. | Yes — Google AI Studio or fal.ai. | Yes — Gemini API and fal.ai. |
| **Claude Code (skills / Amplifiers)** | Anthropic's CLI coding agent. Can load "skills" (prompt + helper scripts) that call third-party APIs. The Loom subject is a skill that wraps fal.ai → GPT Image 2 so you generate images inside Claude Code by typing English. | Claude Pro ($20/mo) or Max ($100+/mo) plus whatever the called API costs. | Yes — Anthropic account; plus whichever image API the skill calls. | The skill itself is OSS on GitHub. |
| **Hyperframes (HeyGen)** | HTML+GSAP→MP4 motion video tool. Referenced in your soul.md; relevant here because it pairs well with AI stills for scroll-stopping IG/TikTok motion. | HeyGen pricing (~$29/mo Creator tier and up). | Yes — HeyGen account. | Yes, via HeyGen API. |
| **Claude Design (Anthropic Opus 4.7 visual tool)** | Anthropic's native visual tool for slides/landing/email/prototypes. Already in your workflow. | Included in Claude plan. | No (existing Anthropic account). | Via Claude. |
| **Midjourney v8** | Highest aesthetic ceiling for editorial / mood / fashion. | $10–60/mo Discord tiers. | Yes — Discord + Midjourney account. | **No public API** — browser/Discord only. Blocks automation pipelines. |
| **Runway Gen-4.5 / Kling 2.6 / Veo 3.1** | Text-to-video and image-to-video models. Used in most 2026 "AI UGC ad" tutorials. | $0.05–0.50 per second of video depending on model/tier. | Yes — each has its own account, all are on fal.ai too. | Yes (direct or via fal.ai). |
| **ElevenLabs** | AI voiceover — commonly chained with Kling/Veo for UGC-style ads. | $5–22/mo entry tiers; API credit-based. | Yes — ElevenLabs account. | Yes. |
| **Pippit (CapCut Commerce Pro)** | Template-driven UGC ad generator specifically for ecommerce (has fragrance templates). | Freemium, paid tiers from ~$9/mo. | Yes. | Limited. |

---

## 4. What's Safe to Adopt for Base Note

### SAFE — use freely

1. **AI-generated product / hero photography for your own channels.** Base Note owns the bottles, the scent stories, and the brand. Generating stylized shots of *your own product* via GPT Image 2 or Nano Banana 2 is creative production, not fraud. No disclosure required for marketing imagery (FTC rules kick in around endorsements and testimonials, not product photography).
2. **AI-generated infographics and educational posts** (fragrance note wheels, longevity/sillage diagrams, "how a subscription works" flows). Pure utility content; matches Base Note's honest-positioning wedge.
3. **Founder-voice explainer videos where Wilson actually wrote the script** and the voice/face is Wilson's (not cloned). AI can do b-roll, stills, captions, background motion.
4. **Claude Code + fal.ai skill workflow (the Loom's apparent subject).** Fully legitimate dev tooling. No TOS or platform risk.
5. **Using Klaviyo-style email hero images generated by AI.** Same logic as product photography.

### CAUTION — disclosure or human-in-the-loop required

1. **AI "UGC" creator videos** (synthetic avatars reading a script as if they're real customers). Platforms increasingly require `#ad` or AI-disclosure labels. TikTok's AIGC label and Meta's AI content label are mandatory for synthetic humans. **Base Note should label any synthetic-person ad.** Running them unlabeled is FTC + platform TOS risk.
2. **Testimonials / before-after / "I tried it for 30 days" formats using AI faces.** Even with a disclosure label, these map to the FTC's new rule on fake reviews (finalized Aug 2024, active now). **Avoid entirely** for Base Note — it directly contradicts your anti-Scentbird honest-positioning wedge.
3. **Cloning a real person's voice/face without a signed release.** Zero exceptions. Always get a signed AI-likeness release.

### AVOID — TOS / FTC / brand risk

1. **Coordinated inauthentic behavior** — multi-account posting, fake engagement, astroturfed comments. TikTok and Meta both ban this; Base Note cannot recover from an enforcement action.
2. **Unlabeled AI influencer accounts posing as real people** recommending Base Note. FTC fraud; also directly undermines the honest wedge.
3. **Generated celebrity likenesses** (public figure, designer, perfumer). Right-of-publicity lawsuits.
4. **Pixel-perfect replica of a competitor's bottle / packaging / campaign** via AI. Trademark and trade-dress risk even if AI-generated.
5. **Any tactic from the X post that can't be verified** — because the post content was inaccessible, treat anything attributed to it as unvetted until the source is checked.

---

## 5. What I'd Start Generating First (ship this week)

Three concrete asset types, each with a copy-paste prompt spine, that match Base Note's wedge and your existing stack (Shopify, Klaviyo, IG/TikTok).

### Asset 1 — Hero Product Photography (GPT Image 2 via fal.ai)

**Use case:** Replace generic stock / lifestyle images on PDPs and the homepage hero. 12 images covers 4 seasonal scenes × 3 aspect ratios (1:1 feed, 9:16 story/reels, 16:9 hero banner). ≈$0.60 at medium quality, ~$2.16 at high quality.

**Prompt spine:**
```
Editorial product photograph of an elegant amber glass fragrance bottle
with a brushed silver cap and a minimalist cream label reading
"BASE NOTE" in small serif type. Shot on medium format, f/2.8,
soft natural window light from the left, shallow depth of field,
neutral stone surface, tasteful shadow, a single sprig of [fresh sage
/ dried vetiver / bergamot peel / tonka bean pod] to the right for
scent cue. Muted warm palette, editorial minimalism, no people,
no text overlays, no logos other than the bottle label. 2048x2048.
```
Swap the seasonal botanical + surface per run.

### Asset 2 — Fragrance Note-Wheel Infographic (GPT Image 2 is uniquely good at this — legible text on-image)

**Use case:** Shareable education carousel for IG + Pinterest, also embeddable on the blog for SEO/GEO (matches your `03-seo-geo-audit.md` content strategy). Turns a tangible differentiator into social ammo.

**Prompt spine:**
```
Clean minimalist editorial infographic titled "Base Note — Fragrance
Note Pyramid." Three horizontal bands stacked: TOP (bergamot,
grapefruit, pink pepper), HEART (rose, jasmine, iris), BASE (sandalwood,
vetiver, musk, amber). Each band has a hand-drawn botanical
illustration and crisp sans-serif labels. Cream background, warm
charcoal ink, single-color palette. Layout for Instagram 1080x1350.
No stock icons. No watermark.
```
Generate 8–10 variations, pick the one with cleanest typography (GPT Image 2's edge), post as a carousel.

### Asset 3 — Founder-Voice Explainer (Wilson's real voice + AI b-roll + AI stills)

**Use case:** 30–45s TikTok/Reels: *"Why I started Base Note / what's different from Scentbird."* You on camera (or voiceover), AI-generated b-roll of bottles + notes for cutaways, on-screen captions.

**Production recipe:**
1. Write the script yourself — 4 beats: (a) the Scentbird gotcha, (b) Base Note's honest promise, (c) how it works, (d) CTA.
2. Record your voice on phone — 30s.
3. Generate 6–8 b-roll stills via GPT Image 2 using Asset 1's spine.
4. Animate stills with Hyperframes (HTML+GSAP→MP4) or Runway Gen-4.5 image-to-video (~$0.15/sec, so ~$5 for 30s).
5. Edit in CapCut — stills on cuts, your VO on top, bold caption overlays.
6. Post natively to TikTok + Reels. No AI-disclosure label needed because the voice and POV are yours; the imagery is clearly stylized product photography.

**Distribution:** This directly addresses the anti-Scentbird honest-positioning wedge and should be the pinned TikTok and the first Reel.

---

## 6. Open Items for Wilson

1. **Loom is blocked right now.** If you have access to the video (you may have it cached or authored it), paste the key timestamps/prompts/tools named on-screen and I'll update § 1 with the real transcript and a full workflow breakdown.
2. **X post is blocked.** Screenshot or paste the post text and I'll add verified ethical flags in § 2.
3. **Immigration note (per soul.md):** No immigration assumptions were made in this doc. The "ship this week" recommendation is a creative-ops recommendation, not a timing one.

---

## Sources

- https://github.com/robonuggets/gpt-image-2-skill (skill repo — verified README content)
- https://www.buildfastwithai.com/blogs/chatgpt-images-2-0-gpt-image-2-2026 (GPT Image 2 pricing, capabilities)
- https://fal.ai/models/fal-ai/nano-banana-2 (Nano Banana 2 pricing on fal.ai)
- https://openai.com/index/introducing-chatgpt-images-2-0/ (OpenAI announcement — 403 from our side, cited for completeness)
- https://fal.ai/learn/tools/ai-image-generators (fal.ai model catalog context)
