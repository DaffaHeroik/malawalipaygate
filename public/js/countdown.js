/* ══════════════════════════════════════════════════════════════════════════
   Countdown masa aktif order.
   <span data-countdown="2026-09-27T10:10:00.000Z" data-countdown-target="el-id">
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  const init = () => {
    const nodes = [...document.querySelectorAll('[data-countdown]')];
    if (!nodes.length) return;

    const tick = () => {
      const now = Date.now();

      nodes.forEach((node) => {
        const end = new Date(node.dataset.countdown).getTime();
        if (!Number.isFinite(end)) return;

        const diff = end - now;
        const alive = diff > 0;
        const total = Math.max(0, Math.floor(diff / 1000));
        const text = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

        node.textContent = alive ? text : (node.dataset.expiredText || 'EXPIRED');
        node.classList.toggle('is-expired', !alive);

        if (!alive) {
          const card = node.closest('[data-countdown-scope]');
          card?.classList.add('is-expired');
        }
      });
    };

    tick();
    window.setInterval(tick, 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
