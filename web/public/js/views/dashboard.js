// 대시보드(#/): 이어풀기 CTA + 내 현황 카드 + 자격증 카드 그리드 + 새 자격증 등록.
// 대시보드 통계는 기존 API 병합(/api/repo + /api/exams + /api/attempts) + localStorage 드래프트 미러로 해결.
// 뷰 인터페이스: export async function mount(container, params) / export function unmount().

import { apiFetch, listDraftMirrors, removeDraftMirror } from '../store.js';
import { certHash, solveHash } from '../router.js';
import { toast } from '../components/toast.js';

// 사이드바의 "＋ 자격증 등록" 진입 시 등록 폼 자동 오픈용 플래그 키.
const OPEN_REGISTER_KEY = 'qnet-open-register';

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

// 인라인 SVG 스파크라인(총점 추이). 색은 CSS(.sparkline-path/.sparkline-dot)가 관장하되
// 프리젠테이션 속성으로 최소 가시성을 보장한다(속성 < 클래스 규칙 우선순위).
function sparkline(values) {
  const NS = 'http://www.w3.org/2000/svg';
  const w = 96;
  const h = 28;
  const pad = 3;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (nums.length === 0) return svg;
  svg.setAttribute('aria-label', `총점 추이 ${nums.map((n) => n.toFixed(0)).join(', ')}`);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const stepX = nums.length > 1 ? (w - pad * 2) / (nums.length - 1) : 0;
  const pts = nums.map((v, i) => [pad + i * stepX, h - pad - ((v - min) / span) * (h - pad * 2)]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'sparkline-path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  const last = pts[pts.length - 1];
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', last[0].toFixed(1));
  dot.setAttribute('cy', last[1].toFixed(1));
  dot.setAttribute('r', '2');
  dot.setAttribute('class', 'sparkline-dot');
  dot.setAttribute('fill', 'currentColor');
  svg.append(dot);
  return svg;
}

// 현재 뷰 상태(정리·갱신용).
const view = { container: null, onFsChange: null, alive: false };

export async function mount(container, _params) {
  view.container = container;
  view.alive = true;
  container.innerHTML = '';

  const page = el('section', 'dash');
  const ctaSlot = el('div', 'dash-cta-slot');
  const statusSlot = el('section', 'dash-status');
  const gridSlot = el('section', 'dash-grid-wrap');
  page.append(ctaSlot, statusSlot, gridSlot);
  container.append(page);

  // 스켈레톤 초기 표시.
  statusSlot.append(skeletonStatus());
  gridSlot.append(skeletonGrid());

  await Promise.all([renderContinue(ctaSlot), renderData(statusSlot, gridSlot)]);

  // fs-change → 그리드/현황 갱신(무음). CTA는 미러 기반이라 재검증만.
  view.onFsChange = () => {
    if (!view.alive) return;
    renderData(statusSlot, gridSlot);
    renderContinue(ctaSlot);
  };
  window.addEventListener('qnet:fs-change', view.onFsChange);
}

// ── 이어풀기 CTA ─────────────────────────────────────────────────────────────
async function renderContinue(slot) {
  const mirrors = listDraftMirrors();
  slot.innerHTML = '';
  if (mirrors.length === 0) return;

  // 서버 드래프트 존재 검증(불일치 미러는 정리). 최근 저장 순으로 첫 유효 항목을 CTA로.
  const checks = await Promise.all(
    mirrors.map(async (m) => {
      try {
        const data = await getJson(`/api/draft/${encodeURIComponent(m.examId)}`);
        return { m, ok: !!(data && data.draft) };
      } catch (_e) {
        return { m, ok: false };
      }
    })
  );
  if (!view.alive) return;
  const valid = [];
  for (const c of checks) {
    if (c.ok) valid.push(c.m);
    else removeDraftMirror(c.m.grade, c.m.cert, c.m.examId);
  }
  slot.innerHTML = '';
  if (valid.length === 0) return;

  const top = valid[0];
  const cta = el('button', 'btn dash-cta', null);
  cta.type = 'button';
  const progress = top.total ? ` (응답 ${top.done}/${top.total})` : '';
  cta.append(
    el('span', 'dash-cta-icon', '▶'),
    el('span', 'dash-cta-label', `이어풀기 — ${top.examId}${progress}`),
    el('span', 'dash-cta-cert', `${top.grade} / ${top.cert}`)
  );
  cta.addEventListener('click', () => {
    location.hash = solveHash(top.grade, top.cert, top.examId);
  });
  slot.append(cta);

  if (valid.length > 1) {
    const more = el('div', 'dash-cta-more');
    for (const m of valid.slice(1)) {
      const link = el('button', 'btn ghost sm', `${m.examId} (${m.cert})`);
      link.type = 'button';
      link.addEventListener('click', () => {
        location.hash = solveHash(m.grade, m.cert, m.examId);
      });
      more.append(link);
    }
    slot.append(more);
  }
}

// ── 내 현황 + 자격증 그리드(데이터 병합) ─────────────────────────────────────
async function renderData(statusSlot, gridSlot) {
  let repo;
  try {
    repo = await getJson('/api/repo');
  } catch (e) {
    statusSlot.innerHTML = '';
    statusSlot.append(el('p', 'error-text', e.message));
    gridSlot.innerHTML = '';
    gridSlot.append(registerCard([]));
    return;
  }
  if (!view.alive) return;
  const certs = repo.certs || [];

  // 자격증별 기출/시도 병렬 조회.
  const perCert = await Promise.all(
    certs.map(async (c) => {
      const [exams, attempts] = await Promise.all([
        getJson(`/api/exams?grade=${encodeURIComponent(c.grade)}&cert=${encodeURIComponent(c.cert)}`)
          .then((d) => d.exams || [])
          .catch(() => []),
        getJson(`/api/attempts?grade=${encodeURIComponent(c.grade)}&cert=${encodeURIComponent(c.cert)}`)
          .then((d) => d.attempts || [])
          .catch(() => []),
      ]);
      return { ...c, exams, attempts };
    })
  );
  if (!view.alive) return;

  renderStatus(statusSlot, perCert);
  renderGrid(gridSlot, perCert, certs);
}

function renderStatus(slot, perCert) {
  slot.innerHTML = '';
  slot.append(el('h2', 'dash-section-title', '내 현황'));

  const all = [];
  for (const c of perCert) for (const a of c.attempts) all.push(a);

  if (all.length === 0) {
    const empty = el('div', 'dash-empty');
    empty.append(
      el('p', null, '아직 기록이 없습니다 — 첫 기출을 풀어보세요.'),
      (() => {
        const b = el('button', 'btn sm', '자격증 살펴보기');
        b.type = 'button';
        b.addEventListener('click', () => {
          const grid = document.querySelector('.dash-grid-wrap');
          if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return b;
      })()
    );
    slot.append(empty);
    return;
  }

  // 최신 시도(풀이일 → 시도 순).
  const sorted = all.slice().sort((a, b) => {
    const d = String(a.풀이일 || '').localeCompare(String(b.풀이일 || ''));
    if (d !== 0) return d;
    return (Number(a.시도) || 0) - (Number(b.시도) || 0);
  });
  const latest = sorted[sorted.length - 1];

  // X 합계·찍음 합계: /api/attempts 목록에는 문항 단위 집계가 없다(서버 계약 고정).
  // 항목에 값이 있으면 합산하고, 없으면 '—'로 표기한다(미제공을 0으로 위장하지 않음).
  let xSum = 0;
  let guessSum = 0;
  let hasXData = false;
  let hasGuessData = false;
  for (const a of all) {
    if (a.X수 != null) {
      xSum += Number(a.X수) || 0;
      hasXData = true;
    }
    if (a.O찍음수 != null || a.찍음수 != null) {
      guessSum += Number(a.O찍음수 != null ? a.O찍음수 : a.찍음수) || 0;
      hasGuessData = true;
    }
  }

  const grid = el('div', 'dash-stat-grid');

  const scoreTile = el('div', 'dash-stat');
  scoreTile.append(el('span', 'stat-label', '최근 점수'));
  const scoreVal = el('span', 'stat-value', latest.총점 != null ? Number(latest.총점).toFixed(1) : '-');
  scoreTile.append(scoreVal);
  if (latest.합격여부) {
    scoreTile.append(el('span', `badge ${latest.합격여부 === '합격' ? 'pass' : 'fail'}`, latest.합격여부));
  }
  grid.append(scoreTile);

  const xTile = el('div', 'dash-stat');
  xTile.append(el('span', 'stat-label', '오답 X'));
  xTile.append(el('span', 'stat-value', hasXData ? `${xSum}개` : '—'));
  if (!hasXData) xTile.append(el('span', 'muted', '상세 미제공'));
  grid.append(xTile);

  const gTile = el('div', 'dash-stat');
  gTile.append(el('span', 'stat-label', '찍음'));
  gTile.append(el('span', 'stat-value', hasGuessData ? `${guessSum}개` : '—'));
  if (!hasGuessData) gTile.append(el('span', 'muted', '상세 미제공'));
  grid.append(gTile);

  const trendTile = el('div', 'dash-stat');
  trendTile.append(el('span', 'stat-label', '총점 추이'));
  const scores = sorted.map((a) => a.총점).filter((v) => v != null);
  if (scores.length >= 2) {
    trendTile.append(sparkline(scores));
  } else {
    trendTile.append(el('span', 'stat-value', scores.length ? Number(scores[0]).toFixed(1) : '-'));
    trendTile.append(el('span', 'muted', '2회 이상 시 추이'));
  }
  grid.append(trendTile);

  slot.append(grid);
}

function renderGrid(slot, perCert, certs) {
  slot.innerHTML = '';
  slot.append(el('h2', 'dash-section-title', '자격증'));
  const grid = el('div', 'dash-grid');

  for (const c of perCert) {
    grid.append(certCard(c));
  }
  grid.append(registerCard(certs));
  slot.append(grid);
}

function certCard(c) {
  const card = el('button', 'dash-card', null);
  card.type = 'button';
  card.append(el('span', 'dash-card-title', c.cert));
  card.append(el('span', 'dash-card-field', c.grade));

  const 채점가능수 = c.exams.filter((e) => e.채점가능).length;
  const stats = el('span', 'dash-card-stats', `기출 ${c.exams.length} · 채점가능 ${채점가능수}`);
  card.append(stats);

  // 최근 시도(모든 시험 중 최신).
  const sorted = c.attempts.slice().sort((a, b) => {
    const d = String(a.풀이일 || '').localeCompare(String(b.풀이일 || ''));
    if (d !== 0) return d;
    return (Number(a.시도) || 0) - (Number(b.시도) || 0);
  });
  const last = sorted[sorted.length - 1];
  const recent = el('span', 'dash-card-recent');
  if (last) {
    recent.append(el('span', null, `최근 ${last.총점 != null ? Number(last.총점).toFixed(1) : '-'}`));
    if (last.합격여부) recent.append(el('span', `badge ${last.합격여부 === '합격' ? 'pass' : 'fail'}`, last.합격여부));
  } else {
    recent.append(el('span', 'muted', '시작 전'));
  }
  card.append(recent);

  card.addEventListener('click', () => {
    location.hash = certHash(c.grade, c.cert);
  });
  return card;
}

// dashed "새 자격증 등록" 카드(인라인 폼: 분야 datalist + 자격증명 → POST /api/certs).
function registerCard(certs) {
  const card = el('div', 'dash-card dash-card-add');

  const openBtn = el('button', 'dash-add-open', '＋ 새 자격증 등록');
  openBtn.type = 'button';
  const formWrap = el('div', 'dash-add-form');
  formWrap.hidden = true;

  const gradeField = el('label', 'field');
  gradeField.append(el('span', null, '종류 (분야, 예: 정보처리)'));
  const gradeInput = el('input');
  gradeInput.type = 'text';
  gradeInput.setAttribute('list', 'dash-grade-suggestions');
  const datalist = document.createElement('datalist');
  datalist.id = 'dash-grade-suggestions';
  for (const g of [...new Set((certs || []).map((c) => c.grade))].sort()) datalist.append(new Option(g, g));
  gradeField.append(gradeInput, datalist);

  const certField = el('label', 'field');
  certField.append(el('span', null, '자격증명 (예: 정보처리기사)'));
  const certInput = el('input');
  certInput.type = 'text';
  certField.append(certInput);

  const submit = el('button', 'btn', '등록');
  submit.type = 'button';
  const cancel = el('button', 'btn ghost sm', '취소');
  cancel.type = 'button';
  const status = el('span', 'status-msg');
  const actions = el('div', 'dash-add-actions');
  actions.append(submit, cancel);
  formWrap.append(gradeField, certField, actions, status);

  card.append(openBtn, formWrap);

  const open = () => {
    openBtn.hidden = true;
    formWrap.hidden = false;
    gradeInput.focus();
  };
  const close = () => {
    formWrap.hidden = true;
    openBtn.hidden = false;
    status.textContent = '';
  };
  openBtn.addEventListener('click', open);
  cancel.addEventListener('click', close);

  // 사이드바에서 진입한 경우 자동 오픈.
  try {
    if (sessionStorage.getItem(OPEN_REGISTER_KEY)) {
      sessionStorage.removeItem(OPEN_REGISTER_KEY);
      setTimeout(() => {
        open();
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  } catch (_e) {
    /* 무시 */
  }

  submit.addEventListener('click', async () => {
    const 종류 = (gradeInput.value || '').trim().normalize('NFC');
    const 자격증 = (certInput.value || '').trim().normalize('NFC');
    if (!종류 || !자격증) {
      status.className = 'status-msg error-text';
      status.textContent = '종류와 자격증명을 모두 입력하세요.';
      return;
    }
    submit.disabled = true;
    status.className = 'status-msg';
    status.textContent = '등록 중…';
    try {
      const res = await apiFetch('/api/certs', { method: 'POST', body: { 종류, 자격증 } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        status.className = 'status-msg error-text';
        status.textContent = res.status === 409 ? '이미 존재하는 자격증입니다.' : data.error || '등록 실패';
        return;
      }
      toast(`${자격증} 등록 완료`, 'ok');
      location.hash = certHash(종류, 자격증); // 방금 만든 자격증 상세로 이동
    } catch (e) {
      status.className = 'status-msg error-text';
      status.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  });

  return card;
}

// ── 스켈레톤 ─────────────────────────────────────────────────────────────────
function skeletonStatus() {
  const wrap = el('div', 'dash-status-skel');
  wrap.append(el('div', 'skeleton dash-title-skel'));
  const grid = el('div', 'dash-stat-grid');
  for (let i = 0; i < 4; i += 1) grid.append(el('div', 'skeleton dash-stat-skel'));
  wrap.append(grid);
  return wrap;
}

function skeletonGrid() {
  const grid = el('div', 'dash-grid');
  for (let i = 0; i < 3; i += 1) grid.append(el('div', 'skeleton dash-card-skel'));
  return grid;
}

export function unmount() {
  view.alive = false;
  if (view.onFsChange) window.removeEventListener('qnet:fs-change', view.onFsChange);
  view.onFsChange = null;
  view.container = null;
}
