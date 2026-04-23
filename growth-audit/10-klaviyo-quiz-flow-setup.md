# Klaviyo Flow: Quiz Taker Welcome Series

**Status:** Email templates created via API. Flow needs to be assembled in Klaviyo admin (5-minute task). The Klaviyo Flows API doesn't fully support programmatic flow creation, so the trigger + timing has to be wired in the UI.

## What's already done (by Claude via API)

- **Metric created**: `Completed Scent Quiz` (id: `UjG7aM`, integration: API). The scent quiz on `/pages/find-your-scent` fires this event client-side with 5 quiz-answer properties attached.
- **4 email templates created** and ready to drop into a flow:

| Step | Template name in Klaviyo | Template ID | Subject line |
|---|---|---|---|
| 1 | `BN — Quiz 1 / Scent profile welcome` | `TjiwWg` | Your Base Note scent profile is ready |
| 2 | `BN — Quiz 2 / Flat price explainer` | `S5grH2` | One flat price, even for Creed Aventus |
| 3 | `BN — Quiz 3 / How a Base Note month works` | `TeFgAS` | How your monthly fragrance actually shows up |
| 4 | `BN — Quiz 4 / Last nudge (offer expiring)` | `QPektL` | 25% off your first month expires this week |

## What Wilson does in Klaviyo admin (~5 minutes)

1. Sign in to Klaviyo → **Flows** → **Create Flow** → **Create From Scratch**.
2. Name the flow: `Quiz Taker Welcome Series`.
3. **Trigger**: **Metric** → pick `Completed Scent Quiz`. Leave filters empty (fire on every occurrence).
4. In the flow builder canvas:
   - Drag an **Email** block right after the trigger → click **Edit Email** → select **Use an existing template** → pick `BN — Quiz 1 / Scent profile welcome`. Set subject to `Your Base Note scent profile is ready`. Save.
   - Drag a **Time Delay** block → 1 day.
   - Drag another **Email** block → `BN — Quiz 2 / Flat price explainer`. Subject: `One flat price, even for Creed Aventus`.
   - **Time Delay** → 2 days.
   - **Email** → `BN — Quiz 3 / How a Base Note month works`. Subject: `How your monthly fragrance actually shows up`.
   - **Time Delay** → 4 days.
   - **Email** → `BN — Quiz 4 / Last nudge (offer expiring)`. Subject: `25% off your first month expires this week`.
5. **Flow filter** (recommended): under Flow Settings, add a filter **"Placed Order zero times since starting this flow"** so paying subscribers don't keep getting the nudge emails.
6. **Smart Sending**: enable (prevents spamming the same recipient multiple times in 16 hours).
7. Toggle flow to **Live**.

Total send cadence: 4 emails over 7 days for every person who completes the scent quiz and provides an email.

## Personalization note

Email 1 references `{{ person|lookup:'scent_profile' }}` and `{{ first_name|default:"there" }}`. The scent quiz only captures email + quiz answers (`scent_profile`, `q1_setting`, `q2_season`, `q3_profile`, `q4_projection`, `q5_notes`) — no first name. Klaviyo will render `{{ first_name }}` as the default value "there" for quiz-captured profiles. If you want to personalize further later, add a hidden "name" field to the quiz and write it through as a profile property.

## Testing before going live

1. In Klaviyo admin → Flows → Quiz Taker Welcome Series → click **Preview & Test** → send preview to your own email for each of the 4 emails. Check rendering on desktop + mobile.
2. Take the scent quiz on `basenotescent.com` in an incognito browser with a throwaway email (e.g., `wilson+test1@basenotescent.com`). Within 1 minute you should see the new profile in Klaviyo and Email 1 landing in the inbox.

## Why the emails are structured this way

- **Email 1 (immediate)**: Payoff. They gave you an email — you owe them the scent profile they were promised + 3 concrete picks. Doubles as a CTA moment (first-month $15).
- **Email 2 (+24h)**: Positioning. Explains the anti-Scentbird wedge. Links to the honest comparison blog post (internal SEO + social proof).
- **Email 3 (+3d)**: Product experience. Removes remaining operational objections — cancellation, how a 5ml actually plays, the rotation concept.
- **Email 4 (+7d)**: Last nudge. Soft-urgency on the 25% off. Explicit "if this isn't for you, that's fine" — maintains trust instead of burning it with hard-sell.

## Maintenance

- If you change the offer (e.g., 25% → 30%), update Email 1 and Email 4 in the template editor. The flow picks up template changes live.
- If the quiz adds or removes questions, the event properties change. Existing emails don't break (Klaviyo falls back to defaults) but new emails can use the new properties.

## Related artifacts

- Scent quiz section: `sections/scent-quiz.liquid` (email gate + Klaviyo event fire)
- Private API key: `.env` → `KLAVIYO_PRIVATE_API_KEY`
- Public API company ID (used client-side in quiz): `VbjRT8`
