/** Lightweight commerce/progressive enhancement shell. Three.js loads on view. */
class VialStudio extends HTMLElement {
  connectedCallback() {
    if (this.controller) return;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.products = JSON.parse(this.querySelector('[data-studio-products]')?.textContent || '[]');
    this.copy = JSON.parse(this.querySelector('[data-studio-copy]')?.textContent || '{}');
    this.picker = this.querySelector('[data-studio-select]');
    this.addButton = this.querySelector('[data-studio-add]');
    this.status = this.querySelector('[data-studio-status]');
    this.selectionVersion = 0;
    this.quoteVersion = 0;
    this.querySelector('[data-studio-controls]')?.removeAttribute('hidden');
    this.querySelector('[data-studio-selector]')?.removeAttribute('hidden');
    this.picker?.addEventListener('change', () => this.selectProduct(this.picker.value, true), { signal: this.signal });
    this.addButton?.addEventListener('click', () => this.addVial(), { signal: this.signal });
    this.addEventListener('click', event => {
      const button = event.target.closest('[data-studio-action]');
      if (!button || !this.model) return;
      const state = this.model.action(button.dataset.studioAction);
      this.querySelector('[data-studio-action="open"]')?.setAttribute('aria-pressed', String(state.open));
      if (button.dataset.studioAction === 'open' || button.dataset.studioAction === 'reset') {
        this.querySelector('[data-studio-action="open"]').textContent = state.open ? this.copy.close : this.copy.open;
      }
    }, { signal: this.signal });
    this.addEventListener('vial-studio:render-error', () => this.showFallback(), { signal: this.signal });
    document.addEventListener('basenote:cart-updated', () => this.refreshPrice(), { signal: this.signal });
    window.addEventListener('basenote:commerce-ready', () => this.refreshPrice(), { signal: this.signal });
    this.selectProduct(this.picker?.value || this.products[0]?.variantId);
    this.observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      this.observer.disconnect();
      this.loadModel();
    }, { rootMargin: '180px' });
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.controller?.abort();
    this.observer?.disconnect();
    this.model?.dispose();
    this.model = null;
    this.loading = false;
    this.dataset.ready = 'false';
    this.controller = null;
  }

  async loadModel() {
    if (this.loading || this.model || !this.product) return;
    this.loading = true;
    try {
      const { createVialStudio } = await import(this.dataset.rendererUrl);
      if (!this.isConnected) return;
      this.model = createVialStudio(this, this.product);
      this.dataset.ready = 'true';
      this.querySelector('[data-studio-canvas]').setAttribute('tabindex', '0');
      for (const control of this.querySelectorAll('[data-studio-action]')) control.disabled = false;
      this.querySelector('[data-studio-hint]').textContent = this.copy.drag;
      this.dispatchEvent(new CustomEvent('vial-studio:ready', { bubbles: true }));
    } catch (error) {
      this.showFallback();
    } finally { this.loading = false; }
  }

  showFallback() {
    this.dataset.ready = 'false';
    this.querySelector('[data-studio-canvas]').setAttribute('tabindex', '-1');
    this.querySelector('[data-studio-hint]').textContent = this.copy.fallback;
    this.querySelector('[data-studio-controls]')?.setAttribute('hidden', '');
    this.model?.dispose();
    this.model = null;
  }

  selectProduct(variantId, announce = false) {
    const product = this.products.find(item => String(item.variantId) === String(variantId)) || this.products[0];
    if (!product) return;
    this.product = product;
    this.selectionVersion += 1;
    this.dataset.productId = product.id;
    this.dataset.variantId = product.variantId;
    this.dataset.productHandle = product.handle;
    this.dataset.productTitle = product.title;
    this.dataset.price = product.price;
    this.querySelector('[data-studio-product-name]').textContent = product.title;
    this.querySelector('[data-studio-details]').href = product.url;
    this.querySelector('[data-studio-price]').textContent = this.money(product.price);
    this.addButton.disabled = !product.available;
    this.addButton.textContent = product.available ? `${this.copy.add} — ${this.money(product.price)}` : this.copy.soldOut;
    this.querySelector('[data-studio-canvas]').setAttribute('aria-label', `${product.title}. ${this.copy.canvas}`);
    this.model?.update(product);
    if (announce) this.status.textContent = `${product.title} · ${this.money(product.price)}`;
    this.querySelector('[data-studio-cart-link]')?.setAttribute('hidden', '');
    this.dispatchEvent(new CustomEvent('vial-studio:selection', { detail: { product, variantId: product.variantId, price: product.price, url: product.url }, bubbles: true }));
    this.refreshPrice();
  }

  money(cents) {
    return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: this.dataset.currency || 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  }

  async refreshPrice() {
    if (!this.product || !window.BaseNoteCommerce?.quoteVial) return;
    const version = this.selectionVersion;
    const quoteVersion = ++this.quoteVersion;
    try {
      const quote = await window.BaseNoteCommerce.quoteVial({ variantId: this.product.variantId, handle: this.product.handle, quantity: 1 });
      if (version !== this.selectionVersion || quoteVersion !== this.quoteVersion) return;
      this.dataset.price = quote.unitPrice;
      this.querySelector('[data-studio-price]').textContent = this.money(quote.unitPrice);
      this.querySelector('[data-studio-price-note]').textContent = quote.additional ? this.copy.additional : this.copy.onetime;
      if (!this.adding) this.addButton.textContent = this.product.available ? `${this.copy.add} — ${this.money(quote.unitPrice)}` : this.copy.soldOut;
    } catch (error) { /* Server-rendered SKU price remains the trustworthy fallback. */ }
  }

  async addVial() {
    if (this.adding || !this.product?.available) return;
    if (!window.BaseNoteCommerce?.addVial) {
      window.location.assign(this.product.url);
      return;
    }
    const product = this.product;
    this.adding = true;
    this.addButton.disabled = true;
    this.picker.disabled = true;
    this.addButton.textContent = this.copy.adding;
    try {
      await window.BaseNoteCommerce.addVial({ variantId: product.variantId, handle: product.handle, title: product.title, quantity: 1, source: 'Homepage scent studio' });
      this.status.textContent = `${product.title} ${this.copy.added}`;
      this.querySelector('[data-studio-cart-link]').removeAttribute('hidden');
    } catch (error) { this.status.textContent = error.message || this.copy.error; }
    finally {
      this.adding = false;
      this.picker.disabled = false;
      this.addButton.disabled = !this.product.available;
      this.addButton.textContent = `${this.copy.add} — ${this.money(Number(this.dataset.price))}`;
      this.refreshPrice();
    }
  }
}

if (!customElements.get('vial-studio')) customElements.define('vial-studio', VialStudio);
