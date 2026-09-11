# Cart feedback verification · September 10, 2026

## Change and scope

The collection previously wrote its success message below the entire product grid, so the visible result could be only the header cart count. The existing in-flight guard did not solve that missing viewport feedback.

`cart-feedback` now shows a restrained ivory/forest-green, non-modal confirmation after the shared Shopify commerce API resolves successfully. It names the scent and quantity and supplies a native View cart link and a 44px close button. Repeated success announcements use a permanent polite live region without moving keyboard focus. Error messages use the same visible surface and direct customers to review their cart, without claiming that an ambiguous failed operation left the cart unchanged.

The clicked card says “Adding…” during its request. Every catalog add button is disabled until that request settles; unavailable buttons retain their prior disabled state. Six taps during one request cannot enqueue six adds. A later intentional add remains available. The original price label nodes are restored and repriced by the existing shared API. No pricing-engine changes, new discounts, merchant-photo changes, homepage composition changes, or product mutations were made.

The notification stays until explicitly closed or replaced by a later result. This intentional alternative to an eight-second timeout keeps the View cart action available for slower readers and avoids timer/focus races. Close returns focus to the initiating button only when focus was inside the notification. A native manual popover is used where available, with fixed-position behavior otherwise. Reduced motion removes the entrance animation.

## Files

- `snippets/cart-feedback.liquid`: translated markup, scoped visual tokens and responsive/reduced-motion styling.
- `assets/scent-storefront.js`: reusable feedback controller and enhanced catalog request feedback/locking.
- `layout/theme.liquid`: one approved snippet render inside MainContent; no structural redesign.
- `locales/en.default.json`: `cart.feedback` English strings.
- `scripts/test-cart-feedback.cjs`: five focused behavior/guard tests.
- `scripts/verify-cart-feedback.cjs`: durable desktop/mobile, preview/live verification.

## Verification

The actual deployed unpublished theme **164195827930** passed the durable browser verifier, with no local asset substitution, at 1440×1000 and 390×844:

| Check | Result |
|---|---|
| Six rapid taps while the real add request is held | Exactly one add; no premature success |
| First Aventus vial | Actual cart $20, one item |
| Later intentional Green Irish Tweed add | Actual $18 additional vial, total $38; correct selected scent/source identity |
| Controlled browser-only 422 response | Visible error, no additional item, no fallback or automatic retry |
| View cart | Native link opened the actual $38 cart |
| Focus and close | Opening did not focus the panel; keyboard close restored the originating button |
| Touch targets | Close 44×44px, View cart 44px high |
| Mobile and motion | Notification entirely inside viewport, no horizontal overflow; reduced-motion animation `none` |
| Browser errors | Zero in both contexts |

Both fresh isolated carts were cleared. No checkout, orders, customer forms, or customer sessions were used. The 422 is deliberately injected only in the isolated test browser; it does not alter any product or production configuration.

Screenshots inspected for hierarchy, contrast, wrapping, placement, touch targets and consistency with the current storefront:

- `/private/tmp/basenote-feedback-preview-qa/feedback-success-1440.png`
- `/private/tmp/basenote-feedback-preview-qa/feedback-success-390.png`
- `/private/tmp/basenote-feedback-preview-qa/feedback-error-1440.png`
- `/private/tmp/basenote-feedback-preview-qa/feedback-error-390.png`

Before upload, the same tests also passed with an explicitly labeled local feedback overlay and the real Shopify cart API. That preliminary evidence is separate from the deployed preview pass above.

`node --test scripts/test-cart-feedback.cjs scripts/test-scent-studio-commerce.cjs scripts/test-header-controller.cjs scripts/test-order-surfaces-helper-guard.cjs`: **30 passed**.

Shopify Theme Check: **0 errors, 92 existing warnings**; no feedback-snippet offenses. The skill's separate validator could not start because its local `@shopify/theme-check-common` dependency is absent, so installed Shopify Theme Check was used instead.

## Re-run

`node scripts/verify-cart-feedback.cjs THEME_ID` verifies the exact unpublished theme. Explicit `--live` verifies that exact theme as role `main`, without preview parameters. `BASENOTE_PLAYWRIGHT_PATH` can identify the installed Playwright module; `BASENOTE_QA_OUTPUT_DIR` selects the screenshot directory. `--local-assets` is an explicitly labeled development-only overlay and is not a substitute for deployed preview/public verification.

Root owns publication and post-publication verification. This worker did not commit or publish.

## Root public verification

Root committed/pushed **6c00af7**, then published theme **164195827930**. The same durable verifier passed on the public main theme with `--live` and no local overlays/preview parameters at both widths. Screenshot directory: `/private/tmp/basenote-feedback-live-qa`. All cart, error, focus, target-size and motion assertions above passed again; only isolated test carts were cleared. Public SEO and Jeff collection-fidelity checks also passed. The previous theme **164193468634** is retained for rollback.
