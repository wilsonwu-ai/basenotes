# Base Note — July 16 Tickets: Solution Design (Task 3)

> Applies Wilson's **LeetCode framework** (Understand → Constraints → Brute-force → Optimize →
> Complexity → Edge cases → Scale/Secure/Stabilize) to each fix, then a system-wide 10,000×
> scale/security/stability analysis. Companion to `PRD.md`.

---

## §0 — Shippable subset vs. decision-gated work

| Item | Nature | Can ship autonomously now? |
|------|--------|----------------------------|
| **A — swap filter** | Self-contained theme fix (Liquid + JS) | ✅ **Yes** — no external deps, low risk, fixes a broken core flow at every swap/pick entry point |
| **D — theme safety-guard** | Small theme guard (CTA can't silently add one-time when `size==0`) | ✅ **Yes** — pure defense-in-depth |
| **D — attach products to Appstle plan** | **Data action in Appstle admin** | ❌ **No** — I can't access Appstle admin; needs Wilson (and identifying the SKU) |
| **B — facet rebuild in modal** | Medium build; needs live Search & Discovery mapping | ⚠️ Design-ready; needs Wilson's Q7/Q8 decisions |
| **C — subscriber gating** | Worker + theme; net-new metafield | ⚠️ Design-ready; needs Wilson's Q9/Q10 decisions |

**Recommendation:** ship **A** (+ **D-guard**) in this loop; deliver **B/C** as approved designs; hand
Wilson the **D data action**. Rationale below.

---

## §1 — Bug A: swap-modal filter (LeetCode framework)

### Understand
Filtering the "Choose Your Fragrance" swap modal by any category empties the grid. Every swap/pick
entry point on the account page opens this one modal, so the whole rotation-building flow is
effectively unusable with filters.

### Constraints (hard invariants — from PRD §6)
1. Preserve `fragrance:selected` event contract `{id,handle,title,image,family}` (queue writes key off it).
2. Preserve `data-product-id/handle/title/image` on `.fs-card__select` (feed the Appstle swap bridge).
3. Client-side only; no build step; runs on Shopify's CDN. Vanilla JS + Liquid.
4. Family data source is **unreliable** in this render context (likely a list metafield that
   `| downcase` can't stringify → falls back to `product.type`="Fragrance").
5. Grid is `limit: 20` from `settings.sub_fragrance_collection || 'all'`.

### Brute-force
Rewrite the 8 tab tokens to the real vocabulary (Aquatic/Citrus/…). **Rejected:** still depends on
the broken family derivation; hardcoding is brittle (new families won't appear, removed ones leave
dead tabs); doesn't reconcile tab scope with the `limit: 20` grid scope → can reproduce empty tabs.

### Optimized approach — **derive family robustly + generate tabs dynamically + delimiter-safe match**
1. **Robust family derivation** (metafield-type-agnostic). Replace L54 with logic that:
   - reads `product.metafields.custom.fragrance_family.value`;
   - if it's a list → join the array; if a single string → use it; if it looks comma/`, `-delimited → split;
   - **fallback chain:** metafield → curated tag subset → `product.type`;
   - normalize to a lowercase, **pipe-delimited** token string, e.g. `"|fresh|citrus|"`.
   ```liquid
   {%- assign ff = product.metafields.custom.fragrance_family.value -%}
   {%- if ff == blank -%}{%- assign ff = product.type -%}{%- endif -%}
   {# join handles both array (list metafield) and string #}
   {%- assign fam_norm = ff | join: '|' | replace: ', ', '|' | replace: ',', '|' | downcase -%}
   {%- assign fam_key = '|' | append: fam_norm | append: '|' -%}   {# "|fresh|citrus|" #}
   ```
2. **Dynamic tabs** — build the tab list from the **distinct families actually present in the
   rendered set** (union across the ≤20 cards). Guarantees **every tab has ≥1 product** → the
   empty-grid class of bug becomes structurally impossible, and it self-adapts to the catalog.
3. **Delimiter-safe match** — store `data-fs-family="{{ fam_key }}"`; the JS matches
   `cardFamily.indexOf('|'+token+'|') !== -1`. Kills false-substring hits (`fresh`⊄`freshwater`) and
   correctly surfaces multi-family products under multiple tabs.
4. Keep the human-facing card label (`.fs-card__family`) and the `data-product-family` payload
   rendering the **display** family (title-case, un-normalized) so queue-card labels don't change.

### Complexity
- Liquid render: O(P·F), P≤20 products, F families/product → trivial.
- Client filter: O(cards) per click → trivial.
- No pagination/network. Zero server cost.

### Edge cases
- No family at all → excluded from generated tabs, still visible under **All** (keep `product.type`
  fallback so it's never blank-hidden).
- Multi-family (list) → appears under each of its tabs (correct).
- Empty collection → existing `.fs-empty` message.
- A family whose only products are beyond `limit: 20` → **impossible to strand** now, because tabs
  are generated from the *rendered* set (tab scope == grid scope). *(If we later raise the limit,
  both move together.)*

### Scale (10,000× users)
**No scale sensitivity.** The modal is server-rendered Liquid on Shopify's CDN (scales with
Shopify) and the filter is 100% client-side (zero marginal server cost per user). This fix does not
touch the Worker/App-Proxy/Appstle path — the only scale-sensitive layer (see §5).

### Security
Operates entirely on already-public product data (`data-product-*` are already in the DOM). No new
input, no injection surface, no auth. Net-zero attack surface delta.

### Stability
Self-contained in `snippets/fragrance-selector.liquid`. Preserving the event contract +
`data-product-*` payload = the Appstle swap bridge is untouched. Dynamic tabs remove the entire
"tab token ↔ data vocabulary drift" failure mode permanently, not just today's instance.

---

## §2 — Bug D: PDP loses subscribe + discount, adds one-time (LeetCode framework)

### Understand
A product **not attached to the Appstle selling-plan group** (`selling_plan_groups.size == 0`)
renders no subscribe control and **silently adds to cart as a one-time purchase** — a revenue leak
(no recurring billing, no first-month discount, no Appstle contract → no renewal/swap).

### Constraints
- The true fix is **data** (attach the SKU to the plan in Appstle) — outside code, needs admin.
- A theme guard must not block **intentionally** one-time SKUs (samples/full bottles) if any exist.
- Must not emit a garbage `selling_plan` (→ `/cart/add.js` 422). Removing the `size>0` guard is a trap.

### Approach (two layers)
1. **Data (Wilson / Appstle admin):** sweep all SKUs; attach any with `size==0` to the subscription
   selling-plan group; verify each variant gets a `plan_allocation`. Zero Liquid change; restores
   subscribe controls, plan-default, cart treatment, and Appstle billing.
2. **Theme guard (I can ship):** when `product.selling_plan_groups.size == 0`, **disable** the
   "Start My Subscription" CTA and show an unavailable/notify state instead of letting it add a
   one-time line. Optional: a Liquid `{% if %}` that hides the "$20/MONTH" affordances for
   unattached products so the card never *claims* subscription it can't honor.

### Complexity / Scale / Security / Stability
- The guard is a compile-time Liquid branch — O(1), no runtime cost, scales natively.
- Security: none (server-rendered gate).
- Stability: gate is additive; verify it doesn't fire on any legitimate one-time SKU (Q6). The
  data fix is inherently stable once each variant has a `plan_allocation`.
- **Do NOT** write `$18/10%` into `settings_data.json` (schema already yields $15/25% — see PRD §3 ⚠).

---

## §3 — Issue B: unify swap-modal filters with the fragrance page (design sketch)

**It's a rebuild, not a port** (PRD §4). The collection page's facets come from Shopify Search &
Discovery (`collection.filters`) which the modal's render context can't access.

Design: emit the subscription collection as an **inline JSON feed** (or full Liquid iteration),
compute per-facet counts (Family / Brand / Season / Occasion) **in Liquid**, render checkboxes with
an **in-modal client-side Apply** (the modal can't full-navigate mid-swap), reuse the collection
page's mobile-drawer CSS/JS, and port the purchase-history "Not Tried Yet" logic verbatim.
**Blocked on:** live Search & Discovery facet→attribute mapping (Q7), especially Occasion (no
metafield today — only `event:` tags), and the URL-persistence vs pure-client decision (Q8).

*Note: the Bug A dynamic-tab fix is the minimal first step of B — it already moves the modal onto
real product-derived facets. B extends that to the full multi-facet + counts + Apply UX.*

---

## §4 — Issue C: subscriber-vs-prospect PDP treatment (design sketch)

**Two-tier signal** (PRD §5):
1. **First paint:** Worker stamps `customer.basenote.subscription_status` (`active|paused|cancelled`
   + `next_bill_date`) whenever it already resolves the contract (`worker/queue-proxy/src/index.ts:
   469-471`); theme reads that one cheap metafield at PDP render.
2. **Enable actions:** confirm client-side via the already-loaded `BasenoteAppstleSwap` contract
   fetch before enabling a swap (so a stale metafield can't fire a swap on a paused/cancelled contract).

PDP gating: logged-out/none → "Start My Subscription"; **ACTIVE** → contextual actions ("Swap into
next month's box" → `BasenoteAppstleSwap.swap()`; "Add to a future month" → `BasenoteQueue.setSlot`);
**paused/cancelled** → Reactivate. Reconcile with account-page `is_subscriber` to avoid divergent
truths; fix the latent unset-`subscriber`-tag dependency at `checkout-thank-you.liquid:513`.
The **"add extra vial to *this* month + upsell discount"** sub-ask has **no code path** — net-new
build (needs an Appstle add-on capability + discount rule). **Blocked on** Q9/Q10.

---

## §5 — The 10,000× question: system-wide scale, security, stability

The **theme** (PDP, collection, swap modal, cart) is server-rendered on Shopify's CDN and scales
with Shopify — effectively unbounded, no action needed. The scale-sensitive surface is the **custom
cross-device stack**: Cloudflare Worker (`basenote-queue-proxy`) ↔ Shopify App Proxy ↔ Appstle API
↔ Shopify Admin API. Under a 10,000× traffic spike:

### Bottlenecks
1. **Appstle API rate limits** — the Worker calls Appstle to resolve/replace contracts on every
   slot-0 swap. Appstle throttles per-store; 10,000× concurrent swaps → 429 storms.
2. **Shopify Admin API rate limits** — metafield writes (`customer.basenote.queue`, and the proposed
   `subscription_status`) are cost-limited (GraphQL ~1000 pts/s; REST 2 req/s). Bursty writes throttle.
3. **App Proxy** — HMAC verify is cheap; not a bottleneck.
4. **localStorage** — per-device, zero server cost; the design already treats it as the source of
   truth with async Appstle/metafield sync — a good scale property (user path isn't blocked on Appstle).

### Make it scalable
- **Cache** Appstle contract lookups in Workers KV / Cache API (short TTL, per-customer key) to
  collapse repeat reads; invalidate on write (the bridge already invalidates lineId post-replace).
- **Queue + backoff** — route Appstle/Shopify writes through **Cloudflare Queues** with exponential
  backoff + retry, decoupling the user path from downstream rate limits (write returns fast; sync
  settles async — consistent with the existing debounced-push + localStorage-authoritative model).
- **Batch** metafield writes (coalesce rapid queue edits — client already debounces; add server-side
  coalescing per customer).
- **Idempotency keys** on swaps so retries under backoff can't double-apply a replace-variants.

### Make it stable
- **Circuit breaker** — if Appstle is down, keep serving from localStorage + metafield and reconcile
  on recovery (design already tolerates this; formalize it).
- **Preserve every swap-bridge invariant** under concurrency: `swap()` serialization prevents racing
  replaces from stranding a contract on a stale variant (PRD §6.5). At 10,000× this matters more.
- **Observability** — structured logs + alerting on Appstle/Shopify 429s and swap failures.

### Make it secure (at any scale)
- **Trust the signed customer id.** The Worker must derive `customer_id` from the **HMAC-signed App
  Proxy params**, never a client-supplied body field — else customer X could edit customer Y's queue.
  *(Verify this invariant during implementation — high-priority.)*
- **Per-customer rate-limit** at the Worker to blunt a malicious client spamming swaps.
- **Secrets** in Worker secrets (Appstle key, Shopify Admin token); **rotate the leaked `shpss_`**
  (open hygiene item from prior session) and sync the stale `.env` `SHOPIFY_API_SECRET`.
- **No PII in URLs/query strings** (privacy rule); metafields hold only queue/status, no card data.

---

## §6 — Recommended plan into tasks 4–7

1. **Ship now (this loop):** Bug **A** fix + Bug **D** theme guard. Both are self-contained,
   low-risk, and address live customer-facing breakage. Route through task 4 (brand/UX design
   check) → task 5 (implement) → task 6 (QA) → task 7 (commit/push).
2. **Hand to Wilson (can't do autonomously):** attach the unconfigured SKU(s) to the Appstle
   selling-plan group (Bug D data fix); confirm which SKU Mike hit.
3. **Deliver as approved designs, implement on Wilson's go:** B (facet rebuild) and C (subscriber
   gating) — both are larger and gated on his Q7–Q10 decisions.
