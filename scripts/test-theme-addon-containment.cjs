const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../sections/main-product.liquid'), 'utf8');
const selection = source.match(/var existingSub = null;([\s\S]*?)\n\s*if \(existingSub\)/);
assert.ok(selection, 'The PDP subscription selection code must be located');
const selectBase = new Function('cart', `var existingSub = null; ${selection[1]} return existingSub;`);
const base = {key: 'base-line', handle: 'creed-aventus', selling_plan_allocation: {}};
const helper = {key: 'helper-line', handle: 'extra-5ml-vial-add-on', selling_plan_allocation: {}};

test('a trailing legacy helper never replaces the base subscription', () => {
  assert.equal(selectBase({items: [base, helper]}), base);
});
test('a leading legacy helper does not alter base identification', () => {
  assert.equal(selectBase({items: [helper, base]}), base);
});
test('a helper-only legacy cart has no swappable base subscription', () => {
  assert.equal(selectBase({items: [helper]}), null);
});
test('ordinary one-time lines are not mistaken for a base subscription', () => {
  assert.equal(selectBase({items: [{key: 'one-time', handle: 'creed-aventus'}, helper]}), null);
});
