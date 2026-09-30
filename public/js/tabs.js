/* ══════════════════════════════════════════════════════════════════════════
   Tabs. Dua mode:
   1) Panel konten:  <div data-tabs><button data-tab="x">...<div data-tab-panel="x">
   2) Block kode:    <div data-code><button data-tab="x">...<pre data-tab-panel="x">
   Sinkronisasi opsional antar grup lewat data-tab-group.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const activate = (root, value, sync = true) => {
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      const isActive = btn.dataset.tab === value;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    root.querySelectorAll('[data-tab-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== value;
    });

    const group = root.dataset.tabGroup;
    if (sync && group) {
      document.querySelectorAll(`[data-tab-group="${group}"]`).forEach((other) => {
        if (other !== root) activate(other, value, false);
      });
      try {
        localStorage.setItem(`malawali.tab.${group}`, value);
      } catch (_) { /* ignore */ }
    }
  };

  const init = () => {
    document.querySelectorAll('[data-tabs], [data-code]').forEach((root) => {
      const buttons = [...root.querySelectorAll('[data-tab]')];
      if (!buttons.length) return;

      const group = root.dataset.tabGroup;
      let initial = root.dataset.tabDefault || buttons[0].dataset.tab;

      if (group) {
        try {
          const saved = localStorage.getItem(`malawali.tab.${group}`);
          if (saved && buttons.some((b) => b.dataset.tab === saved)) initial = saved;
        } catch (_) { /* ignore */ }
      }

      buttons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          activate(root, btn.dataset.tab);
        });
      });

      activate(root, initial);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
