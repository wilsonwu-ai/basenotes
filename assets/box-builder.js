/* Build Your Own Box.
 * window.BasenoteGiftbox is the store (localStorage key basenotes_giftbox, never basenotes_queue).
 * <box-builder> is the page: filters, picking, rail/sheet, add to cart.
 * Everything that touches storage is wrapped; the page works in memory when storage is blocked.
 */
(function () {
  'use strict';
  if (window.BasenoteGiftbox) return;

  var KEY = 'basenotes_giftbox';
  var QUEUE_KEY = 'basenotes_queue';

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }
  function getStorage() {
    try {
      var s = window.localStorage;
      var probe = '__bb_probe';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (e) { return null; }
  }
  var storage = getStorage();
  var memory = null;

  function randomChars(n) {
    var out = '';
    try {
      var buf = new Uint8Array(n);
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < n; i++) out += (buf[i] % 36).toString(36);
    } catch (e) {
      while (out.length < n) out += Math.random().toString(36).slice(2);
      out = out.slice(0, n);
    }
    return out;
  }
  function newBoxId() { return 'bx_' + Date.now().toString(36) + '_' + randomChars(4); }
  function nowIso() { return new Date().toISOString(); }

  /* ---------- store ---------- */
  var listeners = [];
  var state = null;
  var slotCount = 3;
  var messageMax = 200;

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* a listener must not break the store */ }
    }
  }
  function blank() {
    var slots = [];
    for (var i = 0; i < slotCount; i++) slots.push(null);
    return { v: 1, boxId: newBoxId(), slots: slots, message: '', updatedAt: nowIso() };
  }
  function cleanPick(p) {
    if (!p || typeof p !== 'object' || !p.handle || !p.variantId) return null;
    return {
      handle: String(p.handle),
      productId: p.productId || null,
      variantId: p.variantId,
      label: String(p.label || p.handle),
      image: p.image ? String(p.image) : '',
      pickedAt: p.pickedAt || nowIso()
    };
  }
  function normalize(raw) {
    var out = blank();
    if (!raw || raw.v !== 1 || !Array.isArray(raw.slots)) return out;
    for (var i = 0; i < slotCount; i++) out.slots[i] = cleanPick(raw.slots[i]);
    if (typeof raw.boxId === 'string' && raw.boxId.indexOf('bx_') === 0) out.boxId = raw.boxId;
    if (typeof raw.message === 'string') out.message = raw.message.slice(0, messageMax);
    if (raw.updatedAt) out.updatedAt = raw.updatedAt;
    return out;
  }
  function load(opts) {
    if (opts && opts.slots) slotCount = opts.slots;
    if (opts && opts.messageMax) messageMax = opts.messageMax;
    var raw = null;
    try { raw = storage ? safeParse(storage.getItem(KEY)) : null; } catch (e) { raw = null; }
    state = normalize(raw || memory);
    return state;
  }
  function save(silent) {
    if (!state) load();
    state.updatedAt = nowIso();
    memory = JSON.parse(JSON.stringify(state));
    try { if (storage) storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* in-memory only */ }
    if (!silent) emit();
    return state;
  }
  function firstEmpty() {
    for (var i = 0; i < state.slots.length; i++) if (!state.slots[i]) return i;
    return -1;
  }
  function filled() {
    var n = 0;
    for (var i = 0; i < state.slots.length; i++) if (state.slots[i]) n++;
    return n;
  }
  /* Fills the FIRST empty slot. Returns the slot index, or -1 when the box is full. */
  function pick(item) {
    if (!state) load();
    var idx = firstEmpty();
    if (idx < 0) return -1;
    state.slots[idx] = cleanPick({
      handle: item.handle, productId: item.productId, variantId: item.variantId,
      label: item.label, image: item.image, pickedAt: nowIso()
    });
    save();
    return idx;
  }
  function unpick(index) {
    if (!state || index < 0 || index >= state.slots.length || !state.slots[index]) return false;
    state.slots[index] = null;
    save();
    return true;
  }
  function clear() {
    if (!state) load();
    for (var i = 0; i < state.slots.length; i++) state.slots[i] = null;
    save();
  }
  function reset() {
    state = blank();
    save();
    return state;
  }
  function setMessage(text) {
    if (!state) load();
    state.message = String(text || '').slice(0, messageMax);
    save();
  }
  function on(event, fn) {
    if (event === 'change' && typeof fn === 'function') listeners.push(fn);
  }
  function current() { if (!state) load(); return state; }

  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    load();
    emit();
  });

  window.BasenoteGiftbox = {
    key: KEY,
    load: load, save: save, pick: pick, unpick: unpick, clear: clear, reset: reset,
    setMessage: setMessage, on: on, state: current,
    isFull: function () { if (!state) load(); return firstEmpty() < 0; },
    count: function () { if (!state) load(); return filled(); }
  };

  /* ---------- analytics (never carries the gift message) ---------- */
  function track(name, data) {
    var detail = { name: name };
    var k;
    for (k in (data || {})) detail[k] = data[k];
    try { document.dispatchEvent(new CustomEvent('basenote:box', { detail: detail })); } catch (e) { /* ignore */ }
    try {
      if (window.Shopify && window.Shopify.analytics && typeof window.Shopify.analytics.publish === 'function') {
        window.Shopify.analytics.publish(name, data || {});
      }
    } catch (e) { /* ignore */ }
  }
  function klaviyo(props) {
    try {
      if (window._learnq && typeof window._learnq.push === 'function') window._learnq.push(['track', 'Built Gift Box', props]);
    } catch (e) { /* ignore */ }
  }

  /* ---------- page ---------- */
  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function routeRoot() { return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/'; }

  var FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  class BoxBuilder extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      this.init();
    }

    init() {
      var self = this;
      var d = this.dataset;
      this.cfg = {
        slots: parseInt(d.slots, 10) || 3,
        messageMax: parseInt(d.messageMax, 10) || 200,
        rotation: d.rotation === 'true',
        boxReady: d.boxReady === 'true',
        boxNote: d.boxNote || 'Box product not configured',
        boxHandle: d.boxHandle || '',
        boxTitle: d.boxTitle || 'Build Your Own Box',
        boxVariantId: parseInt(d.boxVariantId, 10) || 0,
        priceLabel: d.boxPriceLabel || ''
      };
      this.ui = { tab: 'all', family: 'all', query: '', busy: false, added: false, snapshot: null, blocked: '', notices: [], lastStatus: '', nearLimit: false };

      this.els = {
        grid: $(this, '[data-bb-grid]'),
        empty: $(this, '[data-bb-empty]'),
        count: $(this, '[data-bb-count]'),
        search: $(this, '[data-bb-search]'),
        panel: $(this, '[data-bb-panel]'),
        railSlot: $(this, '[data-bb-rail-slot]'),
        slots: $$(this, '[data-bb-slot]'),
        counters: $$(this, '[data-bb-counter]'),
        trayVials: $$(this, '[data-bb-tray-vial]'),
        dots: $$(this, '[data-bb-dot]'),
        barLabel: $(this, '[data-bb-bar-label]'),
        status: $(this, '[data-bb-status]'),
        notice: $(this, '[data-bb-notice]'),
        noticeText: $(this, '[data-bb-notice-text]'),
        rotation: $(this, '[data-bb-rotation]'),
        rotationHelp: $(this, '[data-bb-rotation-help]'),
        blocked: $(this, '[data-bb-blocked]'),
        toast: $(this, '[data-bb-toast]'),
        message: $(this, '[data-bb-message]'),
        messageCount: $(this, '[data-bb-message-count]'),
        cta: $(this, '[data-bb-add]'),
        ctaLabel: $(this, '[data-bb-cta-label]'),
        spin: $(this, '.bb-cta__spin'),
        check: $(this, '.bb-cta__check'),
        helper: $(this, '[data-bb-helper]'),
        error: $(this, '[data-bb-error]'),
        added: $(this, '[data-bb-added]'),
        opener: $(this, '[data-bb-open-sheet]'),
        sheet: $(this, '[data-bb-sheet]'),
        sheetPanel: $(this, '.bb-sheet__panel'),
        sheetBody: $(this, '[data-bb-sheet-body]'),
        sheetTitle: $(this, '#BoxSheetTitle'),
        vialTpl: $(this, '[data-bb-vial-tpl]')
      };

      this.cards = $$(this.els.grid, '[data-scent-card]').map(function (el) {
        var h3 = $(el, 'h3');
        var img = $(el, 'img');
        return {
          el: el,
          handle: el.dataset.handle || '',
          productId: el.dataset.productId || '',
          variantId: parseInt(el.dataset.variantId, 10) || 0,
          label: el.dataset.boxLabel || '',
          name: h3 ? h3.textContent.trim() : (el.dataset.name || ''),
          brand: el.dataset.brand || '',
          gender: el.dataset.gender || 'unclassified',
          family: (el.dataset.family || '').split(/\s+/).filter(Boolean),
          search: ((el.dataset.name || '') + ' ' + (el.dataset.brand || '')).toLowerCase(),
          available: el.dataset.available === 'true',
          btn: $(el, '[data-box-pick]'),
          rm: $(el, '[data-box-unpick]'),
          badge: $(el, '.scent-card__slot'),
          image: img ? (img.getAttribute('src') || '') : ''
        };
      });
      this.byHandle = {};
      this.cards.forEach(function (c) { self.byHandle[c.handle] = c; });
      if ($(this, '[data-bb-truncated]')) console.warn('[box-builder] The collection has more than 250 products; showing the first 250.');

      // Publish the bar's real height (it includes the safe-area padding) so the page can reserve it.
      var bar = $(this, '[data-bb-bar]');
      if (bar) {
        var setBar = function () {
          var h = bar.getBoundingClientRect().height;
          if (h > 0) document.documentElement.style.setProperty('--bb-bar-real', Math.ceil(h) + 'px');
        };
        setBar();
        if (window.ResizeObserver) new ResizeObserver(setBar).observe(bar);
        window.addEventListener('resize', setBar);
      }

      var heroImg = $(this, '[data-bb-hero-img]');
      if (heroImg) {
        var dropHero = function () { heroImg.remove(); self.els.panel.removeAttribute('data-hero'); };
        heroImg.addEventListener('error', dropHero);
        if (heroImg.complete && heroImg.naturalWidth === 0) dropHero();
        else self.els.panel.setAttribute('data-hero', '');
        if (window.matchMedia('(min-width: 1000px)').matches) heroImg.loading = 'eager';
      }
      this.initGallery();

      BasenoteGiftbox.load({ slots: this.cfg.slots, messageMax: this.cfg.messageMax });
      this.reconcile(false);
      this.ui.nearLimit = (BasenoteGiftbox.state().message || '').length >= this.cfg.messageMax - 20;
      BasenoteGiftbox.on('change', function () {
        if (!self.ui.busy && !self.ui.added) self.reconcile(false);
        self.render();
      });

      this.bind();
      this.applyFilters(false);
      this.render();
      requestAnimationFrame(function () { self.els.count.setAttribute('aria-live', 'polite'); });
      this.setAttribute('data-bb-ready', '');
      track('bn_box_view');
    }

    /* A card whose vial sold out after the page loaded: swap the button for the sold-out text. */
    markSoldOut(card) {
      if (card.btn.hidden) return;
      card.btn.hidden = true;
      if (card.rm) card.rm.hidden = true;
      card.el.removeAttribute('data-picked');
      if (card.badge) card.badge.hidden = true;
      var p = document.createElement('p');
      p.className = 'scent-card__soldout';
      p.textContent = 'Sold out';
      card.btn.insertAdjacentElement('afterend', p);
    }

    /* ----- state helpers ----- */
    view() { return this.ui.added && this.ui.snapshot ? this.ui.snapshot : BasenoteGiftbox.state(); }
    filledCount(slots) { return slots.filter(Boolean).length; }
    indicesOf(handle, slots) {
      var out = [];
      for (var i = 0; i < slots.length; i++) if (slots[i] && slots[i].handle === handle) out.push(i);
      return out;
    }
    say(text) {
      var el = this.els.status;
      if (text === this.ui.lastStatus) text += ' ';
      this.ui.lastStatus = text;
      el.textContent = text;
    }

    /* Drop stored picks that are missing, sold out or under the stock floor; refresh the rest from the card. */
    reconcile(announce) {
      var st = BasenoteGiftbox.state();
      var removed = [];
      var changed = false;
      for (var i = 0; i < st.slots.length; i++) {
        var p = st.slots[i];
        if (!p) continue;
        var card = this.byHandle[p.handle];
        if (!card || !card.available) {
          removed.push(p.label);
          st.slots[i] = null;
          changed = true;
        } else if (p.variantId !== card.variantId || p.label !== card.label || p.image !== card.image) {
          p.variantId = card.variantId;
          p.productId = card.productId;
          p.label = card.label;
          p.image = card.image;
          changed = true;
        }
      }
      if (changed) BasenoteGiftbox.save(true);
      if (removed.length) {
        this.ui.notices = removed.filter(function (l, i) { return removed.indexOf(l) === i; })
          .map(function (l) { return l + ' is sold out and was removed from your box.'; });
        this.say(this.ui.notices.join(' '));
      } else if (announce === true) {
        this.ui.notices = [];
      }
    }

    /* Hero gallery: the strip scrolls natively; a thumbnail scrolls to its photo, and whichever photo is
       mostly in view marks its thumbnail current. */
    initGallery() {
      var gallery = $(this, '[data-bb-gallery]');
      if (!gallery) return;
      var viewport = $(gallery, '[data-bb-gallery-viewport]');
      var slides = $$(gallery, '[data-bb-slide]');
      var thumbs = $$(gallery, '[data-bb-gallery-thumb]');
      if (!viewport || thumbs.length < 2) return;
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      var mark = function (index) {
        if (index < 0) return;
        thumbs.forEach(function (t, i) { t.setAttribute('aria-current', i === index ? 'true' : 'false'); });
      };
      thumbs.forEach(function (thumb, i) {
        thumb.addEventListener('click', function () {
          if (!slides[i]) return;
          viewport.scrollTo({ left: slides[i].offsetLeft, behavior: reduce.matches ? 'auto' : 'smooth' });
          mark(i);
        });
      });
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.6) mark(slides.indexOf(entry.target));
          });
        }, { root: viewport, threshold: 0.6 });
        slides.forEach(function (s) { io.observe(s); });
      }
    }

    /* ----- events ----- */
    bind() {
      var self = this;
      this.addEventListener('click', function (e) {
        var t = e.target;
        var el;
        if ((el = t.closest('[data-box-pick]'))) return self.onPick(el);
        if ((el = t.closest('[data-box-unpick]'))) return self.onUnpickOne(el);
        if ((el = t.closest('[data-bb-remove]'))) return self.onRemove(parseInt(el.getAttribute('data-bb-remove'), 10));
        if ((el = t.closest('[data-bb-tab]'))) return self.setFilter('tab', el.getAttribute('data-bb-tab'));
        if ((el = t.closest('[data-bb-family]'))) return self.setFilter('family', el.getAttribute('data-bb-family'));
        if (t.closest('[data-bb-clear]')) return self.clearFilters();
        if (t.closest('[data-bb-prefill]')) return self.prefill();
        if (t.closest('[data-bb-add]')) return self.add();
        if (t.closest('[data-bb-open-sheet]')) return self.openSheet();
        if (t.closest('[data-bb-close-sheet]') || t.closest('[data-bb-sheet-scrim]')) return self.closeSheet(true);
        if (t.closest('[data-bb-notice-close]')) { self.ui.notices = []; self.render(); }
      });

      this.els.search.addEventListener('input', function () {
        self.ui.query = self.els.search.value;
        self.applyFilters(true);
      });
      this.els.message.addEventListener('input', function () {
        if (self.ui.busy || self.ui.added) return;
        BasenoteGiftbox.setMessage(self.els.message.value);
      });

      this.mql = window.matchMedia('(min-width: 1000px)');
      var onMq = function () { if (self.mql.matches && self.sheetOpen) self.closeSheet(false); };
      if (this.mql.addEventListener) this.mql.addEventListener('change', onMq);
      else if (this.mql.addListener) this.mql.addListener(onMq);

      window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        BasenoteGiftbox.load();
        self.reconcile(false);
        self.render();
      });
      window.addEventListener('storage', function (e) {
        if (e.key === QUEUE_KEY) self.render();
      });
    }

    /* ----- filtering ----- */
    setFilter(kind, value) {
      this.ui[kind] = value;
      this.applyFilters(true);
    }
    clearFilters() {
      this.ui.tab = 'all';
      this.ui.family = 'all';
      this.ui.query = '';
      this.els.search.value = '';
      this.applyFilters(true);
      this.els.search.focus();
    }
    applyFilters(announce) {
      var ui = this.ui;
      var q = (ui.query || '').trim().toLowerCase();
      var shown = 0;
      this.cards.forEach(function (c) {
        var ok = true;
        if (ui.tab === 'him') ok = c.gender === 'him' || c.gender === 'unisex';
        else if (ui.tab === 'her') ok = c.gender === 'her' || c.gender === 'unisex';
        else if (ui.tab === 'unisex') ok = c.gender === 'unisex';
        if (ok && ui.family !== 'all') ok = c.family.indexOf(ui.family) !== -1;
        if (ok && q) ok = c.search.indexOf(q) !== -1;
        c.el.hidden = !ok;
        if (ok) shown++;
      });
      $$(this, '[data-bb-tab]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-bb-tab') === ui.tab ? 'true' : 'false'); });
      $$(this, '[data-bb-family]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-bb-family') === ui.family ? 'true' : 'false'); });
      this.els.count.textContent = plural(shown, 'fragrance', 'fragrances');
      this.els.empty.hidden = shown !== 0;
      this.els.grid.hidden = shown === 0;
      if (announce) {
        var self = this;
        clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(function () {
          track('bn_box_filter', { gender: ui.tab, family: ui.family, query_len: (ui.query || '').trim().length });
        }, 500);
      }
    }

    /* ----- picking ----- */
    cardOf(btn) {
      var article = btn.closest('[data-scent-card]');
      return article ? this.byHandle[article.dataset.handle] : null;
    }
    onPick(btn) {
      if (this.ui.busy || this.ui.added) return;
      var card = this.cardOf(btn);
      if (!card) return;
      var total = BasenoteGiftbox.state().slots.length;
      this.ui.blocked = '';
      this.hideToast();
      if (BasenoteGiftbox.isFull()) return this.blockedPick(card);
      var slot = BasenoteGiftbox.pick({ handle: card.handle, productId: card.productId, variantId: card.variantId, label: card.label, image: card.image });
      var n = BasenoteGiftbox.count();
      this.say(card.label + ' added. ' + n + ' of ' + total + ' picked.' + (n === total ? ' Your box is full.' : ''));
      track('bn_box_pick', { handle: card.handle, slot: slot + 1 });
      if (n === total) track('bn_box_full');
    }
    /* Remove one copy of a scent: the last-filled slot holding it. */
    onUnpickOne(btn) {
      if (this.ui.busy || this.ui.added) return;
      var card = this.cardOf(btn);
      if (!card) return;
      var st = BasenoteGiftbox.state();
      var idxs = this.indicesOf(card.handle, st.slots);
      if (!idxs.length) return;
      var idx = idxs[idxs.length - 1];
      this.ui.blocked = '';
      this.hideToast();
      BasenoteGiftbox.unpick(idx);
      this.say(card.label + ' removed. ' + BasenoteGiftbox.count() + ' of ' + st.slots.length + ' picked.');
      track('bn_box_unpick', { handle: card.handle, slot: idx + 1 });
      if (idxs.length === 1 && card.btn) card.btn.focus();
    }

    blockedPick(card) {
      var msg = 'Your box is full. Remove one to add ' + card.label + '.';
      this.ui.blocked = msg;
      this.say(msg);
      track('bn_box_blocked_pick', { handle: card.handle });
      this.pulseRemoves();
      this.render();
      if (!this.mql.matches && !this.sheetOpen) this.showToast(msg);
    }
    pulseRemoves() {
      $$(this, '[data-bb-remove]').forEach(function (b) {
        b.classList.remove('is-pulse');
        void b.offsetWidth;
        b.classList.add('is-pulse');
        setTimeout(function () { b.classList.remove('is-pulse'); }, 1100);
      });
    }
    showToast(msg) {
      var t = this.els.toast;
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
    }
    hideToast() {
      clearTimeout(this.toastTimer);
      this.els.toast.hidden = true;
    }

    onRemove(index) {
      if (this.ui.busy || this.ui.added) return;
      var st = BasenoteGiftbox.state();
      var p = st.slots[index];
      if (!p) return;
      this.ui.blocked = '';
      this.hideToast();
      BasenoteGiftbox.unpick(index);
      this.say(p.label + ' removed. ' + BasenoteGiftbox.count() + ' of ' + st.slots.length + ' picked.');
      track('bn_box_unpick', { handle: p.handle, slot: index + 1 });
      var li = this.els.slots[index];
      if (li) li.focus();
    }

    /* ----- Rotation prefill (reads basenotes_queue, never writes it) ----- */
    rotationEligible() {
      if (!this.cfg.rotation) return [];
      var raw = null;
      try { raw = safeParse(window.localStorage.getItem(QUEUE_KEY)); } catch (e) { raw = null; }
      if (!Array.isArray(raw) || !raw.length) return [];
      var floor = '';
      try { floor = window.BasenoteQueue && typeof window.BasenoteQueue.firstVisibleMonth === 'function' ? window.BasenoteQueue.firstVisibleMonth() : ''; } catch (e) { floor = ''; }
      var items = raw.filter(function (e) { return e && (e.productId || e.url) && (!floor || !e.shipMonth || e.shipMonth >= floor); });
      items.sort(function (a, b) { return String(a.shipMonth || '').localeCompare(String(b.shipMonth || '')); });
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var e = items[i];
        var card = null;
        for (var j = 0; j < this.cards.length && !card; j++) if (String(this.cards[j].productId) === String(e.productId)) card = this.cards[j];
        if (!card && e.url) {
          var m = String(e.url).match(/\/products\/([^/?#]+)/);
          if (m && this.byHandle[m[1]]) card = this.byHandle[m[1]];
        }
        if (!card || !card.available || !card.btn) continue;
        out.push(card);
      }
      return out;
    }
    prefill() {
      if (this.ui.busy || this.ui.added) return;
      var eligible = this.rotationEligible();
      var added = 0;
      for (var i = 0; i < eligible.length; i++) {
        if (BasenoteGiftbox.isFull()) break;
        var c = eligible[i];
        BasenoteGiftbox.pick({ handle: c.handle, productId: c.productId, variantId: c.variantId, label: c.label, image: c.image });
        added++;
      }
      this.ui.blocked = '';
      this.say('Added ' + added + ' from your Rotation. ' + BasenoteGiftbox.count() + ' of ' + BasenoteGiftbox.state().slots.length + ' picked.');
      track('bn_box_rotation_prefill', { added: added });
    }

    /* ----- rendering ----- */
    render() {
      var self = this;
      var cfg = this.cfg;
      var v = this.view();
      var slots = v.slots;
      var total = slots.length;
      var count = this.filledCount(slots);
      var full = count === total;
      var locked = this.ui.busy || this.ui.added;

      this.cards.forEach(function (c) {
        if (!c.btn) return;
        if (!c.available) { self.markSoldOut(c); return; }
        var n = self.indicesOf(c.handle, slots).length;
        c.btn.setAttribute('aria-disabled', (locked || full) ? 'true' : 'false');
        if (c.rm) {
          c.rm.hidden = n === 0;
          c.rm.setAttribute('aria-disabled', locked ? 'true' : 'false');
        }
        if (n) c.el.setAttribute('data-picked', ''); else c.el.removeAttribute('data-picked');
        if (c.badge) {
          c.badge.hidden = n === 0;
          c.badge.textContent = n ? 'In box x' + n : '';
        }
      });

      this.els.slots.forEach(function (li, i) {
        var p = slots[i];
        var thumb = $(li, '[data-bb-thumb]');
        var name = $(li, '[data-bb-slot-name]');
        var brand = $(li, '[data-bb-slot-brand]');
        var empty = $(li, '[data-bb-slot-empty]');
        var rm = $(li, '[data-bb-remove]');
        if (p) {
          var card = self.byHandle[p.handle];
          if (li.dataset.handle !== p.handle) {
            li.dataset.handle = p.handle;
            thumb.textContent = '';
            if (p.image) {
              var img = document.createElement('img');
              img.src = p.image;
              img.alt = '';
              img.width = 52;
              img.height = 52;
              thumb.appendChild(img);
            } else if (self.els.vialTpl) {
              thumb.appendChild(self.els.vialTpl.content.cloneNode(true));
            }
            li.style.animation = 'none';
            void li.offsetWidth;
            li.style.animation = '';
          }
          li.removeAttribute('data-empty');
          name.textContent = card ? card.name : p.label;
          brand.textContent = card ? card.brand : '';
          name.hidden = false;
          brand.hidden = !card;
          empty.hidden = true;
          rm.hidden = false;
          rm.setAttribute('aria-label', 'Remove ' + p.label);
          li.setAttribute('aria-label', 'Vial ' + (i + 1) + ', ' + p.label);
        } else {
          if (li.dataset.handle) {
            delete li.dataset.handle;
            thumb.textContent = '';
            var num = document.createElement('span');
            num.className = 'bb-slot__num';
            num.setAttribute('aria-hidden', 'true');
            num.textContent = String(i + 1);
            thumb.appendChild(num);
          }
          li.setAttribute('data-empty', '');
          name.hidden = true;
          brand.hidden = true;
          empty.hidden = false;
          rm.hidden = true;
          rm.setAttribute('aria-label', 'Remove');
          li.setAttribute('aria-label', 'Vial ' + (i + 1) + ', empty');
        }
      });

      var counterText = count + ' of ' + total;
      this.els.counters.forEach(function (el) { el.textContent = counterText; });
      this.els.trayVials.forEach(function (el, i) { if (slots[i]) el.setAttribute('data-filled', ''); else el.removeAttribute('data-filled'); });
      this.els.dots.forEach(function (el, i) { if (slots[i]) el.setAttribute('data-filled', ''); else el.removeAttribute('data-filled'); });
      this.els.barLabel.textContent = counterText + ' picked · ' + cfg.priceLabel;

      // Notice for picks dropped because they sold out
      this.els.notice.hidden = !this.ui.notices.length;
      this.els.noticeText.textContent = this.ui.notices.join(' ');

      // Rotation prefill
      var eligible = (!full && !locked) ? this.rotationEligible() : [];
      this.els.rotation.hidden = eligible.length === 0;
      if (eligible.length) this.els.rotationHelp.textContent = plural(eligible.length, 'saved scent', 'saved scents');

      // Blocked note
      this.els.blocked.hidden = !(this.ui.blocked && full);
      this.els.blocked.textContent = this.ui.blocked;

      // Gift message
      var msg = v.message || '';
      if (this.els.message.value !== msg) this.els.message.value = msg;
      this.els.message.readOnly = locked;
      this.els.messageCount.textContent = msg.length + ' / ' + cfg.messageMax;
      var near = msg.length >= cfg.messageMax - 20;
      this.els.messageCount.classList.toggle('is-near', near);
      if (near && !this.ui.nearLimit) this.say((cfg.messageMax - msg.length) + ' characters left');
      this.ui.nearLimit = near;

      // CTA
      var state = this.ui.busy ? 'adding' : (this.ui.added ? 'added' : 'idle');
      var ctaDisabled = !cfg.boxReady || !full || locked;
      this.els.cta.setAttribute('aria-disabled', ctaDisabled ? 'true' : 'false');
      this.els.cta.setAttribute('aria-busy', this.ui.busy ? 'true' : 'false');
      this.els.cta.setAttribute('data-state', state);
      this.els.ctaLabel.textContent = state === 'adding' ? 'Adding…' : (state === 'added' ? 'Added to cart' : 'Add box to cart');
      this.els.spin.hidden = state !== 'adding';
      this.els.check.hidden = state !== 'added';
      this.els.added.hidden = state !== 'added';
      var helper = this.helperText(slots);
      this.els.helper.textContent = helper;
      this.els.helper.hidden = !helper;
    }

    helperText(slots) {
      if (!this.cfg.boxReady) return this.cfg.boxNote;
      if (this.ui.busy || this.ui.added) return '';
      var total = slots.length;
      var left = total - this.filledCount(slots);
      if (left <= 0) return '';
      return left === total ? 'Pick ' + total + ' to finish your box.' : 'Pick ' + left + ' more to finish your box.';
    }

    /* ----- sheet (below 1000px) ----- */
    openSheet() {
      if (this.sheetOpen) return;
      this.sheetOpen = true;
      var self = this;
      this.sheetOpener = this.els.opener;
      this.hideToast();
      this.els.sheetBody.appendChild(this.els.panel);
      this.els.sheet.hidden = false;
      this.els.opener.setAttribute('aria-expanded', 'true');
      this.savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      this.keyHandler = function (e) { self.onSheetKey(e); };
      document.addEventListener('keydown', this.keyHandler);
      this.els.sheetTitle.focus();
      track('bn_box_sheet_open');
    }
    closeSheet(restoreFocus) {
      if (!this.sheetOpen) return;
      this.sheetOpen = false;
      this.els.railSlot.appendChild(this.els.panel);
      this.els.sheet.hidden = true;
      this.els.opener.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = this.savedOverflow || '';
      document.removeEventListener('keydown', this.keyHandler);
      if (restoreFocus !== false && this.sheetOpener && this.sheetOpener.isConnected) this.sheetOpener.focus();
    }
    onSheetKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); this.closeSheet(true); return; }
      if (e.key !== 'Tab') return;
      var items = $$(this.els.sheetPanel, FOCUSABLE).filter(function (n) { return n.offsetParent !== null || n === document.activeElement; });
      if (!items.length) { e.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      var inside = this.els.sheetPanel.contains(active);
      if (e.shiftKey && (active === first || active === this.els.sheetTitle || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    }

    /* ----- add to cart ----- */
    async add() {
      var self = this;
      var cfg = this.cfg;
      if (this.ui.busy || this.ui.added) return;
      var st = BasenoteGiftbox.state();
      var total = st.slots.length;
      var left = total - this.filledCount(st.slots);
      if (!cfg.boxReady) { this.say(cfg.boxNote); return; }
      if (left > 0) { this.say(this.helperText(st.slots)); return; }
      if (!window.BaseNoteCommerce || typeof window.BaseNoteCommerce.addVial !== 'function') {
        return this.fail("We couldn't add your box. Please try again.", 'commerce_missing');
      }

      this.ui.busy = true;
      this.ui.blocked = '';
      this.setError('');
      this.render();
      track('bn_box_add_attempt');

      var picks = st.slots.slice();
      var boxId = st.boxId;
      var message = (st.message || '').trim();
      var properties = {};
      picks.forEach(function (p, i) { properties['Fragrance ' + (i + 1)] = p.label; });
      if (message) properties['Gift message'] = message;
      properties._bn_box = boxId;

      try {
        var gone = await this.precheck(picks);
        if (gone.length) return this.soldOutAtAdd(gone, 'precheck');
        await window.BaseNoteCommerce.addVial({
          variantId: cfg.boxVariantId, handle: cfg.boxHandle, title: cfg.boxTitle,
          quantity: 1, properties: properties, source: 'box-builder'
        });
      } catch (err) {
        var gone2 = [];
        try { gone2 = await this.precheck(picks); } catch (e) { gone2 = []; }
        if (gone2.length) return this.soldOutAtAdd(gone2, (err && err.message) || 'rejected');
        return this.fail("We couldn't add your box. Please try again.", (err && err.message) || 'error');
      }

      // Success
      var handles = picks.map(function (p) { return p.handle; });
      this.ui.snapshot = JSON.parse(JSON.stringify(st));
      this.ui.busy = false;
      this.ui.added = true;
      BasenoteGiftbox.reset();
      this.say('Your box is in your cart. Build another anytime.');
      this.render();
      var trigger = this.els.cta;
      if (this.sheetOpen) { this.closeSheet(false); trigger = this.els.opener; trigger.focus(); }
      var fb = document.querySelector('cart-feedback');
      if (fb && typeof fb.show === 'function') fb.show({ title: cfg.boxTitle, quantity: 1, trigger: trigger });
      track('bn_box_add_success', { box_id: boxId, handles: handles, has_message: !!message });
      klaviyo({ box_id: boxId, handles: handles, has_message: !!message });
      setTimeout(function () {
        self.ui.added = false;
        self.ui.snapshot = null;
        self.ui.notices = [];
        self.render();
      }, 2500);
    }

    async precheck(picks) {
      var root = routeRoot();
      var doFetch = window.__bnFetch || window.fetch.bind(window);
      var seen = {};
      var unique = picks.filter(function (p) { if (seen[p.handle]) return false; seen[p.handle] = true; return true; });
      var results = await Promise.all(unique.map(async function (p) {
        var res = await doFetch(root + 'products/' + encodeURIComponent(p.handle) + '.js', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (res.status === 404) return { pick: p, ok: false };
        if (!res.ok) throw new Error('product check failed: ' + res.status);
        var data = await res.json();
        var variant = (data.variants || []).filter(function (x) { return Number(x.id) === Number(p.variantId); })[0];
        return { pick: p, ok: !!(variant && variant.available) };
      }));
      return results.filter(function (r) { return !r.ok; }).map(function (r) { return r.pick; });
    }

    soldOutAtAdd(gone, reason) {
      var st = BasenoteGiftbox.state();
      var self = this;
      gone.forEach(function (g) {
        self.indicesOf(g.handle, st.slots).forEach(function (i) { st.slots[i] = null; });
        var card = self.byHandle[g.handle];
        if (card) { card.available = false; }
      });
      BasenoteGiftbox.save(true);
      this.ui.busy = false;
      var msg = gone[0].label + ' just sold out. Pick another to finish your box.';
      this.setError(msg);
      this.say(msg);
      track('bn_box_add_error', { status: 422, reason: 'sold_out' });
      this.render();
    }
    fail(msg, reason) {
      this.ui.busy = false;
      this.setError(msg);
      this.say(msg);
      track('bn_box_add_error', { status: 0, reason: String(reason).slice(0, 80) });
      this.render();
    }
    setError(msg) {
      this.els.error.textContent = msg;
      this.els.error.hidden = !msg;
    }
  }

  if (!customElements.get('box-builder')) customElements.define('box-builder', BoxBuilder);
})();
