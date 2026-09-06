# Safe content wave implementation record

**Reconciled:** 2026-09-06 (America/New_York)
**Branch:** `codex/content-wave-safe-2026-09-05`
**Worktree:** `/private/tmp/basenote-content-wave-safe-20260905`
**Base:** `origin/fix/july16-swap-filter-pdp-guard` at `37c3728`
**Original content commit:** `44acf49`.
**External state:** Both Shopify articles and their SEO metafields already existed when recovery resumed. FAL heroes were already generated, visually approved, copied into the media assets, and deployed as Media Worker version `c96ea7bf-8eea-439d-9221-0765c3deb557`. This recovery verified existing state and repaired the local publisher/ledger; it did not repeat Shopify article writes, image generation, or media deployment.
**PR target:** `fix/july16-swap-filter-pdp-guard`. `origin/main` has no merge base with this content branch, so targeting the original base preserves a content-only comparison without importing unrelated history.

## Delivered assets

| Asset | Handle / purpose | Publication state |
|---|---|---|
| `growth-audit/blog-post-48-best-vanilla-colognes-men.html` | `best-vanilla-colognes-men` | Live; Article `668074639578`, published `2026-09-06T14:34:01Z` |
| `growth-audit/blog-post-49-best-cologne-for-the-gym.html` | `best-cologne-for-the-gym` | Unpublished; Article `668074672346`, scheduled `2026-12-28T17:00:00Z` |
| `growth-audit/blog-manifest-content-wave-2026-09-05.json` | Exactly two rows with SEO title/description and public hero URLs | Matches both existing article states |
| `growth-audit/blog-image-jobs-content-wave-2026-09-05.json` | Exactly one deterministic hero job per article | FAL-only generated JPEGs and provenance sidecars retained |
| `growth-audit/blog-ledger.json` | Only these two article records added | IDs, states, dates, Shopify CDN images, and SEO verified against Admin |
| `scripts/blog_publish.py` | Explicit SEO aliases, complete handle lookup, independent write verification | No mutation retries; ambiguous handles fail closed |
| `scripts/gen_image.py` | Explicit FAL-only/no-OpenAI-fallback mode | Local tooling change |
| `tests/test_content_wave.py` | Tooling and editorial safety regression suite | Original 19 passed; expanded suite 27 passed |

## Publication and crawler verification

Read-only exact-handle queries returned exactly one article in blog `hub` for each handle. Both existing SEO fields exactly match their manifest values, and both Shopify CDN images have the intended alt text. No SEO repair was necessary. The initially failed publisher had misread successful writes: the namespace-qualified connection query returned keys such as `global.title_tag`, while the reader expected `title_tag`.

| Check on September 6, 2026 | Vanilla guide | Gym guide |
|---|---|---|
| URL | [Live vanilla guide](https://basenotescent.com/blogs/hub/best-vanilla-colognes-men) | [Scheduled gym route](https://basenotescent.com/blogs/hub/best-cologne-for-the-gym) |
| Browser / OAI-SearchBot HTTP status | 200 / 200 | 404 / 404, expected until scheduled publication |
| Public sitemap | Present in `sitemap_blogs_1.xml` | Absent, expected |
| Robots rules | Article route allowed | Article route allowed |
| Canonical / structured data | Exact public canonical; Article JSON-LD present | No public article page yet |
| Admin publication / SEO / image alt | Matches manifest | Matches manifest |
| Stored body vs prepared source | Matches after entity and intertag-whitespace normalization | Matches after entity and intertag-whitespace normalization |

Vanilla Open Graph title and description already match the authored SEO. At the initial live-theme check, the HTML `<title>` was overridden and the meta description truncated by theme logic. The fix in [theme PR #48](https://github.com/wilsonwu-ai/basenotes/pull/48), unpublished candidate `164045029594`, passed independent 1440px and 390px article checks: exact title, description and canonical, loaded hero, and a contained scrolling table without page overflow. Final production confirmation remains part of that separate theme release. The gym article has not been temporarily published for testing, and no signed preview URL was available through the Article API.

Stored Admin body SHA-256 values are `4ca926d0f0d01dc35b9e3783cbf879ac02220a43cfa688392417e8aa1022ca96` (vanilla) and `0d9038cb19cda706a6cb3d9068002aa4523a6de4ba89297c91f974f0b22516ac` (gym). Bodies are not byte-identical to the prepared payload because Shopify normalizes entities and inserts line breaks before `<strong>` inside list items; the normalized HTML comparison passes for both.

## Evidence and claim boundaries

The vanilla article uses five Base Note products whose public product JSON returned one available variant on September 6, 2026. The gym article uses four products meeting the same check. All nine Base Note product routes returned HTTP 200. The articles do not make Base Note price, shipping, spray-count, longevity, projection, or compliment claims.

### Vanilla guide sources

| Product | Manufacturer source used |
|---|---|
| Emporio Armani Stronger With You Intensely | [Armani Beauty](https://www.giorgioarmanibeauty-usa.com/fragrances/stronger-with-you-intensely-eau-de-parfum/ww-00180-arm.html) |
| Xerjoff Erba Pura | [Xerjoff](https://www.xerjoff.com/en-as/products/erba-pura-eau-de-parfum) |
| Versace Eros Eau de Parfum | [Versace](https://www.versace.com/us/en/eros-edp-50-ml/R740108-R050MLS.html) |
| Valentino Born in Roma Uomo Intense | [Valentino Beauty](https://www.valentino-beauty.us/fragrances/fragrances-men/born-in-roma-uomo-intense/born-in-roma-uomo-eau-de-parfum-intense-3614273790833.html) |
| Bvlgari Le Gemme Orom | [Bvlgari](https://www.bulgari.com/en-int/fragrances/bvlgari-le-gemme/42180.html) |

The two gated Parfums de Marly products are absent from the article, manifest, and image brief. The page presents note-based style selection rather than an unsupported performance ranking.

### Gym guide sources

| Topic / product | Authoritative source used |
|---|---|
| Individual asthma triggers; some chemicals or fragrances; fast breathing during exercise | [CDC: Controlling Asthma](https://www.cdc.gov/asthma/control/index.html) |
| Environmental-odor sensitivity and increased odor intake during exercise | [ATSDR: Understanding Your Risk for Environmental Odors](https://www.atsdr.cdc.gov/odors/populations-at-risk/index.html) |
| Creed Silver Mountain Water | [Creed](https://creedboutique.com/products/silver-mountain-water) |
| Xerjoff Torino21 | [Xerjoff](https://www.xerjoff.com/en-ie/products/torino21-eau-de-parfum-15ml) |
| Acqua di Gio Profondo Parfum | [Armani Beauty](https://www.giorgioarmanibeauty-usa.com/fragrances/acqua-di-gio-profondo-parfum/A2772.html) |
| Dolce & Gabbana Light Blue Pour Homme Eau de Parfum | [Dolce & Gabbana](https://www.dolcegabbana.com/en-us/beauty/perfumes-for-him/light-blue-pour-homme/light-blue-pour-homme-eau-de-parfum---VT034DVT0009V000.html) |

The article explicitly labels the combined CDC/ATSDR etiquette conclusion as Base Note's inference. It does not claim that the public-health sources tested or ranked any fragrance, and it makes no hypoallergenic or asthma-safe claim.

## Internal-link gate

Every internal URL used in the two articles returned HTTP 200 on September 6, 2026. Product variants also reported available. Only currently public articles were linked; scheduled-but-not-yet-public handles were excluded. This availability evidence is time-bound and should be refreshed for future editorial updates.

## Shopify SEO implementation

Shopify's Admin GraphQL `Article` does not have a native `seo` field, and `ArticleCreateInput` / `ArticleUpdateInput` do not accept a native `seo` object. Shopify documents article search listings through two metafields instead:

- `global.title_tag`
- `global.description_tag`
- type: `single_line_text_field`

See [Shopify: Optimize storefront SEO](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) and [Shopify: Article GraphQL object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Article).

The store's pinned `2025-10` schema was also checked through read-only introspection: `Article` exposes `metafield` / `metafields`, both article input types accept `metafields`, and none exposes a native `seo` field. The corrected publisher query was exercised against both existing articles without changing them. It loads `titleSeo: metafield(namespace: "global", key: "title_tag")` and `descriptionSeo: metafield(namespace: "global", key: "description_tag")`, following Shopify's [explicit namespace/key read pattern](https://shopify.dev/docs/apps/build/metafields/manage-metafields).

The publisher now:

1. accepts `seo_title` and `seo_description` from a manifest or single-post CLI flags;
2. validates nonblank values at conservative 60/160-character limits;
3. creates the two `global` metafields for new articles;
4. reads existing metafield IDs and updates by ID for existing articles, as Shopify requires;
5. performs an independent exact-handle read after create/update, verifies the returned article ID, SEO values, publication state/schedule, and image presence/alt text before storing the verified record in the ledger;
6. paginates the complete handle search and fails closed on duplicate exact matches or an incomplete cursor response, instead of selecting an arbitrary article;
7. surfaces uncertain mutation responses and readback mismatches without retrying a create; and
8. reports `seo=ok`, `seo=DIFF`, `seo=missing`, or `seo=n/a` in `--verify`.

`--validate-only` builds full article inputs locally before any credential lookup or network request. `--dry-run` remains a Shopify read that performs no write.

## Approved images retained

Both generated heroes use `fal-ai/nano-banana-2`, 16:9, 2K, with FAL-only behavior. The global `--fal-only` flag and each job's `fal_only: true` independently disable the OpenAI fallback. The approved JPEGs and `.prompt.json` sidecars are included in this branch; their Worker copies are byte-identical.

| Hero | Public URL | SHA-256 of generated and Worker copy |
|---|---|---|
| Vanilla | [Hero JPEG](https://basenote-media.wilson-af8.workers.dev/img/best-vanilla-colognes-men/hero.jpg) | `399944e97927517ecdce73b17e3d758b95ebf7471403a5377ea07529fdec7613` |
| Gym | [Hero JPEG](https://basenote-media.wilson-af8.workers.dev/img/best-cologne-for-the-gym/hero.jpg) | `462cbdbfc1cfeef06bebd5912e06a0ae3d895bd5f6a2d35b6c46ed545f949c0a` |

Both public Worker URLs returned HTTP 200 with `image/jpeg`. The manifest points to those existing URLs. Shopify hosts the imported article images on its own CDN, as recorded in the ledger.

The two article writes and image deployment are complete. Future recovery should query the exact handles and compare existing state before considering another write. The manifest remains publication-capable; use `--validate-only` for offline checks and `--dry-run` for a read-only update/create decision.

## Local QA record

```text
python3 -B -m unittest discover -s tests -v
Original 19 tests ... OK
Expanded 27 tests ... OK

python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest-content-wave-2026-09-05.json --validate-only
VALID best-vanilla-colognes-men ... pub=now
VALID best-cologne-for-the-gym ... pub=2026-12-28T17:00:00Z
```

Additional checks passed: JSON parsing, exactly two manifest rows, exactly one `publish_now` plus one later schedule, exactly two one-to-one deterministic FAL hero jobs, existing public image URLs, SEO length limits, current-link allowlist, gated-product omission, public-health/manufacturer source presence, visible disclosures/direct answers/tables/FAQs, and no numeric price or performance claims. `git diff --check` passed. Read-only Admin verification matched both source bodies and the two reconciled ledger records; all other ledger rows were preserved.
