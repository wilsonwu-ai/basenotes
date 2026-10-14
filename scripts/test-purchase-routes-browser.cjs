#!/usr/bin/env node
'use strict';
// Native form validation only: never submits customer data, newsletters or enquiries.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const theme = process.argv[2];
const origin = 'https://basenotescent.com';
const urlFor = path => {
  const url = new URL(path, origin);
  if (theme) url.searchParams.set('preview_theme_id', theme);
  return url.href;
};
(async () => {
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  const errors = [];
  const formPosts = [];
  const results = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /\/contact(?:\?|$)/.test(request.url())) formPosts.push(request.url());
  });
  try {
    for (const [name,path,heading] of [
      ['rotation','/pages/monthly-rotation','Your Monthly Rotation.'],
      ['bottles','/pages/full-bottles?fragrance=Creed%20Aventus','Make it your full bottle.'],
      ['faq','/pages/faq','Good questions. Clear answers.']
    ]) {
      await page.goto(urlFor(path),{waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{level:1,name:heading,exact:true}).waitFor();
      if (theme) assert.equal(String(await page.evaluate(() => Shopify.theme.id)),theme,'Must test the requested preview, not silently test production');
      await page.waitForLoadState('load');
      for (const frame of page.frames()) {
        const hide = frame.getByRole('button',{name:'Hide bar',exact:true});
        if (await hide.isVisible().catch(() => false)) await hide.evaluate(button => button.click()).catch(error => {
          if (!frame.isDetached()) throw error;
        });
      }
      const reject = page.getByRole('button',{name:'Reject',exact:true});
      // This lane validates purchase routes/forms, not Shopify's preview toolbar.
      // Invoke the real reject button so its late-loading iframe cannot intercept it.
      if (await reject.isVisible()) await reject.evaluate(button => button.click());
      if (name === 'rotation') {
        assert.match(await page.locator('.scent-route__intro').innerText(),/\$15\.00.*\$20\.00/s);
        assert.ok(await page.locator('#RotationScents a[href*="purchase=subscription"]').count());
      }
      if (name === 'bottles') {
        await page.waitForFunction(() => document.querySelector('#FullBottleContact input[name="contact[Fragrance]"]')?.value === 'Creed Aventus');
        const form = page.locator('#FullBottleContact');
        assert.equal(await form.locator('input[name="contact[Fragrance]"]').inputValue(),'Creed Aventus');
        assert.equal(await form.evaluate(el => el.checkValidity()),false);
        assert.equal(await form.getAttribute('method'),'post');
        assert.match(await form.getAttribute('action'),/^\/contact/);
      }
      const newsletter = page.locator('form.artifact-footer__form');
      assert.equal(await newsletter.count(),1);
      assert.equal(await newsletter.getAttribute('method'),'post');
      assert.match(await newsletter.getAttribute('action'),/^\/contact/);
      assert.equal(await newsletter.locator('input[name="form_type"]').inputValue(),'customer');
      const email = newsletter.locator('input[type="email"]');
      await email.fill('invalid');
      assert.equal(await newsletter.evaluate(el => el.checkValidity()),false);
      await email.fill('qa@example.invalid');
      assert.equal(await newsletter.evaluate(el => el.checkValidity()),true);
      await email.fill('');
      for (const width of [1440,390]) {
        await page.setViewportSize({width,height:width===390?844:1000});
        await page.evaluate(() => window.scrollTo(0,250));
        await page.waitForFunction(() => document.querySelector('header.header')?.classList.contains('is-scrolled'));
        await page.locator('header.header').evaluate(async header => {
          await Promise.all(header.getAnimations().map(animation => animation.finished.catch(() => {})));
        });
        assert.equal(await page.locator('header.header').evaluate(header => getComputedStyle(header).backgroundColor),'rgb(34, 57, 43)','Scrolled header retains contrast against its cream text');
        await page.evaluate(() => window.scrollTo(0,0));
        await page.waitForFunction(() => !document.querySelector('header.header')?.classList.contains('is-scrolled'));
        await page.screenshot({path:`/private/tmp/basenote-routes-${name}-${width}.png`,fullPage:true});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`${name} at ${width}px must not overflow`);
      }
      results.push({page:name,heading,newsletter:'native required/email/customer form verified',overflow:false});
    }
    assert.equal(formPosts.length,0,'QA must not submit customer/contact data');
    assert.deepEqual(errors,[],'No page JavaScript exceptions');
    console.log(JSON.stringify({theme:theme||'live',results,formPosts:0,pageErrors:errors},null,2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
