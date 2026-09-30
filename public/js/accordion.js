/* ══════════════════════════════════════════════════════════════════════════
   Accordion: <div class="accordion" data-accordion>
                 <div class="accordion__item">
                   <button class="accordion__trigger">...<svg/></button>
                   <div class="accordion__panel">...</div>
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const init = () => {
    document.querySelectorAll('[data-accordion]').forEach((root) => {
      const single = root.dataset.accordion === 'single';

      root.querySelectorAll('.accordion__trigger').forEach((trigger) => {
        const item = trigger.closest('.accordion__item');
        const panel = item?.querySelector('.accordion__panel');
        if (!item || !panel) return;

        const startOpen = item.classList.contains('is-open');
        panel.hidden = !startOpen;
        trigger.setAttribute('aria-expanded', String(startOpen));

        trigger.addEventListener('click', () => {
          const willOpen = panel.hidden;

          if (single && willOpen) {
            root.querySelectorAll('.accordion__item').forEach((other) => {
              if (other === item) return;
              other.classList.remove('is-open');
              const otherPanel = other.querySelector('.accordion__panel');
              if (otherPanel) otherPanel.hidden = true;
              other.querySelector('.accordion__trigger')?.setAttribute('aria-expanded', 'false');
            });
          }

          item.classList.toggle('is-open', willOpen);
          panel.hidden = !willOpen;
          trigger.setAttribute('aria-expanded', String(willOpen));
        });
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
