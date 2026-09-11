## Summary

Implements the user's three Claude artifact page mappings and a one-time-first interactive homepage. Preserves Jeff's gLmqu campaign image, original product photos, and existing subscription workflows.

- Homepage: real WebGL glass vial, orbit/tilt/zoom/cap controls, 32 fragrance selections, real selected-SKU cart action, $20/$18 quotes, photo fallback and reduced motion.
- Fragrances: centered editorial catalog, working search/preference filters and shared one-time pricing.
- Product/cart: artifact-based layout, actual size/price/quantity controls, explicit Monthly Rotation consent, truthful bottle availability, correct selected-scent helper lines and price normalization.
- Marketing/audit: real product/FAQ/agent metadata, newsletter confirmation, canonical links, all 29 findings tracked, live redirect/link repairs and two researched comparison articles.

## Validation

25 Node tests pass; artifact/recovery checks pass; CLI 4.8.0 Theme Check has zero errors (108 warnings, not a zero-warning claim). Actual isolated Shopify carts verify $20 first + $18 extra, mixed-scent anchor removal, real $15 first / $20 renewal subscription, and one-time extras. Actual unpublished Shopify theme `164192813274` passes desktop/mobile 3D controls, photo fallback, preserved banner, search/filters, menu/search focus and scrolled-header contrast checks. Native newsletter/enquiry validation passes without submitting customer data. SEO verification covers real offers, metadata, 16 matching FAQ answers and all three agent/LLM endpoints; an independent sweep passed all 32 ordinary product pages. No orders, checkout payments, campaigns or customer messages were created.

## Release gate

Shopify device login is restored. Repeated CLI 3.89.0 authentication failures were resolved with a task-local official CLI 4.8.0 invocation against the canonical shop host; no global installation replacement or scope bypass was used. Fresh live theme settings/header/footer/index snapshots are identical to the earlier preserved copy. Target release theme: `164192813274`; previous live theme retained for recovery: `164190748890`. The actual unpublished-theme commerce browser checks pass, including mixed-scent base removal, native no-JavaScript add, unchecked recurring-consent prevention and zero browser errors. After publication, rerun public checks without preview parameters; record the deployed theme and source commit on this PR.

## Remaining external dependencies

Product-scoped Admin access is missing: catalog titles/descriptions/SKUs, Oud Wood handle, real browse collections and correct Merchant Center imagery remain unfinished. Full-bottle checkout needs actual bottle variants/prices/inventory. GSC readback needs an authenticated connection. The existing $18 helper approach also needs backend enforcement for direct-API tampering/inventory guarantees; this PR protects normal frontend interactions without claiming server-side validation.

See `docs/audit-resolution-20260910.md`, `docs/design/commerce-qa-20260910.md`, `docs/design/vial-reference.md`, and `docs/design/scent-studio-execution.md` for evidence and recovery steps.
