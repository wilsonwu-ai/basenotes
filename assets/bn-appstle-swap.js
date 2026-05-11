/**
 * Basenote Appstle Swap
 * ---------------------
 * Bridges the customer-facing queue/next-shipment UI to the Appstle subscription
 * contract by calling Appstle's customer-portal `replace-variants-v2` endpoint
 * whenever the next renewal's product changes.
 *
 * Why: the queue and next-shipment selectors used to write only to localStorage,
 * so renewals shipped the customer's ORIGINAL variant forever (see order #1029).
 *
 * Two paths (PRD 2026-05-11 — Jeff's mismatch fix):
 *   A. Appstle customer-portal proxy `/apps/subscriptions/cp/api/...`
 *      (in-session, no secret in client). Tried first.
 *   B. Basenote queue-proxy Worker `/apps/basenote/sync-subscription`
 *      (Worker holds the Appstle Admin API key as a Wrangler secret and calls
 *      replace-variants-v3 server-side). Durable fallback when A fails.
 *
 * Public API (window.BasenoteAppstleSwap):
 *   swap({ variantId? , handle? })  → Promise<{ok, noop?, error?, path?}>
 *   seed({ contractId, lineId, variantId, customerId })  → void
 *   on(event, cb)                   → 'start' | 'success' | 'noop' | 'error'
 *   state()                         → snapshot of cached contract state
 *
 * Calls are serialized: a second swap mid-flight queues and supersedes any
 * earlier queued swap so the final UI selection wins.
 */
(function () {
  'use strict';

  var CP = '/apps/subscriptions/cp/api';
  var REPLACE_PATH = CP + '/subscription-contract-details/replace-variants-v2';
  var WORKER_SYNC_PATH = '/apps/basenote/sync-subscription';

  var listeners = [];
  var state = {
    customerId: null,
    contractId: null,
    lineId: null,
    currentVariantId: null,
    fetched: false,
    fetching: null
  };

  var swapInflight = null;
  var pendingInput = null;

  function isLoggedIn() {
    return !!(window.bnCustomerId);
  }

  function stripGid(s) {
    // "gid://shopify/SubscriptionLine/abc-123" -> "abc-123"
    // "12345" -> "12345"
    if (s == null) return null;
    var str = String(s);
    var idx = str.lastIndexOf('/');
    return idx >= 0 ? str.slice(idx + 1) : str;
  }

  function emit(evt, data) {
    listeners.forEach(function (l) {
      if (l.evt === evt) {
        try { l.cb(data || {}); } catch (e) { /* listener errors must not break callers */ }
      }
    });
    try { document.dispatchEvent(new CustomEvent('bn-appstle-swap:' + evt, { detail: data || {} })); } catch (e) {}
  }

  function fetchActiveContract() {
    if (state.fetched && state.contractId && state.lineId) return Promise.resolve(state);
    if (state.fetching) return state.fetching;

    state.fetching = fetch(CP + '/logged-in-customer', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('no-session')); })
      .then(function (customerId) {
        if (!customerId) return Promise.reject(new Error('no-customer'));
        state.customerId = customerId;
        return fetch(CP + '/subscription-customers-detail/valid/' + customerId, { credentials: 'same-origin' });
      })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('no-contracts')); })
      .then(function (contracts) {
        var list = contracts || [];
        // Appstle returns `status: "active"` lowercase, not "ACTIVE".
        var active = null;
        for (var i = 0; i < list.length; i++) {
          if (String(list[i].status || '').toLowerCase() === 'active') { active = list[i]; break; }
        }
        if (!active) active = list[0];
        if (!active) throw new Error('no-active-contract');

        state.contractId = active.subscriptionContractId || active.contractId || active.id || null;

        // Line data lives in `contractDetailsJSON` (stringified JSON array),
        // not in `lines` or `lineItems`. Confirmed via Playwright probe May 11.
        // Each entry: {productId, variantId, lineId, quantity, ...} — values
        // are full GraphQL gids (e.g. "gid://shopify/SubscriptionLine/...").
        var line = null;
        if (active.contractDetailsJSON) {
          try {
            var parsed = JSON.parse(active.contractDetailsJSON);
            if (Array.isArray(parsed) && parsed.length > 0) line = parsed[0];
          } catch (e) { /* fall through to legacy paths */ }
        }
        if (!line) {
          var lines = active.lines || active.lineItems || [];
          line = lines[0] || null;
        }

        if (line) {
          // lineId MUST stay in full gid form (gid://shopify/SubscriptionLine/UUID)
          // — Appstle's replace-variants-v2 rejects bare UUIDs with HTTP 400
          // "Contract line not found." Confirmed via Playwright probe May 11.
          // variantId: keep bare numeric form for the noop comparison; bn-appstle-swap
          // also resolves swap targets to bare variant IDs via /products/:handle.js.
          var rawLineId = line.lineId || line.id || null;
          var rawVid = line.variantId || (line.variant && line.variant.id) || null;
          state.lineId = rawLineId;
          state.currentVariantId = rawVid != null ? stripGid(String(rawVid)) : null;
        }
        state.fetched = true;
        state.fetching = null;
        if (!state.contractId || !state.lineId) {
          throw new Error('no-line-on-contract');
        }
        return state;
      })
      .catch(function (err) {
        state.fetching = null;
        throw err;
      });

    return state.fetching;
  }

  function resolveHandleToVariantId(handle) {
    if (!handle) return Promise.reject(new Error('no-handle'));
    return fetch('/products/' + encodeURIComponent(handle) + '.js', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('product-not-found')); })
      .then(function (p) {
        var variants = p && p.variants ? p.variants : [];
        if (!variants.length) throw new Error('no-variants');
        return String(variants[0].id);
      });
  }

  function callReplaceVariants(newVariantId) {
    // Path A: Appstle customer-portal proxy.
    var url = REPLACE_PATH
      + '?contractId=' + encodeURIComponent(state.contractId)
      + '&newVariantId=' + encodeURIComponent(newVariantId)
      + '&quantity=1'
      + '&oldLineId=' + encodeURIComponent(state.lineId);
    return fetch(url, { method: 'POST', credentials: 'same-origin' })
      .then(function (r) {
        if (r.ok || r.status === 204) return true;
        return r.text().then(function (t) {
          throw new Error('Appstle ' + r.status + ': ' + (t || 'no-body'));
        });
      });
  }

  function callWorkerSync(newVariantId) {
    // Path B: Basenote queue-proxy Worker — server-side Appstle Admin API
    // with the API key held as a Wrangler secret. Works even when Path A's
    // /apps/subscriptions proxy mount is misconfigured or unreachable.
    return fetch(WORKER_SYNC_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: String(newVariantId) })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.ok && j && j.ok) return j;
        var detail = (j && (j.detail || j.error)) || ('worker_' + r.status);
        throw new Error('Worker ' + r.status + ': ' + detail);
      });
    });
  }

  function doSwap(input) {
    var handle = input && input.handle ? String(input.handle) : null;
    var variantId = input && input.variantId ? String(input.variantId) : null;

    // First resolve target variant id (no contract fetch needed for Path B,
    // but Path A still needs it for the cache + noop check).
    var resolveVariant = variantId
      ? Promise.resolve(variantId)
      : resolveHandleToVariantId(handle);

    return resolveVariant.then(function (newVariantId) {
      // Try Path A. Requires contract metadata.
      return fetchActiveContract().then(function () {
        if (state.currentVariantId && newVariantId === state.currentVariantId) {
          emit('noop', { variantId: newVariantId });
          return { ok: true, noop: true, path: 'A' };
        }
        emit('start', { variantId: newVariantId, handle: handle, path: 'A' });
        return callReplaceVariants(newVariantId).then(function () {
          state.currentVariantId = newVariantId;
          emit('success', { variantId: newVariantId, handle: handle, path: 'A' });
          return { ok: true, variantId: newVariantId, path: 'A' };
        });
      }).catch(function (pathAErr) {
        // Path A failed (proxy 404, no contract endpoint, etc).
        // Fall back to the Worker. The Worker resolves the contract from
        // customer id server-side, so we don't need state.contractId here.
        try { console.warn('[bn-appstle-swap] Path A failed, falling back to Worker:', pathAErr && pathAErr.message); } catch (e) {}
        emit('start', { variantId: newVariantId, handle: handle, path: 'B' });
        return callWorkerSync(newVariantId).then(function (j) {
          if (j && j.noop) {
            emit('noop', { variantId: newVariantId, path: 'B' });
            state.currentVariantId = String(newVariantId);
            return { ok: true, noop: true, path: 'B' };
          }
          state.currentVariantId = String(newVariantId);
          if (j && j.contractId) state.contractId = j.contractId;
          emit('success', { variantId: newVariantId, handle: handle, path: 'B' });
          return { ok: true, variantId: newVariantId, path: 'B' };
        });
      });
    }).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      try { console.warn('[bn-appstle-swap] failed:', msg); } catch (e) {}
      emit('error', { error: msg, handle: handle, variantId: variantId });
      return { ok: false, error: msg };
    });
  }

  function swap(input) {
    if (!isLoggedIn()) return Promise.resolve({ ok: false, skipped: 'logged-out' });
    if (!input || (!input.handle && !input.variantId)) {
      return Promise.resolve({ ok: false, skipped: 'no-target' });
    }

    if (swapInflight) {
      pendingInput = input;
      return swapInflight.then(function () {
        if (pendingInput === input) {
          pendingInput = null;
          return swap(input);
        }
        return { ok: false, skipped: 'superseded' };
      });
    }

    swapInflight = doSwap(input).then(function (res) {
      swapInflight = null;
      if (pendingInput) {
        var next = pendingInput;
        pendingInput = null;
        return swap(next);
      }
      return res;
    });
    return swapInflight;
  }

  function seed(data) {
    if (!data) return;
    if (data.contractId) state.contractId = data.contractId;
    if (data.lineId) state.lineId = data.lineId;
    if (data.variantId != null) state.currentVariantId = String(data.variantId);
    if (data.customerId) state.customerId = data.customerId;
    if (state.contractId && state.lineId) state.fetched = true;
  }

  function on(evt, cb) {
    if (typeof evt !== 'string' || typeof cb !== 'function') return;
    listeners.push({ evt: evt, cb: cb });
  }

  window.BasenoteAppstleSwap = {
    swap: swap,
    seed: seed,
    on: on,
    state: function () {
      return {
        customerId: state.customerId,
        contractId: state.contractId,
        lineId: state.lineId,
        currentVariantId: state.currentVariantId,
        fetched: state.fetched
      };
    }
  };
})();
