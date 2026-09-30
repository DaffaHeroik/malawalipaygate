/* ══════════════════════════════════════════════════════════════════════════
   Tombol salin: <button data-copy-value="teks"> atau data-copy-target="#id".
   Menampilkan toast sebagai umpan balik.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const writeClipboard = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fallback di bawah */ }

    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (_) {
      return false;
    }
  };

  const resolveText = (btn) => {
    const direct = btn.getAttribute('data-copy-value');
    if (direct !== null) return direct;

    const target = btn.getAttribute('data-copy-target');
    if (target) {
      const el = document.querySelector(target);
      if (el) return (el.value ?? el.textContent ?? '').trim();
    }

    const scope = btn.closest('.copy-field, .code, [data-copy-scope]');
    const code = scope?.querySelector('code, pre:not([hidden])');
    return (code?.textContent ?? '').trim();
  };

  const init = () => {
    document.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-copy-value], [data-copy-target], .code__copy');
      if (!btn) return;
      event.preventDefault();

      const text = resolveText(btn);
      if (!text) return;

      const ok = await writeClipboard(text);
      window.MalawaliToast?.(ok ? 'Disalin ke clipboard.' : 'Gagal menyalin.', ok ? 'success' : 'danger');

      if (ok) {
        btn.classList.add('is-copied');
        window.setTimeout(() => btn.classList.remove('is-copied'), 1200);
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
