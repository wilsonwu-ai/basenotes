/**
 * Base Note Theme JavaScript
 * Premium Fragrance Subscription
 */

(function() {
  'use strict';

  // DOM Ready
  document.addEventListener('DOMContentLoaded', function() {
    initHeader();
    initMobileNav();
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
   * Quick add to cart
   */
  function initQuickAdd() {
    document.querySelectorAll('[data-quick-add]').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const variantId = this.dataset.quickAdd;
        if (!variantId) return;

        const sellingPlan = this.dataset.sellingPlan;

        this.classList.add('loading');
        this.textContent = 'Adding...';

        addToCart(variantId, 1, sellingPlan)
          .then(() => {
            this.textContent = 'Added!';
            setTimeout(() => {
              this.classList.remove('loading');
              this.textContent = 'Quick Subscribe — $20/mo';
            }, 1500);

            // Refresh and open cart drawer with updated content
            if (window.refreshAndOpenCartDrawer) {
              window.refreshAndOpenCartDrawer();
            }
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
   * Wishlist / Rotation Queue functionality
   * Serves dual purpose: wishlist for browsing + rotation queue for subscription
   */
  function initWishlist() {
    const wishlistKey = 'basenotes_wishlist';
    const queueKey = 'basenotes_queue';

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

    function getQueue() {
      try {
        return JSON.parse(localStorage.getItem(queueKey)) || [];
      } catch {
        return [];
      }
    }

    function toggleWishlist(productId) {
      const wishlist = getWishlist();
      const index = wishlist.indexOf(productId);

      if (index > -1) {
        wishlist.splice(index, 1);
        saveWishlist(wishlist);
        return false;
      } else {
        wishlist.push(productId);
        saveWishlist(wishlist);
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
      });
    });

    // Update rotation queue count badge if exists
    const queueCountEl = document.querySelector('[data-queue-count]');
    if (queueCountEl) {
      const queue = getQueue();
      queueCountEl.textContent = queue.length;
      queueCountEl.style.display = queue.length > 0 ? 'flex' : 'none';
    }
  }

  /**
   * Add item to cart via AJAX
   */
  function addToCart(variantId, quantity, sellingPlan) {
    var payload = { id: parseInt(variantId), quantity: quantity };
    if (sellingPlan) payload.selling_plan = parseInt(sellingPlan);
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
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
          const countEl = document.querySelector('[data-cart-count]') || document.querySelector('.header__cart-count');
          if (countEl) {
            countEl.textContent = cart.item_count;
            countEl.style.display = cart.item_count > 0 ? 'flex' : 'none';
            countEl.classList.toggle('is-hidden', cart.item_count === 0);
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
      if (window.refreshCartDrawer) {
        window.refreshCartDrawer();
      }
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
