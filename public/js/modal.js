/* ══════════════════════════════════════════════════════════════════════════
   Modal sederhana berbasis atribut:
     <button data-modal-open="modal-id">  -> buka
     <button data-modal-close>            -> tutup modal terdekat
     [data-modal-backdrop]                -> klik backdrop menutup
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  let lastFocused = null;

  const open = (id) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const focusable = modal.querySelector('input, select, textarea, button');
    focusable?.focus({ preventScroll: true });
  };

  const close = (modal) => {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    lastFocused?.focus?.({ preventScroll: true });
  };

  const closeAll = () => {
    document.querySelectorAll('.modal:not([hidden])').forEach(close);
  };

  const init = () => {
    document.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-modal-open]');
      if (opener) {
        event.preventDefault();
        open(opener.getAttribute('data-modal-open'));
        return;
      }

      const closer = event.target.closest('[data-modal-close]');
      if (closer) {
        event.preventDefault();
        close(closer.closest('.modal'));
        return;
      }

      // klik area backdrop (bukan dialog)
      if (event.target.classList?.contains('modal')) {
        close(event.target);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAll();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MalawaliModal = { open, close: closeAll };
})();
