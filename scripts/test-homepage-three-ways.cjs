const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const index = fs.readFileSync('templates/index.json', 'utf8');
const parsedIndex = JSON.parse(index.slice(index.indexOf('{')));
const hero = fs.readFileSync('sections/hero.liquid', 'utf8');
const paths = fs.readFileSync('sections/home-buying-paths.liquid', 'utf8');
const card = fs.readFileSync('snippets/product-card.liquid', 'utf8');
const pdp = fs.readFileSync('sections/main-product.liquid', 'utf8');
const newsletter = fs.readFileSync('sections/newsletter.liquid', 'utf8');
const atelier = fs.readFileSync('sections/home-scent-atelier.liquid', 'utf8');
const layout = fs.readFileSync('layout/theme.liquid', 'utf8');

test('live merchant imagery remains referenced', () => {
  assert.match(index, /shopify:\/\/shop_images\/case-forest-green\.png/);
  assert.match(index, /Screenshot_2026-05-14_at_4\.47\.07_PM\.png/);
  assert.match(index, /Screenshot_2026-05-14_at_4\.31\.57_PM\.png/);
});

test('homepage restores the original visual composition and leads with one-time discovery', () => {
  const orderStart = index.indexOf('"order"');
  const order = index.slice(orderStart);
  assert.equal(order.includes('"home-scent-atelier"'), false);
  assert.equal(order.includes('"home-buying-paths"'), false);
  assert.ok(order.indexOf('"featured-collection"') < order.indexOf('"delivery-explainer"'));
  assert.equal(parsedIndex.sections['growth-goal'].disabled, true);
  assert.equal(parsedIndex.sections['how-it-works'].disabled, undefined);
  assert.match(hero, /hero__overlay/);
  assert.match(hero, /Cormorant Garamond/);
  assert.match(index, /\$20 for your first fragrance\. \$18 for every one after/);
});

test('three offers are distinct and Monthly Rotation is defined', () => {
  assert.match(paths, /One-time purchase/);
  assert.match(paths, /Monthly Rotation is our flexible subscription/);
  assert.match(paths, /full-size sourcing/);
  assert.match(paths, /quote shown before you buy/i);
});

test('interactive vial uses live variants and the verified $18 add-on', () => {
  assert.match(atelier, /all_products\['extra-5ml-vial-add-on'\]/);
  assert.match(atelier, /fetch\('\/cart\.js'/);
  assert.match(atelier, /fetch\('\/cart\/add\.js'/);
  assert.match(atelier, /'Selected scent': option\.dataset\.title/);
  assert.match(atelier, /href="\/checkout"/);
  assert.doesNotMatch(atelier, /selling_plan/);
});

test('interactive vial preserves the Union Made accessible workbench pattern', () => {
  assert.match(atelier, /customElements\.define\('scent-atelier'/);
  assert.match(atelier, /pointerdown/);
  assert.match(atelier, /event\.key !== 'ArrowLeft'/);
  assert.match(atelier, /prefers-reduced-motion: reduce/);
  assert.match(atelier, /aria-pressed="true"/);
});

test('homepage cards choose on PDP and do not quick-add a plan', () => {
  assert.match(card, /purchase_context == 'one_time'/);
  assert.match(card, /choose_purchase/);
  assert.match(card, /href="{{ product.url }}"/);
});

test('PDP defaults one-time while subscription remains cart verified', () => {
  assert.match(pdp, /name="bn_ptype" value="onetime" checked/);
  assert.match(pdp, /name="bn_ptype" value="subscribe"/);
  assert.match(pdp, /var sellingPlan = isOnetimeMode \? null/);
  assert.match(pdp, /selling_plan_not_applied/);
  assert.match(pdp, /Start Monthly Rotation — ' \+ SUBSCRIPTION_FIRST_PRICE \+ ' today/);
});

test('newsletter keeps the original styling and promotes new scent drops', () => {
  assert.match(newsletter, /class="visually-hidden">Email address/);
  assert.match(newsletter, /class="section section--dark newsletter-section"/);
  assert.match(index, /"button_label": "Tell Me First"/);
  assert.equal(parsedIndex.sections.newsletter.disabled, undefined);
  assert.match(layout, /unless request\.page_type == 'index'/);
});
