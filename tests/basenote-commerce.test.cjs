/* Exercises assets/basenote-commerce.js against a simulated Shopify cart.
 * The fake server applies the three automatic discounts the way Shopify is configured to:
 * Fragrance-type units 2 -> $2 off the order, 3 -> $4 off, 4+ -> $2 off each.
 * Usage (from the repo root): node tests/basenote-commerce.test.cjs assets/basenote-commerce.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

const SOURCE = fs.readFileSync(process.argv[2], 'utf8');
const PLAN = 7001;

// ---------- catalog ----------
function vialProduct(id, handle, title, { price = 2000, available = true, withBottle = false } = {}) {
  const variants = [{ id: id * 10 + 1, title: '5ml', price, available, requires_selling_plan: false,
    selling_plan_allocations: [{ selling_plan_id: PLAN, selling_plan_group_id: 'g1', price: 1500 }] }];
  if (withBottle) variants.push({ id: id * 10 + 2, title: '3.4oz', price: 26000, available: true, requires_selling_plan: false, selling_plan_allocations: [] });
  return { id, handle, title, type: 'Fragrance', variants,
    selling_plan_groups: [{ id: 'g1', selling_plans: [{ id: PLAN, name: 'Monthly Rotation', recurring_deliveries: true }] }] };
}
const PRODUCTS = [
  vialProduct(1, 'creed-aventus', 'Creed Aventus'),
  vialProduct(2, 'bleecker-street', 'Bleecker Street'),
  vialProduct(3, 'santal-33', 'Santal 33'),
  vialProduct(4, 'baccarat-rouge', 'Baccarat Rouge'),
  vialProduct(5, 'tom-ford-oud-wood', 'Oud Wood', { withBottle: true }),
  vialProduct(6, 'sale-scent', 'Sale Scent', { price: 1500 }),
  vialProduct(7, 'gone-scent', 'Gone Scent', { available: false }),
  { id: 8, handle: 'build-your-own-box-set', title: 'Build Your Own Box Set', type: 'Box Set', selling_plan_groups: [],
    variants: [{ id: 81, title: 'Default Title', price: 5600, available: true, requires_selling_plan: false, selling_plan_allocations: [] }] },
  { id: 9, handle: 'extra-5ml-vial-add-on', title: 'Extra 5ml Vial Add-On', type: '', selling_plan_groups: [],
    variants: [{ id: 91, title: 'Default Title', price: 1800, available: true, requires_selling_plan: false, selling_plan_allocations: [{ selling_plan_id: PLAN, selling_plan_group_id: 'g1', price: 1350 }] }] },
];
const byHandle = new Map(PRODUCTS.map((p) => [p.handle, p]));
const byVariant = new Map();
for (const p of PRODUCTS) for (const v of p.variants) byVariant.set(v.id, { product: p, variant: v });
const V = (handle, index = 0) => byHandle.get(handle).variants[index].id;

// ---------- fake Shopify cart ----------
const tierSaving = (u) => (u >= 4 ? 200 * u : u === 3 ? 400 : u === 2 ? 200 : 0);
const server = { lines: [], stripPlansOnAdd: false, discountsOn: true, calls: [] };
const keyOf = (l) => `${l.variant_id}:${l.plan || 0}:${JSON.stringify(Object.entries(l.properties).sort())}`;
function addLine(variantId, quantity, properties = {}, plan = null) {
  const hit = byVariant.get(Number(variantId));
  if (!hit) throw Object.assign(new Error('Cannot find variant'), { status: 404 });
  if (!hit.variant.available) throw Object.assign(new Error('sold out'), { status: 422 });
  const line = { variant_id: hit.variant.id, plan: plan ? Number(plan) : null, properties: { ...properties }, quantity };
  const existing = server.lines.find((l) => keyOf(l) === keyOf(line));
  if (existing) existing.quantity += quantity; else server.lines.push(line);
}
function cartJson() {
  const items = server.lines.filter((l) => l.quantity > 0).map((l) => {
    const { product, variant } = byVariant.get(l.variant_id);
    const unit = l.plan ? variant.selling_plan_allocations.find((a) => a.selling_plan_id === l.plan).price : variant.price;
    return { key: keyOf(l), id: l.variant_id, variant_id: l.variant_id, product_id: product.id, handle: product.handle,
      product_type: product.type, title: variant.title === 'Default Title' ? product.title : `${product.title} - ${variant.title}`, variant_title: variant.title === 'Default Title' ? null : variant.title,
      quantity: l.quantity, properties: l.properties, price: unit, original_price: unit, original_line_price: unit * l.quantity,
      selling_plan_allocation: l.plan ? { selling_plan: { id: l.plan, name: 'Monthly Rotation' }, price: unit } : null };
  });
  const units = items.reduce((s, i) => s + (i.product_type === 'Fragrance' ? i.quantity : 0), 0);
  const discount = server.discountsOn ? tierSaving(units) : 0;
  const subtotal = items.reduce((s, i) => s + i.original_line_price, 0);
  const eligibleTotal = items.filter((i) => i.product_type === 'Fragrance').reduce((s, i) => s + i.original_line_price, 0);
  for (const i of items) {
    const share = i.product_type === 'Fragrance' && eligibleTotal ? Math.round(discount * i.original_line_price / eligibleTotal) : 0;
    i.final_line_price = i.original_line_price - share;
  }
  return { currency: 'USD', item_count: items.reduce((s, i) => s + i.quantity, 0), items, total_price: subtotal - discount, total_discount: discount };
}
async function fakeFetch(href, init = {}) {
  const path = new URL(href).pathname.replace(/^\//, '');
  const body = init.body ? JSON.parse(init.body) : null;
  server.calls.push(path);
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const fail = (status, description) => ({ ok: false, status, json: async () => ({ status, description }) });
  try {
    if (path === 'cart.js') return ok(cartJson());
    if (path === 'cart/add.js') {
      for (const item of body.items) addLine(item.id, item.quantity, item.properties || {}, server.stripPlansOnAdd ? null : item.selling_plan);
      return ok({ items: body.items });
    }
    if (path === 'cart/change.js') {
      if (server.failNextChange > 0) { server.failNextChange -= 1; return fail(422, 'Simulated change failure'); }
      const live = server.lines.filter((l) => l.quantity > 0);
      const line = body.line ? live[body.line - 1] : live.find((l) => keyOf(l) === body.id);
      if (!line) return fail(400, 'no such line');
      if ('selling_plan' in body) line.plan = body.selling_plan ? Number(body.selling_plan) : null;
      line.quantity = body.quantity;
      server.lines = server.lines.filter((l) => l.quantity > 0);
      if (server.loseNextChangeResponse > 0) { server.loseNextChangeResponse -= 1; return fail(500, 'Simulated lost response'); }
      return ok(cartJson());
    }
    let m = path.match(/^products\/([a-z0-9-]+)\.js$/);
    if (m) { const p = byHandle.get(m[1]); return p ? ok(JSON.parse(JSON.stringify(p))) : fail(404, 'Not found'); }
    if (path === 'collections/fragrances/products.json') return ok({ products: PRODUCTS.filter((p) => p.type === 'Fragrance').map((p) => ({ handle: p.handle, title: p.title })) });
    return fail(404, 'unknown ' + path);
  } catch (error) { return fail(error.status || 500, error.message); }
}

// ---------- browser shims ----------
const defined = {};
const events = [];
const sandbox = {
  console, URL, Intl, Promise, JSON, Number, Object, Math, Array, Map, Error, String, Boolean, setTimeout,
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  HTMLElement: class {},
  customElements: { get: (n) => defined[n], define: (n, c) => { defined[n] = c; } },
  navigator: {},
  document: { dispatchEvent: (e) => events.push(e.type), querySelectorAll: () => [], documentElement: { lang: 'en-US' } },
};
sandbox.window = sandbox;
sandbox.window.location = { origin: 'https://test.local', href: 'https://test.local/' };
sandbox.window.Shopify = { routes: { root: '/' }, currency: { active: 'USD' } };
sandbox.window.__bnFetch = fakeFetch;
sandbox.window.dispatchEvent = () => {};
vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox);
const C = sandbox.BaseNoteCommerce;
assert.ok(C, 'BaseNoteCommerce loaded');

// ---------- helpers ----------
const reset = (lines = []) => { server.lines = lines.map((l) => ({ plan: null, properties: {}, ...l })); server.stripPlansOnAdd = false; server.discountsOn = true; server.failNextChange = 0; server.loseNextChangeResponse = 0; };
const total = () => cartJson().total_price;
const helperCount = () => server.lines.filter((l) => l.variant_id === 91).length;
const add = (handle, extra = {}) => C.addVial({ variantId: V(handle, extra.index || 0), handle, quantity: extra.quantity || 1, sellingPlanId: extra.plan || null, source: 'test' });
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (error) { results.push(['FAIL', name, error.message]); }
}

(async () => {
  await test('1 vial = $20, real scent line', async () => {
    reset(); await add('creed-aventus');
    assert.equal(total(), 2000); assert.equal(helperCount(), 0);
  });
  await test('2/3/4/5 different vials = $38/$56/$72/$90, never a helper line', async () => {
    reset();
    const seen = [];
    for (const h of ['creed-aventus', 'bleecker-street', 'santal-33', 'baccarat-rouge', 'sale-scent']) { await add(h); seen.push(total()); }
    assert.deepEqual(seen.slice(0, 4), [2000, 3800, 5600, 7200]);
    assert.equal(seen[4], 2000 * 4 + 1500 - 1000, '5th unit (a $15 sale vial) -> 9500 - 1000');
    assert.equal(helperCount(), 0);
  });
  await test('5 x $20 vials = $90 (Jeff tier, 4+ = $18 each)', async () => {
    reset(); await add('creed-aventus', { quantity: 5 });
    assert.equal(server.lines.length, 1); assert.equal(server.lines[0].quantity, 5); assert.equal(total(), 9000);
  });
  await test('same scent twice -> one line qty 2, $38', async () => {
    reset(); await add('creed-aventus'); await add('creed-aventus');
    assert.equal(server.lines.length, 1); assert.equal(server.lines[0].quantity, 2); assert.equal(total(), 3800);
  });
  await test('subscription box + 1/2/3 extras = $33/$51/$67', async () => {
    reset(); await add('creed-aventus', { plan: PLAN });
    assert.equal(total(), 1500);
    const seen = [];
    for (const h of ['bleecker-street', 'santal-33', 'baccarat-rouge']) { await add(h); seen.push(total()); }
    assert.deepEqual(seen, [3300, 5100, 6700]);
    assert.equal(server.lines.filter((l) => l.plan).length, 1, 'still exactly one subscription line');
  });
  await test('second subscription is refused', async () => {
    reset(); await add('creed-aventus', { plan: PLAN });
    await assert.rejects(add('bleecker-street', { plan: PLAN }), /already in your cart/);
  });
  await test('full bottle + vial counts as 2 units ($2 off)', async () => {
    reset(); await add('tom-ford-oud-wood', { index: 1 }); await add('creed-aventus');
    assert.equal(total(), 26000 + 2000 - 200);
  });
  await test('box set + vial: box set is not a Fragrance, no discount ($76)', async () => {
    reset(); await add('build-your-own-box-set'); await add('creed-aventus');
    assert.equal(total(), 7600);
  });
  await test('adding the helper directly is refused', async () => {
    reset(); await assert.rejects(C.addVial({ variantId: 91, handle: 'extra-5ml-vial-add-on', quantity: 1 }), /Choose a fragrance/);
  });
  await test('legacy cart: real vial + helper x2 (props) -> 3 real lines, $56, no helper', async () => {
    reset([{ variant_id: V('creed-aventus'), quantity: 1 },
      { variant_id: 91, quantity: 2, properties: { 'Selected scent': 'Bleecker Street', '_Base Note scent handle': 'bleecker-street', '_Base Note scent variant': String(V('bleecker-street')), '_Base Note source': 'Product page' } }]);
    await C.prepareCart();
    assert.equal(helperCount(), 0);
    const bleecker = server.lines.find((l) => l.variant_id === V('bleecker-street'));
    assert.equal(bleecker.quantity, 2); assert.deepEqual(bleecker.properties, {}, 'helper bookkeeping properties dropped');
    assert.equal(total(), 5600);
  });
  await test('legacy cart: helper alone -> its scent at $20', async () => {
    reset([{ variant_id: 91, quantity: 1, properties: { 'Selected scent': 'Santal 33', '_Base Note scent handle': 'santal-33', '_Base Note scent variant': String(V('santal-33')) } }]);
    await C.prepareCart();
    assert.equal(helperCount(), 0); assert.equal(total(), 2000);
  });
  await test('legacy cart: helper with only the scent title -> resolved by exact title', async () => {
    reset([{ variant_id: V('creed-aventus'), quantity: 1 }, { variant_id: 91, quantity: 1, properties: { 'Selected scent': 'Baccarat Rouge' } }]);
    await C.prepareCart();
    assert.equal(helperCount(), 0); assert.ok(server.lines.some((l) => l.variant_id === V('baccarat-rouge'))); assert.equal(total(), 3800);
  });
  await test('legacy cart: helper for a scent now on sale still converts', async () => {
    reset([{ variant_id: 91, quantity: 1, properties: { '_Base Note scent handle': 'sale-scent', '_Base Note scent variant': String(V('sale-scent')) } }]);
    await C.prepareCart();
    assert.equal(helperCount(), 0); assert.equal(total(), 1500);
  });
  await test('legacy cart: helper whose scent sold out -> clear error, cart untouched', async () => {
    reset([{ variant_id: 91, quantity: 1, properties: { '_Base Note scent handle': 'gone-scent', '_Base Note scent variant': String(V('gone-scent')) } }]);
    await assert.rejects(C.prepareCart(), /no longer available/);
    assert.equal(helperCount(), 1);
  });
  await test('legacy cart: helper with a selling plan -> refused for review', async () => {
    reset([{ variant_id: 91, quantity: 1, plan: PLAN, properties: { '_Base Note scent handle': 'santal-33', '_Base Note scent variant': String(V('santal-33')) } }]);
    await assert.rejects(C.prepareCart(), /older additional-vial subscription/);
  });
  await test('quotes mirror the tiers', async () => {
    const q = (handle, quantity = 1, index = 0) => C.quoteVial({ variantId: V(handle, index), handle, quantity });
    reset();
    let r = await q('creed-aventus'); assert.deepEqual([r.unitPrice, r.totalPrice, r.additional], [2000, 2000, false]);
    r = await q('creed-aventus', 3); assert.deepEqual([r.unitPrice, r.totalPrice, r.units], [1800, 5600, 3]);
    r = await q('creed-aventus', 4); assert.equal(r.totalPrice, 7200);
    await add('bleecker-street');
    r = await q('creed-aventus'); assert.deepEqual([r.unitPrice, r.totalPrice, r.additional], [1800, 1800, true]);
    await add('santal-33');
    r = await q('creed-aventus'); assert.deepEqual([r.unitPrice, r.totalPrice], [1800, 1800]);
    await add('baccarat-rouge');
    r = await q('creed-aventus'); assert.deepEqual([r.unitPrice, r.totalPrice, r.units], [1800, 1600, 4], '4th vial adds $16 and makes every vial $18');
    r = await q('tom-ford-oud-wood', 1, 1); assert.deepEqual([r.unitPrice, r.totalPrice], [26000, 26000], 'full bottles quote at regular price');
    reset(); await add('build-your-own-box-set');
    r = await q('creed-aventus'); assert.deepEqual([r.unitPrice, r.totalPrice], [2000, 2000], 'a box set alone does not unlock $18');
    reset(); await add('creed-aventus', { plan: PLAN });
    r = await q('bleecker-street'); assert.equal(r.unitPrice, 1800, 'subscription box unlocks $18');
  });
  await test('every quote equals the real change in cart total', async () => {
    const bases = [[], ['creed-aventus'], ['creed-aventus', 'bleecker-street'], ['creed-aventus', 'bleecker-street', 'santal-33'], ['build-your-own-box-set'], ['tom-ford-oud-wood#1']];
    for (const base of bases) for (const qty of [1, 2, 3]) {
      reset();
      for (const h of base) { const [handle, idx] = h.split('#'); await add(handle, { index: Number(idx || 0) }); }
      const before = total();
      const quote = await C.quoteVial({ variantId: V('baccarat-rouge'), handle: 'baccarat-rouge', quantity: qty });
      await add('baccarat-rouge', { quantity: qty });
      assert.equal(quote.totalPrice, total() - before, `base=${base.join('+') || 'empty'} qty=${qty}`);
    }
  });
  await test('changeQuantity: lowering a line reprices via discounts, no helper', async () => {
    reset(); await add('creed-aventus', { quantity: 3 });
    const key = cartJson().items[0].key;
    await C.changeQuantity(key, 2);
    assert.equal(total(), 3800); assert.equal(helperCount(), 0);
  });
  await test('changeQuantity: subscription line cannot go above 1', async () => {
    reset(); await add('creed-aventus', { plan: PLAN });
    await assert.rejects(C.changeQuantity(cartJson().items[0].key, 2), /one vial each month/);
  });
  await test('setOrderMode subscription on a qty-2 line converts ONE unit, keeps the other', async () => {
    reset(); await add('creed-aventus', { quantity: 2 });
    await C.setOrderMode('subscription');
    const lines = cartJson().items;
    assert.equal(lines.length, 2);
    assert.equal(lines.find((i) => i.selling_plan_allocation).quantity, 1);
    assert.equal(lines.find((i) => !i.selling_plan_allocation).quantity, 1);
    assert.equal(total(), 1500 + 2000 - 200);
  });
  await test('setOrderMode subscription prefers a single-unit line', async () => {
    reset(); await add('creed-aventus', { quantity: 2 }); await add('bleecker-street');
    await C.setOrderMode('subscription');
    const sub = cartJson().items.find((i) => i.selling_plan_allocation);
    assert.equal(sub.handle, 'bleecker-street');
  });
  await test('setOrderMode subscription when the plan is stripped: error, no unit lost', async () => {
    reset(); await add('creed-aventus', { quantity: 2 });
    server.stripPlansOnAdd = true;
    await assert.rejects(C.setOrderMode('subscription'), /not applied/);
    const items = cartJson().items;
    assert.equal(items.length, 1); assert.equal(items[0].quantity, 2, 'still two one-time units');
  });
  await test('setOrderMode subscription when lowering the one-time line fails: subscription unit removed, no duplicate', async () => {
    reset(); await add('creed-aventus', { quantity: 3 });
    server.failNextChange = 1;
    await assert.rejects(C.setOrderMode('subscription'), /Simulated change failure/);
    const items = cartJson().items;
    assert.equal(items.length, 1, 'only the one-time line remains');
    assert.ok(!items[0].selling_plan_allocation); assert.equal(items[0].quantity, 3, 'still three one-time units');
  });
  await test('setOrderMode subscription when the change lands but its response is lost: keeps the result', async () => {
    reset(); await add('creed-aventus', { quantity: 3 });
    server.loseNextChangeResponse = 1;
    await C.setOrderMode('subscription');
    const items = cartJson().items;
    assert.equal(items.find((i) => i.selling_plan_allocation).quantity, 1);
    assert.equal(items.find((i) => !i.selling_plan_allocation).quantity, 2);
  });
  await test('setOrderMode one-time turns the subscription back into a one-time line', async () => {
    reset(); await add('creed-aventus', { plan: PLAN }); await add('bleecker-street');
    await C.setOrderMode('onetime');
    assert.ok(cartJson().items.every((i) => !i.selling_plan_allocation)); assert.equal(total(), 3800);
  });
  await test('PDP price note copy', async () => {
    const Product = defined['artifact-product'];
    const note = (quote, current, qty) => Product.prototype.priceNote.call({ plan: null }, quote, current, qty);
    const vial = { isVial: true, price: 2000 };
    assert.equal(note({ unitPrice: 2000, saving: 0, units: 1, additional: false, currency: 'USD' }, vial, 1), '$20 first vial · $18 each additional vial in your order.');
    assert.equal(note({ unitPrice: 1800, saving: 200, units: 2, additional: true, currency: 'USD' }, vial, 1), '$18 per additional vial in this order.');
    assert.equal(note({ unitPrice: 1800, saving: 400, units: 3, additional: true, currency: 'USD' }, vial, 3), 'First vial at regular price; additional 5ml vials are $18 each.');
    assert.equal(note({ unitPrice: 1800, saving: 400, units: 4, additional: true, currency: 'USD' }, vial, 1), 'Four or more vials in one order: $18 each.');
    assert.equal(note({ unitPrice: 26000, saving: 0, units: 2, additional: false }, { isVial: false, price: 26000 }, 1), '');
    assert.equal(note({ unitPrice: 1300, saving: 200, units: 2, additional: true, currency: 'USD' }, { isVial: true, price: 1500 }, 1), 'Includes $2 in vial bundle savings.');
  });
  await test('every add publishes cart events', async () => {
    reset(); events.length = 0; await add('creed-aventus');
    assert.ok(events.includes('basenote:cart-updated') && events.includes('cart:refresh'));
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const r of results) console.log(r.join(' | '));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
