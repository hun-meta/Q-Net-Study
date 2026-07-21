// 인라인 SVG 라인 차트(외부 라이브러리 없음). 추이 화면(시도/자격증)이 공유.
// 색·굵기는 인자로 받아 토큰(var(--accent) 등)을 그대로 사용한다.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  return e;
}
function text(x, y, t, attrs) {
  const e = svgEl('text', { x, y, ...attrs });
  e.textContent = String(t);
  return e;
}

// buildLineChart(opts) → <svg>
// opts: {
//   cw, ch, yMax, grid:[number], passLine:number|null,
//   xLabels:[string],
//   series:[{ values:[number], color, r?, labels?:bool }]  // 마지막 series 위에 값 라벨(labels:true)
// }
export function buildLineChart(opts) {
  const cw = opts.cw || 560;
  const ch = opts.ch || 200;
  const yMax = opts.yMax || 100;
  const grid = opts.grid || [0, 25, 50, 75, 100];
  const xLabels = opts.xLabels || [];
  const series = opts.series || [];
  const n = xLabels.length;

  const xAt = (i) => (n > 1 ? (i * cw) / (n - 1) : cw / 2);
  const yAt = (v) => ch - (Math.max(0, Math.min(yMax, Number(v))) / yMax) * ch;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${cw} ${ch}`,
    style: 'width:100%;height:auto;overflow:visible;display:block',
    role: 'img',
  });

  // 그리드 + y 라벨.
  for (const g of grid) {
    const y = yAt(g);
    svg.append(svgEl('line', { x1: 0, y1: y, x2: cw, y2: y, stroke: 'var(--border)', 'stroke-width': 1 }));
    svg.append(text(-8, y + 3, g, { 'font-size': 9, fill: 'var(--fg-3)', 'text-anchor': 'end' }));
  }
  // 합격선.
  if (opts.passLine != null) {
    const y = yAt(opts.passLine);
    svg.append(
      svgEl('line', {
        x1: 0,
        y1: y,
        x2: cw,
        y2: y,
        stroke: 'var(--fg-3)',
        'stroke-width': 1.2,
        'stroke-dasharray': '4 4',
        opacity: 0.7,
      })
    );
  }

  // 라인(폴리라인).
  for (const s of series) {
    if (!s.values.length) continue;
    const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    svg.append(
      svgEl('polyline', {
        points: pts,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })
    );
  }

  // 점 + (마지막 강조 series) 값 라벨.
  for (const s of series) {
    s.values.forEach((v, i) => {
      svg.append(
        svgEl('circle', {
          cx: xAt(i).toFixed(1),
          cy: yAt(v).toFixed(1),
          r: s.r || 3.5,
          fill: s.color,
          stroke: 'var(--surface)',
          'stroke-width': 1.5,
        })
      );
      if (s.labels) {
        svg.append(
          text(xAt(i).toFixed(1), (yAt(v) - 9).toFixed(1), Math.round(v), {
            'font-size': 11,
            'font-weight': 700,
            fill: s.color,
            'text-anchor': 'middle',
          })
        );
      }
    });
  }

  // x축 라벨.
  xLabels.forEach((lab, i) => {
    svg.append(text(xAt(i).toFixed(1), ch + 14, lab, { 'font-size': 10.5, fill: 'var(--fg-2)', 'text-anchor': 'middle' }));
  });

  return svg;
}
