'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const HELPER_VARIANT = '48547911696602';

function schemaOf(liquid) {
  const m = liquid.match(/{% schema %}([\s\S]*?){% endschema %}/);
  assert.ok(m, 'schema block must exist');
  return JSON.parse(m[1]);
}

test('founding proof panel is off by default and carries no hard-coded count', () => {
  const src = read('sections/main-product.liquid');
  const settings = schemaOf(src).settings;
  const byId = Object.fromEntries(settings.map((s) => [s.id, s]));
  assert.equal(byId.show_founding_proof.default, false);
  assert.equal(byId.founding_members_current.default, 0);
  assert.match(byId.founding_endpoint.default, /member-count$/);
  assert.equal(byId.founding_note.default, undefined);
  assert.doesNotMatch(src, /for as long as they stay/);
  assert.match(src, /data-founding-proof[\s\S]*?{% if founding_current == 0 %}hidden{% endif %}/);
});

test('thank-you page never picks the helper as the subscription line', () => {
  const src = read('snippets/checkout-thank-you.liquid');
  assert.match(src, new RegExp(`if line_item\\.selling_plan_allocation and line_item\\.variant_id != ${HELPER_VARIANT}`));
  assert.doesNotMatch(src, /if line_item\.selling_plan_allocation -%}/);
});

test('account dashboard never picks the helper as the subscription line', () => {
  const src = read('templates/customers/account.liquid');
  const guarded = (src.match(new RegExp(`selling_plan_allocation and (line_item|line)\\.variant_id != ${HELPER_VARIANT}`, 'g')) || []).length;
  const unguarded = (src.match(/if (line_item|line)\.selling_plan_allocation -%}/g) || []).length;
  assert.equal(guarded, 3);
  assert.equal(unguarded, 0);
});
