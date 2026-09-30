/* ══════════════════════════════════════════════════════════════════════════
   Tema terang/gelap.
   Bootstrap anti-flash-nya ada inline di partial head.ejs (biar jalan sebelum
   CSS dimuat). File ini hanya menangani interaksi tombol.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const KEY = 'malawali.theme';
  const root = document.documentElement;

  const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  const apply = (theme, animate = true) => {
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1319' : '#f8f9fa');

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const next = theme === 'dark' ? 'terang' : 'gelap';
      btn.setAttribute('aria-label', `Gunakan mode ${next}`);
      btn.setAttribute('title', `Gunakan mode ${next}`);
      btn.dataset.themeCurrent = theme;
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'dark' ? 'Mode terang' : 'Mode gelap';
    });

    if (animate) {
      root.classList.add('theme-transition');
      window.clearTimeout(apply._timer);
      apply._timer = window.setTimeout(() => root.classList.remove('theme-transition'), 320);
    }
  };

  const store = (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch (_) {
      /* storage bisa diblokir */
    }
  };

  const toggle = () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    store(next);
  };

  const init = () => {
    apply(current(), false);

    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-theme-toggle]');
      if (!btn) return;
      event.preventDefault();
      toggle();
    });

    // ikuti perubahan preferensi sistem kalau user belum memilih manual
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', (event) => {
        let saved = null;
        try {
          saved = localStorage.getItem(KEY);
        } catch (_) {
          saved = null;
        }
        if (saved === 'dark' || saved === 'light') return;
        apply(event.matches ? 'dark' : 'light');
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MalawaliTheme = { set: (t) => { apply(t); store(t); }, get: current, toggle };
})();
