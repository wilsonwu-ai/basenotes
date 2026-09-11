/** Regression: the current header and legacy theme controller must not both own navigation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const themeSource = fs.readFileSync(path.join(root, 'assets/theme.js'), 'utf8');
const headerSource = fs.readFileSync(path.join(root, 'sections/header.liquid'), 'utf8');
const headerController = headerSource.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function fixture(managed) {
  const listeners = new Map();
  let document;
  function element(id = '') {
    const classes = new Set();
    const attributes = new Map();
    const handlers = new Map();
    return {
      id,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(handler); },
      click() { for (const handler of handlers.get('click') || []) handler({ target: this }); },
      handlerCount: type => (handlers.get(type) || []).length,
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: key => attributes.delete(key),
      getAttribute: key => attributes.get(key),
      querySelectorAll: () => [],
      focus() { document.activeElement = this; },
    };
  }
  const toggle = element();
  const nav = element(managed ? 'BaseNoteMobileNavigation' : 'LegacyNavigation');
  const close = element();
  const mobileOverlay = element();
  const legacyOverlay = element('overlay');
  const selectors = new Map([
    ['[data-mobile-toggle]', toggle], ['[data-mobile-nav]', nav], ['[data-mobile-close]', close],
    ['[data-mobile-overlay]', mobileOverlay], ['[data-search-toggle]', element()],
    ['[data-search-overlay]', element()], ['[data-search-close]', element()], ['[data-search-input]', element()],
  ]);
  document = {
    body: { style: {} }, activeElement: null,
    querySelector: selector => selectors.get(selector) || null,
    querySelectorAll: () => [], getElementById: id => id === 'overlay' ? legacyOverlay : null,
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
    emit(type, event = {}) { for (const handler of listeners.get(type) || []) handler(event); },
  };
  const context = vm.createContext({ document, window: { addEventListener() {} }, localStorage: { getItem: () => null }, setTimeout: callback => callback(), console });
  if (managed) vm.runInContext(headerController, context, { filename: 'header.liquid inline controller' });
  vm.runInContext(themeSource, context, { filename: 'assets/theme.js' });
  document.emit('DOMContentLoaded');
  return { document, toggle, nav, close, mobileOverlay, legacyOverlay };
}

const current = fixture(true);
assert.equal(current.toggle.handlerCount('click'), 1, 'Only the current header binds its toggle');
current.toggle.click();
assert.equal(current.nav.classList.contains('is-active'), true);
assert.equal(current.mobileOverlay.classList.contains('is-active'), true);
assert.equal(current.legacyOverlay.classList.contains('is-active'), false, 'Header never activates the unrelated global overlay');
assert.equal(current.document.activeElement, current.close);
current.document.emit('keydown', { key: 'Escape' });
assert.equal(current.nav.classList.contains('is-active'), false);
assert.equal(current.mobileOverlay.classList.contains('is-active'), false);
assert.equal(current.legacyOverlay.classList.contains('is-active'), false, 'Escape leaves no invisible click blocker');
assert.equal(current.document.activeElement, current.toggle);
assert.equal(current.toggle.getAttribute('aria-expanded'), 'false');
assert.equal(current.document.body.style.overflow, '');
current.toggle.click();
current.close.click();
assert.equal(current.document.activeElement, current.toggle);
assert.equal(current.mobileOverlay.classList.contains('is-active'), false);

const legacy = fixture(false);
assert.equal(legacy.toggle.handlerCount('click'), 1, 'Legacy navigation retains its original controller');
legacy.toggle.click();
assert.equal(legacy.legacyOverlay.classList.contains('is-active'), true);
legacy.document.emit('keydown', { key: 'Escape' });
assert.equal(legacy.nav.classList.contains('is-active'), false);
assert.equal(legacy.legacyOverlay.classList.contains('is-active'), false);
console.log('Header controller regression passed: current and legacy navigation each have one owner; Escape clears overlays and preserves focus.');
