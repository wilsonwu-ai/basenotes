'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cartApi = require('../assets/bn-extra-vial-cart.js');

const EXTRA_VARIANT_ID = cartApi.EXTRA_VIAL_VARIANT_ID;
const SELLING_PLAN_ID = 900000001;

function approvedPriceProof(overrides = {}) {
  return {
    sellingPlanId: SELLING_PLAN_ID,
    basePriceCents: 1800,
    firstPriceCents: 1800,
    recurringPriceCents: 1800,
    adjustmentPrices: [1800, 1800],
    recurringDeliveries: true,
    ...overrides
  };
}

function response(payload, ok = true) {
  return { ok, json: async () => structuredClone(payload) };
}

function extraLine({ key = 'extra-key', price = 1800, quantity = 1, sellingPlanId = SELLING_PLAN_ID } = {}) {
  return {
    key,
    variant_id: EXTRA_VARIANT_ID,
    quantity,
    final_price: price,
    selling_plan_allocation: {
      price,
      selling_plan: { id: sellingPlanId }
    }
  };
}

test('Jeff bundle example is $51: one $15 base plus two $18 extras', () => {
  assert.equal(cartApi.calculateInitialTotal(1500, 1800, 2), 5100);
});

test('price mismatch fails closed before the first cart request', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    cartApi.ensureExtraVialQuantity({
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not run');
      },
      variantId: EXTRA_VARIANT_ID,
      sellingPlanId: SELLING_PLAN_ID,
      quantity: 1,
      priceProof: approvedPriceProof({ firstPriceCents: 1350 })
    }),
    (error) => error.code === 'extra_vial_price_mismatch'
  );
  assert.equal(fetchCalls, 0);
});

test('base-subscription lookup always ignores the add-on line', () => {
  const addOn = extraLine();
  const base = {
    key: 'base-key',
    variant_id: 12345,
    selling_plan_allocation: { price: 1500, selling_plan: { id: 101 } }
  };
  assert.equal(cartApi.findBaseSubscriptionLine([addOn, base]), base);
  assert.equal(cartApi.findBaseSubscriptionLine([addOn]), null);
});

test('retrying an already-satisfied quantity is idempotent', async () => {
  const calls = [];
  const line = extraLine({ quantity: 2 });
  const result = await cartApi.ensureExtraVialQuantity({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      return response({ items: [line] });
    },
    variantId: EXTRA_VARIANT_ID,
    sellingPlanId: SELLING_PLAN_ID,
    quantity: 2,
    priceProof: approvedPriceProof()
  });
  assert.equal(result.changed, false);
  assert.deepEqual(calls, [{ url: '/cart.js', method: 'GET' }]);
});

test('concurrent duplicate requests share one cart transaction', async () => {
  let items = [];
  let addCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === '/cart.js') return response({ items });
    if (url === '/cart/add.js') {
      addCount += 1;
      const payload = JSON.parse(options.body);
      items = [extraLine({ quantity: payload.quantity })];
      return response({ key: 'extra-key' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const options = {
    fetchImpl,
    variantId: EXTRA_VARIANT_ID,
    sellingPlanId: SELLING_PLAN_ID,
    quantity: 2,
    priceProof: approvedPriceProof()
  };

  const [first, second] = await Promise.all([
    cartApi.ensureExtraVialQuantity(options),
    cartApi.ensureExtraVialQuantity(options)
  ]);
  assert.equal(addCount, 1);
  assert.equal(first.line.quantity, 2);
  assert.equal(second.line.quantity, 2);
});

test('an unverified add is removed and the empty pre-change state is verified', async () => {
  let items = [];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (url === '/cart.js') return response({ items });
    if (url === '/cart/add.js') {
      const payload = JSON.parse(options.body);
      items = [extraLine({
        key: 'unapproved-key',
        price: 1350,
        quantity: payload.quantity,
        sellingPlanId: payload.selling_plan
      })];
      return response({ key: 'unapproved-key' });
    }
    if (url === '/cart/change.js') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.id, 'unapproved-key');
      assert.equal(payload.quantity, 0);
      items = [];
      return response({ items });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  await assert.rejects(
    cartApi.ensureExtraVialQuantity({
      fetchImpl,
      variantId: EXTRA_VARIANT_ID,
      sellingPlanId: SELLING_PLAN_ID,
      quantity: 1,
      priceProof: approvedPriceProof()
    }),
    (error) => error.code === 'extra_vial_verification_failed'
  );

  assert.deepEqual(items, []);
  assert.ok(calls.some((call) => call.url === '/cart/change.js' && call.method === 'POST'));
  assert.equal(calls.at(-1).url, '/cart.js');
});

test('Liquid offer is hidden by default and gated by exact live $18 allocations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../sections/main-product.liquid'), 'utf8');
  assert.match(source, /"id": "show_extra_vial_offer"[\s\S]*?"default": false/);
  assert.match(source, /extra_vial_variant\.price == 1800[\s\S]*?extra_vial_allocation\.price == 1800/);
  assert.match(source, /extra_vial_recurring_price == 1800/);
  assert.match(source, /\{%- if extra_vial_offer_valid -%\}[\s\S]*?data-extra-vial-offer/);
});

test('shared compare dialog declares modal labels and lifecycle hooks', () => {
  const snippet = fs.readFileSync(path.join(__dirname, '../snippets/compare-price-dialog.liquid'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../assets/bn-compare-price.js'), 'utf8');
  assert.match(snippet, /<dialog[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="BaseNoteComparePriceTitle"[\s\S]*?aria-describedby="BaseNoteComparePriceDescription"/);
  assert.match(script, /new AbortController\(\)/);
  assert.match(script, /event\.key !== 'Tab'/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /target\.focus\(\)/);
  assert.match(script, /pagehide/);
});
