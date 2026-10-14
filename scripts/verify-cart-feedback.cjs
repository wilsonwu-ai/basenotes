#!/usr/bin/env node
'use strict';
// Usage: node scripts/verify-cart-feedback.cjs THEME_ID [--live] [--local-assets]
// Local-assets mode is clearly labeled; only the new feedback markup/JS is
// overlaid in the isolated browser. Cart writes always use the actual API.
// Never submits checkout, an order, or a customer form. Clears only own carts.
const { chromium } = require(process.env.BASENOTE_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const theme = process.argv[2];
const live = process.argv.includes('--live');
const local = process.argv.includes('--local-assets');
if (!/^\d+$/.test(theme || '')) throw Error('Provide the expected Shopify theme ID.');
if (local && !live) throw Error('Use --live with --local-assets; preview QA must inspect the deployed assets.');
const root = path.resolve(__dirname, '..');
const origin = 'https://basenotescent.com';
const output = process.env.BASENOTE_QA_OUTPUT_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'basenote-feedback-'));
fs.mkdirSync(output, { recursive: true });
const target = new URL('/collections/fragrances', origin);
if (!live) target.searchParams.set('preview_theme_id', theme);

async function localMarkup() {
  const { Liquid } = require(process.env.BASENOTE_LIQUID_PATH || 'liquidjs');
  const engine = new Liquid();
  const locale = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.default.json'), 'utf8'));
  engine.registerFilter('t', (key, ...args) => {
    let value = key.split('.').reduce((parent, field) => parent?.[field], locale);
    for (const [name, replacement] of args.filter(Array.isArray)) value = value.replaceAll(`{{ ${name} }}`, replacement);
    return value;
  });
  const source = fs.readFileSync(path.join(root, 'snippets/cart-feedback.liquid'), 'utf8').replace(/{% doc %}[\s\S]*?{% enddoc %}/, '').replace('{% stylesheet %}', '<style>').replace('{% endstylesheet %}', '</style>');
  return engine.parseAndRender(source, { routes: { cart_url: '/cart' } });
}

async function dismissMerchantAndCookieUi(page) {
  await page.waitForLoadState('load');
  for (const frame of page.frames().filter(frame => frame.url().includes('/shopifycloud/preview-bar/'))) {
    try {
      const hide = frame.getByRole('button', { name: 'Hide bar', exact: true });
      if (await hide.count()) await hide.evaluate(button => button.click());
    } catch (error) { if (!/detached/i.test(error.message)) throw error; }
  }
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  if (await reject.isVisible()) await reject.click();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let mode = 'hold';
      let calls = 0;
      let release;
      let firstRequestStarted;
      let requestTimeout;
      const gate = new Promise(resolve => { release = resolve; });
      const started = new Promise((resolve, reject) => {
        firstRequestStarted = () => { clearTimeout(requestTimeout); resolve(); };
        requestTimeout = setTimeout(() => reject(Error('The first real cart add request did not start.')), 20000);
      });
      started.catch(() => {});
      await context.route('**/cart/add.js', async route => {
        calls++;
        firstRequestStarted();
        if (mode === 'hold') await gate;
        if (mode === 'failure') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ description: 'Test only: this add was not accepted.' }) });
        return route.continue();
      });
      if (local) {
        const markup = await localMarkup();
        await context.route('**/assets/scent-storefront.js*', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'assets/scent-storefront.js'), 'utf8') }));
        await context.route('**/collections/fragrances', async route => {
          if (route.request().resourceType() !== 'document') return route.continue();
          const response = await route.fetch();
          const html = (await response.text()).replace(/<cart-feedback\b[\s\S]*?<\/cart-feedback>/g, '').replace('</main>', `${markup}</main>`);
          return route.fulfill({ response, body: html });
        });
      }
      try {
        await page.goto(target.href, { waitUntil: 'load' });
        assert.equal(await page.evaluate(() => String(window.Shopify?.theme?.id)), theme);
        const role = await page.evaluate(() => window.Shopify?.theme?.role);
        if (live) assert.equal(role, 'main'); else assert.notEqual(role, 'main');
        await page.waitForFunction(() => window.BaseNoteCommerce && document.querySelector('scent-catalog')?.initialized && document.querySelector('cart-feedback')?.controller);
        await dismissMerchantAndCookieUi(page);
        const panel = page.locator('[data-cart-feedback-panel]');
        const first = page.locator('[data-scent-add][data-handle="creed-aventus"] button');
        const second = page.locator('[data-scent-add][data-handle="creed-green-irish-tweed"] button');
        assert.equal(await panel.isVisible(), false);
        await first.click({ clickCount: 6, delay: 25 });
        await page.waitForFunction(() => document.querySelector('[data-scent-add][data-handle="creed-aventus"] button')?.getAttribute('aria-busy') === 'true');
        await started;
        assert.equal(calls, 1, 'Six rapid taps must result in only one in-flight add.');
        assert.equal(await panel.isVisible(), false, 'Do not claim success before Shopify confirms.');
        assert.equal(await second.isDisabled(), true);
        assert.match(await first.innerText(), /Adding/i);
        mode = 'normal'; release();
        await page.waitForFunction(() => document.querySelector('[data-cart-feedback-panel]')?.dataset.state === 'success');
        await panel.waitFor({ state: 'visible' });
        const firstCart = await page.evaluate(() => window.BaseNoteCommerce.getCart());
        assert.equal(firstCart.item_count, 1);
        assert.equal(firstCart.total_price, 2000);
        assert.match(await panel.innerText(), /Added to cart[\s\S]*Creed Aventus EDP[\s\S]*Quantity: 1[\s\S]*View cart/);
        assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), false, 'Opening feedback must not move focus into it.');
        const geometry = await panel.evaluate(node => {
          const box = node.getBoundingClientRect();
          const close = node.querySelector('[data-cart-feedback-close]').getBoundingClientRect();
          const link = node.querySelector('a').getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight, closeWidth: close.width, closeHeight: close.height, linkHeight: link.height, animation: getComputedStyle(node).animationName, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height, 'Feedback must be in the visible viewport.');
        assert.ok(geometry.closeWidth >= 44 && geometry.closeHeight >= 44 && geometry.linkHeight >= 44);
        assert.equal(geometry.overflow, false);
        if (width === 390) assert.equal(geometry.animation, 'none');
        await page.screenshot({ path: path.join(output, `feedback-success-${width}.png`) });
        await panel.locator('[data-cart-feedback-close]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await panel.isVisible(), false);
        assert.equal(await first.evaluate(button => document.activeElement === button), true, 'Explicit close from inside restores the initiating control.');
        await second.click();
        await panel.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('[data-cart-feedback-message]')?.textContent === 'Creed Green Irish Tweed EDP');
        const secondCart = await page.evaluate(() => window.BaseNoteCommerce.getCart());
        assert.equal(secondCart.item_count, 2);
        assert.equal(secondCart.total_price, 3800);
        const extra = secondCart.items.find(item => item.handle === 'extra-5ml-vial-add-on');
        assert.equal(extra.properties['Selected scent'], 'Creed Green Irish Tweed EDP');
        assert.equal(calls, 2, 'A later intentional add remains available.');
        await panel.locator('[data-cart-feedback-close]').click();
        mode = 'failure';
        await first.click();
        await page.waitForFunction(() => document.querySelector('[data-cart-feedback-panel]')?.dataset.state === 'error');
        await panel.waitFor({ state: 'visible' });
        assert.match(await panel.innerText(), /couldn’t confirm[\s\S]*Test only: this add was not accepted[\s\S]*View cart/);
        const afterFailure = await page.evaluate(() => window.BaseNoteCommerce.getCart());
        assert.equal(afterFailure.item_count, 2);
        assert.equal(afterFailure.total_price, 3800);
        assert.equal(calls, 3, 'A failed add must not be retried or submitted natively.');
        assert.equal(await first.isDisabled(), false);
        await page.screenshot({ path: path.join(output, `feedback-error-${width}.png`) });
        await panel.locator('a').click();
        await page.waitForURL(/\/cart(?:\?|$)/);
        assert.match(await page.locator('.artifact-cart__total').innerText(), /38\.00/);
        assert.deepEqual(errors, []);
        results.push({ width, first: 2000, additional: 1800, total: 3800, rapidClicks: 6, firstAddRequests: 1, errorDidNotAdd: true, focusPreserved: true, geometry, errors });
      } finally {
        clearTimeout(requestTimeout);
        release();
        await page.waitForFunction(() => !document.querySelector('scent-catalog')?.pending, undefined, { timeout: 10000 }).catch(() => {});
        const cleared = await context.request.post(`${origin}/cart/clear.js`);
        assert.equal(cleared.ok(), true, 'Only this isolated test cart must be cleared.');
        await context.close();
      }
    }
    console.log(JSON.stringify({ theme, mode: live ? 'live' : 'preview', assets: local ? 'local feedback overlay; actual Shopify cart API' : 'deployed theme', output, results }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
