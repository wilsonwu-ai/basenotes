const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');
const indexRaw = read('templates/index.json');
const index = JSON.parse(indexRaw.slice(indexRaw.indexOf('{')));
const home = read('sections/jeff-storefront.liquid');
const pdp = read('sections/main-product.liquid');
const cart = read('templates/cart.liquid');
const base = read('assets/base.css');
const layout = read('layout/theme.liquid');

test('Jeff Claude homepage is the only lead section and preserves the new banner', () => {
  assert.equal(index.order[0], 'jeff-storefront');
  assert.equal(index.sections['jeff-storefront'].settings.collection, 'fragrances');
  assert.match(home, /images\['gLmqu\.jpg'\]/);
  assert.match(home, /Shop fragrances and get your vial today/);
});

test('exact Claude visual system is present', () => {
  for (const color of ['#22392B', '#1B2F22', '#F4EFE3', '#AC9159', '#242320']) {
    assert.match(home + base, new RegExp(color, 'i'));
  }
  assert.match(layout, /Playfair\+Display/);
  assert.match(layout, /EB\+Garamond/);
  assert.match(layout, /Jost/);
});

test('homepage offer hierarchy is one-time, rotation, full bottle', () => {
  const offerGrid = home.slice(home.indexOf('jeff-storefront__step-grid'));
  const once = offerGrid.indexOf('Try one vial');
  const rotation = offerGrid.indexOf('Monthly Rotation');
  const bottle = offerGrid.indexOf('Go full bottle');
  assert.ok(once > 0 && once < rotation && rotation < bottle);
  assert.match(home, /monthly fragrance subscription/i);
  assert.match(home, /\$20 for your first fragrance/);
  assert.match(home, /\$18 for each one after/);
  assert.doesNotMatch(home, /quiz|Find My Scent/i);
});

test('PDP uses a real variant-backed size selector and keeps one-time default', () => {
  assert.match(pdp, /class="variant-tabs"/);
  assert.match(pdp, /data-variant-tab/);
  assert.match(pdp, /name="bn_ptype" value="onetime" checked/);
  assert.match(pdp, /Monthly Rotation <small>\(subscription\)<\/small>/);
  assert.match(pdp, /if \(!isSub\)[\s\S]*oneTimeRadio\.checked = true/);
  assert.match(pdp, /var sellingPlan = isOnetimeMode \? null/);
});

test('cart clearly labels purchase types and has working quantity controls', () => {
  assert.match(cart, /ONE-TIME · 5ML VIAL/);
  assert.match(cart, /MONTHLY ROTATION · SUBSCRIPTION/);
  assert.match(cart, /ONE-TIME · FULL BOTTLE/);
  assert.match(cart, /data-cart-qty/);
  assert.match(cart, /\/cart\/change\.js/);
  assert.match(cart, /One-time purchase\. No subscription and no recurring charge/);
});
