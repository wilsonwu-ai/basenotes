/* One shared cart API owns all writes, including $20 → $18 add-on handling. */
(() => {
  const bottleField = document.querySelector('#FullBottleContact input[name="contact[Fragrance]"]');
  const requestedFragrance = new URLSearchParams(location.search).get('fragrance');
  if (bottleField && requestedFragrance && !bottleField.value) bottleField.value = requestedFragrance.slice(0,160);
  class CartFeedback extends HTMLElement {
    connectedCallback() {
      if (this.controller) return;
      this.controller = new AbortController();
      this.panel = this.querySelector('[data-cart-feedback-panel]');
      this.announcement = this.querySelector('[data-cart-feedback-announcement]');
      this.querySelector('[data-cart-feedback-close]')?.addEventListener('click', () => this.close(), { signal: this.controller.signal });
      this.panel?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      }, { signal: this.controller.signal });
    }
    disconnectedCallback() { this.controller?.abort(); this.controller = null; this.announcementRevision++; }
    show({ title, quantity = 1, error = false, message = '', trigger }) {
      if (!this.panel) return;
      this.trigger = trigger;
      this.querySelector('[data-cart-feedback-heading]').textContent = error ? this.dataset.error : this.dataset.added;
      this.querySelector('[data-cart-feedback-message]').textContent = error ? message || this.dataset.fallbackError : title;
      const quantityText = this.dataset.quantity.replace('__quantity__', String(quantity));
      const quantityNode = this.querySelector('[data-cart-feedback-quantity]');
      quantityNode.textContent = error ? '' : quantityText;
      quantityNode.hidden = error;
      this.querySelector('[data-cart-feedback-icon]').textContent = error ? '!' : '✓';
      this.panel.dataset.state = error ? 'error' : 'success';
      this.panel.hidden = false;
      this.panel.dataset.open = '';
      if (typeof this.panel.showPopover === 'function' && !this.panel.matches(':popover-open')) this.panel.showPopover();
      const revision = this.announcementRevision = (this.announcementRevision || 0) + 1;
      this.announcement.textContent = '';
      requestAnimationFrame(() => {
        if (revision !== this.announcementRevision) return;
        this.announcement.textContent = error ? `${this.dataset.error}. ${message || this.dataset.fallbackError}` : this.dataset.announcement.replace('__fragrance__', title).replace('__quantity__', String(quantity));
      });
    }
    close() {
      const focusWasInside = this.panel.contains(document.activeElement);
      this.announcementRevision = (this.announcementRevision || 0) + 1;
      if (typeof this.panel.hidePopover === 'function' && this.panel.matches(':popover-open')) this.panel.hidePopover();
      this.panel.hidden = true;
      delete this.panel.dataset.open;
      this.announcement.textContent = '';
      if (focusWasInside && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
    }
  }
  if (!customElements.get('cart-feedback')) customElements.define('cart-feedback', CartFeedback);
  if (customElements.get('scent-catalog')) return;
  class ScentCatalog extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      this.cards = [...this.querySelectorAll('[data-scent-card]')];
      this.status = this.querySelector('[data-scent-status]');
      this.feedback = document.querySelector('cart-feedback');
      if (this.feedback && this.status) this.status.setAttribute('aria-live', 'off');
      this.gender = 'all';
      this.search = this.querySelector('[data-scent-search]');
      this.search?.addEventListener('input', () => this.filter());
      this.querySelectorAll('[data-gender-filter]').forEach(button => button.addEventListener('click', () => {
        this.gender = button.dataset.genderFilter;
        this.filter();
      }));
      this.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
        this.gender = 'all';
        if (this.search) this.search.value = '';
        this.filter();
      });
      this.addEventListener('submit', event => this.add(event));
      this.refresh = () => this.refreshPrices();
      document.addEventListener('basenote:cart-updated', this.refresh);
      window.addEventListener('basenote:commerce-ready', this.refresh);
      this.filter();
      this.refreshPrices();
    }
    disconnectedCallback() {
      document.removeEventListener('basenote:cart-updated', this.refresh);
      window.removeEventListener('basenote:commerce-ready', this.refresh);
      this.initialized = false;
    }
    filter() {
      const term = (this.search?.value || '').trim().toLocaleLowerCase();
      let count = 0;
      this.cards.forEach(card => {
        // Unisex is compatible with either preference, without inventing classifications.
        const genderMatches = this.gender === 'all' || card.dataset.gender === this.gender || (this.gender !== 'unisex' && card.dataset.gender === 'unisex');
        const nameMatches = `${card.dataset.name} ${card.dataset.tags}`.toLocaleLowerCase().includes(term);
        card.hidden = !(genderMatches && nameMatches);
        if (!card.hidden) count++;
      });
      this.querySelectorAll('[data-gender-filter]').forEach(button => {
        const active = button.dataset.genderFilter === this.gender;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-active', active);
      });
      const counter = this.querySelector('[data-scent-count]');
      if (counter) counter.textContent = `${count} fragrance${count === 1 ? '' : 's'}`;
      const empty = this.querySelector('[data-scent-empty]');
      if (empty) empty.hidden = count > 0;
    }
    async refreshPrices() {
      if (!window.BaseNoteCommerce) return;
      const revision = this.priceRevision = (this.priceRevision || 0) + 1;
      const forms = [...this.querySelectorAll('[data-scent-add]')];
      try {
        const cart = await window.BaseNoteCommerce.getCart();
        const quoteForm = forms.find(form => Number(form.dataset.price) === 2000);
        // All eligible 5ml $20 cards share the same verified cart-wide quote.
        // Avoid fetching 32 product endpoints simply to paint identical prices.
        const quote = cart.item_count && quoteForm ? await window.BaseNoteCommerce.quoteVial({variantId: quoteForm.dataset.variantId, handle: quoteForm.dataset.handle, quantity: 1}) : null;
        if (revision !== this.priceRevision) return;
        const formatter = new Intl.NumberFormat(document.documentElement.lang || 'en-US', {style:'currency', currency:cart.currency || 'USD', minimumFractionDigits:0, maximumFractionDigits:2});
        forms.forEach(form => {
          const price = form.querySelector('[data-scent-price]');
          const regular = Number(form.dataset.price);
          if (price) price.textContent = formatter.format((regular === 2000 && quote ? quote.unitPrice : regular) / 100);
        });
      } catch (_) { /* Retain Shopify's rendered prices; an add is re-verified by the API. */ }
    }
    async add(event) {
      const form = event.target.closest('[data-scent-add]');
      if (!form || !this.contains(form)) return;
      // Keep native Shopify forms functional without JavaScript, but never submit a
      // second request when an enhanced add fails or the commerce library is late.
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled || this.pending) return;
      if (!window.BaseNoteCommerce) {
        const message = this.feedback?.dataset.loading || 'The cart is still loading. Please try again in a moment.';
        if (this.status) this.status.textContent = message;
        this.feedback?.show({ error: true, message, trigger: button });
        return;
      }
      this.pending = true;
      const controls = [...this.querySelectorAll('[data-scent-add] button')].map(control => [control, control.disabled]);
      for (const [control] of controls) control.disabled = true;
      const originalLabel = [...button.childNodes];
      button.replaceChildren(document.createTextNode(this.feedback?.dataset.adding || 'Adding…'));
      button.setAttribute('aria-busy', 'true');
      form.setAttribute('aria-busy', 'true');
      if (this.status) this.status.textContent = `Adding ${form.dataset.title}…`;
      try {
        await window.BaseNoteCommerce.addVial({variantId: form.dataset.variantId, handle: form.dataset.handle, title: form.dataset.title, quantity: 1, source: this.dataset.source || 'Fragrance collection'});
        this.feedback?.show({ title: form.dataset.title, quantity: 1, trigger: button });
        if (this.status) {
          this.status.textContent = `${form.dataset.title} added to your cart.`;
          const link = document.createElement('a');
          link.href = `${window.Shopify?.routes?.root || '/'}cart`;
          link.textContent = 'View cart →';
          this.status.append(link);
        }
      } catch (error) {
        const message = error.message || this.feedback?.dataset.fallbackError || 'We could not confirm the add. Check your cart before trying again.';
        if (this.status) this.status.textContent = message;
        this.feedback?.show({ error: true, message, trigger: button });
      } finally {
        button.replaceChildren(...originalLabel);
        for (const [control, wasDisabled] of controls) control.disabled = wasDisabled;
        button.removeAttribute('aria-busy');
        form.removeAttribute('aria-busy');
        this.pending = false;
        this.refreshPrices();
      }
    }
  }
  customElements.define('scent-catalog', ScentCatalog);
})();
