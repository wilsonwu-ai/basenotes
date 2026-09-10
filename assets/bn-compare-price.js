(function initBaseNoteComparePrice(globalScope) {
  'use strict';

  const dialog = document.getElementById('BaseNoteComparePriceDialog');
  if (!dialog || dialog.dataset.compareDialogReady === 'true') return;
  dialog.dataset.compareDialogReady = 'true';

  const controller = new AbortController();
  const signal = controller.signal;
  const product = dialog.querySelector('[data-compare-dialog-product]');
  const exactRetail = dialog.querySelector('[data-compare-dialog-exact]');
  const variableRetail = dialog.querySelector('[data-compare-dialog-variable]');
  const retailValue = dialog.querySelector('[data-compare-dialog-retail]');
  const priceValue = dialog.querySelector('[data-compare-dialog-price]');
  const closeButton = dialog.querySelector('[data-compare-dialog-close]');
  let returnFocus = null;

  function focusableElements() {
    return Array.from(dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden && element.getClientRects().length > 0);
  }

  function closeDialog() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function openDialog(trigger) {
    returnFocus = trigger;
    product.textContent = trigger.dataset.compareProduct || 'This fragrance';
    priceValue.textContent = trigger.dataset.comparePriceValue || 'the current subscriber price';

    const hasExactRetail = trigger.dataset.compareRetailMode === 'exact'
      && Boolean(trigger.dataset.compareRetailValue);
    exactRetail.hidden = !hasExactRetail;
    variableRetail.hidden = hasExactRetail;
    retailValue.textContent = hasExactRetail ? trigger.dataset.compareRetailValue : '';

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    window.requestAnimationFrame(() => closeButton.focus());
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-compare-price]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    openDialog(trigger);
  }, { signal });

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-compare-dialog-close]') || event.target === dialog) {
      closeDialog();
    }
  }, { signal });

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  }, { signal });

  dialog.addEventListener('close', () => {
    const target = returnFocus;
    returnFocus = null;
    if (target && target.isConnected) target.focus();
  }, { signal });

  document.addEventListener('keydown', (event) => {
    if (!dialog.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, { signal });

  function destroy() {
    closeDialog();
    controller.abort();
    delete dialog.dataset.compareDialogReady;
  }

  window.addEventListener('pagehide', destroy, { once: true, signal });
  globalScope.BaseNoteComparePrice = { close: closeDialog, destroy, open: openDialog };
})(window);
