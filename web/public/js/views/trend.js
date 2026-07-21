// 기출별 시도 추이(#/trend/{분야}/{자격증}/{시험ID}): 지표 3개 + 점수·확신정답률 이중선 차트 +
// 시도별 표 + 하단(스터디원 비교 · 자격증별 내 성적). 데이터: /api/attempts(보강된 시도별 지표).

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

function judgeCls(j) {
  if (j === '합격') return 'pass';
  if (j === '과락') return 'flunk';
  return 'fail';
}

function examLabelFromId(id) {
  const parts = String(id).split('-');
  if (parts.length >= 3) {
    const 연도 = parts[0];
    const 구분 = parts[parts.length - 1];
    const 식별자 = parts.slice(1, -1).join('-');
    return `${연도}년 ${/^\d+$/.test(식별자) ? 식별자 + '회' : 식별자} ${구분}`;
  }
  return id;
}

async function myAttempts(grade, cert, examId, user) {
  const u = user ? `&user=${enc(user)}` : '';
  const data = await getJson(`/api/attempts?grade=${enc(grade)}&cert=${enc(cert)}&examId=${enc(examId)}${u}`);
  return (data.attempts || []).slice().sort((a, b) => (Number(a.시도) || 0) - (Number(b.시도) || 0));
}

const view = { alive: false, onFs: null };

export async function mount(container, { grade, cert, examId }) {
  view.alive = true;
  container.innerHTML = '';
  const page = el('div', 'tr');
  page.append(el('p', 'loading', '추이를 불러오는 중…'));
  container.append(page);

  const render = async () => {
    let attempts;
    try {
      attempts = await myAttempts(grade, cert, examId);
    } catch (e) {
      page.innerHTML = '';
      page.append(el('p', 'error-text', e.message));
      return;
    }
    if (!view.alive) return;
    page.innerHTML = '';

    // 헤더.
    const head = el('div', 'tr-head');
    head.append(el('div', 'tr-eyebrow', '성적 추이'), el('h1', 'tr-title', `${examLabelFromId(examId)} · 내 기록`));
    head.append(el('p', 'tr-desc', '재풀이할 때마다 시도 번호가 올라가요. 점수·오답·찍음의 흐름을 확인하세요.'));
    page.append(head);

    if (attempts.length === 0) {
      const empty = el('div', 'tr-empty');
      empty.append(el('p', null, '아직 이 기출의 풀이 기록이 없어요. 먼저 시험을 풀어보세요.'));
      page.append(empty);
      return;
    }

    const first = attempts[0];
    const last = attempts[attempts.length - 1];

    // 지표 3개.
    const metrics = el('div', 'tr-metrics');
    metrics.append(
      metricScore('최근 점수', last.총점, last.합격여부, delta(last.총점, first.총점), '점', 'higher-good'),
      metricAccent('확신 정답률', last.확신정답률, delta(last.확신정답률, first.확신정답률), '%p', 'higher-good'),
      metricPlain('오답 수', last.X수, delta(last.X수, first.X수), '개', 'lower-good')
    );
    page.append(metrics);

    // 차트: 점수(accent) + 확신정답률(success).
    const chartCard = el('div', 'tr-chart-card');
    const chartHead = el('div', 'tr-chart-head');
    chartHead.append(el('div', 'tr-chart-title', '시도별 추이'));
    const legend = el('div', 'tr-legend');
    legend.append(legendItem('점수', 'var(--accent)'), legendItem('확신 정답률', 'var(--success)'), legendItem('합격선 60', 'dash'));
    chartHead.append(legend);
    chartCard.append(chartHead);

    const chartWrap = el('div', 'tr-chart-wrap');
    chartWrap.append(
      buildLineChart({
        cw: 560,
        ch: 190,
        passLine: 60,
        xLabels: attempts.map((a) => `시도 ${a.시도}`),
        series: [
          { values: attempts.map((a) => (a.확신정답률 == null ? 0 : a.확신정답률)), color: 'var(--success)', r: 4 },
          { values: attempts.map((a) => Number(a.총점) || 0), color: 'var(--accent)', r: 4.5, labels: true },
        ],
      })
    );
    chartCard.append(chartWrap);
    page.append(chartCard);

    // 시도별 표.
    const table = el('div', 'tr-table');
    const header = el('div', 'tr-row tr-row-head');
    ['시도', '날짜', '점수', '오답', '찍음', '확신 정답률'].forEach((h) => header.append(el('span', null, h)));
    table.append(header);
    for (const a of attempts) {
      const row = el('div', 'tr-row');
      row.append(el('span', 'tr-c-attempt', `시도 ${a.시도}`));
      row.append(el('span', 'tr-c-date', a.풀이일 || '-'));
      const score = el('span', 'tr-c-score');
      score.append(el('b', null, a.총점 != null ? Number(a.총점).toFixed(0) : '-'), el('span', `judge-pill ${judgeCls(a.합격여부)} tr-pill`, a.합격여부 || ''));
      row.append(score);
      row.append(el('span', 'tr-c-wrong', String(a.X수 != null ? a.X수 : '-')));
      row.append(el('span', 'tr-c-guess', String(a.찍음수 != null ? a.찍음수 : '-')));
      row.append(el('span', 'tr-c-conf', a.확신정답률 == null ? '-' : `${a.확신정답률}%`));
      table.append(row);
    }
    page.append(table);

    // 하단 2열: 스터디원 비교 · 자격증별 내 성적.
    const bottom = el('div', 'tr-bottom');
    const cmp = el('div', 'tr-panel');
    cmp.append(el('div', 'tr-panel-title', '스터디원 비교'), el('p', 'tr-panel-sub', '이 기출 최근 점수 · 확신 정답률'));
    const cmpList = el('div', 'tr-bars');
    cmp.append(cmpList);
    const certPanel = el('div', 'tr-panel');
    certPanel.append(el('div', 'tr-panel-title', '자격증별 내 성적'), el('p', 'tr-panel-sub', '최근 시도 기준'));
    const certList = el('div', 'tr-bars');
    certPanel.append(certList);
    bottom.append(cmp, certPanel);
    page.append(bottom);

    renderParticipantCompare(cmpList, grade, cert, examId, last).catch(() => {});
    renderCertCompare(certList, grade).catch(() => {});
  };

  await render();
  view.onFs = () => {
    if (view.alive) render();
  };
  window.addEventListener('qnet:fs-change', view.onFs);
}

function delta(cur, base) {
  if (cur == null || base == null) return null;
  return Number(cur) - Number(base);
}

function metricScore(label, value, judge, d, unit, dir) {
  const box = el('div', 'tr-metric');
  box.append(el('div', 'tr-metric-label', label));
  const row = el('div', 'tr-metric-main');
  row.append(el('span', 'tr-metric-val', value != null ? Number(value).toFixed(0) : '-'));
  if (judge) row.append(el('span', `judge-pill ${judgeCls(judge)} tr-pill`, judge));
  box.append(row);
  box.append(deltaEl(d, unit, dir, '1회차 대비 '));
  return box;
}
function metricAccent(label, value, d, unit, dir) {
  const box = el('div', 'tr-metric');
  box.append(el('div', 'tr-metric-label accent', label));
  const v = el('div', 'tr-metric-val accent');
  v.append(document.createTextNode(value == null ? '-' : String(value)), el('span', 'tr-metric-unit', '%'));
  box.append(v);
  box.append(deltaEl(d, unit, dir, '1회차 대비 '));
  return box;
}
function metricPlain(label, value, d, unit, dir) {
  const box = el('div', 'tr-metric');
  box.append(el('div', 'tr-metric-label', label));
  const v = el('div', 'tr-metric-main');
  v.append(el('span', 'tr-metric-val', value != null ? String(value) : '-'), el('span', 'tr-metric-unit2', '개'));
  box.append(v);
  box.append(deltaEl(d, unit, dir, '1회차 대비 '));
  return box;
}

function deltaEl(d, unit, dir, prefix) {
  const e = el('div', 'tr-delta');
  if (d == null || d === 0) {
    e.classList.add('flat');
    e.textContent = `${prefix}변화 없음`;
    return e;
  }
  const good = dir === 'lower-good' ? d < 0 : d > 0;
  e.classList.add(good ? 'up' : 'down');
  const sign = d > 0 ? '+' : '';
  e.textContent = `${prefix}${sign}${d}${unit}`;
  return e;
}

function legendItem(label, color) {
  const s = el('span', 'tr-legend-item');
  const dot = el('span', 'tr-legend-dot' + (color === 'dash' ? ' dash' : ''));
  if (color !== 'dash') dot.style.background = color;
  s.append(dot, document.createTextNode(label));
  return s;
}

async function renderParticipantCompare(container, grade, cert, examId, mine) {
  const repo = await getJson('/api/repo').catch(() => ({ certs: [] }));
  const c = (repo.certs || []).find((x) => x.grade === grade && x.cert === cert);
  const me = repo.nickname || null; // 없을 수 있음 — 아래에서 mine으로 판단
  let parts = c ? (c.participants || []).slice() : [];
  if (parts.length === 0) parts = [];
  const results = await Promise.all(
    parts.map(async (p) => {
      try {
        const list = await myAttempts(grade, cert, examId, p);
        const last = list[list.length - 1];
        return last ? { name: p, score: Number(last.총점) || 0, conf: last.확신정답률 } : null;
      } catch (_e) {
        return null;
      }
    })
  );
  let rows = results.filter(Boolean);
  // 참여자 목록이 비어도 내 기록은 항상 노출.
  if (rows.length === 0 && mine) rows = [{ name: '나', score: Number(mine.총점) || 0, conf: mine.확신정답률, self: true }];
  container.innerHTML = '';
  const max = Math.max(100, ...rows.map((r) => r.score));
  for (const r of rows) {
    const self = r.self || (mine && r.score === (Number(mine.총점) || 0) && r.conf === mine.확신정답률);
    container.append(bar(r.name + (self ? ' (나)' : ''), r.score, `${r.score} · ${r.conf == null ? '-' : r.conf + '%'}`, self ? 'var(--accent)' : 'var(--fg-3)', max));
  }
  if (rows.length === 0) container.append(el('p', 'muted', '기록이 없어요.'));
}

async function renderCertCompare(container, grade) {
  const repo = await getJson('/api/repo').catch(() => ({ certs: [] }));
  const certs = repo.certs || [];
  const rows = await Promise.all(
    certs.map(async (c) => {
      try {
        const data = await getJson(`/api/attempts?grade=${enc(c.grade)}&cert=${enc(c.cert)}`);
        const list = (data.attempts || []).slice().sort((a, b) => String(a.풀이일 || '').localeCompare(String(b.풀이일 || '')));
        const last = list[list.length - 1];
        return last ? { name: c.cert, score: Number(last.총점) || 0, judge: last.합격여부 } : null;
      } catch (_e) {
        return null;
      }
    })
  );
  const valid = rows.filter(Boolean);
  container.innerHTML = '';
  if (valid.length === 0) {
    container.append(el('p', 'muted', '아직 기록이 없어요.'));
    return;
  }
  const max = Math.max(100, ...valid.map((r) => r.score));
  for (const r of valid) {
    container.append(bar(r.name, r.score, `${r.score}점 · ${r.judge || ''}`, 'var(--accent)', max, judgeCls(r.judge)));
  }
}

function bar(name, value, rightLabel, color, max, judgeClsName) {
  const wrap = el('div', 'tr-bar');
  const top = el('div', 'tr-bar-top');
  top.append(el('span', 'tr-bar-name', name));
  const right = el('span', 'tr-bar-right');
  if (judgeClsName) right.classList.add('jw-' + judgeClsName.replace('pass', 'pass').replace('fail', 'fail').replace('flunk', 'flunk'));
  right.textContent = rightLabel;
  top.append(right);
  wrap.append(top);
  const track = el('div', 'tr-bar-track');
  const fill = el('div', 'tr-bar-fill');
  fill.style.width = `${Math.max(2, Math.min(100, (value / max) * 100))}%`;
  fill.style.background = color;
  track.append(fill);
  wrap.append(track);
  return wrap;
}

export function unmount() {
  view.alive = false;
  if (view.onFs) window.removeEventListener('qnet:fs-change', view.onFs);
  view.onFs = null;
}
