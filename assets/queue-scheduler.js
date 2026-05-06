/**
 * Basenote QueueScheduler
 * -----------------------
 * Month-by-month subscription queue for the account page.
 * Reference UX: Scentbird "My Subscription List" (see april-22-prd/PRD-01).
 *
 * Data shape (localStorage key `basenotes_queue`):
 *   [
 *     { shipMonth: "2026-05", productId, title, url, image, family?, variantId?, addedAt, locked? },
 *     ...
 *   ]
 *
 * Legacy shape (pre-PRD-01) had no shipMonth. migrate() converts on first read.
 *
 * Public API (exposed as window.BasenoteQueue):
 *   load()                         → array
 *   save(queue)                    → void
 *   reorder(fromMonth, toMonth)    → array (swaps two slots)
 *   setSlot(month, product)        → array (upsert at targeted month)
 *   clearSlot(month)               → array
 *   slotsFromNow(count)            → array of N month strings ["2026-05", "2026-06", ...]
 *   findSlot(month)                → queue entry or null
 *   count()                        → number of filled slots
 *   on(event, cb)                  → subscribe to 'change'
 *   monthLabel(monthStr, opts)     → "May 2026" or "May"
 */
(function () {
  'use strict';

  var KEY = 'basenotes_queue';
  var listeners = [];
  // shippedThrough: "YYYY-MM" of the latest month the customer already received a subscription shipment.
  // Queue entries <= shippedThrough are considered in-the-past and pruned.
  // When set, the queue's first visible slot is the month AFTER shippedThrough (not calendar current month).
  var shippedThrough = null;

  function safeParse(raw) {
    try { return JSON.parse(raw) || []; } catch (e) { return []; }
  }

  function emit() {
    listeners.forEach(function (cb) { try { cb(load()); } catch (e) { console.error('[queue] listener error', e); } });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function currentMonthStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthStrAddOne(monthStr) {
    var parts = (monthStr || '').split('-');
    if (parts.length !== 2) return currentMonthStr();
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return y + '-' + pad2(m);
  }

  function firstVisibleMonth() {
    // The earliest month we will ever show as a queue slot.
    // 3-day end-of-month buffer: if today is in the last 3 days of the month
    // (daysLeft < 3, i.e. days 29/30/31 on a 31-day month), treat next month
    // as "current" — the current month's shipment is already locked in.
    var cur = currentMonthStr();
    var d = new Date();
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if ((lastDay - d.getDate()) < 3) cur = monthStrAddOne(cur);
    if (shippedThrough && shippedThrough >= cur) return monthStrAddOne(shippedThrough);
    return cur;
  }

  function monthStrFromOffset(offset) {
    // Kept for back-compat — offset from calendar today, ignoring shippedThrough.
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthStrFromFirstVisible(offset) {
    // Offset from the firstVisibleMonth, honoring shippedThrough.
    var base = firstVisibleMonth().split('-');
    var d = new Date(parseInt(base[0], 10), parseInt(base[1], 10) - 1, 1);
    d.setMonth(d.getMonth() + offset);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthLabel(monthStr, opts) {
    opts = opts || {};
    var parts = (monthStr || '').split('-');
    if (parts.length !== 2) return monthStr;
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
    var monthName = d.toLocaleString('en-US', { month: 'long' });
    if (opts.short) return d.toLocaleString('en-US', { month: 'short' });
    if (opts.withYear) return monthName + ' ' + d.getFullYear();
    return monthName;
  }

  function migrate(raw) {
    if (!raw || !raw.length) return raw || [];
    if (raw[0].shipMonth) return raw;
    // Legacy flat list → assign sequential future months starting next month
    var migrated = raw.slice(0, 5).map(function (item, i) {
      return {
        shipMonth: monthStrFromOffset(i + 1),
        productId: item.productId,
        title: item.title,
        url: item.url,
        image: item.image,
        family: item.family,
        variantId: item.variantId,
        addedAt: item.addedAt || new Date().toISOString(),
        locked: false
      };
    });
    try { console.info('[queue] migrated', raw.length, 'legacy entries →', migrated.length, 'scheduled'); } catch (e) {}
    localStorage.setItem(KEY, JSON.stringify(migrated));
    return migrated;
  }

  function pruneExpired(queue) {
    // Drop slots whose shipMonth is already shipped (<= shippedThrough) or before current calendar month.
    var minMonth = firstVisibleMonth();
    return queue.filter(function (entry) { return entry.shipMonth >= minMonth; });
  }

  function load() {
    var raw = safeParse(localStorage.getItem(KEY));
    var migrated = migrate(raw);
    var pruned = pruneExpired(migrated);
    if (pruned.length !== migrated.length) {
      localStorage.setItem(KEY, JSON.stringify(pruned));
    }
    return pruned;
  }

  function save(queue) {
    localStorage.setItem(KEY, JSON.stringify(queue || []));
    emit();
  }

  function findSlot(month) {
    return load().find(function (e) { return e.shipMonth === month; }) || null;
  }

  function emitKlaviyo(eventName, properties) {
    // Fire a Klaviyo "Viewed Product" style event so marketing can build flows off queue activity.
    // Safe no-op if Klaviyo onsite JS is not present (logged-out visitors or unsubscribed envs).
    try {
      if (!window._learnq) return;
      window._learnq.push(['track', eventName, properties || {}]);
    } catch (e) { /* swallow — analytics failures must not break UX */ }
  }

  function handleFromUrl(url) {
    if (!url) return null;
    var clean = String(url).split('?')[0].split('#')[0];
    var parts = clean.split('/').filter(Boolean);
    var idx = parts.lastIndexOf('products');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] || null;
  }

  function syncFirstSlotToAppstle(month, product) {
    // The very next renewal is bound to Appstle. Months 2+ stay local until
    // they become month 1 (handled on next render or via setShippedThrough).
    if (month !== firstVisibleMonth()) return;
    if (!window.BasenoteAppstleSwap || typeof window.BasenoteAppstleSwap.swap !== 'function') return;
    var input = {};
    if (product && product.variantId) input.variantId = product.variantId;
    if (product && product.url) input.handle = handleFromUrl(product.url);
    if (!input.variantId && !input.handle) return;
    try { window.BasenoteAppstleSwap.swap(input); } catch (e) {}
  }

  function setSlot(month, product) {
    if (!month || !product || !product.productId) return load();
    var queue = load();
    var existingIdx = queue.findIndex(function (e) { return e.shipMonth === month; });
    var isReplace = existingIdx >= 0;
    var previous = isReplace ? queue[existingIdx] : null;
    var entry = {
      shipMonth: month,
      productId: product.productId,
      title: product.title,
      url: product.url,
      image: product.image,
      family: product.family,
      variantId: product.variantId,
      addedAt: new Date().toISOString(),
      locked: false
    };
    if (isReplace) queue[existingIdx] = entry;
    else queue.push(entry);
    save(queue);
    emitKlaviyo(isReplace ? 'Swapped Queue Slot' : 'Added to Queue', {
      ShipMonth: month,
      ProductId: product.productId,
      ProductTitle: product.title,
      ProductFamily: product.family || null,
      QueueLength: queue.length,
      PreviousTitle: previous ? previous.title : null
    });
    syncFirstSlotToAppstle(month, entry);
    return queue;
  }

  function clearSlot(month) {
    var before = load();
    var cleared = before.find(function (e) { return e.shipMonth === month; });
    var queue = before.filter(function (e) { return e.shipMonth !== month; });
    save(queue);
    if (cleared) {
      emitKlaviyo('Removed from Queue', {
        ShipMonth: month,
        ProductId: cleared.productId,
        ProductTitle: cleared.title,
        QueueLength: queue.length
      });
    }
    return queue;
  }

  function reorder(fromMonth, toMonth) {
    if (fromMonth === toMonth) return load();
    var queue = load();
    var fromIdx = queue.findIndex(function (e) { return e.shipMonth === fromMonth; });
    var toIdx = queue.findIndex(function (e) { return e.shipMonth === toMonth; });
    if (fromIdx < 0) return queue;
    var fromEntry = queue[fromIdx];
    if (toIdx >= 0) {
      // Swap months on both entries
      var toEntry = queue[toIdx];
      fromEntry.shipMonth = toMonth;
      toEntry.shipMonth = fromMonth;
    } else {
      // Target month is empty → just relabel the entry
      fromEntry.shipMonth = toMonth;
    }
    save(queue);
    // If a reorder put a different entry into month #1, sync it to Appstle.
    var firstMonth = firstVisibleMonth();
    var nowFirst = queue.find(function (e) { return e.shipMonth === firstMonth; });
    if (nowFirst) syncFirstSlotToAppstle(firstMonth, nowFirst);
    return queue;
  }

  function slotsFromNow(count) {
    // Honors shippedThrough: first slot is the next month the customer hasn't yet received.
    count = count || 5;
    var out = [];
    for (var i = 0; i < count; i++) out.push(monthStrFromFirstVisible(i));
    return out;
  }

  function setShippedThrough(monthStr) {
    if (monthStr && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
      shippedThrough = monthStr;
    } else {
      shippedThrough = null;
    }
    // Re-prune existing queue now that the boundary changed
    var pruned = pruneExpired(load());
    localStorage.setItem(KEY, JSON.stringify(pruned));
    emit();
    // After a shipment posts, the slot that was month-2 becomes month-1.
    // Sync the new first-visible month to Appstle so the next renewal
    // pulls the customer's actual queued pick (not the variant they just received).
    var firstMonth = firstVisibleMonth();
    var nowFirst = pruned.find(function (e) { return e.shipMonth === firstMonth; });
    if (nowFirst) syncFirstSlotToAppstle(firstMonth, nowFirst);
  }

  function filledCount() {
    return load().length;
  }

  function on(event, cb) {
    if (event !== 'change' || typeof cb !== 'function') return;
    listeners.push(cb);
  }

  window.BasenoteQueue = {
    load: load,
    save: save,
    setSlot: setSlot,
    clearSlot: clearSlot,
    reorder: reorder,
    findSlot: findSlot,
    slotsFromNow: slotsFromNow,
    count: filledCount,
    monthLabel: monthLabel,
    currentMonth: currentMonthStr,
    firstVisibleMonth: firstVisibleMonth,
    setShippedThrough: setShippedThrough,
    on: on
  };

  // ════════════════════════════════════════════════════════════
  // Server sync (PRD-4 — Apr 30 2026)
  // Cross-device persistence via Shopify customer metafield, fronted by a
  // Cloudflare Worker mounted at /apps/basenote/queue (Shopify App Proxy).
  // localStorage is the warm cache; server is the source of truth for
  // logged-in customers. Logged-out: localStorage only (unchanged behavior).
  // ════════════════════════════════════════════════════════════
  var SYNC_URL = '/apps/basenote/queue';
  var DEBOUNCE_MS = 1500;
  var pushTimer = null;
  var lastPushedJson = null;

  function isLoggedIn() {
    // Set by Liquid as <script>window.bnCustomerId = {{ customer.id | json }}</script>
    return !!(window.bnCustomerId);
  }

  function mergeServerLocal(serverQ, localQ) {
    // Server wins on shipMonth collision. Local-only entries are added.
    var byMonth = {};
    (serverQ || []).forEach(function (e) { if (e && e.shipMonth) byMonth[e.shipMonth] = e; });
    (localQ || []).forEach(function (e) { if (e && e.shipMonth && !byMonth[e.shipMonth]) byMonth[e.shipMonth] = e; });
    return Object.keys(byMonth).sort().map(function (m) { return byMonth[m]; });
  }

  function pullFromServer() {
    if (!isLoggedIn()) return Promise.resolve(null);
    return fetch(SYNC_URL, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && Array.isArray(j.queue) ? j.queue : null; })
      .catch(function () { return null; });
  }

  function pushToServerNow(queue) {
    if (!isLoggedIn()) return Promise.resolve(false);
    var bodyStr = JSON.stringify({ queue: queue || [] });
    if (bodyStr === lastPushedJson) return Promise.resolve(true); // no-op
    return fetch(SYNC_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr
    })
      .then(function (r) { if (r.ok) lastPushedJson = bodyStr; return r.ok; })
      .catch(function () { return false; });
  }

  function schedulePush() {
    if (!isLoggedIn()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushToServerNow(load()); }, DEBOUNCE_MS);
  }

  // Hydrate on first load: server → merge with local → save
  (function hydrateFromServer() {
    if (!isLoggedIn()) return;
    pullFromServer().then(function (serverQ) {
      if (serverQ === null) return; // request failed; stick with local
      var localQ = load();
      var merged = mergeServerLocal(serverQ, localQ);
      var localJson = JSON.stringify(localQ);
      var mergedJson = JSON.stringify(merged);
      if (mergedJson !== localJson) {
        localStorage.setItem(KEY, mergedJson);
        emit();
      }
      lastPushedJson = JSON.stringify({ queue: serverQ });
      // If merge differs from server, push the merged result back
      if (mergedJson !== JSON.stringify(serverQ)) pushToServerNow(merged);
    });
  })();

  // Subscribe local-changes → debounced push
  listeners.push(function () { schedulePush(); });

  // Flush pending push on tab close so we don't lose changes
  window.addEventListener('pagehide', function () {
    if (pushTimer && isLoggedIn()) {
      clearTimeout(pushTimer);
      try {
        var bodyStr = JSON.stringify({ queue: load() });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(SYNC_URL, new Blob([bodyStr], { type: 'application/json' }));
        }
      } catch (e) {}
    }
  });

  // Expose sync hooks for debugging / manual triggers
  window.BasenoteQueue.sync = {
    pull: pullFromServer,
    push: function () { return pushToServerNow(load()); },
    isLoggedIn: isLoggedIn
  };
})();
