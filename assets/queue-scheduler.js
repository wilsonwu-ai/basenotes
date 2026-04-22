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

  function monthStrFromOffset(offset) {
    var d = new Date();
    d.setDate(1);
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
    // Drop slots whose shipMonth is in the past (before current month)
    var cur = currentMonthStr();
    return queue.filter(function (entry) { return entry.shipMonth >= cur; });
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

  function setSlot(month, product) {
    if (!month || !product || !product.productId) return load();
    var queue = load();
    var existingIdx = queue.findIndex(function (e) { return e.shipMonth === month; });
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
    if (existingIdx >= 0) queue[existingIdx] = entry;
    else queue.push(entry);
    save(queue);
    return queue;
  }

  function clearSlot(month) {
    var queue = load().filter(function (e) { return e.shipMonth !== month; });
    save(queue);
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
    return queue;
  }

  function slotsFromNow(count) {
    count = count || 5;
    var out = [];
    for (var i = 0; i < count; i++) out.push(monthStrFromOffset(i));
    return out;
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
    on: on
  };
})();
