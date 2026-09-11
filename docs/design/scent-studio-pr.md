## Summary

Implements the user's three Claude artifact page mappings and a one-time-first interactive homepage. Preserves Jeff's gLmqu campaign image, original product photos, and existing subscription workflows.

- Homepage: real WebGL glass vial, orbit/tilt/zoom/cap controls, 32 fragrance selections, real selected-SKU cart action, $20/$18 quotes, photo fallback and reduced motion.
- Fragrances: centered editorial catalog, working search/preference filters and shared one-time pricing.
- Product/cart: artifact-based layout, actual size/price/quantity controls, explicit Monthly Rotation consent, truthful bottle availability, correct selected-scent helper lines and price normalization.
- Marketing/audit: real product/FAQ/agent metadata, newsletter confirmation, canonical links, all 29 findings tracked, live redirect/link repairs and two researched comparison articles.

## Validation

22 Node tests pass; artifact/recovery checks pass; Theme Check has zero errors. Actual isolated Shopify carts verify $20 first + $18 extra, anchor removal, real $15 first / $20 renewal subscription, and one-time extras. Desktop/mobile local Liquid projections pass overflow/console/visual checks. No orders, checkout payments, campaigns or customer messages were created.

## Do not merge yet

Shopify's saved deployment authentication stopped working after the preservation pull. The upload is waiting for fresh device login. No new theme is published. Final unpublished-Shopify-theme rendering, SEO verifier and newsletter backend checks must pass before merge/publication. Local projections and injected-asset backend tests are deliberately identified separately from full preview QA.

## Remaining external dependencies

Product-scoped Admin access is missing: catalog titles/descriptions/SKUs, Oud Wood handle, real browse collections and correct Merchant Center imagery remain unfinished. Full-bottle checkout needs actual bottle variants/prices/inventory. GSC readback needs an authenticated connection. The existing $18 helper approach also needs backend enforcement for direct-API tampering/inventory guarantees; this PR protects normal frontend interactions without claiming server-side validation.

See `docs/audit-resolution-20260910.md`, `docs/design/commerce-qa-20260910.md`, `docs/design/vial-reference.md`, and `docs/design/scent-studio-execution.md` for evidence and recovery steps.
