/* Curated box set page: gallery thumbs + one-time Add to cart via BaseNoteCommerce.addVial.
   Properties "Fragrance 1".."Fragrance 3" travel on the line item, same as the Build Your Own box. */
(function () {
  'use strict';
  var root = document.querySelector('[data-box-set]');
  if (!root) return;

  var status = root.querySelector('[data-status]');
  function say(msg, state) {
    if (!status) return;
    status.textContent = msg || '';
    if (state) status.setAttribute('data-state', state); else status.removeAttribute('data-state');
  }

  /* Gallery */
  var viewport = root.querySelector('[data-gallery-viewport]');
  var thumbs = Array.prototype.slice.call(root.querySelectorAll('[data-gallery-thumb]'));
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mark(index) {
    thumbs.forEach(function (t, i) { if (i === index) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
  }
  if (viewport && thumbs.length) {
    thumbs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        viewport.scrollTo({ left: i * viewport.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
        mark(i);
      });
    });
    var ticking = false;
    viewport.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        mark(Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth)));
      });
    }, { passive: true });
  }

  /* Add to cart */
  var btn = root.querySelector('[data-add]');
  if (!btn) return;
  var busy = false;
  var idle = btn.textContent;

  btn.addEventListener('click', async function () {
    if (busy || btn.getAttribute('aria-disabled') === 'true' || root.getAttribute('data-can-buy') !== 'true') return;
    var rows = Array.prototype.slice.call(root.querySelectorAll('.bs-scent[data-label]'));
    if (rows.length !== 3) { say("We couldn't read this set's fragrances. Please refresh and try again.", 'error'); return; }
    if (!window.BaseNoteCommerce || typeof window.BaseNoteCommerce.addVial !== 'function') {
      say("We couldn't add this set. Please refresh and try again.", 'error');
      return;
    }
    var properties = {};
    rows.forEach(function (li, i) { properties['Fragrance ' + (i + 1)] = li.getAttribute('data-label'); });

    busy = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = 'Adding...';
    say('');
    try {
      await window.BaseNoteCommerce.addVial({
        variantId: Number(root.getAttribute('data-variant-id')),
        handle: root.getAttribute('data-handle'),
        title: root.getAttribute('data-title'),
        quantity: 1,
        properties: properties,
        source: 'box-set'
      });
      btn.textContent = 'Added';
      say('Added to your bag.');
      var fb = document.querySelector('cart-feedback');
      if (fb && typeof fb.show === 'function') fb.show({ title: root.getAttribute('data-title'), quantity: 1, trigger: btn });
      setTimeout(function () { btn.textContent = idle; btn.removeAttribute('aria-disabled'); busy = false; }, 2500);
    } catch (err) {
      var msg = (err && err.message) || "We couldn't add this set. Please try again.";
      say(msg, 'error');
      btn.textContent = idle;
      btn.removeAttribute('aria-disabled');
      busy = false;
    }
  });
})();
