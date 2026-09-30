/* ══════════════════════════════════════════════════════════════════════════
   Toast: window.MalawaliToast('pesan', 'success'|'danger'|'warn'|'info')
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ICONS = {
    success: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    danger: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 15.6h.01"/>',
    warn: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 9.5v4.5M12 16.8h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8.2h.01"/>',
  };

  const stack = () =>
    document.getElementById('toast-stack') ||
    (() => {
      const el = document.createElement('div');
      el.className = 'toast-stack';
      el.id = 'toast-stack';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      return el;
    })();

  const show = (message, type = 'info', timeout = 3200) => {
    if (!message) return;
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[type] || ICONS.info}</svg><div class="toast__body"></div>`;
    el.querySelector('.toast__body').textContent = message;

    stack().appendChild(el);

    window.setTimeout(() => {
      el.style.transition = 'opacity 160ms ease, transform 160ms ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(12px)';
      window.setTimeout(() => el.remove(), 180);
    }, timeout);
  };

  window.MalawaliToast = show;

  // tampilkan flash yang dikirim server lewat <div data-flash>
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-flash]').forEach((el) => {
      show(el.dataset.flash, el.dataset.flashType || 'info');
      el.remove();
    });
  });
})();
