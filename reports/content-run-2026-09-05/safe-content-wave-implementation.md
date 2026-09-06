# Safe content wave implementation record

**Prepared:** 2026-09-06 (America/New_York)
**Branch:** `codex/content-wave-safe-2026-09-05`
**Worktree:** `/private/tmp/basenote-content-wave-safe-20260905`
**Base:** `origin/fix/july16-swap-filter-pdp-guard` at `37c3728`
**External writes:** none. No Shopify create/update/publish, theme deployment, media upload, or billable image generation was performed.

## Delivered assets

| Asset | Handle / purpose | Publication state |
|---|---|---|
| `growth-audit/blog-post-48-best-vanilla-colognes-men.html` | `best-vanilla-colognes-men` | Local source only |
| `growth-audit/blog-post-49-best-cologne-for-the-gym.html` | `best-cologne-for-the-gym` | Local source only |
| `growth-audit/blog-manifest-content-wave-2026-09-05.json` | Exactly two rows with Shopify SEO title/description | Vanilla is marked `publish_now`; gym is scheduled for `2026-12-28T17:00:00Z`; no image URL |
| `growth-audit/blog-image-jobs-content-wave-2026-09-05.json` | Exactly one deterministic hero job per article | Prompts only; both pin FAL and `fal_only: true` |
| `scripts/blog_publish.py` | SEO metafield input/readback and credential-free validation | Local tooling change |
| `scripts/gen_image.py` | Explicit FAL-only/no-OpenAI-fallback mode | Local tooling change |
| `tests/test_content_wave.py` | Tooling and editorial safety regression suite | 19 local tests |

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

Every internal URL used in the two drafts returned HTTP 200 on September 6, 2026. Product variants also reported available. Only currently public articles were linked; scheduled-but-not-yet-public handles were excluded. Recheck all routes and product availability immediately before any Shopify draft creation because this evidence is time-bound.

## Shopify SEO implementation

Shopify's Admin GraphQL `Article` does not have a native `seo` field, and `ArticleCreateInput` / `ArticleUpdateInput` do not accept a native `seo` object. Shopify documents article search listings through two metafields instead:

- `global.title_tag`
- `global.description_tag`
- type: `single_line_text_field`

See [Shopify: Optimize storefront SEO](https://shopify.dev/docs/apps/build/marketing/optimize-storefront-seo) and [Shopify: Article GraphQL object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Article).

The store's pinned `2025-10` schema was also checked through read-only introspection: `Article` exposes `metafield` / `metafields`, both article input types accept `metafields`, and none exposes a native `seo` field. The patched query successfully read the two keyed SEO metafields from an existing live article without changing it.

The publisher now:

1. accepts `seo_title` and `seo_description` from a manifest or single-post CLI flags;
2. validates nonblank values at conservative 60/160-character limits;
3. creates the two `global` metafields for new articles;
4. reads existing metafield IDs and updates by ID for existing articles, as Shopify requires;
5. queries the two metafields after create/update, fails visibly if either returned value differs from the request, and stores returned values in the ledger; and
6. reports `seo=ok`, `seo=DIFF`, `seo=missing`, or `seo=n/a` in `--verify`.

`--validate-only` builds full article inputs locally before any credential lookup or network request. `--dry-run` remains a Shopify read that performs no write.

## Safe image and publication workflow

1. Human-review both article bodies, manufacturer links, current product availability, hero prompts, and alt text.
2. Confirm permission for billable generation and ensure `FAL_KEY` or `FAL_API_KEY` is available. No key is required for the current source-only review.
3. Generate only after approval:

   ```sh
   python3 scripts/gen_image.py --batch growth-audit/blog-image-jobs-content-wave-2026-09-05.json --fal-only
   ```

   The global flag and each job's `fal_only: true` independently disable the OpenAI Images fallback. Failure of the pinned FAL model stops that job instead of spending through another provider.
4. Review both generated JPEGs and their `.prompt.json` provenance sidecars. Reject artifacts, misleading branded bottle shapes, labels, logos, or illegible glass. Do not upload an unreviewed image.
5. Upload approved images through the existing media workflow, then add the returned public URL to the matching manifest row as `image_url`. Preserve the existing `image_alt`.
6. Re-run credential-free validation:

   ```sh
   python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest-content-wave-2026-09-05.json --validate-only
   ```

7. With `SHOPIFY_ADMIN_API_ACCESS_TOKEN` available, run `--dry-run` and exact-handle checks. Confirm both handles are still unique and review the two intended states: vanilla `now`, gym `2026-12-28T17:00:00Z`.
8. Treat the manifest as publication-capable: running it without `--dry-run` will publish the vanilla article immediately and schedule the gym article. Do that only after explicit approval for those external Shopify writes and after approved hero image URLs have been added.
9. Read back Admin/publication state and both SEO metafields. Review the live vanilla page plus the gym preview and rendered `<title>` / meta description.

## Local QA record

```text
python3 -m unittest discover -s tests -v
Ran 19 tests ... OK

python3 scripts/blog_publish.py --manifest growth-audit/blog-manifest-content-wave-2026-09-05.json --validate-only
VALID best-vanilla-colognes-men ... pub=now
VALID best-cologne-for-the-gym ... pub=2026-12-28T17:00:00Z
```

Additional checks passed: Python compilation, JSON parsing, exactly two manifest rows, exactly one `publish_now` plus one later schedule, exactly two one-to-one deterministic FAL hero jobs, SEO length limits, no image URLs, current-link allowlist, gated-product omission, public-health/manufacturer source presence, visible disclosures/direct answers/tables/FAQs, and no numeric price or performance claims.
