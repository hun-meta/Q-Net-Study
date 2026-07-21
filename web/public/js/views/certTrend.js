// 자격증별 개인 추이(#/cert/{분야}/{자격증}/trend): 참여자 탭 + 지표 3개 +
// 점수·오답 수·찍음 비율 3선 차트 + 기록 표. 데이터: 참여자별 /api/attempts(보강 지표).

import { getState } from '../store.js';
import { buildLineChart } from '../charts.js';

const enc = encodeURIComponent;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

function shortDate(iso) {
  const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : iso || '-';
}

const view = { alive: false, onFs: null, part: null };

export async function mount(container, { grade, cert }) {
  view.alive = true;
  container.innerHTML = '';
  const page = el('div', 'ct');
  page.append(el('p', 'loading', '추이를 불러오는 중…'));
  container.append(page);

  const me = getState().nickname;

  const load = async () => {
    let repo;
    try {
      repo = await getJson('/api/repo');
    } catch (e) {
      page.innerHTML = '';
      page.append(el('p', 'error-text', e.message));
      return;
    }
    if (!view.alive) return;
    const c = (repo.certs || []).find((x) => x.grade === grade && x.cert === cert);
    let parts = c ? (c.participants || []).slice() : [];
    if (me && !parts.includes(me)) parts = [me, ...parts];
    if (parts.length === 0 && me) parts = [me];

    if (!view.part || !parts.includes(view.part)) view.part = parts.includes(me) ? me : parts[0] || null;

    // 참여자별 기록 수집.
    const recordsByPart = {};
    await Promise.all(
      parts.map(async (p) => {
        try {
          const data = await getJson(`/api/attempts?grade=${enc(grade)}&cert=${enc(cert)}&user=${enc(p)}`);
          recordsByPart[p] = (data.attempts || [])
            .map((a) => ({
              exam: `${a.시험}${Number(a.시도) > 1 ? ` (${a.시도})` : ''}`,
              date: a.풀이일,
              score: Number(a.총점) || 0,
              wrong: a.X수 != null ? a.X수 : 0,
              guessRatio: a.찍음비율 != null ? a.찍음비율 : 0,
            }))
            .sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
        } catch (_e) {
          recordsByPart[p] = [];
        }
      })
    );
    if (!view.alive) return;
    render(parts, recordsByPart, me);
  };

  const render = (parts, recordsByPart, me) => {
    page.innerHTML = '';

    // 헤더.
    const head = el('div', 'ct-head');
    head.append(el('div', 'ct-eyebrow', '개인별 기출 추이'), el('h1', 'ct-title', `${cert} · 기출 시험치기 추이`));
    head.append(el('p', 'ct-desc', '스터디원을 골라 최근 기출 시험치기 기록의 점수·오답 수·찍음 비율 흐름을 확인하세요.'));
    page.append(head);

    // 참여자 탭.
    const tabs = el('div', 'ct-tabs');
    for (const p of parts) {
      const t = el('button', 'ct-tab' + (p === view.part ? ' active' : ''), p === me ? `${p} (나)` : p);
      t.type = 'button';
      t.addEventListener('click', () => {
        view.part = p;
        render(parts, recordsByPart, me);
      });
      tabs.append(t);
    }
    page.append(tabs);

    const records = recordsByPart[view.part] || [];
    if (records.length === 0) {
      const empty = el('div', 'ct-empty');
      empty.append(el('p', null, `${view.part || '이 참여자'}의 기출 시험치기 기록이 아직 없어요.`));
      page.append(empty);
      return;
    }

    const first = records[0];
    const last = records[records.length - 1];

    // 지표 3개.
    const metrics = el('div', 'ct-metrics');
    metrics.append(
      ctMetric('최근 점수', last.score, '점', d(last.score, first.score), '점', 'higher-good', 'accent'),
      ctMetric('오답 수', last.wrong, '개', d(last.wrong, first.wrong), '개', 'lower-good', 'danger'),
      ctMetric('찍음 비율', last.guessRatio, '%', d(last.guessRatio, first.guessRatio), '%p', 'lower-good', 'warn')
    );
    page.append(metrics);

    // 차트: 점수(accent) + 오답(danger) + 찍음 비율(warn).
    const chartCard = el('div', 'ct-chart-card');
    const chartHead = el('div', 'ct-chart-head');
    chartHead.append(el('div', 'ct-chart-title', '기록별 추이'));
    const legend = el('div', 'ct-legend');
    legend.append(leg('점수', 'var(--accent)'), leg('오답 수', 'var(--danger)'), leg('찍음 비율(%)', 'var(--warn)'));
    chartHead.append(legend);
    chartCard.append(chartHead);
    const chartWrap = el('div', 'ct-chart-wrap');
    chartWrap.append(
      buildLineChart({
        cw: 580,
        ch: 190,
        xLabels: records.map((r) => shortDate(r.date)),
        series: [
          { values: records.map((r) => r.wrong), color: 'var(--danger)', r: 3.5 },
          { values: records.map((r) => r.guessRatio), color: 'var(--warn)', r: 3.5 },
          { values: records.map((r) => r.score), color: 'var(--accent)', r: 4.5, labels: true },
        ],
      })
    );
    chartCard.append(chartWrap);
    page.append(chartCard);

    // 기록 표.
    const table = el('div', 'ct-table');
    const header = el('div', 'ct-row ct-row-head');
    ['기출 시험', '날짜', '점수', '오답 수', '찍음 비율'].forEach((h) => header.append(el('span', null, h)));
    table.append(header);
    for (const r of records) {
      const row = el('div', 'ct-row');
      row.append(el('span', 'ct-c-exam', r.exam));
      row.append(el('span', 'ct-c-date', shortDate(r.date)));
      row.append(el('span', 'ct-c-score', String(r.score)));
      row.append(el('span', 'ct-c-wrong', String(r.wrong)));
      row.append(el('span', 'ct-c-guess', `${r.guessRatio}%`));
      table.append(row);
    }
    page.append(table);
  };

  await load();
  view.onFs = () => {
    if (view.alive) load();
  };
  window.addEventListener('qnet:fs-change', view.onFs);
}

function d(cur, base) {
  if (cur == null || base == null) return null;
  return Number(cur) - Number(base);
}

function ctMetric(label, value, unit, dv, dunit, dir, tone) {
  const box = el('div', 'ct-metric');
  box.append(el('div', 'ct-metric-label ' + tone, label));
  const v = el('div', 'ct-metric-val' + (tone === 'accent' ? ' accent' : ''));
  v.append(document.createTextNode(String(value)), el('span', 'ct-metric-unit', unit));
  box.append(v);
  const de = el('div', 'ct-delta');
  if (dv == null || dv === 0) {
    de.classList.add('flat');
    de.textContent = '첫 기록 대비 변화 없음';
  } else {
    const good = dir === 'lower-good' ? dv < 0 : dv > 0;
    de.classList.add(good ? 'up' : 'down');
    de.textContent = `첫 기록 대비 ${dv > 0 ? '+' : ''}${dv}${dunit}`;
  }
  box.append(de);
  return box;
}

function leg(label, color) {
  const s = el('span', 'ct-legend-item');
  const dot = el('span', 'ct-legend-dot');
  dot.style.background = color;
  s.append(dot, document.createTextNode(label));
  return s;
}

export function unmount() {
  view.alive = false;
  if (view.onFs) window.removeEventListener('qnet:fs-change', view.onFs);
  view.onFs = null;
}
