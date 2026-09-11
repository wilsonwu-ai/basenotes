# Base Note vial studio

Purpose: make a real 5 ml fragrance decant tangible on the homepage, then connect exploration to an actual Shopify vial purchase. The visual direction is luxury restraint: warm cream, forest green, silver, white paper, a single sculptural object and quiet controls. Existing Claude artifacts dictate the surrounding page design; no new bitmap concept is needed.

## References and scope

- User reference: https://x.com/daradoescode/status/2097111589002350688/video/1. Downloaded video and eight frames inspected. Interaction vocabulary: full orbit, reverse, material close-up, cap opening, reset.
- Physical reference: Jeff's current `gLmqu.jpg` Shopify banner, inspected September 10, 2026. Clear cylindrical glass, rounded foot/shoulder, polished silver cylindrical cap, white wrap label with fragrance name. The existing `snippets/vial-illustration.liquid` agrees with this shape. The old green case and square atomizer photos were inspected and deliberately not used as shape references.
- Framework reused: local Union Made `design-configurator/three-scenes.js` and `hat-scene.js` renderer, room environment, and scene/material conventions. This is a new parametric vial mesh, not a bottle photograph or a flat image rotation. Geometry and liquid are an illustrative preview derived from the banner, not a dimensional scan or claim about exact liquid color.
- No existing product photos or Jeff banner were overwritten. The banner is a progressive photo fallback.

## Integration contract

Render `{% render 'vial-studio', products: collection.products, section_id: section.id %}` inside the homepage's right column. The snippet loads its own scoped CSS and tiny module loader. Each rendered product is a real non-helper Shopify product with a 5 ml variant; up to Shopify's natural 50-product Liquid loop limit is supported, covering the current 32-fragrance collection.

`vial-studio:selection` bubbles with `{product, variantId, price, url}`. Element data attributes always reflect the current SKU. The primary button calls `window.BaseNoteCommerce.addVial({variantId, handle, title, quantity: 1, source: 'Homepage scent studio'})`; quote calls determine the actual first/additional price. If commerce cannot initialize, the button leads to the current product page. No checkout mutations happen in the render module.

The loader dynamically imports the local renderer bundle when the component comes within 180 px of the viewport. Rendering occurs only on interaction, resize, or transition; it stops offscreen/when the tab is hidden. Pixel ratio capped at 1.75. Native vertical touch scrolling is preserved; horizontal touch drag rotates. All viewpoints including tilt and zoom are available through keyboard on the focusable canvas (arrows, +, −, Home). Visible buttons offer reverse, details, cap, reset, tilt, and zoom. Reduced motion makes camera/cap state changes immediate. No automatic spinning.

## Build

```sh
NODE_PATH=/Users/wilsonwu/Desktop/unionmade/design-configurator/node_modules /Users/wilsonwu/Desktop/unionmade/design-configurator/node_modules/.bin/esbuild assets/basenote-vial-studio.js --bundle --format=esm --minify --target=es2020 --legal-comments=inline --outfile=assets/basenote-vial-studio.bundle.js
```

Three.js 0.180.0 is bundled locally under its MIT license. The bundle keeps the Three.js license block, with the full notice in `assets/basenote-vial-studio.LICENSE.txt`. No install or runtime CDN dependency is required. Built bundle: 512,434 bytes raw / 130,174 bytes gzip. Loader: 7,362 bytes; scoped CSS: 5,454 bytes. Scene: 15,082 triangles / 20 draw calls in the standalone Chromium test.

## Verification

Independent browser QA completed with Playwright Chromium + SwiftShader against a local Liquid-rendered fixture at `http://127.0.0.1:4187/` (server exits after the test). Shopify product data was fetched for Creed Aventus and Green Irish Tweed. Commerce was stubbed in this isolated fixture to avoid live cart changes; actual shared-module/cart integration remains the root agent's preview QA.

Passed: initial render; actual 3D reverse; camera drag (yaw −.19 → −1.91 and pitch .075 → .422); cap separation (cap Y 2.955 → 4.152); reset; keyboard arrows/+; reduced-motion final state equals target; live SKU/label change from Aventus to Green Irish Tweed; add-hook status; mobile layout without horizontal overflow; normal vertical touchscreen page scroll over the canvas (+223 px); forced context loss returns to the preserved photo. No page JavaScript errors. Visual checks included vial shape, silver material, glass/liquid, paper legibility, spacing, control touch targets, desktop/mobile crop and focus treatment.

Evidence screenshots: `/private/tmp/vial-studio-desktop.png`, `/private/tmp/vial-studio-open.png`, `/private/tmp/vial-studio-mobile.png`. Temporary runner: `/private/tmp/basenote-vial-studio-qa.cjs`. `node --check assets/basenote-vial-studio-loader.js` and `git diff --check` pass. Inspect a running viewer via `document.querySelector('vial-studio').model.inspect()` for camera/cap state and geometry count.

Intentional limits: the geometry is a reference-derived illustration, not photogrammetry; all fragrance previews share a neutral amber liquid. At most 50 real 5 ml products appear in this homepage selector, covering all 32 current fragrances. A WebGL failure preserves the original banner plus fully usable fragrance selection, price, product links and add flow. No new bitmap, product image overwrite, or backend inventory mutation occurs in this component.

## Independent homepage and collection visual review

While Shopify preview authentication was unavailable, `/private/tmp/basenote-root-local-visual-qa.cjs` rendered the actual homepage, collection, card, viewer, header and footer Liquid with the existing LiquidJS installation. It used all 32 public collection products, integer-cent variant prices, the real Creed Ajax product response for selling-plan allocations, and preserved header/footer group settings from the read-only live-theme capture. The current live HTML shell supplied base styling. New assets were served locally, third-party scripts removed, and commerce/form operations stubbed. This verifies local layout and render behavior, not Shopify deployment or backend form/cart processing.

The review found and corrected two scoped layout defects, with root coordination: duplicate header padding below a header already in normal flow; and an oversized mobile introduction pushing the 3D model below the first screen. The mobile heading now fits two lines, while desktop remains unchanged. At 390×844, the canvas occupies Y427–813, fully visible after the introduction. At 1440×1000, the canvas occupies Y152–610 and the viewer purchase row Y761–809. Both home and collection have no horizontal overflow or browser JavaScript errors. All 32 fragrance options render in the viewer.

Full-page review also caught mobile campaign clipping at the top-row vial caps. The mobile campaign now retains the image's square ratio, showing all of Jeff's `gLmqu.jpg`; desktop crop/asset remain unchanged. Three purchase paths, compact fragrance cards, editorial campaign and updated newsletter/footer were inspected on both sizes. Collection hierarchy was compared with `/private/tmp/jeff-latest-claude.png`: immediate green category row, centered cream headline/intro/price hierarchy, four desktop product columns, two mobile columns. Unsupported review claims from the mockup are deliberately absent.

Final full-page evidence: `/private/tmp/basenote-root-local-home-desktop-full.png`, `/private/tmp/basenote-root-local-home-mobile-full.png`. Additional viewport/region files follow `/private/tmp/basenote-root-local-{home,collection,ways,campaign,footer}-{desktop,mobile}.png`. Shopify preview, actual cart behavior and native newsletter submission remain separate root verification requirements.

The updated header's actual inline controller was subsequently checked with `BASENOTE_HEADER_QA=1 node /private/tmp/basenote-root-local-visual-qa.cjs`. At 390×844, its three-line SVG hamburger rendered, closed navigation remained inert/hidden, open navigation focused its close button, search focused its input, and both panels trapped Tab/Shift+Tab (6 navigation stops, 8 search stops). Escape and close buttons restored the correct trigger focus, cleared body scroll locking and reset expanded state. No horizontal overflow or JavaScript errors. Evidence: `/private/tmp/basenote-header-nav-mobile.png`, `/private/tmp/basenote-header-search-mobile.png`.
