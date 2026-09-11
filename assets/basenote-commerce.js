/* Base Note storefront commerce. Prices and selling plans are verified against Shopify.
 * The $18 helper is a one-time fulfillment line, with the original scent recorded.
 * It must never receive the helper's discounted subscription selling plan.
 */
(() => {
  'use strict';
  if (window.BaseNoteCommerce) return;

  const HELPER = 'extra-5ml-vial-add-on';
  const HANDLE = '_Base Note scent handle';
  const VARIANT = '_Base Note scent variant';
  const SOURCE = '_Base Note source';
  const productCache = new Map();
  let catalogPromise;
  let cartReadPromise;
  let queue = Promise.resolve();
  const cartFetch = window.__bnFetch || window.fetch?.bind(window) || fetch;
  const root = window.Shopify?.routes?.root || '/';
  const url = (path) => new URL(`${root}${path}`, window.location.origin).href;
  const isHelper = (item) => item.handle === HELPER;
  const isVial = (variant) => /(?:^|\s|\/)5\s?ml(?:$|\s|\/)/i.test(variant.title || variant.variant_title || '');
  const quantityOf = (value) => {
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99) throw new Error('Choose a whole quantity from 1 to 99.');
    return quantity;
  };
  const planIdOf = (item) => Number(item.selling_plan_allocation?.selling_plan?.id || 0);
  const cleanProperties = (properties = {}) => Object.fromEntries(Object.entries(properties).filter(([key, value]) => value !== null && value !== '' && ![HANDLE, VARIANT, SOURCE, 'Selected scent'].includes(key)));
  const sameProperties = (a = {}, b = {}) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const sameLine = (item, spec) => Number(item.variant_id) === Number(spec.id) && planIdOf(item) === Number(spec.selling_plan || 0) && sameProperties(item.properties || {}, spec.properties || {});
  const specification = (item) => ({ id: item.variant_id, properties: item.properties || {}, selling_plan: planIdOf(item) || null });
  const currentLine = (cart, item) => cart.items.find((candidate) => sameLine(candidate, specification(item)));

  async function request(path, body) {
    // Appstle can wrap window.fetch; the theme captures the native function in
    // the head so explicit customer selling-plan choices reach Shopify intact.
    if (body) cartReadPromise = null;
    const response = await cartFetch(url(path), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.description === 'string' ? data.description : 'We could not update your cart. Please review it and try again.');
    return data;
  }

  async function getProduct(handle) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(handle || '')) throw new Error('Choose your fragrance again before adding it.');
    if (!productCache.has(handle)) productCache.set(handle, request(`products/${encodeURIComponent(handle)}.js`).catch((error) => { productCache.delete(handle); throw error; }));
    return productCache.get(handle);
  }

  async function getCart() {
    if (!cartReadPromise) {
      const pending = request('cart.js');
      cartReadPromise = pending;
      pending.finally(() => { if (cartReadPromise === pending) cartReadPromise = null; }).catch(() => {});
    }
    return cartReadPromise;
  }

  function publish(cart) {
    document.dispatchEvent(new CustomEvent('basenote:cart-updated', { detail: { cart } }));
    document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { cart } }));
    for (const count of document.querySelectorAll('[data-cart-count], .header__cart-count')) {
      count.textContent = String(cart.item_count);
      count.classList.toggle('is-hidden', cart.item_count === 0);
    }
    return cart;
  }

  // A single queue covers every page component; the optional browser lock also
  // serializes cooperating tabs so two quick clicks cannot both be a first vial.
  function exclusive(task) {
    const run = () => navigator.locks?.request ? navigator.locks.request('basenote-cart', task) : task();
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  async function helperVariant(cart) {
    const product = await getProduct(HELPER);
    const variant = product.variants.find((item) => item.available && Number(item.price) === 1800 && !item.requires_selling_plan);
    if (cart.currency !== 'USD' || !variant) throw new Error('Additional-vial pricing is unavailable right now. Please review your cart before continuing.');
    return variant;
  }

  async function resolveScent(item) {
    if (!isHelper(item)) {
      const product = await getProduct(item.handle);
      return { product, variant: product.variants.find((variant) => Number(variant.id) === Number(item.variant_id)) };
    }
    const handle = item.properties?.[HANDLE];
    const variantId = Number(item.properties?.[VARIANT]);
    if (handle && variantId) {
      const product = await getProduct(handle);
      const variant = product.variants.find((candidate) => Number(candidate.id) === variantId && isVial(candidate));
      if (variant && Number(variant.price) === 2000) return { product, variant };
    }
    // Recover earlier theme carts by an exact, unique merchant product title.
    // Never substitute a scent from a fuzzy match.
    const selected = item.properties?.['Selected scent'];
    if (selected) {
      catalogPromise ||= request('collections/fragrances/products.json?limit=250');
      const catalog = await catalogPromise;
      const matches = catalog.products.filter((product) => product.title === selected && product.handle !== HELPER);
      if (matches.length === 1) {
        const product = await getProduct(matches[0].handle);
        const variant = product.variants.find((candidate) => isVial(candidate) && Number(candidate.price) === 2000);
        if (variant) return { product, variant };
      }
    }
    throw new Error('An additional vial needs a fragrance selection. Remove that item and choose its scent again before checkout.');
  }

  function helperSpec(helper, scent, quantity, properties = {}, source = 'Fragrance shop') {
    return { id: helper.id, quantity, properties: { ...cleanProperties(properties), 'Selected scent': scent.product.title, [HANDLE]: scent.product.handle, [VARIANT]: String(scent.variant.id), [SOURCE]: source } };
  }

  async function eligibleLines(cart) {
    const result = [];
    for (const item of cart.items) {
      if (isHelper(item)) continue;
      if (!isVial(item)) continue;
      const scent = await resolveScent(item);
      if (scent.variant && Number(scent.variant.price) === 2000) result.push({ item, ...scent });
    }
    return result;
  }

  async function addItems(items) { await request('cart/add.js', { items }); return getCart(); }

  // Replacing units always adds their replacement first. If the subsequent
  // removal fails, inspect server state and undo only the units we just added.
  // Never clear/rebuild a customer's cart or blindly retry an ambiguous add.
  async function replaceUnits(cart, original, count, replacement) {
    const existing = cart.items.find((item) => sameLine(item, replacement));
    const priorQuantity = existing?.quantity || 0;
    let updated = await addItems([{ ...replacement, quantity: count }]);
    try {
      const source = currentLine(updated, original);
      if (!source) throw new Error('The cart line changed while updating.');
      updated = await request('cart/change.js', { id: source.key, quantity: original.quantity - count });
      return updated;
    } catch (error) {
      const observed = await getCart();
      const source = currentLine(observed, original);
      if ((source?.quantity || 0) === original.quantity - count) return observed;
      const target = observed.items.find((item) => sameLine(item, replacement));
      if ((source?.quantity || 0) === original.quantity && target?.quantity === priorQuantity + count) {
        await request('cart/change.js', { id: target.key, quantity: priorQuantity });
      }
      throw new Error('The cart update could not finish. Review your quantities and prices before trying again.');
    }
  }

  async function normalizeCart(cart) {
    if (cart.currency !== 'USD') return cart;
    const helpers = cart.items.filter(isHelper);
    if (helpers.some((item) => item.selling_plan_allocation)) throw new Error('An older additional-vial subscription needs review. Remove that additional vial and add its scent again as a one-time vial.');
    for (const item of helpers) await resolveScent(item);
    let eligible = await eligibleLines(cart);
    if (!eligible.length && !helpers.length) return cart;
    // A helper with no real qualifying vial must be promoted back to its own
    // original scent. This prevents a remaining first vial being charged $18.
    if (!eligible.length && helpers.length) {
      const first = helpers[0];
      const scent = await resolveScent(first);
      if (!scent.variant.available) throw new Error('The remaining fragrance is no longer available. Remove it or choose another scent before checkout.');
      cart = await replaceUnits(cart, first, 1, { id: scent.variant.id, properties: cleanProperties(first.properties) });
      eligible = await eligibleLines(cart);
    }
    const subscription = eligible.find(({ item }) => item.selling_plan_allocation);
    const anchor = subscription || eligible[0];
    const excess = eligible.filter(({ item }) => !item.selling_plan_allocation && (item.key !== anchor.item.key || item.quantity > 1));
    if (excess.length) {
      const helper = await helperVariant(cart);
      for (const line of excess) {
        const current = currentLine(cart, line.item);
        if (!current) continue;
        const count = current.quantity - (sameLine(current, specification(anchor.item)) ? 1 : 0);
        cart = await replaceUnits(cart, current, count, helperSpec(helper, line, count, current.properties, 'Cart quantity pricing'));
      }
    }
    return cart;
  }

  async function quoteVial({ variantId, handle, quantity = 1 }) {
    const count = quantityOf(quantity);
    const [product, cart] = await Promise.all([getProduct(handle), getCart()]);
    const variant = product.variants.find((candidate) => Number(candidate.id) === Number(variantId));
    if (!variant) throw new Error('This size is unavailable. Choose another size.');
    const eligible = isVial(variant) && Number(variant.price) === 2000 && cart.currency === 'USD';
    const anchor = eligible && (await eligibleLines(cart)).length > 0;
    let unitPrice = Number(variant.price);
    let totalPrice = unitPrice * count;
    if (eligible) {
      try {
        const helper = await helperVariant(cart);
        if (anchor) unitPrice = Number(helper.price);
        totalPrice = anchor ? unitPrice * count : unitPrice + Number(helper.price) * Math.max(0, count - 1);
      } catch (_) { /* Show the real regular price if the helper is unavailable. */ }
    }
    return { unitPrice, totalPrice, currency: cart.currency, additional: unitPrice < Number(variant.price) };
  }

  async function addVial(options) {
    return exclusive(async () => {
      const quantity = quantityOf(options.quantity ?? 1);
      if (!quantity) throw new Error('Choose at least one item.');
      const product = await getProduct(options.handle);
      if (product.handle === HELPER) throw new Error('Choose a fragrance from the collection first.');
      const variant = product.variants.find((candidate) => Number(candidate.id) === Number(options.variantId));
      if (!variant?.available) throw new Error('This size is sold out. Choose another fragrance or size.');
      let cart = await normalizeCart(await getCart());
      const eligible = isVial(variant) && Number(variant.price) === 2000 && cart.currency === 'USD';
      if (options.sellingPlanId) {
        const planId = Number(options.sellingPlanId);
        const allocation = (variant.selling_plan_allocations || []).find((plan) => Number(plan.selling_plan_id) === planId);
        if (!eligible || !allocation || quantity !== 1) throw new Error('Monthly Rotation starts with one eligible 5ml vial.');
        if ((await eligibleLines(cart)).some(({ item }) => item.selling_plan_allocation)) throw new Error('A Monthly Rotation is already in your cart. Remove it to choose a different monthly scent, or add this vial as a one-time purchase.');
        const before = cart;
        cart = await addItems([{ id: variant.id, quantity: 1, selling_plan: planId, properties: options.properties || {} }]);
        if (!cart.items.some((item) => Number(item.variant_id) === Number(variant.id) && planIdOf(item) === planId)) {
          const spec = { id: variant.id, properties: options.properties || {} };
          const prior = before.items.find((item) => sameLine(item, spec));
          const unintended = cart.items.find((item) => sameLine(item, spec));
          if (unintended?.quantity === (prior?.quantity || 0) + 1) await request('cart/change.js', { id: unintended.key, quantity: prior?.quantity || 0 });
          throw new Error('The subscription option was not applied. Review your cart before trying again.');
        }
        return publish(await normalizeCart(cart));
      }
      if (variant.requires_selling_plan) throw new Error('This item requires a subscription. Choose Monthly Rotation to continue.');
      if (!eligible) return publish(await addItems([{ id: variant.id, quantity, properties: options.properties || {} }]));
      const hasAnchor = (await eligibleLines(cart)).length > 0;
      const items = [];
      if (!hasAnchor) items.push({ id: variant.id, quantity: 1, properties: options.properties || {} });
      const additional = quantity - (hasAnchor ? 0 : 1);
      if (additional) items.push(helperSpec(await helperVariant(cart), { product, variant }, additional, options.properties, options.source));
      return publish(await addItems(items));
    });
  }

  async function changeQuantity(key, requested) {
    return exclusive(async () => {
      const quantity = quantityOf(requested);
      let cart = await getCart();
      const original = cart.items.find((item) => item.key === key);
      if (!original) throw new Error('Your cart changed in another window. Refresh it before trying again.');
      if (quantity === original.quantity) return cart;
      if (quantity === 0 && !isHelper(original)) {
        const remaining = (await eligibleLines(cart)).filter(({ item }) => item.key !== original.key);
        const helper = cart.items.find(isHelper);
        if (!remaining.length && helper) {
          const scent = await resolveScent(helper);
          cart = await replaceUnits(cart, helper, 1, { id: scent.variant.id, properties: cleanProperties(helper.properties) });
          // Same-scent promotion can merge with the item the customer removed.
          const target = currentLine(cart, original);
          if (!target) throw new Error('Your cart changed while updating. Review its current items before trying again.');
          cart = await request('cart/change.js', { id: target.key, quantity: Math.max(0, target.quantity - original.quantity) });
          return publish(await normalizeCart(cart));
        }
      }
      if (original.selling_plan_allocation && quantity > 1) throw new Error('Monthly Rotation includes one vial each month. Add extra scents as one-time vials from the fragrance page.');
      cart = await request('cart/change.js', { id: key, quantity });
      return publish(await normalizeCart(cart));
    });
  }

  async function setOrderMode(mode) {
    return exclusive(async () => {
      let cart = await normalizeCart(await getCart());
      const lines = await eligibleLines(cart);
      if (!lines.length) throw new Error('Add a 5ml fragrance to choose Monthly Rotation. Full bottles remain one-time purchases.');
      if (mode === 'subscription') {
        if (lines.some(({ item }) => item.selling_plan_allocation)) return publish(cart);
        const base = lines[0];
        const allocation = (base.variant.selling_plan_allocations || []).find((plan) => {
          const group = base.product.selling_plan_groups.find((candidate) => candidate.id === plan.selling_plan_group_id);
          return group?.selling_plans.some((candidate) => Number(candidate.id) === Number(plan.selling_plan_id) && candidate.recurring_deliveries && /month/i.test(candidate.name));
        });
        if (!allocation) throw new Error('Monthly Rotation is unavailable for this scent. Choose another 5ml fragrance.');
        const index = cart.items.findIndex((item) => item.key === base.item.key);
        cart = await request('cart/change.js', { line: index + 1, quantity: 1, selling_plan: allocation.selling_plan_id });
        if (!cart.items.some((item) => Number(item.variant_id) === Number(base.variant.id) && planIdOf(item) === Number(allocation.selling_plan_id))) throw new Error('The subscription option was not applied. Review your cart before trying again.');
      } else {
        for (const { item } of lines) {
          if (!item.selling_plan_allocation) continue;
          const current = currentLine(cart, item);
          const index = cart.items.findIndex((line) => line.key === current?.key);
          if (index < 0) throw new Error('Your cart changed. Review it before changing the purchase option.');
          cart = await request('cart/change.js', { line: index + 1, quantity: current.quantity, selling_plan: null });
          if (currentLine(cart, item)?.selling_plan_allocation) throw new Error('A subscription could not be changed to a one-time purchase. Review the renewal details in your cart.');
        }
      }
      return publish(await normalizeCart(cart));
    });
  }

  async function prepareCart() { return exclusive(async () => publish(await normalizeCart(await getCart()))); }
  function money(cents, currency = window.Shopify?.currency?.active || 'USD') {
    return new Intl.NumberFormat(document.documentElement.lang || 'en-US', { style: 'currency', currency }).format(Number(cents) / 100);
  }

  window.BaseNoteCommerce = Object.freeze({ addVial, quoteVial, getCart, changeQuantity, setOrderMode, prepareCart, money });
  window.dispatchEvent(new CustomEvent('basenote:commerce-ready'));

  class ArtifactProduct extends HTMLElement {
    connectedCallback() {
      if (this.controller) return;
      this.controller = new AbortController();
      const on = (node, type, fn) => node?.addEventListener(type, fn, { signal: this.controller.signal });
      this.form = this.querySelector('[data-artifact-product-form]');
      this.quantity = this.querySelector('[data-artifact-quantity]');
      this.submit = this.querySelector('[data-artifact-submit]');
      this.price = this.querySelector('[data-artifact-product-price]');
      this.status = this.querySelector('[data-artifact-product-status]');
      this.plan = this.querySelector('[data-artifact-plan]');
      this.rotation = this.querySelector('[data-artifact-rotation]');
      this.variants = JSON.parse(this.querySelector('[data-artifact-variants]').textContent);
      this.current = this.variants.find((variant) => String(variant.id) === this.form.elements.id.value) || this.variants[0];
      for (const input of this.querySelectorAll('[data-artifact-size]')) {
        if (input.dataset.request === 'true') input.disabled = false;
        on(input, 'change', () => this.select(input.value));
      }
      for (const button of this.querySelectorAll('[data-artifact-qty]')) {
        button.hidden = false;
        on(button, 'click', () => { this.quantity.value = String(Math.max(1, Math.min(this.plan?.value ? 1 : 99, Number(this.quantity.value || 1) + (button.dataset.artifactQty === 'plus' ? 1 : -1)))); this.updatePrice(); });
      }
      on(this.quantity, 'change', () => this.updatePrice());
      on(this.rotation, 'change', () => this.choosePlan());
      on(this.form, 'submit', (event) => this.add(event));
      for (const button of this.querySelectorAll('[data-product-image]')) on(button, 'click', () => {
        const image = this.querySelector('[data-product-main-image]');
        image.src = button.dataset.productImage; image.srcset = ''; image.alt = button.dataset.alt || '';
        for (const thumb of this.querySelectorAll('[data-product-image]')) thumb.setAttribute('aria-pressed', String(thumb === button));
      });
      on(document, 'basenote:cart-updated', () => this.updatePrice());
      if (this.rotation) {
        this.rotation.closest('.artifact-product__rotation').hidden = false;
        this.rotation.disabled = !this.current?.planId;
        if (new URL(window.location.href).searchParams.get('purchase') === 'subscription' && this.current?.planId) {
          this.rotation.value = 'subscription'; this.choosePlan();
        }
      }
      this.updatePrice();
    }
    disconnectedCallback() { this.controller?.abort(); this.controller = null; }
    select(id) {
      this.current = this.variants.find((variant) => String(variant.id) === id);
      const missing = !this.current;
      const showVial = Boolean(this.current?.isVial);
      const vialReference = this.querySelector('[data-product-vial-reference]');
      if (vialReference) vialReference.hidden = !showVial;
      this.querySelector('[data-product-comparison]')?.classList.toggle('artifact-product__visual--single', !showVial);
      this.submit.hidden = missing;
      this.querySelector('[data-bottle-request]').hidden = !missing;
      this.querySelector('[data-artifact-purchase-controls]').hidden = missing;
      if (this.current) this.form.elements.id.value = this.current.id;
      if (this.rotation) { this.rotation.value = ''; this.rotation.disabled = missing || !this.current?.planId; }
      this.choosePlan();
      if (missing) { this.price.textContent = 'Not currently available'; this.price.setAttribute('aria-label', 'Full bottle not currently available'); return; }
      this.submit.disabled = !this.current.available;
      this.submit.textContent = this.current.available ? 'Add to cart' : 'Sold out';
      const location = new URL(window.location.href); location.searchParams.set('variant', this.current.id); history.replaceState({}, '', location);
      this.querySelector('[data-artifact-size-note]').textContent = this.current.isVial ? '5ml in a portable spray atomizer. Try it on your skin before committing to a bottle.' : 'Original full bottle. Size and price shown are for the selected variant.';
      this.updatePrice();
    }
    choosePlan() {
      const selected = Boolean(this.rotation?.value && this.current?.planId);
      if (this.rotation && !this.current?.planId) this.rotation.value = '';
      if (this.plan) { this.plan.value = selected ? this.current.planId : ''; this.plan.disabled = !selected; }
      this.quantity.max = selected ? '1' : '99';
      if (selected) this.quantity.value = '1';
      const disclosure = this.querySelector('[data-artifact-rotation-note]');
      if (disclosure) disclosure.hidden = !selected;
      if (selected) {
        this.querySelector('[data-plan-first]').textContent = money(this.current.planPrice);
        this.querySelector('[data-plan-renewal]').textContent = money(this.current.renewalPrice);
      }
      const consent = this.querySelector('[data-artifact-consent]');
      if (consent) { consent.required = selected; consent.disabled = !selected; consent.checked = false; }
      this.updatePrice();
    }
    async updatePrice() {
      const ticket = this.priceTicket = (this.priceTicket || 0) + 1;
      const current = this.current;
      if (!current) return;
      const quantity = Math.max(1, Number(this.quantity.value) || 1);
      let quote = { unitPrice: current.price, totalPrice: current.price * quantity };
      if (this.plan?.value) quote = { unitPrice: current.planPrice, totalPrice: current.planPrice };
      else {
        try { quote = await quoteVial({ variantId: current.id, handle: this.dataset.productHandle, quantity }); }
        catch (_) { /* Initial Shopify-rendered price remains a valid fallback. */ }
      }
      if (ticket !== this.priceTicket || current !== this.current) return;
      this.price.textContent = money(quote.totalPrice, quote.currency);
      this.price.setAttribute('aria-label', `${quantity > 1 ? `Total for ${quantity} items` : 'Price'} ${this.price.textContent}`);
      this.querySelector('[data-artifact-price-note]').textContent = this.plan?.value ? 'First shipment. Recurring price below.' : quote.additional ? `${money(quote.unitPrice, quote.currency)} per additional vial in this order.` : quantity > 1 && current.isVial && current.price === 2000 ? 'First vial at regular price; additional 5ml vials are $18 each.' : current.isVial && current.price === 2000 ? `${money(current.price)} first vial · $18 each additional vial in your order.` : '';
    }
    async add(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.busy || !this.current || !this.form.reportValidity()) return;
      this.busy = true; this.submit.disabled = true;
      this.status.textContent = 'Adding your fragrance…';
      try {
        await addVial({ variantId: this.current.id, handle: this.dataset.productHandle, quantity: Number(this.quantity.value), sellingPlanId: this.plan?.value || null, source: 'Product page' });
        this.status.textContent = `${this.dataset.productTitle} is in your cart. `;
        const link = document.createElement('a'); link.href = url('cart'); link.textContent = 'View cart →'; this.status.append(link);
      } catch (error) { this.status.textContent = `${error.message} Open your cart to check the current items.`; }
      finally { this.busy = false; this.submit.disabled = !this.current?.available; }
    }
  }

  class ArtifactCart extends HTMLElement {
    connectedCallback() {
      if (this.controller) return;
      this.controller = new AbortController();
      this.status = this.querySelector('[data-cart-status]');
      this.checkout = this.querySelector('[data-cart-checkout]');
      this.consent = this.querySelector('[data-cart-consent]');
      if (!this.checkout) return;
      const on = (node, type, fn) => node?.addEventListener(type, fn, { signal: this.controller.signal });
      this.checkout.disabled = true;
      for (const button of this.querySelectorAll('[data-cart-step]')) { button.hidden = false; on(button, 'click', () => {
        const row = button.closest('[data-cart-key]'); const input = row.querySelector('[data-cart-quantity]');
        this.run(() => changeQuantity(row.dataset.cartKey, Math.max(0, Number(input.value) + Number(button.dataset.cartStep))));
      }); }
      for (const input of this.querySelectorAll('[data-cart-quantity]')) on(input, 'change', () => this.run(() => changeQuantity(input.closest('[data-cart-key]').dataset.cartKey, input.value)));
      for (const link of this.querySelectorAll('[data-cart-remove]')) on(link, 'click', (event) => { event.preventDefault(); this.run(() => changeQuantity(link.closest('[data-cart-key]').dataset.cartKey, 0)); });
      for (const radio of this.querySelectorAll('input[name="artifact_order_mode"]')) {
        radio.disabled = radio.dataset.unavailable === 'true';
        on(radio, 'change', () => this.run(() => setOrderMode(radio.value)));
      }
      on(this.consent, 'change', () => this.updateCheckout());
      on(this.querySelector('form'), 'submit', (event) => {
        if (this.busy || this.failed || (this.consent && !this.consent.checked)) { event.preventDefault(); this.status.textContent = this.failed ? 'Review the cart message above before continuing.' : 'Agree to the recurring subscription terms before continuing.'; }
      });
      this.prepare();
    }
    disconnectedCallback() { this.controller?.abort(); this.controller = null; }
    updateCheckout() {
      this.checkout.disabled = Boolean(this.busy || this.failed || (this.consent && !this.consent.checked));
      this.setAttribute('aria-busy', String(Boolean(this.busy)));
      for (const input of this.querySelectorAll('[data-cart-step], [data-cart-quantity]')) input.disabled = Boolean(this.busy);
      for (const radio of this.querySelectorAll('input[name="artifact_order_mode"]')) radio.disabled = Boolean(this.busy || radio.dataset.unavailable === 'true');
      for (const link of this.querySelectorAll('[data-cart-remove]')) {
        link.setAttribute('aria-disabled', String(Boolean(this.busy)));
        link.tabIndex = this.busy ? -1 : 0;
      }
    }
    async prepare() {
      this.busy = true; this.updateCheckout();
      this.status.textContent = 'Checking your cart prices…';
      try {
        const before = await getCart();
        const after = await prepareCart();
        const signature = (cart) => JSON.stringify(cart.items.map((item) => [item.key, item.quantity, item.final_line_price]));
        if (signature(before) !== signature(after)) { window.location.reload(); return; }
        this.status.textContent = '';
      } catch (error) { this.failed = true; this.status.textContent = error.message; }
      this.busy = false; this.updateCheckout();
    }
    async run(action) {
      if (this.busy) return;
      this.busy = true; this.failed = false; this.setAttribute('aria-busy', 'true'); this.updateCheckout();
      this.status.textContent = 'Updating your cart…';
      try { await action(); window.location.reload(); }
      catch (error) {
        this.failed = true;
        this.status.textContent = `${error.message} Your cart may have changed. `;
        const link = document.createElement('a'); link.href = url('cart'); link.textContent = 'Reload and review cart'; this.status.append(link);
        this.busy = false; this.setAttribute('aria-busy', 'false'); this.updateCheckout();
      }
    }
  }
  if (!customElements.get('artifact-product')) customElements.define('artifact-product', ArtifactProduct);
  if (!customElements.get('artifact-cart')) customElements.define('artifact-cart', ArtifactCart);
})();
