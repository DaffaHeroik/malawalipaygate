/* ══════════════════════════════════════════════════════════════════════════
   Shell: drawer sidebar mobile.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const init = () => {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('app-overlay');
    const burger = document.querySelector('[data-sidebar-open]');
    const closers = document.querySelectorAll('[data-sidebar-close]');

    if (!sidebar || !burger) return;

    const open = () => {
      sidebar.classList.add('is-open');
      overlay?.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      const first = sidebar.querySelector('a, button');
      first?.focus({ preventScroll: true });
    };

    const close = () => {
      sidebar.classList.remove('is-open');
      overlay?.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };

    burger.addEventListener('click', () => {
      sidebar.classList.contains('is-open') ? close() : open();
    });

    closers.forEach((el) => el.addEventListener('click', close));
    overlay?.addEventListener('click', close);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('is-open')) close();
    });

    // klik link navigasi -> tutup drawer
    sidebar.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));

    // kalau layar dibesarkan, pastikan state bersih
    window.matchMedia?.('(min-width: 901px)').addEventListener?.('change', (event) => {
      if (event.matches) close();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
