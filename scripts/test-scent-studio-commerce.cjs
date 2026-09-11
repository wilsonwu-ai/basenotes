const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/basenote-commerce.js'), 'utf8');
const HELPER = 'extra-5ml-vial-add-on';
const clone = (data) => JSON.parse(JSON.stringify(data));

function harness({ stripPlans = false, capturedFetch = false, discountKeys = false } = {}) {
  const products = {};
  for (const [handle, id, title] of [['creed-aventus', 101, 'Creed Aventus EDP'], ['another-scent', 102, 'Another Scent EDP']]) {
    products[handle] = { handle, title, variants: [{ id, title: '5ml', available: true, price: 2000, selling_plan_allocations: [{ selling_plan_id: 700, selling_plan_group_id: 'monthly', price: 1500 }] }], selling_plan_groups: [{ id: 'monthly', selling_plans: [{ id: 700, name: 'Monthly Subscription', recurring_deliveries: true }] }] };
  }
  products[HELPER] = { handle: HELPER, title: 'Extra 5ml Vial Add-On', variants: [{ id: 999, title: 'Default Title', available: true, price: 1800, selling_plan_allocations: [{ selling_plan_id: 700, price: 1350 }] }] };
  products['full-bottle'] = { handle: 'full-bottle', title: 'Full Bottle', variants: [{ id: 500, title: '100ml', available: true, price: 21000, selling_plan_allocations: [] }] };
  let items = [];
  let nextFailure;
  const requests = [];
  const keyFor = (id, properties, plan) => `${id}:${crypto.createHash('md5').update(JSON.stringify([Object.entries(properties).sort(), plan || null])).digest('hex')}`;
  function makeLine(spec) {
    const product = Object.values(products).find((candidate) => candidate.variants.some((variant) => variant.id === Number(spec.id)));
    const variant = product?.variants.find((candidate) => candidate.id === Number(spec.id));
    if (!variant?.available) throw new Error('Sold out');
    const properties = clone(spec.properties || {});
    const plan = spec.selling_plan ? { selling_plan: { id: Number(spec.selling_plan), name: 'Monthly Subscription' } } : null;
    const price = plan ? variant.selling_plan_allocations.find((candidate) => candidate.selling_plan_id === Number(spec.selling_plan)).price : variant.price;
    return { key: keyFor(variant.id, properties, spec.selling_plan), variant_id: variant.id, title: `${product.title} - ${variant.title}`, variant_title: variant.title, product_title: product.title, handle: product.handle, quantity: spec.quantity, properties, price, selling_plan_allocation: plan };
  }
  const cart = () => ({ currency: 'USD', items: clone(items.map((item) => ({ ...item, final_line_price: item.price * item.quantity }))), item_count: items.reduce((sum, item) => sum + item.quantity, 0), total_price: items.reduce((sum, item) => sum + item.price * item.quantity, 0) });
  const reprice = () => {
    if (!discountKeys) return;
    const regularCount = items.filter((item) => [101, 102].includes(item.variant_id) && !item.selling_plan_allocation).reduce((sum, item) => sum + item.quantity, 0);
    for (const item of items) {
      if ([101, 102].includes(item.variant_id) && !item.selling_plan_allocation) item.price = regularCount > 1 ? 1800 : 2000;
      item.key = `${keyFor(item.variant_id, item.properties, item.selling_plan_allocation?.selling_plan.id)}:${item.price}`;
    }
  };
  const add = (spec) => { const line = makeLine(spec); const existing = items.find((item) => keyFor(item.variant_id, item.properties, item.selling_plan_allocation?.selling_plan.id) === keyFor(line.variant_id, line.properties, line.selling_plan_allocation?.selling_plan.id)); if (existing) existing.quantity += line.quantity; else items.unshift(line); reprice(); };
  async function fetch(url, options = {}) {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    if (stripPlans && body) {
      if (body.items) for (const item of body.items) delete item.selling_plan;
      else delete body.selling_plan;
    }
    requests.push({ path, body });
    if (nextFailure?.path === path) { nextFailure = null; return { ok: false, json: async () => ({ description: 'Test request failed' }) }; }
    let result;
    if (path === '/cart.js') result = cart();
    else if (path === '/collections/fragrances/products.json') result = { products: Object.values(products) };
    else if (/^\/products\//.test(path)) result = products[path.split('/').pop().replace('.js', '')];
    else if (path === '/cart/add.js') { for (const spec of body.items) add(spec); result = { items }; }
    else if (path === '/cart/change.js') {
      if ('selling_plan' in body) assert.ok(body.line, 'Shopify requires a line index when changing selling_plan');
      const item = body.line ? items[body.line - 1] : items.find((candidate) => candidate.key === body.id);
      if (!item) return { ok: false, json: async () => ({ description: 'Line missing' }) };
      items = items.filter((candidate) => candidate.key !== item.key);
      if (body.quantity) add({ id: item.variant_id, quantity: body.quantity, properties: item.properties, selling_plan: 'selling_plan' in body ? body.selling_plan : item.selling_plan_allocation?.selling_plan.id });
      reprice();
      result = cart();
    } else throw new Error(`Unhandled ${path}`);
    return { ok: true, json: async () => clone(result) };
  }
  class DummyEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const window = { Shopify: { routes: { root: '/' } }, location: { origin: 'https://test.local', href: 'https://test.local/' }, dispatchEvent() {}, ...(capturedFetch ? { __bnFetch: fetch, fetch: () => { throw new Error('Wrapped fetch must not be used'); } } : {}) };
  const context = { window, document: { documentElement: { lang: 'en-US' }, dispatchEvent() {}, querySelectorAll: () => [] }, navigator: {}, fetch, URL, Intl, CustomEvent: DummyEvent, HTMLElement: class {}, customElements: { get: () => false, define() {} }, AbortController, console };
  vm.runInNewContext(source, context);
  return { api: window.BaseNoteCommerce, cart, products, requests, seed: (spec) => add(spec), fail: (path) => { nextFailure = { path }; } };
}

const a = { variantId: 101, handle: 'creed-aventus' };
const b = { variantId: 102, handle: 'another-scent' };

test('one-time first/additional pricing is authoritative and preserves scent identity', async () => {
  const h = harness();
  await h.api.addVial(a);
  const quote = await h.api.quoteVial(b);
  assert.equal(quote.unitPrice, 1800);
  await h.api.addVial(b);
  assert.equal(h.cart().total_price, 3800);
  const helper = h.cart().items.find((item) => item.handle === HELPER);
  assert.equal(helper.properties['Selected scent'], 'Another Scent EDP');
  assert.equal(helper.properties['_Base Note scent variant'], '102');
  assert.equal(helper.selling_plan_allocation, null);
});

test('a quantity of three is $20 + $18 + $18, including repeated same scent', async () => {
  const h = harness(); await h.api.addVial({ ...a, quantity: 3 });
  assert.equal(h.cart().total_price, 5600); assert.equal(h.cart().item_count, 3);
  assert.equal(h.cart().items.find((item) => item.handle !== HELPER).quantity, 1);
});

test('concurrent add buttons cannot both charge the first-vial price', async () => {
  const h = harness(); await Promise.all([h.api.addVial(a), h.api.addVial(b)]);
  assert.equal(h.cart().total_price, 3800);
});

test('removing a different first scent promotes the remaining scent to its real $20 variant', async () => {
  const h = harness(); await h.api.addVial(a); await h.api.addVial(b);
  const first = h.cart().items.find((item) => item.variant_id === 101);
  await h.api.changeQuantity(first.key, 0);
  assert.equal(h.cart().item_count, 1); assert.equal(h.cart().total_price, 2000);
  assert.equal(h.cart().items[0].variant_id, 102);
});

test('removing a same-scent first line keeps one correct remaining vial despite Shopify merging', async () => {
  const h = harness(); await h.api.addVial({ ...a, quantity: 2 });
  await h.api.changeQuantity(h.cart().items.find((item) => item.variant_id === 101).key, 0);
  assert.equal(h.cart().item_count, 1); assert.equal(h.cart().total_price, 2000);
  assert.equal(h.cart().items[0].variant_id, 101);
});

test('native/legacy quantity changes are normalized without losing units', async () => {
  const h = harness(); h.seed({ id: 101, quantity: 3 });
  await h.api.prepareCart();
  assert.equal(h.cart().item_count, 3); assert.equal(h.cart().total_price, 5600);
  const helper = h.cart().items.find((item) => item.variant_id === 999);
  await h.api.changeQuantity(helper.key, 1);
  assert.equal(h.cart().total_price, 3800);
});

test('Monthly Rotation converts one base vial; extras never receive the invalid helper selling plan', async () => {
  const h = harness(); await h.api.addVial(a); await h.api.addVial(b);
  await h.api.setOrderMode('subscription');
  assert.equal(h.cart().total_price, 3300);
  assert.equal(h.cart().items.filter((item) => item.selling_plan_allocation).length, 1);
  assert.equal(h.cart().items.find((item) => item.handle === HELPER).selling_plan_allocation, null);
  await h.api.setOrderMode('onetime'); assert.equal(h.cart().total_price, 3800);
});

test('PDP subscription only starts one recurring vial and prevents accidental duplicates', async () => {
  const h = harness(); await h.api.addVial({ ...a, sellingPlanId: 700 });
  await assert.rejects(h.api.addVial({ ...b, sellingPlanId: 700 }), /already in your cart/);
  await assert.rejects(h.api.changeQuantity(h.cart().items[0].key, 2), /includes one vial/);
  assert.equal(h.cart().total_price, 1500);
});

test('a full bottle retains real pricing and does not become a vial-price anchor', async () => {
  const h = harness(); await h.api.addVial({ variantId: 500, handle: 'full-bottle' }); await h.api.addVial(a);
  assert.equal(h.cart().total_price, 23000); assert.equal(h.cart().items.some((item) => item.handle === HELPER), false);
});

test('an exact legacy Selected scent recovers the correct original variant', async () => {
  const h = harness(); h.seed({ id: 999, quantity: 2, properties: { 'Selected scent': 'Another Scent EDP' } });
  await h.api.prepareCart(); assert.equal(h.cart().total_price, 3800);
  assert.equal(h.cart().items.find((item) => item.handle !== HELPER).variant_id, 102);
});

test('unidentified legacy helpers and recurring helper plans fail closed', async () => {
  const h = harness(); h.seed({ id: 999, quantity: 1 });
  await assert.rejects(h.api.prepareCart(), /needs a fragrance selection/);
  const recurring = harness(); recurring.seed({ id: 999, quantity: 1, selling_plan: 700 });
  await assert.rejects(recurring.api.prepareCart(), /older additional-vial subscription/);
});

test('failed replacement removes only its newly added units and leaves original selection intact', async () => {
  const h = harness(); h.seed({ id: 101, quantity: 2 }); h.fail('/cart/change.js');
  await assert.rejects(h.api.prepareCart(), /could not finish/);
  assert.equal(h.cart().item_count, 2); assert.equal(h.cart().items.length, 1);
  assert.equal(h.cart().items[0].variant_id, 101);
});

test('sold-out variants and direct helper additions cannot enter a cart', async () => {
  const h = harness(); h.products['creed-aventus'].variants[0].available = false;
  await assert.rejects(h.api.addVial(a), /sold out/);
  await assert.rejects(h.api.addVial({ variantId: 999, handle: HELPER }), /Choose a fragrance/);
  assert.equal(h.cart().item_count, 0);
});

test('uses the early captured fetch instead of an app-wrapped fetch', async () => {
  const h = harness({ capturedFetch: true });
  await h.api.addVial({ ...a, sellingPlanId: 700 });
  assert.equal(h.cart().items[0].selling_plan_allocation.selling_plan.id, 700);
});

test('does not claim subscription success if Shopify receives a stripped selling plan', async () => {
  const h = harness({ stripPlans: true });
  await assert.rejects(h.api.addVial({ ...a, sellingPlanId: 700 }), /subscription option was not applied/);
  assert.equal(h.cart().item_count, 0, 'the unintended one-time line was removed');
  await h.api.addVial(a);
  await assert.rejects(h.api.setOrderMode('subscription'), /subscription option was not applied/);
  assert.equal(h.cart().items[0].selling_plan_allocation, null);
});

test('coalesces simultaneous cart reads without caching across a mutation', async () => {
  const h = harness();
  await Promise.all([h.api.quoteVial(a), h.api.quoteVial(b), h.api.quoteVial(a)]);
  assert.equal(h.requests.filter((request) => request.path === '/cart.js').length, 1);
  await h.api.addVial(a);
  assert.equal((await h.api.getCart()).item_count, 1);
});

test('a malformed helper remains blocked even when a valid base exists', async () => {
  const h = harness(); h.seed({ id: 101, quantity: 1 }); h.seed({ id: 999, quantity: 1 });
  await assert.rejects(h.api.prepareCart(), /needs a fragrance selection/);
  assert.equal(h.cart().item_count, 2);
});

test('promoting a helper refreshes line keys after Shopify automatic discounts change them', async () => {
  const h = harness({ discountKeys: true });
  await h.api.addVial(a); await h.api.addVial(b);
  const base = h.cart().items.find((item) => item.variant_id === 101);
  await h.api.changeQuantity(base.key, 0);
  assert.equal(h.cart().total_price, 2000);
  assert.equal(h.cart().items[0].variant_id, 102);
  assert.equal(h.cart().item_count, 1);
});

test('normalizes several native variants despite discount key changes between each replacement', async () => {
  const h = harness({ discountKeys: true });
  h.seed({ id: 101, quantity: 2 }); h.seed({ id: 102, quantity: 2 });
  await h.api.prepareCart();
  assert.equal(h.cart().total_price, 7400);
  assert.equal(h.cart().item_count, 4);
  assert.equal(h.cart().items.filter((item) => item.variant_id !== 999).length, 1);
});
