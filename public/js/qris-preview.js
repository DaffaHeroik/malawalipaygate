/* ══════════════════════════════════════════════════════════════════════════
   Preview nominal (halaman QRIS).

   Rumus harus sama persis dengan src/lib/money.js:
     feeAmount = round(baseAmount * feePercent / 100)
     payAmount = baseAmount + feeAmount + uniqueCode

   Field dideteksi otomatis dari form, jadi satu script bisa dipakai di form
   pengaturan maupun form buat order:
     nominal   : [data-preview-amount] atau [name="base_amount"]
     fee %     : [data-preview-fee]    atau [name="fee_percent"]
     digit     : radio [name="unique_digits"] terpilih, atau [data-preview-digit]
     mode      : radio [name$="mode"] terpilih, atau [data-preview-mode]
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const rupiah = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
  const digitsOnly = (value) => Number(String(value ?? '').replace(/[^\d]/g, '')) || 0;

  const first = (root, selectors) => {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  };

  const readNumber = (element) => (element ? digitsOnly(element.value) : 0);

  const readRadioValue = (root, name) => {
    const checked = root.querySelector(`input[type="radio"][name="${name}"]:checked`);
    if (checked) return checked.value;
    const hidden = root.querySelector(`input[type="hidden"][name="${name}"]`);
    return hidden ? hidden.value : null;
  };

  const initForm = (form) => {
    const out = (field) => form.querySelector(`[data-preview-out="${field}"]`);

    const amountEl = first(form, ['[data-preview-amount]', '[name="base_amount"]']);
    const feeEl = first(form, ['[data-preview-fee]', '[name="fee_percent"]']);

    const render = () => {
      const base = readNumber(amountEl);
      const feePercent = Number(feeEl?.value) || 0;

      const mode = readRadioValue(form, 'shopee_mode') || readRadioValue(form, 'mode') || 'hybrid';
      const digits = Number(readRadioValue(form, 'unique_digits'))
        || Number(form.querySelector('[data-preview-digit]')?.value)
        || 2;

      let feeAmount = 0;
      let uniqueCode = 0;
      let note;

      if (mode === 'fee') {
        feeAmount = Math.round((base * feePercent) / 100);
        note = `Fee ${feePercent}% aktif. Kode unik tidak dipakai.`;
      } else if (mode === 'unique') {
        const min = 10 ** (digits - 1);
        const max = 10 ** digits - 1;
        uniqueCode = Math.floor(Math.random() * (max - min + 1)) + min;
        note = `Kode unik ${digits} digit dipakai untuk pencocokan pembayaran.`;
      } else {
        note = 'Mode Hybrid aktif. Preview memakai nominal normal. Jika nominal ini sedang dipakai order PENDING, server otomatis memilih tambahan minimum +1/+2/+3... saat QR dibuat.';
      }

      const total = base + feeAmount + uniqueCode;

      const set = (field, value) => {
        const node = out(field);
        if (node) node.textContent = value;
      };

      set('base', rupiah(base));
      set('fee', `${rupiah(feeAmount)}${mode === 'fee' && feePercent ? ` (${feePercent}%)` : ''}`);
      set('code', uniqueCode
        ? `${uniqueCode}${mode === 'unique' ? ' (random)' : ' (penyesuaian)'}`
        : `0 · ${mode === 'hybrid' ? 'Hybrid' : 'Nonaktif'}`);
      set('total', rupiah(total));
      set('pay', rupiah(total));

      const noteEl = out('note');
      if (noteEl) noteEl.textContent = note;
    };

    form.addEventListener('input', render);
    form.addEventListener('change', render);
    render();
  };

  const init = () => {
    document.querySelectorAll('[data-qris-preview]').forEach(initForm);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
