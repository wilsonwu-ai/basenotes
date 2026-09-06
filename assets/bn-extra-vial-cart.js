(function initBaseNoteExtraVialCart(globalScope) {
  'use strict';

  const EXTRA_VIAL_VARIANT_ID = 48547911696602;
  const EXPECTED_EXTRA_VIAL_PRICE_CENTS = 1800;
  const MAX_EXTRA_VIAL_QUANTITY = 2;
  let activeOperation = null;

  class ExtraVialCartError extends Error {
    constructor(code, message, options) {
      super(message);
      this.name = 'ExtraVialCartError';
      this.code = code;
      this.cause = options && options.cause;
      this.rollbackError = options && options.rollbackError;
    }
  }

  function normalizePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function sellingPlanIdFor(item) {
    if (!item || !item.selling_plan_allocation) return null;
    const allocation = item.selling_plan_allocation;
    const rawId = allocation.selling_plan && allocation.selling_plan.id
      ? allocation.selling_plan.id
      : allocation.selling_plan_id;
    return normalizePositiveInteger(rawId);
  }

  function isExtraVialLine(item, extraVariantId) {
    const expectedVariantId = normalizePositiveInteger(extraVariantId) || EXTRA_VIAL_VARIANT_ID;
    return normalizePositiveInteger(item && item.variant_id) === expectedVariantId;
  }

  function findBaseSubscriptionLine(items, extraVariantId) {
    if (!Array.isArray(items)) return null;
    return items.find((item) => Boolean(item && item.selling_plan_allocation)
      && !isExtraVialLine(item, extraVariantId)) || null;
  }

  function calculateInitialTotal(baseFirstPriceCents, extraUnitPriceCents, extraQuantity) {
    const basePrice = Number(baseFirstPriceCents);
    const extraPrice = Number(extraUnitPriceCents);
    const quantity = Number(extraQuantity);
    if (!Number.isSafeInteger(basePrice) || basePrice < 0
      || !Number.isSafeInteger(extraPrice) || extraPrice < 0
      || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw new ExtraVialCartError('invalid_bundle_price', 'Bundle prices and quantity must be non-negative integers.');
    }
    return basePrice + (extraPrice * quantity);
  }

  function isApprovedPriceProof(proof) {
    if (!proof || proof.recurringDeliveries !== true) return false;
    const planId = normalizePositiveInteger(proof.sellingPlanId);
    if (!planId) return false;

    const expected = EXPECTED_EXTRA_VIAL_PRICE_CENTS;
    const prices = [
      Number(proof.basePriceCents),
      Number(proof.firstPriceCents),
      Number(proof.recurringPriceCents)
    ];
    if (prices.some((price) => price !== expected)) return false;

    const adjustmentPrices = Array.isArray(proof.adjustmentPrices)
      ? proof.adjustmentPrices.map(Number)
      : [];
    return adjustmentPrices.length > 0
      && adjustmentPrices.every((price) => price === expected);
  }

  async function responseError(response, fallbackMessage) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    return new ExtraVialCartError(
      'cart_request_failed',
      payload && (payload.description || payload.message)
        ? payload.description || payload.message
        : fallbackMessage
    );
  }

  async function requestJSON(fetchImpl, url, options) {
    const response = await fetchImpl(url, options);
    if (!response || !response.ok) {
      throw await responseError(response || { json: async () => null }, `Cart request failed: ${url}`);
    }
    return response.json();
  }

  function extraLines(cart, extraVariantId) {
    const items = cart && Array.isArray(cart.items) ? cart.items : [];
    return items.filter((item) => isExtraVialLine(item, extraVariantId));
  }

  function exactExtraLine(lines, variantId, sellingPlanId) {
    return lines.find((line) => sellingPlanIdFor(line) === sellingPlanId
      && normalizePositiveInteger(line.variant_id) === variantId) || null;
  }

  function lineHasExpectedPrice(line) {
    if (!line || !line.selling_plan_allocation) return false;
    const allocationPrice = Number(line.selling_plan_allocation.price);
    const finalPrice = Number(line.final_price);
    return allocationPrice === EXPECTED_EXTRA_VIAL_PRICE_CENTS
      && (!Number.isFinite(finalPrice) || finalPrice === EXPECTED_EXTRA_VIAL_PRICE_CENTS);
  }

  async function readCart(fetchImpl) {
    const cart = await requestJSON(fetchImpl, '/cart.js', {
      headers: { Accept: 'application/json' }
    });
    if (!cart || !Array.isArray(cart.items)) {
      throw new ExtraVialCartError('invalid_cart_response', 'Shopify returned an invalid cart response.');
    }
    return cart;
  }

  async function changeLine(fetchImpl, key, quantity) {
    return requestJSON(fetchImpl, '/cart/change.js', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id: key, quantity })
    });
  }

  async function addLine(fetchImpl, variantId, sellingPlanId, quantity) {
    return requestJSON(fetchImpl, '/cart/add.js', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: variantId,
        quantity,
        selling_plan: sellingPlanId
      })
    });
  }

  function assertNoConflictingExtraLines(lines, sellingPlanId) {
    const conflicting = lines.filter((line) => sellingPlanIdFor(line) !== sellingPlanId);
    if (conflicting.length > 0 || lines.length > 1) {
      throw new ExtraVialCartError(
        'extra_vial_conflicting_line',
        'Your cart already contains an extra vial with an unexpected purchase option. Review the cart before retrying.'
      );
    }
  }

  function assertDesiredExtraState(cart, config) {
    const lines = extraLines(cart, config.variantId);
    if (config.quantity === 0) {
      if (lines.length !== 0) {
        throw new ExtraVialCartError('extra_vial_verification_failed', 'The extra vial was not removed from the cart.');
      }
      return null;
    }

    if (lines.length !== 1) {
      throw new ExtraVialCartError('extra_vial_verification_failed', 'The cart contains an unexpected number of extra-vial lines.');
    }
    const line = exactExtraLine(lines, config.variantId, config.sellingPlanId);
    if (!line || Number(line.quantity) !== config.quantity || !lineHasExpectedPrice(line)) {
      throw new ExtraVialCartError(
        'extra_vial_verification_failed',
        'The extra vial price or monthly plan could not be verified.'
      );
    }
    if (config.expectedKey && line.key !== config.expectedKey) {
      throw new ExtraVialCartError('extra_vial_verification_failed', 'Shopify returned a different extra-vial cart line.');
    }
    return line;
  }

  async function removeAllExtraLines(fetchImpl, variantId) {
    let cart = await readCart(fetchImpl);
    for (const line of extraLines(cart, variantId)) {
      if (!line.key) {
        throw new ExtraVialCartError('extra_vial_rollback_failed', 'An extra-vial cart line has no removable key.');
      }
      await changeLine(fetchImpl, line.key, 0);
    }
    cart = await readCart(fetchImpl);
    if (extraLines(cart, variantId).length !== 0) {
      throw new ExtraVialCartError('extra_vial_rollback_failed', 'The extra-vial rollback could not be verified.');
    }
  }

  async function restoreSnapshot(fetchImpl, snapshot, config) {
    await removeAllExtraLines(fetchImpl, config.variantId);
    if (snapshot.quantity > 0) {
      await addLine(fetchImpl, config.variantId, config.sellingPlanId, snapshot.quantity);
    }
    const restored = await readCart(fetchImpl);
    assertDesiredExtraState(restored, {
      ...config,
      quantity: snapshot.quantity,
      expectedKey: null
    });
  }

  async function performExtraVialQuantity(options) {
    const fetchImpl = options && options.fetchImpl;
    if (typeof fetchImpl !== 'function') {
      throw new ExtraVialCartError('missing_fetch', 'Cart access is unavailable.');
    }
    if (!isApprovedPriceProof(options.priceProof)) {
      throw new ExtraVialCartError(
        'extra_vial_price_mismatch',
        'The approved $18 extra-vial price could not be verified. No extra vial was added.'
      );
    }

    const variantId = normalizePositiveInteger(options.variantId);
    const sellingPlanId = normalizePositiveInteger(options.sellingPlanId);
    const quantity = Number(options.quantity);
    if (variantId !== EXTRA_VIAL_VARIANT_ID || !sellingPlanId
      || !Number.isSafeInteger(quantity)
      || quantity < 0
      || quantity > MAX_EXTRA_VIAL_QUANTITY) {
      throw new ExtraVialCartError('invalid_extra_vial_configuration', 'The extra-vial selection is invalid.');
    }
    if (normalizePositiveInteger(options.priceProof.sellingPlanId) !== sellingPlanId) {
      throw new ExtraVialCartError(
        'extra_vial_price_mismatch',
        'The approved $18 price proof does not match the selected monthly plan.'
      );
    }

    const config = { variantId, sellingPlanId, quantity };
    const beforeCart = await readCart(fetchImpl);
    const beforeLines = extraLines(beforeCart, variantId);
    assertNoConflictingExtraLines(beforeLines, sellingPlanId);
    const beforeLine = exactExtraLine(beforeLines, variantId, sellingPlanId);
    if (beforeLine && !lineHasExpectedPrice(beforeLine)) {
      throw new ExtraVialCartError('extra_vial_price_mismatch', 'The cart contains an extra vial at an unapproved price.');
    }

    const snapshot = { quantity: beforeLine ? Number(beforeLine.quantity) : 0 };
    if (snapshot.quantity === quantity) {
      return { changed: false, line: beforeLine };
    }

    let mutationAttempted = false;
    try {
      mutationAttempted = true;
      let expectedKey = null;
      if (beforeLine) {
        await changeLine(fetchImpl, beforeLine.key, quantity);
        expectedKey = quantity > 0 ? beforeLine.key : null;
      } else if (quantity > 0) {
        const added = await addLine(fetchImpl, variantId, sellingPlanId, quantity);
        expectedKey = added && added.key ? added.key : null;
        if (!expectedKey) {
          throw new ExtraVialCartError('extra_vial_verification_failed', 'Shopify did not return the added cart-line key.');
        }
      }

      const afterCart = await readCart(fetchImpl);
      const line = assertDesiredExtraState(afterCart, { ...config, expectedKey });
      return { changed: true, line };
    } catch (error) {
      if (!mutationAttempted) throw error;
      try {
        await restoreSnapshot(fetchImpl, snapshot, config);
      } catch (rollbackError) {
        throw new ExtraVialCartError(
          'extra_vial_rollback_failed',
          'The extra vial could not be verified or rolled back. Review your cart before checkout.',
          { cause: error, rollbackError }
        );
      }
      throw new ExtraVialCartError(
        error && error.code ? error.code : 'extra_vial_verification_failed',
        error && error.message ? error.message : 'The extra vial could not be verified.',
        { cause: error }
      );
    }
  }

  function ensureExtraVialQuantity(options) {
    const operationKey = [
      options && options.variantId,
      options && options.sellingPlanId,
      options && options.quantity
    ].join(':');

    if (activeOperation) {
      if (activeOperation.key === operationKey) return activeOperation.promise;
      return activeOperation.promise.then(
        () => ensureExtraVialQuantity(options),
        () => ensureExtraVialQuantity(options)
      );
    }

    const promise = performExtraVialQuantity(options).finally(() => {
      if (activeOperation && activeOperation.promise === promise) activeOperation = null;
    });
    activeOperation = { key: operationKey, promise };
    return promise;
  }

  const api = {
    EXTRA_VIAL_VARIANT_ID,
    EXPECTED_EXTRA_VIAL_PRICE_CENTS,
    MAX_EXTRA_VIAL_QUANTITY,
    ExtraVialCartError,
    calculateInitialTotal,
    ensureExtraVialQuantity,
    findBaseSubscriptionLine,
    isApprovedPriceProof,
    isExtraVialLine,
    sellingPlanIdFor
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.BaseNoteExtraVialCart = api;
})(typeof window !== 'undefined' ? window : globalThis);
