'use strict';
// The thank-you page and the account dashboard pick "the subscription line" as the first
// line item carrying a selling_plan_allocation. Once add-on vials ship on a recurring plan,
// that rule would show a $18 helper as the customer's monthly fragrance. These checks pin
// the helper variant exclusion at every selection site.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HELPER_VARIANT = '48547911696602';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('thank-you subscription pick excludes the helper variant', () => {
  const src = read('snippets/checkout-thank-you.liquid');
  assert.match(src, new RegExp(`if line_item\\.selling_plan_allocation and line_item\\.variant_id != ${HELPER_VARIANT}`));
  assert.doesNotMatch(src, /if line_item\.selling_plan_allocation -%}/);
});

test('account dashboard excludes the helper variant at every selection site', () => {
  const src = read('templates/customers/account.liquid');
  const guarded = (src.match(new RegExp(`selling_plan_allocation and (line_item|line)\\.variant_id != ${HELPER_VARIANT}`, 'g')) || []).length;
  const unguarded = (src.match(/if (line_item|line)\.selling_plan_allocation -%}/g) || []).length;
  assert.equal(guarded, 3, 'three guarded selection sites expected');
  assert.equal(unguarded, 0, 'no unguarded selection site may remain');
});

test('FAQ uses one source for visible and machine-readable answers', () => {
  const src = read('sections/faq-page.liquid');
  const capture = src.match(/capture faq_content -%}([\s\S]*?){%- endcapture/);
  assert(capture, 'FAQ answers have a single canonical source');
  assert.match(capture[1], /without subscribing/);
  assert.match(capture[1], /Shipping for one-time and mixed orders is calculated at checkout/);
  assert.doesNotMatch(capture[1], /all orders ship free|shipping is always on us/i);
  assert.equal((src.match(/for entry in faq_entries/g) || []).length, 2, 'visible and JSON-LD views consume the same entries');
  // Rendered answer equality is checked against the actual preview/live page by
  // scripts/verify-storefront-seo.cjs, replacing the former duplicate-word-count test.
});
