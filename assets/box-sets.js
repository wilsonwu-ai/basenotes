/* Curated box sets.
   1. Hash routing on the curated page: #slug shows that set's detail view, anything else the grid.
      Back/forward and direct links work; document.title and focus follow the route.
   2. Add to cart (curated page and real box-set product pages):
      mode "product": add the set product's own variant, one-time, with Fragrance 1-3.
      mode "byo": add the Build Your Own variant with the SAME properties box-builder.js sends
                  (Fragrance 1-3, hidden _bn_box id "bx_<time36>_<4 chars>", quantity 1) plus a visible "Box set" = title. */
(function () {
  'use strict';

  /* ----- routing ----- */
  var curated = document.querySelector('[data-curated]');
  if (curated) {
    var grid = curated.querySelector('[data-view-grid]');
    var detail = curated.querySelector('[data-view-detail]');
    var baseTitle = document.title;
    var current = null;
    var route = function (first) {
      var slug = decodeURIComponent((location.hash || '').replace(/^#/, ''));
      var target = slug ? detail.querySelector('[data-set="' + slug.replace(/"/g, '') + '"]') : null;
      var prev = current;
      current = target ? slug : null;
      Array.prototype.forEach.call(detail.querySelectorAll('[data-set]'), function (a) { a.hidden = a !== target; });
      detail.hidden = !target;
      grid.hidden = !!target;
      document.title = target ? target.getAttribute('data-title') + ' — Curated Box Sets | Base Note' : baseTitle;
      if (first && !target) return;
      if (prev === current && !first) return;
      var h = target ? target.querySelector('[data-detail-title]') : curated.querySelector('[data-grid-title]');
      window.scrollTo(0, 0);
      if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
    };
    window.addEventListener('hashchange', function () { route(false); });
    route(true);
  }

  /* ----- add to cart ----- */
  function newBoxId() {
    var out = '';
    try {
      var buf = new Uint8Array(4);
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < 4; i++) out += (buf[i] % 36).toString(36);
    } catch (e) { out = Math.random().toString(36).slice(2, 6); }
    return 'bx_' + Date.now().toString(36) + '_' + out;
  }

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest ? e.target.closest('[data-add]') : null;
    if (!btn) return;
    var root = btn.closest('[data-set]');
    if (!root || btn.getAttribute('aria-disabled') === 'true' || root.getAttribute('data-can-buy') !== 'true') return;
    if (btn.__busy) return;
    var status = root.querySelector('[data-status]');
    function say(msg, state) {
      if (!status) return;
      status.textContent = msg || '';
      if (state) status.setAttribute('data-state', state); else status.removeAttribute('data-state');
    }
    var rows = Array.prototype.slice.call(root.querySelectorAll('.bs-scent[data-label]'));
    if (rows.length !== 3) { say("We couldn't read this set's fragrances. Please refresh and try again.", 'error'); return; }
    if (!window.BaseNoteCommerce || typeof window.BaseNoteCommerce.addVial !== 'function') {
      say("We couldn't add this set. Please refresh and try again.", 'error');
      return;
    }
    var title = root.getAttribute('data-title');
    var properties = {};
    rows.forEach(function (li, i) { properties['Fragrance ' + (i + 1)] = li.getAttribute('data-label'); });
    if (root.getAttribute('data-mode') === 'byo') {
      properties['Box set'] = title;
      properties._bn_box = newBoxId();
    }

    var idle = btn.textContent;
    btn.__busy = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = 'Adding...';
    say('');
    try {
      await window.BaseNoteCommerce.addVial({
        variantId: Number(root.getAttribute('data-variant-id')),
        handle: root.getAttribute('data-handle'),
        title: title,
        quantity: 1,
        properties: properties,
        source: 'box-set'
      });
      btn.textContent = 'Added';
      say('Added to your bag.');
      var fb = document.querySelector('cart-feedback');
      if (fb && typeof fb.show === 'function') fb.show({ title: title, quantity: 1, trigger: btn });
      setTimeout(function () { btn.textContent = idle; btn.removeAttribute('aria-disabled'); btn.__busy = false; }, 2500);
    } catch (err) {
      say((err && err.message) || "We couldn't add this set. Please try again.", 'error');
      btn.textContent = idle;
      btn.removeAttribute('aria-disabled');
      btn.__busy = false;
    }
  });
})();
