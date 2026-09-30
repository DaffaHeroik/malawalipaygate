/* ══════════════════════════════════════════════════════════════════════════
   Grafik garis SVG tanpa library eksternal.

   <div class="chart" data-chart="chart-1"></div>
   <script type="application/json" id="chart-1">
     {
       "labels": ["14 Sep", "15 Sep", ...],
       "series": [
         { "key": "total", "label": "Total Order", "color": "#174d9b", "values": [0,3,1] },
         { "key": "paid",  "label": "Paid",        "color": "#12784a", "values": [0,1,0] }
       ]
     }
   </script>
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const W = 760;
  const H = 230;
  const PAD = { top: 18, right: 14, bottom: 30, left: 40 };
  const NS = 'http://www.w3.org/2000/svg';

  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    });
    return node;
  };

  const niceMax = (value) => {
    if (value <= 0) return 4;
    const pow = 10 ** Math.floor(Math.log10(value));
    const norm = value / pow;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * pow;
  };

  const build = (container, data) => {
    const labels = data.labels || [];
    const series = (data.series || []).filter((s) => Array.isArray(s.values));
    if (!labels.length || !series.length) return;

    const maxRaw = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
    const max = niceMax(maxRaw);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;

    const x = (i) => PAD.left + i * stepX;
    const y = (v) => PAD.top + innerH - ((Number(v) || 0) / max) * innerH;

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': data.ariaLabel || 'Grafik performa order',
      preserveAspectRatio: 'xMidYMid meet',
    });

    // grid + label sumbu Y
    const ticks = 4;
    for (let t = 0; t <= ticks; t += 1) {
      const value = (max / ticks) * t;
      const yy = y(value);
      svg.appendChild(el('line', {
        x1: PAD.left, x2: W - PAD.right, y1: yy, y2: yy,
        stroke: 'currentColor', 'stroke-opacity': t === 0 ? 0.22 : 0.1, 'stroke-width': 1,
      }));
      const text = el('text', {
        x: PAD.left - 8, y: yy + 3.5, 'text-anchor': 'end',
        'font-size': '10', fill: 'currentColor', 'fill-opacity': 0.55,
        'font-family': 'Inter, sans-serif',
      });
      text.textContent = String(Math.round(value));
      svg.appendChild(text);
    }

    // label sumbu X (dibatasi biar nggak penuh)
    const labelEvery = labels.length > 10 ? 2 : 1;
    labels.forEach((label, i) => {
      if (i % labelEvery !== 0 && i !== labels.length - 1) return;
      const text = el('text', {
        x: x(i), y: H - 10, 'text-anchor': 'middle',
        'font-size': '10', fill: 'currentColor', 'fill-opacity': 0.55,
        'font-family': 'Inter, sans-serif',
      });
      text.textContent = label;
      svg.appendChild(text);
    });

    // seri
    series.forEach((s) => {
      const color = s.color || '#174d9b';
      const points = s.values.map((v, i) => [x(i), y(v)]);

      if (s.area !== false && series.length === 1) {
        const areaD = [
          `M ${points[0][0]} ${PAD.top + innerH}`,
          ...points.map(([px, py]) => `L ${px} ${py}`),
          `L ${points[points.length - 1][0]} ${PAD.top + innerH}`,
          'Z',
        ].join(' ');
        svg.appendChild(el('path', { d: areaD, fill: color, 'fill-opacity': 0.1, stroke: 'none' }));
      }

      svg.appendChild(el('path', {
        d: points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${px} ${py}`).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }));

      points.forEach(([px, py], i) => {
        const dot = el('circle', {
          cx: px, cy: py, r: 3,
          fill: color,
          stroke: 'var(--bg-card)',
          'stroke-width': 1.6,
        });
        const title = el('title');
        title.textContent = `${labels[i]} — ${s.label}: ${s.values[i]}`;
        dot.appendChild(title);
        svg.appendChild(dot);
      });
    });

    // legend
    const legend = document.createElement('div');
    legend.className = 'chart__legend';
    series.forEach((s) => {
      const item = document.createElement('span');
      item.className = 'chart__legend-item';
      item.innerHTML = `<i style="background:${s.color}"></i><span>${s.label}</span>`;
      legend.appendChild(item);
    });

    container.innerHTML = '';
    container.appendChild(svg);
    container.appendChild(legend);
  };

  const init = () => {
    document.querySelectorAll('[data-chart]').forEach((container) => {
      const id = container.dataset.chart;
      const source = document.getElementById(id);
      if (!source) return;
      try {
        build(container, JSON.parse(source.textContent));
      } catch (error) {
        container.innerHTML = '<p class="dim text-sm">Grafik tidak dapat ditampilkan.</p>';
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
