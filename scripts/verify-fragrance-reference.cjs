#!/usr/bin/env node
'use strict';
// Visual contract from Jeff's saved df9b screenshot plus the supplied HTML CSS.
// Defaults to preview; --live verifies public identity without preview parameters.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const theme = process.argv[2];
const live = process.argv.includes('--live');
if (!/^\d+$/.test(theme || '')) throw Error('Expected Shopify theme ID is required');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'basenote-fragrance-fidelity-'));
const target = new URL('https://basenotescent.com/collections/fragrances');
if (!live) target.searchParams.set('preview_theme_id', theme);
(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const result = { theme, mode: live ? 'live' : 'preview', views: [], output };
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(target.href, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('scent-catalog')?.initialized);
      const identity = await page.evaluate(() => Shopify.theme);
      assert.equal(String(identity.id), theme);
      if (live) assert.equal(identity.role, 'main');
      assert.equal(await page.locator('main .collection__sidebar, main [data-filter-sidebar]').count(), 0, 'The legacy left category sidebar must not be rendered');
      for (const frame of page.frames()) {
        if (!frame.url().includes('/shopifycloud/preview-bar/')) continue;
        const hide = frame.getByRole('button', { name: 'Hide bar', exact: true });
        if (await hide.count()) await hide.evaluate(button => button.click()).catch(error => {
          if (!frame.isDetached()) throw error;
        });
      }
      const reject = page.getByRole('button', { name: 'Reject', exact: true });
      await reject.waitFor({ state: 'visible', timeout: 5000 }).catch(error => {
        if (error.name !== 'TimeoutError') throw error;
      });
      if (await reject.isVisible()) {
        await reject.click();
        await reject.waitFor({ state: 'hidden' });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.scent-card__reference-image').first().evaluate(image => image.decode());
      const metrics = await page.evaluate(() => {
        const title = document.querySelector('.fragrance-catalog__hero h1');
        const grid = document.querySelector('.fragrance-catalog .scent-grid');
        const tile = grid.querySelector('[data-scent-card]');
        const categories = [...document.querySelectorAll('.fragrance-catalog__tabs button')];
        const rect = element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height });
        return {
          title: { ...rect(title), size: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight, color: getComputedStyle(title).color },
          grid: { ...rect(grid), columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, gap: getComputedStyle(grid).gap, border: getComputedStyle(grid).borderTopWidth },
          tile: rect(tile),
          photo: rect(tile.querySelector('.scent-card__media')),
          nameBeforeBrand: Boolean(tile.querySelector('h2').compareDocumentPosition(tile.querySelector('.scent-card__brand')) & Node.DOCUMENT_POSITION_FOLLOWING),
          horizontalCategories: categories.length === 4 && categories.every(button => Math.abs(button.getBoundingClientRect().y - categories[0].getBoundingClientRect().y) < 1),
          total: grid.querySelectorAll('[data-scent-card]').length,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      assert.equal(metrics.title.size, width > 820 ? '44px' : '32px');
      assert.equal(metrics.title.weight, '700');
      assert.equal(metrics.title.color, 'rgb(36, 35, 32)');
      assert.equal(metrics.grid.columns, width > 820 ? 4 : 2);
      assert.equal(metrics.grid.gap, '1px');
      assert.equal(metrics.grid.border, '1px');
      if (width > 820) assert.equal(metrics.grid.width, 1020);
      assert.ok(metrics.tile.height < 300, 'Compact tiles cannot regress to oversized image cards');
      assert.equal(metrics.photo.height, 66);
      assert.equal(metrics.nameBeforeBrand, true);
      assert.equal(metrics.horizontalCategories, true, 'Reference category controls must remain one horizontal row, never a left sidebar');
      assert.equal(metrics.overflow, false);
      assert.equal(await page.locator('.fragrance-catalog__toolbar').isVisible(), false, 'Search must not displace the reference grid');
      await page.screenshot({ path: path.join(output, `collection-${width}.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `collection-${width}-top.png`) });
      await page.locator('[data-gender-filter="unisex"]').click();
      assert.ok(await page.locator('[data-scent-card]:visible').count());
      await page.locator('[data-gender-filter="all"]').click();
      assert.equal(await page.locator('[data-scent-card]:visible').count(), metrics.total);
      await page.locator('.fragrance-catalog__search summary').click();
      await page.locator('[data-scent-search]').fill('aventus');
      assert.ok(await page.locator('[data-scent-card]:visible').count());
      await page.locator('[data-scent-search]').fill('no-such-scent-qa');
      assert.equal(await page.locator('[data-scent-card]:visible').count(), 0);
      await page.locator('[data-clear-filters]').click();
      assert.equal(await page.locator('[data-scent-card]:visible').count(), metrics.total);
      result.views.push({ width, ...metrics, filters: 'passed', search: 'passed' });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...result, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
