#!/usr/bin/env node
'use strict';

// Public, read-only integration checks. Pass --theme=123 to verify an unpublished
// Shopify theme without changing production. No cart or checkout is created.
const assert = require('node:assert/strict');
const origin = process.env.BASENOTE_STOREFRONT_URL || 'https://basenotescent.com';
const theme = process.argv.find(arg => arg.startsWith('--theme='))?.split('=')[1];
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
const read = async path => {
  const url = new URL(path, origin);
  if (theme) url.searchParams.set('preview_theme_id', theme);
  const response = await fetch(url);
  const html = await response.text();
  const schema = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  return { path, response, html, schema };
};

(async () => {
  const [product, faq, collection, duplicate, tags, helper] = await Promise.all([
    read('/products/creed-aventus'), read('/pages/faq'), read('/collections/fragrances'),
    read('/collections/all'), read('/blogs/hub/tagged/scentbird'), read('/products/extra-5ml-vial-add-on')
  ]);
  for (const page of [product, faq, collection, duplicate, tags, helper]) assert.equal(page.response.status, 200, `${page.path} should render`);
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
  const faqData = faq.schema.find(item => item['@type'] === 'FAQPage');
  assert(faqData, 'Visible FAQ has FAQPage structured data');
  const visible = [...faq.html.matchAll(/<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-item__content">([\s\S]*?)<\/div>\s*<\/details>/g)].map(match => ({ question: strip(match[1]), answer: strip(match[2]) }));
  assert.equal(visible.length, faqData.mainEntity.length, 'Every schema FAQ is visible');
  for (let index = 0; index < visible.length; index++) {
    assert.equal(visible[index].question, strip(faqData.mainEntity[index].name));
    assert.equal(visible[index].answer, strip(faqData.mainEntity[index].acceptedAnswer.text));
  }
  assert(visible.some(entry => /without subscribing/i.test(entry.question)), 'FAQ supports the primary one-time purchase path');
  console.log(`PASS: metadata, real offers, canonical/robots, helper containment, and ${visible.length} matching FAQ answers (${theme ? `theme ${theme}` : 'live'}).`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
