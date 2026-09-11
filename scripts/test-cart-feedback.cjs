const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const theme = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(theme, 'assets/scent-storefront.js'), 'utf8');

function node(text = '') {
  return {
    textContent: text, childNodes: [{ textContent: text }], dataset: {}, attributes: {}, disabled: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(child) { this.childNodes.push(child); },
    replaceChildren(...children) { this.childNodes = children; this.textContent = children.map(child => child.textContent).join(''); }
  };
}

function harness(addVial) {
  const elements = new Map();
  const frames = [];
  const document = { querySelector: () => null, createTextNode: text => node(text), createElement: () => node(), activeElement: null };
  const window = { Shopify: { routes: { root: '/' } }, ...(addVial ? { BaseNoteCommerce: { addVial } } : {}) };
  vm.runInNewContext(source, { document, window, location: { search: '' }, URLSearchParams, HTMLElement: class {}, AbortController, customElements: { get: name => elements.get(name), define: (name, value) => elements.set(name, value) }, requestAnimationFrame: fn => frames.push(fn) });
  const catalog = new (elements.get('scent-catalog'))();
  const button = node('Add to cart · $20');
  const other = node('Add to cart · $20');
  const soldOut = node('Sold out'); soldOut.disabled = true;
  const controls = [button, other, soldOut];
  const form = { dataset: { variantId: '101', handle: 'real-fragrance', title: 'Real Fragrance EDP' }, querySelector: () => button, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  const shown = [];
  catalog.contains = candidate => candidate === form;
  catalog.querySelectorAll = () => controls;
  catalog.status = node();
  catalog.dataset = { source: 'Fragrance collection' };
  catalog.refreshPrices = () => {};
  catalog.feedback = { dataset: { loading: 'Cart loading', adding: 'Adding…', fallbackError: 'Check your cart.' }, show: value => shown.push(value) };
  const event = () => ({ target: { closest: () => form }, preventDefault() { this.prevented = true; } });
  return { catalog, button, other, soldOut, form, shown, event, window, document, frames, Feedback: elements.get('cart-feedback') };
}

test('six in-flight taps make one add; success feedback waits for Shopify; later repeats work', async () => {
  let calls = 0;
  let confirm;
  const h = harness(() => { calls++; return new Promise(resolve => { confirm = resolve; }); });
  const first = h.catalog.add(h.event());
  for (let count = 0; count < 5; count++) await h.catalog.add(h.event());
  assert.equal(calls, 1);
  assert.equal(h.shown.length, 0);
  assert.equal(h.button.textContent, 'Adding…');
  assert.equal(h.button.disabled, true);
  assert.equal(h.other.disabled, true);
  confirm({ item_count: 1 }); await first;
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].title, 'Real Fragrance EDP');
  assert.equal(h.shown[0].quantity, 1);
  assert.equal(h.button.disabled, false);
  assert.equal(h.other.disabled, false);
  assert.equal(h.soldOut.disabled, true);
  assert.equal(h.button.textContent, 'Add to cart · $20');
  const second = h.catalog.add(h.event());
  assert.equal(calls, 2);
  confirm({ item_count: 2 }); await second;
  assert.equal(h.shown.length, 2);
});

test('rejected adds show only an error and restore the original controls without retry', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('Unavailable fragrance'); });
  const event = h.event();
  await h.catalog.add(event);
  assert.equal(event.prevented, true);
  assert.equal(calls, 1);
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].error, true);
  assert.equal(h.shown[0].message, 'Unavailable fragrance');
  assert.equal(h.button.disabled, false);
  assert.equal(h.soldOut.disabled, true);
  assert.equal(h.form.attributes['aria-busy'], undefined);
});

test('late commerce library gives visible feedback and never falls through to a native second request', async () => {
  const h = harness();
  const event = h.event();
  await h.catalog.add(event);
  assert.equal(event.prevented, true);
  assert.equal(h.shown[0].error, true);
  assert.equal(h.shown[0].message, 'Cart loading');
});

test('feedback is non-modal, announces repeated results, and returns focus only when closed from inside', () => {
  const h = harness();
  const feedback = new h.Feedback();
  const panel = { hidden: true, dataset: {}, open: false, matches() { return this.open; }, showPopover() { this.open = true; }, hidePopover() { this.open = false; }, contains: target => target === panel };
  const nodes = Object.fromEntries(['heading', 'message', 'quantity', 'icon'].map(name => [`[data-cart-feedback-${name}]`, node()]));
  feedback.panel = panel;
  feedback.announcement = node();
  feedback.querySelector = selector => nodes[selector];
  feedback.dataset = { added: 'Added to cart', error: 'Add not confirmed', quantity: 'Quantity: __quantity__', announcement: 'Added: __fragrance__. Quantity: __quantity__.', fallbackError: 'Check your cart.' };
  let focusCalls = 0;
  const trigger = { isConnected: true, focus() { focusCalls++; } };
  h.document.activeElement = trigger;
  feedback.show({ title: '<script>not markup</script>', quantity: 1, trigger });
  assert.equal(h.document.activeElement, trigger);
  assert.equal(nodes['[data-cart-feedback-message]'].textContent, '<script>not markup</script>');
  assert.equal(panel.open, true);
  h.frames.shift()();
  assert.match(feedback.announcement.textContent, /Quantity: 1/);
  feedback.show({ title: 'Second fragrance', quantity: 1, trigger });
  assert.equal(feedback.announcement.textContent, '');
  h.frames.shift()();
  assert.match(feedback.announcement.textContent, /Second fragrance/);
  feedback.close();
  assert.equal(focusCalls, 0);
  feedback.show({ error: true, message: 'Check your cart', trigger });
  h.document.activeElement = panel;
  feedback.close();
  assert.equal(focusCalls, 1);
  assert.equal(panel.hidden, true);
  assert.equal(panel.open, false);
  h.frames.shift()();
  assert.equal(feedback.announcement.textContent, '');
});

test('feedback stays localized, reduced-motion aware, and included once without pricing-engine changes', () => {
  const markup = fs.readFileSync(path.join(theme, 'snippets/cart-feedback.liquid'), 'utf8');
  const layout = fs.readFileSync(path.join(theme, 'layout/theme.liquid'), 'utf8');
  const locale = JSON.parse(fs.readFileSync(path.join(theme, 'locales/en.default.json'), 'utf8'));
  assert.equal((layout.match(/render 'cart-feedback'/g) || []).length, 1);
  assert.match(markup, /popover="manual"/);
  assert.match(markup, /aria-live="polite" aria-atomic="true"/);
  assert.match(markup, /prefers-reduced-motion: reduce/);
  assert.match(markup, /routes\.cart_url/);
  assert.ok(locale.cart.feedback.close);
  assert.doesNotMatch(markup, /autofocus|aria-modal="true"/);
  assert.doesNotMatch(source, /\/cart\/add\.js|selling_plan\s*:/);
});
