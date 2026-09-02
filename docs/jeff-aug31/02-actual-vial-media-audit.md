# PRD: Actual 5 ml vial media audit

## Outcome

Every active fragrance PDP has a verified image of the actual Base Note 5 ml vial for that fragrance, correctly mapped to the sellable variant and presented accessibly. Missing or uncertain images are visible as content gaps, not silently replaced with generic or AI-generated imagery.

## Current anchor

The PDP gallery uses Shopify product media. `sections/main-product.liquid` also exposes an optional section `vial_image` setting for the subscription box. That setting is not, by itself, proof that every product’s live gallery contains the correct vial image. The audit must account for both surfaces and their mapping to the current sellable 5 ml variant.

## Required business decisions

| Decision | Required answer |
| --- | --- |
| Canonical catalog | Approved list of active product handles and the one or more sellable 5 ml variants for each; resolve count and availability discrepancies first. |
| Definition of “actual vial” | Whether it must show the decanted Base Note atomizer, source bottle, label, cap, and/or fragrance name; approve a photo checklist. |
| Preferred PDP placement | Is the actual vial primary gallery media, a required secondary gallery image, the subscription-box image, or all applicable placements? |
| Media ownership and provenance | Who supplied each image, permission to use it, source file location, and whether retouching/background removal is allowed. |
| Gap policy | Use a clearly flagged internal gap, temporarily hide an affected SKU, or permit an approved non-vial fallback. Do not infer this choice from the theme. |
| Alt-text convention | Product-specific formula and responsibility for copy approval. |

## Inventory record

Create a single content record, one row per active product/5 ml variant, with the following fields:

| Field | Requirement |
| --- | --- |
| Product handle and Shopify product ID | Canonical identifier, not title alone. |
| 5 ml variant ID / SKU | Required for fulfillment-safe mapping. |
| Live PDP URL | The page to verify. |
| Actual-vial asset ID / source | Shopify media ID or approved DAM/source reference. |
| Placement | Primary gallery, secondary gallery, subscription-box image, or approved exception. |
| Proof of match | Reviewer confirmation that label/product/volume match the row. |
| Alt text | Specific, accurate, and non-keyword-stuffed. |
| Dimensions / crop / accessibility result | Meets agreed visual and responsive baseline. |
| Status | `verified`, `needs_retake`, `missing`, `wrong-product`, or `awaiting approval`. |
| Reviewer and date | Makes subsequent changes auditable. |

## Content, privacy, and security controls

- Use only Base Note-owned or licensed assets. Record provenance before publication; do not use a customer photo, competitor asset, or generated substitute without explicit permission and approval.
- Store high-resolution originals in the approved business asset location with least-privilege access. Shopify should receive only export-ready derivatives where appropriate.
- Do not embed personal names, customer data, EXIF location data, unpublished inventory details, or secrets in filenames, alt text, metadata, or repository commits. Strip unnecessary EXIF metadata from delivery assets.
- Limit Shopify media-edit access to designated content roles. Keep an audit record of the asset-to-product mapping and reviewer approval.
- Never declare an image “actual” merely because it visually resembles the vial. A verifier must compare the source image against the approved product/variant record.

## Delivery plan

1. Freeze the canonical product/variant list and photo definition.
2. Gather source photos, provenance records, and approved crops without publishing them.
3. Build the inventory and classify every row. Resolve `missing`, `wrong-product`, and `needs_retake` rows before content sign-off.
4. In a non-production/unpublished theme or controlled Shopify media workflow, map the approved assets to their PDP placement and write alt text.
5. Independently verify the live-ready pages at desktop and mobile sizes, then obtain content-owner approval before publishing.

## Acceptance tests

| Test | Pass condition |
| --- | --- |
| Coverage | Every active 5 ml product/variant has exactly one approved inventory row and one of the approved placement outcomes. No row remains ambiguously “done.” |
| Product correctness | A reviewer confirms the vial label and product/variant map for every `verified` row; a random second reviewer rechecks at least the agreed sample size, including edge cases. |
| PDP rendering | On desktop and mobile, the expected image loads, has no broken URL, preserves the intended crop, and thumbnails select the correct gallery image. |
| Accessibility | Each informative image has accurate alt text; decorative duplicates have empty alt text. Keyboard and screen-reader behavior remains usable. |
| Truthfulness | No generic, AI-generated, full-bottle-only, or mislabeled image is called an actual 5 ml vial. Exceptions use the approved gap policy. |
| Performance | The primary media uses Shopify-responsive sizes/lazy loading as appropriate and does not materially regress agreed PDP performance metrics. |
| Regression | Variant changes and unavailable products do not display the vial of a different product. |
| Provenance | Every published image has a recorded approved source and no prohibited metadata. |

## Dependencies and release gate

The audit is blocked by the canonical catalog decision and actual source photography. It can proceed alongside the queue-report build, but editorial product recommendations should wait for the verified catalog/media inventory. Publication requires a complete approved inventory and independent page-level QA.
