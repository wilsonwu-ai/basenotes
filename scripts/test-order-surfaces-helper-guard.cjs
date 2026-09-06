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

test('FAQ visible answers and FAQPage JSON-LD captures agree on shipping copy', () => {
  const src = read('sections/faq-page.liquid');
  assert.doesNotMatch(src, /3-5 business days/);
  assert.doesNotMatch(src, /next renewal date/);
  assert.equal((src.match(/next scheduled shipment date/g) || []).length, 2);
  assert.equal((src.match(/1–3 business days after shipping/g) || []).length, 2);
});
