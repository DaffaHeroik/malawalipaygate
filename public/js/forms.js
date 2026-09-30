/* ══════════════════════════════════════════════════════════════════════════
   Bantuan form:
   - tampil/sembunyikan password  : [data-toggle-password] dengan target #id
   - indikator kekuatan password  : [data-password-strength="#inputId"]
   - kecocokan konfirmasi         : [data-password-match="#a" data-target="#b"]
   - cegah submit ganda           : [data-submit-once]
   - isi otomatis nilai salin     : [data-fill-target="#id"][data-fill-value="..."]
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ISSUES = (value) => {
    const list = [];
    if (value.length < 8) list.push('Minimal 8 karakter.');
    if (!/[A-Za-z]/.test(value)) list.push('Harus memuat huruf.');
    if (!/\d/.test(value)) list.push('Harus memuat angka.');
    return list;
  };

  const init = () => {
    /* Tampil / sembunyikan password */
    document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.querySelector(btn.dataset.togglePassword);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
        btn.dataset.state = show ? 'shown' : 'hidden';
      });
    });

    /* Kekuatan password */
    document.querySelectorAll('[data-password-strength]').forEach((meter) => {
      const input = document.querySelector(meter.dataset.passwordStrength);
      if (!input) return;
      const bar = meter.querySelector('.progress__bar');
      const hint = meter.parentElement?.querySelector('[data-password-hint]');

      const update = () => {
        const value = input.value || '';
        const issues = ISSUES(value);
        const score = value.length === 0 ? 0 : Math.max(0, 4 - issues.length);
        if (bar) {
          bar.style.width = `${(score / 4) * 100}%`;
          bar.style.background = score >= 4 ? 'var(--success)' : score >= 2 ? 'var(--warn)' : 'var(--danger)';
        }
        if (hint) {
          hint.textContent = value.length === 0
            ? 'Minimal 8 karakter, memuat huruf dan angka.'
            : issues.join(' ');
          hint.style.color = issues.length ? 'var(--danger)' : 'var(--success)';
        }
      };

      input.addEventListener('input', update);
      update();
    });

    /* Konfirmasi password */
    document.querySelectorAll('[data-password-match]').forEach((input) => {
      const source = document.querySelector(input.dataset.passwordMatch);
      const target = input.dataset.target ? document.querySelector(input.dataset.target) : input;
      if (!source) return;

      const update = () => {
        const ok = !input.value || input.value === source.value;
        input.classList.toggle('input--error', !ok);
        if (target) {
          target.textContent = ok || !input.value ? '' : 'Konfirmasi password tidak sama.';
        }
      };

      input.addEventListener('input', update);
      source.addEventListener('input', update);
    });

    /* Cegah submit ganda */
    document.querySelectorAll('form[data-submit-once]').forEach((form) => {
      form.addEventListener('submit', () => {
        const btn = form.querySelector('button[type="submit"]');
        if (!btn) return;
        btn.disabled = true;
        const label = btn.dataset.loadingLabel || 'Memproses...';
        btn.dataset.originalText = btn.textContent;
        btn.textContent = label;
      });
    });

    /* Isi field dari tombol */
    document.querySelectorAll('[data-fill-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.querySelector(btn.dataset.fillTarget);
        if (!input) return;
        input.value = btn.dataset.fillValue || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
    });

    /* Konfirmasi aksi destruktif */
    document.querySelectorAll('[data-confirm]').forEach((el) => {
      el.addEventListener('click', (event) => {
        if (window.confirm(el.dataset.confirm)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
