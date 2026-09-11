#!/usr/bin/env node
'use strict';

// Public, read-only integration checks. Pass --theme=123 to verify an unpublished
// Shopify theme without changing production. No cart or checkout is created.
const assert = require('node:assert/strict');
const origin = process.env.BASENOTE_STOREFRONT_URL || 'https://basenotescent.com';
const theme = process.argv.find(arg => arg.startsWith('--theme='))?.split('=')[1];
const cookies = new Map();
// Preview selection is a 302 plus an essential cookie. Node fetch does not
// retain that cookie automatically and would silently inspect the live theme.
const fetchPage = async input => {
  let url = new URL(input, origin);
  for (let redirects = 0; redirects <= 5; redirects++) {
    assert.equal(url.origin, new URL(origin).origin, 'Do not forward preview cookies to another origin');
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0];
      const split = first.indexOf('=');
      if (split > 0) cookies.set(first.slice(0, split), first.slice(split + 1));
    }
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    return response;
  }
  throw new Error('Too many storefront redirects');
};
const strip = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
const meta = (html, key) => html.match(new RegExp(`<meta[^>]+(?:name|property)="${key}"[^>]+content="([^"]*)"`))?.[1] || '';
const read = async path => {
  const url = new URL(path, origin);
  const response = await fetchPage(url);
  const html = await response.text();
  if (theme && response.headers.get('content-type')?.includes('text/html')) {
    const renderedTheme = JSON.parse(html.match(/Shopify\.theme = ([^;]+);/)?.[1] || '{}');
    assert.equal(String(renderedTheme.id), theme, `${path} must render the requested preview theme`);
  }
  const schema = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  return { path, response, html, schema };
};

(async () => {
  if (theme) await fetchPage(`/?preview_theme_id=${encodeURIComponent(theme)}`);
  const [product, faq, collection, duplicate, tags, helper, agents, llms, llmsFull] = await Promise.all([
    read('/products/creed-aventus'), read('/pages/faq'), read('/collections/fragrances'),
    read('/collections/all'), read('/blogs/hub/tagged/scentbird'), read('/products/extra-5ml-vial-add-on'),
    read('/agents.md'), read('/llms.txt'), read('/llms-full.txt')
  ]);
  for (const page of [product, faq, collection, duplicate, tags, helper, agents, llms, llmsFull]) assert.equal(page.response.status, 200, `${page.path} should render`);
  const productData = product.schema.find(item => item['@id']?.endsWith('#product'));
  assert(productData, 'Product schema has a stable product identity');
  const offers = productData.offers;
  assert(Array.isArray(offers), 'Purchase modes are explicit separate offers');
  const single = offers.find(offer => offer.name === 'One-time purchase');
  assert(single && !single.priceSpecification, 'One-time purchase must not be described as recurring');
  const variant = (await (await fetch(`${origin}/products/creed-aventus.js`)).json()).variants[0];
  assert.equal(single.price, variant.price / 100, 'One-time schema price matches the actual catalog variant');
  const recurring = offers.find(offer => offer.name === 'Monthly Rotation subscription');
  if (variant.selling_plan_allocations.length) {
    assert(recurring, 'A real available subscription has a separate offer');
    assert.equal(recurring.price, variant.selling_plan_allocations[0].price / 100);
    assert.equal(recurring.priceSpecification[0].billingIncrement, 1, 'Schema billing increment is a number');
    assert.equal(recurring.priceSpecification[0].billingDuration, 'P1M');
  }
  assert(!JSON.stringify(productData).includes('FreeReturn'), 'No invented free-return policy');
  assert(!productData.mpn, 'A merchant SKU is not a manufacturer part number');
  assert(!helper.schema.some(item => item['@type'] === 'Product'), 'Internal helper has no public Product offer');
  assert.match(helper.html, /name="robots" content="noindex, follow"/);
  assert.match(duplicate.html, /rel="canonical" href="https:\/\/basenotescent\.com\/collections\/fragrances"/);
  assert.match(tags.html, /name="robots" content="noindex, follow"/);
  assert.doesNotMatch(collection.html.match(/<meta name="description"[^>]+>/)?.[0] || '', /List Showing the Fragrances Offered/);
  for (const page of [product, faq, collection]) {
    assert.equal(strip(meta(page.html, 'description')), strip(meta(page.html, 'og:description')), `${page.path} search and social descriptions agree`);
    assert.equal([...page.html.matchAll(/<h1\b/g)].length, 1, `${page.path} has one main heading`);
  }
  assert.match(meta(faq.html, 'description'), /one-time/i, 'FAQ metadata explains the primary purchase path');
  assert.match(meta(faq.html, 'description'), /Monthly Rotation/i, 'FAQ metadata uses the current subscription name');
  const faqData = faq.schema.find(item => item['@type'] === 'FAQPage');
  assert(faqData, 'Visible FAQ has FAQPage structured data');
  const visible = [...faq.html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-item__content">([\s\S]*?)<\/div>\s*<\/details>/g)].map(match => ({ question: strip(match[1]), answer: strip(match[2]) }));
  assert.equal(visible.length, faqData.mainEntity.length, 'Every schema FAQ is visible');
  for (let index = 0; index < visible.length; index++) {
    assert.equal(visible[index].question, strip(faqData.mainEntity[index].name));
    assert.equal(visible[index].answer, strip(faqData.mainEntity[index].acceptedAnswer.text));
  }
  assert(visible.some(entry => /without subscribing/i.test(entry.question)), 'FAQ supports the primary one-time purchase path');
  for (const page of [agents, llms, llmsFull]) {
    assert.match(page.html, /one-time 5 ml travel vials/, `${page.path} explains the primary one-time offer`);
    assert.match(page.html, /Monthly Rotation[\s\n]*subscription/, `${page.path} defines recurring purchases`);
    assert.match(page.html, /full bottles when listed as available/, `${page.path} does not invent bottle availability`);
    assert.doesNotMatch(page.html, /Subscription, not a one-off|32 fragrances/, `${page.path} must not retain obsolete static positioning`);
    assert.match(page.html, /extra-5ml-vial-add-on/, `${page.path} guards internal add-on products`);
  }
  console.log(`PASS: metadata, real offers, canonical/robots, helper containment, ${visible.length} matching FAQ answers, and all three agent/LLM endpoints (${theme ? `theme ${theme}` : 'live'}).`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
