#!/usr/bin/env node
'use strict';
// Usage: node scripts/verify-scent-studio-commerce-preview.cjs THEME_ID [--live]
// Default is unpublished preview QA. --live deliberately verifies the same
// expected theme ID as the published storefront, without a preview cookie.
// Requires Playwright (or BASENOTE_PLAYWRIGHT_PATH). Creates and clears only
// fresh isolated test carts. Never submits checkout, orders, or customer forms.
const { chromium } = require(process.env.BASENOTE_PLAYWRIGHT_PATH || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const output = process.env.BASENOTE_QA_OUTPUT_DIR || require('node:os').tmpdir();
fs.mkdirSync(output, { recursive: true });
const artifact = (name) => path.join(output, `scent-studio-${name}.png`);
const assert = require('node:assert/strict');
const theme = process.argv[2];
const live = process.argv.includes('--live');
if (!/^\d+$/.test(theme || '')) throw new Error('Provide the expected Shopify theme ID.');
const origin = 'https://basenotescent.com';
const preview = (path) => { const url = new URL(path, origin); if (!live) url.searchParams.set('preview_theme_id', theme); return url.href; };
const cartSummary = (cart) => ({ total_price: cart.total_price, item_count: cart.item_count, currency: cart.currency, items: cart.items.map((item) => ({ key: item.key, variant_id: item.variant_id, handle: item.handle, quantity: item.quantity, price: item.price, selected_scent: item.properties?.['Selected scent'], source_handle: item.properties?.['_Base Note scent handle'], source_variant: item.properties?.['_Base Note scent variant'], plan_id: item.selling_plan_allocation?.selling_plan.id, plan_prices: item.selling_plan_allocation?.price_adjustments.map((adjustment) => adjustment.price) })) });
async function dismissOverlays(page) {
  // Activate only Shopify's merchant-only toolbar control; its responsive
  // iframe otherwise covers native cookie controls. No storefront component
  // or commerce behavior is hidden or bypassed.
  await page.waitForLoadState('load');
  for (const frame of page.frames().filter((frame) => frame.url().includes('/shopifycloud/preview-bar/'))) {
    try {
      const hide = frame.getByRole('button', { name: 'Hide bar', exact: true });
      if (await hide.count()) await hide.evaluate((button) => button.click());
    } catch (error) { if (!/detached/i.test(error.message)) throw error; }
  }
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  if (await reject.isVisible()) await reject.click();
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const cartWrites = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('request', (request) => { if (request.method() === 'POST' && /\/cart\/(add|change|update)/.test(request.url())) cartWrites.push(new URL(request.url()).pathname); });
  const result = { theme, mode: live ? 'live' : 'unpublished' };
  try {
    await page.goto(preview('/products/creed-aventus'), { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => String(window.Shopify?.theme?.id)), theme, 'The expected theme must actually be rendered.');
    const role = await page.evaluate(() => window.Shopify?.theme?.role);
    if (live) assert.equal(role, 'main', '--live must verify the published storefront without preview selection.');
    else assert.notEqual(role, 'main', 'Use explicit --live for post-publication verification.');
    await page.waitForFunction(() => window.BaseNoteCommerce && document.querySelector('artifact-product')?.controller);
    await page.locator('[data-artifact-product-price]').filter({ hasText: '$20' }).waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('[data-product-main-image]'); return image?.complete && image.naturalWidth > 0; });
    await dismissOverlays(page);
    result.productImage = await page.locator('[data-product-main-image]').evaluate((image) => ({ loaded: image.complete && image.naturalWidth > 0, source: image.currentSrc }));
    assert.equal(result.productImage.loaded, true);
    assert.equal(await page.locator('[data-product-vial-reference]').isVisible(), true);
    assert.match(await page.locator('[data-product-comparison]').innerText(), /Your 5ml vial[\s\S]*Original fragrance/);
    result.productCtaBottom = await page.locator('[data-artifact-submit]').evaluate((button) => button.getBoundingClientRect().bottom);
    assert.ok(result.productCtaBottom < 1000);
    result.notes = await page.locator('.artifact-product__notes').innerText();
    assert.match(result.notes, /Blackcurrant/i);
    await page.screenshot({ path: artifact('product-desktop'), fullPage: true });
    await page.locator('.artifact-product__size').filter({ hasText: 'Full bottle' }).click();
    await page.locator('[data-bottle-request]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-product-vial-reference]').isVisible(), false);
    assert.equal(await page.locator('[data-product-main-image]').isVisible(), true);
    assert.match(await page.locator('[data-artifact-product-price]').innerText(), /Not currently available/);
    result.bottleRequest = await page.locator('[data-bottle-request] a').getAttribute('href');
    await page.locator('.artifact-product__size').filter({ hasText: /^5ml$/ }).click();
    assert.equal(await page.locator('[data-product-vial-reference]').isVisible(), true);
    await page.locator('[data-artifact-submit]').click();
    await page.locator('[data-artifact-product-status] a').waitFor();
    result.first = await page.evaluate(() => window.BaseNoteCommerce.getCart());
    assert.equal(result.first.total_price, 2000);
    await page.goto(preview('/collections/fragrances'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BaseNoteCommerce && customElements.get('scent-catalog'));
    const secondForm = page.locator('[data-scent-add][data-handle="creed-green-irish-tweed"]');
    await secondForm.locator('[data-scent-price]').filter({ hasText: '$18' }).waitFor();
    await secondForm.locator('button').click();
    await page.locator('[data-scent-status] a').waitFor();
    result.second = await page.evaluate(() => window.BaseNoteCommerce.getCart());
    assert.equal(result.second.total_price, 3800);
    assert.equal(result.second.item_count, 2);
    assert.ok(result.second.items.find((item) => item.handle === 'extra-5ml-vial-add-on').properties['Selected scent']);
    await page.goto(preview('/cart'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const cart = document.querySelector('artifact-cart'); return cart?.controller && cart.busy === false && cart.checkout?.disabled === false; });
    assert.match(await page.locator('.artifact-cart__total').innerText(), /38/);
    await dismissOverlays(page);
    await page.screenshot({ path: artifact('cart-desktop'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: artifact('cart-mobile'), fullPage: true });
    result.cartMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(result.cartMobileOverflow, false);
    const baseKey = result.second.items.find((item) => item.handle !== 'extra-5ml-vial-add-on').key;
    await page.waitForFunction(() => { const cart = document.querySelector('artifact-cart'); return cart?.controller && cart.busy === false && cart.checkout?.disabled === false; });
    await page.locator(`[data-cart-key="${baseKey}"] [data-cart-remove]`).click();
    await page.waitForFunction(() => { const cart = document.querySelector('artifact-cart'); return document.querySelectorAll('[data-cart-key]').length === 1 && cart?.controller && cart.busy === false && cart.checkout?.disabled === false; });
    result.afterBaseRemoval = await page.evaluate(() => window.BaseNoteCommerce.getCart());
    assert.equal(result.afterBaseRemoval.total_price, 2000);
    assert.equal(result.afterBaseRemoval.items[0].handle === 'extra-5ml-vial-add-on', false);
    assert.equal(result.afterBaseRemoval.items[0].handle, 'creed-green-irish-tweed');
    await page.locator('input[name="artifact_order_mode"][value="subscription"]').check();
    await page.locator('[data-cart-consent]').waitFor();
    result.subscription = await page.evaluate(() => window.BaseNoteCommerce.getCart());
    assert.equal(result.subscription.total_price, 1500);
    assert.ok(result.subscription.items[0].selling_plan_allocation);
    assert.equal(await page.locator('[data-cart-checkout]').isDisabled(), true);
    assert.match(await page.locator('.artifact-cart__disclosure').innerText(), /20\.00 every month/);
    await page.locator('[data-cart-consent]').check();
    await page.waitForFunction(() => document.querySelector('[data-cart-checkout]')?.disabled === false);
    await page.screenshot({ path: artifact('cart-subscription'), fullPage: true });
    await page.goto(preview('/products/creed-aventus?purchase=subscription#monthly-rotation'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-artifact-plan]')?.value);
    assert.equal(await page.locator('[data-artifact-consent]').isChecked(), false);
    assert.equal(await page.locator('[data-artifact-consent]').getAttribute('required'), '');
    await dismissOverlays(page);
    const writesBeforeUnconsentedAdd = cartWrites.length;
    await page.locator('[data-artifact-submit]').click();
    assert.equal(await page.locator('[data-artifact-consent]').evaluate((input) => input.validity.valueMissing), true);
    assert.equal(cartWrites.length, writesBeforeUnconsentedAdd, 'Missing subscription consent must not submit a cart mutation.');
    result.unconsentedAddBlocked = true;
    await page.screenshot({ path: artifact('product-mobile'), fullPage: true });
    result.productMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(result.productMobileOverflow, false);
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const fallback = await nojs.newPage();
    await fallback.goto(preview('/products/creed-aventus'), { waitUntil: 'domcontentloaded' });
    await fallback.locator('[data-artifact-submit]').click();
    await fallback.waitForURL(/\/cart/);
    result.noJsCart = await fallback.locator('.artifact-cart__total').innerText();
    assert.match(result.noJsCart, /20\.00/);
    await nojs.request.post(`${origin}/cart/clear.js`);
    await nojs.close();
    result.pageErrors = errors;
    assert.deepEqual(errors, [], 'No browser errors may pass preview QA.');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value?.items ? cartSummary(value) : value])), null, 2));
  } catch (error) {
    const cart = await page.evaluate(() => window.BaseNoteCommerce?.getCart()).catch(() => null);
    console.error(JSON.stringify({ failure: error.message, pageErrors: errors, cartWrites, cart: cart ? cartSummary(cart) : null, cartStatus: await page.locator('[data-cart-status]').textContent({ timeout: 1000 }).catch(() => null), cartRows: await page.locator('[data-cart-key]').count(), checkoutDisabled: await page.locator('[data-cart-checkout]').isDisabled({ timeout: 1000 }).catch(() => null) }, null, 2));
    await page.screenshot({ path: artifact('failure'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.request.post(`${origin}/cart/clear.js`).catch(() => {}); await context.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
