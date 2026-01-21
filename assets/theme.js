/**
 * Basenotes Theme JavaScript
 * Premium Fragrance Subscription
 */

(function() {
  'use strict';

  // DOM Ready
  document.addEventListener('DOMContentLoaded', function() {
    initHeader();
    initMobileNav();
    initCartDrawer();
    initQuickAdd();
    initWishlist();
  });

  /**
   * Header scroll behavior
   */
  function initHeader() {
    const header = document.querySelector('[data-header]');
    if (!header) return;

    let lastScroll = 0;
    const scrollThreshold = 50;

    function handleScroll() {
      const currentScroll = window.pageYOffset;

      if (currentScroll > scrollThreshold) {
        header.classList.add('is-scrolled');
      } else {
        header.classList.remove('is-scrolled');
      }

      lastScroll = currentScroll;
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check
  }

  /**
   * Mobile navigation
   */
  function initMobileNav() {
    const toggle = document.querySelector('[data-mobile-toggle]');
    const nav = document.querySelector('[data-mobile-nav]');
    const close = document.querySelector('[data-mobile-close]');
    const overlay = document.getElementById('overlay');

    if (!toggle || !nav) return;

    function openNav() {
      nav.classList.add('is-active');
      overlay?.classList.add('is-active');
      document.body.style.overflow = 'hidden';
    }

    function closeNav() {
      nav.classList.remove('is-active');
      overlay?.classList.remove('is-active');
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', openNav);
    close?.addEventListener('click', closeNav);
    overlay?.addEventListener('click', closeNav);

    // Close on escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && nav.classList.contains('is-active')) {
        closeNav();
      }
    });
  }

  /**
   * Cart drawer
   */
  function initCartDrawer() {
    const cartToggle = document.querySelector('[data-cart-toggle]');
    const cartDrawer = document.querySelector('[data-cart-drawer]');
    const cartClose = document.querySelector('[data-cart-close]');
    const overlay = document.getElementById('overlay');

    if (!cartToggle || !cartDrawer) return;

    function openCart() {
      cartDrawer.classList.add('is-active');
      overlay?.classList.add('is-active');
      document.body.style.overflow = 'hidden';
    }

    function closeCart() {
      cartDrawer.classList.remove('is-active');
      overlay?.classList.remove('is-active');
      document.body.style.overflow = '';
    }

    cartToggle.addEventListener('click', function(e) {
      e.preventDefault();
      openCart();
    });

    cartClose?.addEventListener('click', closeCart);

    overlay?.addEventListener('click', function() {
      closeCart();
      // Also close mobile nav if open
      document.querySelector('[data-mobile-nav]')?.classList.remove('is-active');
    });

    // Close on escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && cartDrawer.classList.contains('is-active')) {
        closeCart();
      }
    });

    // Remove item from cart
    document.querySelectorAll('[data-remove-item]').forEach(btn => {
      btn.addEventListener('click', function() {
        const key = this.dataset.removeItem;
        updateCartItem(key, 0);
      });
    });
  }

  /**
   * Quick add to cart
   */
  function initQuickAdd() {
    document.querySelectorAll('[data-quick-add]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const variantId = this.dataset.quickAdd;
        if (!variantId) return;

        this.classList.add('loading');
        this.textContent = 'Adding...';

        addToCart(variantId, 1)
          .then(() => {
            this.textContent = 'Added!';
            setTimeout(() => {
              this.classList.remove('loading');
              this.textContent = 'Quick Add to Queue';
            }, 1500);

            // Optionally open cart drawer
            document.querySelector('[data-cart-drawer]')?.classList.add('is-active');
            document.getElementById('overlay')?.classList.add('is-active');
          })
          .catch(err => {
            console.error('Add to cart error:', err);
            this.classList.remove('loading');
            this.textContent = 'Error - Try Again';
          });
      });
    });
  }

  /**
   * Wishlist functionality
   */
  function initWishlist() {
    const wishlistKey = 'basenotes_wishlist';

    function getWishlist() {
      try {
        return JSON.parse(localStorage.getItem(wishlistKey)) || [];
      } catch {
        return [];
      }
    }

    function saveWishlist(items) {
      localStorage.setItem(wishlistKey, JSON.stringify(items));
    }

    function toggleWishlist(productId) {
      const wishlist = getWishlist();
      const index = wishlist.indexOf(productId);

      if (index > -1) {
        wishlist.splice(index, 1);
        return false;
      } else {
        wishlist.push(productId);
        return true;
      }
    }

    // Initialize wishlist buttons
    document.querySelectorAll('[data-wishlist-toggle]').forEach(btn => {
      const card = btn.closest('[data-product-id]');
      if (!card) return;

      const productId = card.dataset.productId;
      const wishlist = getWishlist();

      if (wishlist.includes(productId)) {
        btn.classList.add('is-active');
      }

      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const isAdded = toggleWishlist(productId);
        this.classList.toggle('is-active', isAdded);
        saveWishlist(getWishlist());
      });
    });
  }

  /**
   * Add item to cart via AJAX
   */
  function addToCart(variantId, quantity) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        id: variantId,
        quantity: quantity
      })
    })
    .then(response => {
      if (!response.ok) throw new Error('Add to cart failed');
      return response.json();
    })
    .then(() => {
      // Refresh cart count in header
      return fetch('/cart.js')
        .then(res => res.json())
        .then(cart => {
          const countEl = document.querySelector('.header__cart-count');
          if (countEl) {
            countEl.textContent = cart.item_count;
            countEl.style.display = cart.item_count > 0 ? 'flex' : 'none';
          }
        });
    });
  }

  /**
   * Update cart item quantity
   */
  function updateCartItem(key, quantity) {
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        id: key,
        quantity: quantity
      })
    })
    .then(response => response.json())
    .then(() => {
      // Reload page to update cart drawer
      window.location.reload();
    });
  }

  /**
   * Smooth scroll for anchor links
   */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerHeight = document.querySelector('[data-header]')?.offsetHeight || 0;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

})();
