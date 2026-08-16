/* ============================================================================
 * bn-motion.js — Base Note facelift, presentational motion only.
 * Vanilla, no deps, defer-loaded. 9.0 KB with comments, ~5.9 KB stripped, ~1.9 KB gzipped.
 *
 * HARD RULE: this file never touches the subscription funnel.
 * Every effect filters its candidate elements through isSafe(), which refuses
 * anything inside a funnel node. That is a structural gate, not a comment —
 * an element inside #cartDrawer cannot be picked up even if it carries the
 * data attribute. See DENY below.
 *
 * Effects: reveal (IntersectionObserver) · marquee · magnetic · cursor label.
 * All are no-ops under prefers-reduced-motion or coarse pointers.
 * ========================================================================== */
(function () {
  'use strict';

  /* --- Funnel guard ------------------------------------------------------ */
  var DENY = [
    'form[action*="/cart/add"]', '#sellingPlanSelector', '[name="selling_plan"]',
    '#addToCartButton', '[data-quick-add]', '[data-cart-drawer]', '[data-cart-count]',
    '[data-cart-items]', '#cartDrawer', '#bn-queue', '[data-bn-appstle]'
  ].join(',');

  function isSafe(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches && el.matches(DENY)) return false;
    return !(el.closest && el.closest(DENY));
  }
  function safeAll(sel, root) {
    var out = [], n = (root || document).querySelectorAll(sel), i;
    for (i = 0; i < n.length; i++) if (isSafe(n[i])) out.push(n[i]);
    return out;
  }

  /* --- Environment ------------------------------------------------------- */
  var mqMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var mqFine   = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  function reduced() { return !!(mqMotion && mqMotion.matches); }
  function fine()    { return !!(mqFine && mqFine.matches); }
  var hasIO = 'IntersectionObserver' in window;

  document.documentElement.classList.add('bn-js');

  /* ======================================================================
   * 1. REVEAL — [data-reveal], fires once then unobserves.
   * Groups share a stagger index via [data-reveal-group] on the parent.
   * ==================================================================== */
  function initReveal() {
    var els = safeAll('[data-reveal]');
    if (!els.length) return;

    if (reduced() || !hasIO) {                       // fail visible, always
      els.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }

    var css = getComputedStyle(document.documentElement);
    var step = parseInt(css.getPropertyValue('--bn-reveal-stagger'), 10) || 70;
    var cap  = parseInt(css.getPropertyValue('--bn-reveal-stagger-cap'), 10) || 6;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, i = 0, group = el.closest('[data-reveal-group]');
        if (group) {
          var sibs = safeAll('[data-reveal]', group);
          i = Math.min(sibs.indexOf(el), cap);
        }
        el.style.setProperty('--bn-reveal-delay', (i * step) + 'ms');
        el.classList.add('is-revealed');
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ======================================================================
   * 2. MARQUEE — [data-marquee] wraps one track; the track is duplicated
   * once so translateX(-50%) loops seamlessly. Pauses off-screen and hover.
   * ==================================================================== */
  function initMarquee() {
    safeAll('[data-marquee]').forEach(function (wrap) {
      var track = wrap.firstElementChild;
      if (!track || track.dataset.bnCloned === '1') return;

      var clone = track.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.dataset.bnCloned = '1';
      wrap.appendChild(clone);

      if (reduced()) return;                          // static, still readable

      var speed = wrap.dataset.marqueeSpeed || '26s';
      [track, clone].forEach(function (t) {
        t.style.animation = 'bn-marq ' + speed + ' linear infinite';
        t.style.willChange = 'transform';
      });

      wrap.addEventListener('mouseenter', function () { setPlay(wrap, 'paused'); });
      wrap.addEventListener('mouseleave', function () { setPlay(wrap, 'running'); });

      if (hasIO) {
        new IntersectionObserver(function (es) {
          setPlay(wrap, es[0].isIntersecting ? 'running' : 'paused');
        }, { threshold: 0 }).observe(wrap);
      }
    });

    function setPlay(wrap, state) {
      var kids = wrap.children, i;
      for (i = 0; i < kids.length; i++) kids[i].style.animationPlayState = state;
    }

    if (!document.getElementById('bn-marq-kf')) {
      var s = document.createElement('style');
      s.id = 'bn-marq-kf';
      s.textContent = '@keyframes bn-marq{to{transform:translate3d(-100%,0,0)}}' +
                      '[data-marquee]{display:flex;overflow:hidden;width:100%}' +
                      '[data-marquee]>*{flex:none;display:flex;white-space:nowrap}';
      document.head.appendChild(s);
    }
  }

  /* ======================================================================
   * 3. MAGNETIC — [data-magnetic]. Pointer-fine only, capped displacement,
   * rAF-throttled, resets on leave. Never applied to a funnel button.
   * ==================================================================== */
  function initMagnetic() {
    if (reduced() || !fine()) return;
    var css = getComputedStyle(document.documentElement);
    var max = parseFloat(css.getPropertyValue('--bn-magnetic-max')) || 6;

    safeAll('[data-magnetic]').forEach(function (el) {
      var raf = null, tx = 0, ty = 0;

      el.addEventListener('mousemove', function (ev) {
        var r = el.getBoundingClientRect();
        tx = ((ev.clientX - (r.left + r.width / 2)) / (r.width / 2)) * max;
        ty = ((ev.clientY - (r.top + r.height / 2)) / (r.height / 2)) * max;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      el.addEventListener('mouseleave', function () {
        tx = ty = 0;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      function apply() {
        raf = null;
        el.style.transform = 'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)';
      }
    });
  }

  /* ======================================================================
   * 4. CURSOR LABEL — [data-cursor="Drag →"]. One shared pill, follows the
   * pointer, shows the element's label. Suppressed on touch.
   * ==================================================================== */
  function initCursor() {
    if (reduced() || !fine()) return;
    var targets = safeAll('[data-cursor]');
    if (!targets.length) return;

    var pill = document.createElement('div');
    pill.className = 'bn-cursor';
    pill.setAttribute('aria-hidden', 'true');
    pill.style.cssText =
      'position:fixed;top:0;left:0;z-index:var(--bn-z-cursor,2000);pointer-events:none;' +
      'padding:8px 13px;border-radius:999px;background:var(--bn-brass,#B99A5B);' +
      'color:var(--bn-ink,#0F1211);font:700 9px/1 var(--bn-font-body,sans-serif);' +
      'letter-spacing:.18em;text-transform:uppercase;opacity:0;' +
      'transition:opacity var(--bn-cursor-fade,160ms) ease;' +
      'transform:translate3d(-50%,-50%,0);white-space:nowrap';
    document.body.appendChild(pill);

    var raf = null, x = 0, y = 0;
    function move() { raf = null; pill.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) translate(-50%,-50%)'; }

    targets.forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        pill.textContent = el.dataset.cursor || 'View';
        pill.style.opacity = '1';
      });
      el.addEventListener('mouseleave', function () { pill.style.opacity = '0'; });
      el.addEventListener('mousemove', function (ev) {
        x = ev.clientX; y = ev.clientY;
        if (!raf) raf = requestAnimationFrame(move);
      });
    });
  }

  /* --- Boot -------------------------------------------------------------- */
  function boot() {
    try { initReveal(); }   catch (e) { fallbackVisible(); }
    try { initMarquee(); }  catch (e) {}
    try { initMagnetic(); } catch (e) {}
    try { initCursor(); }   catch (e) {}
  }
  function fallbackVisible() {
    safeAll('[data-reveal]').forEach(function (el) { el.classList.add('is-revealed'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Re-evaluate if the user flips the OS motion setting mid-session.
  if (mqMotion && mqMotion.addEventListener) {
    mqMotion.addEventListener('change', function () {
      if (reduced()) fallbackVisible();
    });
  }

  // Shopify theme editor re-renders sections; re-scan the new subtree only.
  document.addEventListener('shopify:section:load', function () {
    try { initReveal(); initMarquee(); initMagnetic(); } catch (e) { fallbackVisible(); }
  });
}());
