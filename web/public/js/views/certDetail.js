// 기출 목록(#/cert/{분야}/{자격증}): 헤더(제목·성적추이) + 2열(기출 목록 · 업로드 aside) + 마이크로월드.
// 상태(채점가능/열람만/열람불가)는 서버 불리언에서 파생. 뷰 계약: mount/unmount.

import { renderUploadPanel } from '../components/upload.js';
import { renderMicroworldPanel } from '../components/microworld.js';
import { solveHash, viewHash, certTrendHash } from '../router.js';
import { toast } from '../components/toast.js';

const enc = encodeURIComponent;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svg(html) {
  const s = el('span');
  s.style.display = 'inline-flex';
  s.innerHTML = html;
  return s;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

function judgeCls(judge) {
  if (judge === '합격') return 'jw-pass';
  if (judge === '과락') return 'jw-flunk';
  if (judge === '불합격') return 'jw-fail';
  return '';
}

function examLabel(exam) {
  const 연도 = exam.연도 != null && exam.연도 !== '' ? `${exam.연도}년 ` : '';
  const id = String(exam.식별자 || '');
  const 식별자 = id ? (/^\d+$/.test(id) ? `${id}회 ` : `${id} `) : '';
  const 구분 = exam.구분 || '';
  const label = `${연도}${식별자}${구분}`.trim();
  return label || exam.id;
}

// 내 시도 기록을 시험ID별 최신 시도로 집계.
async function loadAttemptMap(grade, cert) {
  try {
    const data = await getJson(`/api/attempts?grade=${enc(grade)}&cert=${enc(cert)}`);
    const byExam = {};
    for (const a of data.attempts || []) {
      const cur = byExam[a.시험];
      if (!cur || (Number(a.시도) || 0) >= (Number(cur.시도) || 0)) {
        byExam[a.시험] = { 시도: a.시도, 총점: a.총점, 합격여부: a.합격여부 };
      }
    }
    return byExam;
  } catch (_e) {
    return {};
  }
}

const view = { grade: null, cert: null, listSlot: null, headSubEl: null, errSlot: null, onFs: null, mwCleanup: null };

export async function mount(container, params) {
  const grade = params.grade;
  const cert = params.cert;
  view.grade = grade;
  view.cert = cert;
  container.innerHTML = '';

  const page = el('section', 'xl');

  // 헤더.
  const head = el('div', 'xl-head');
  const headL = el('div');
  const title = el('h1', 'xl-title', cert);
  const sub = el('p', 'xl-sub', '참여자 정보 불러오는 중…');
  view.headSubEl = sub;
  headL.append(title, sub);
  const trendBtn = el('button', 'xl-trend-btn');
  trendBtn.type = 'button';
  trendBtn.append(
    svg('<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13l3.5-4 2.5 2.5L13 5"></path><path d="M9.5 5H13v3.5"></path></svg>'),
    document.createTextNode('성적 추이')
  );
  trendBtn.addEventListener('click', () => {
    location.hash = certTrendHash(grade, cert);
  });
  head.append(headL, trendBtn);

  // 2열 그리드.
  const grid = el('div', 'xl-grid');
  const listCol = el('div', 'xl-list-col');
  const listHead = el('div', 'xl-list-head');
  const countEl = el('span', 'xl-list-count', '');
  listHead.append(el('h2', 'xl-list-title', '기출 목록'), countEl);
  const errSlot = el('div', 'xl-err-slot');
  view.errSlot = errSlot;
  const listSlot = el('div', 'xl-list');
  view.listSlot = listSlot;
  view.countEl = countEl;
  listCol.append(listHead, errSlot, listSlot);

  const aside = el('aside', 'xl-aside');
  grid.append(listCol, aside);

  // 마이크로월드(디자인 외 기존 기능 — 접이식 카드).
  const mw = el('details', 'xl-mw');
  const mwSummary = document.createElement('summary');
  mwSummary.className = 'xl-mw-summary';
  mwSummary.append(
    svg('<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M1.5 8h13M8 1.5c2 2.2 2 10.8 0 13M8 1.5C6 3.7 6 12.3 8 14.5"></path></svg>'),
    document.createTextNode('마이크로월드 (개념 시뮬레이션)')
  );
  const mwBody = el('div', 'xl-mw-body');
  mw.append(mwSummary, mwBody);
  mw.addEventListener('toggle', () => {
    if (mw.open && !view.mwCleanup) {
      view.mwCleanup = renderMicroworldPanel(mwBody, { grade, cert });
    }
  });

  page.append(head, grid, mw);
  container.append(page);

  renderUploadPanel(aside, { grade, cert }, () => refreshList());

  // 참여자·_공통 부제 로드.
  getJson('/api/repo')
    .then((repo) => {
      const c = (repo.certs || []).find((x) => x.grade === grade && x.cert === cert);
      const n = c ? (c.participants || []).length : 0;
      view.headSubEl.textContent = `참여자 ${n}명${c && c.hasCommon ? ' · _공통 공유' : ''}`;
    })
    .catch(() => {
      view.headSubEl.textContent = '_공통 공유';
    });

  await refreshList();

  view.onFs = () => refreshList();
  window.addEventListener('qnet:fs-change', view.onFs);
}

function showLockedWarn(id) {
  const slot = view.errSlot;
  if (!slot) return;
  slot.innerHTML = '';
  const banner = el('div', 'xl-locked-warn');
  banner.append(
    svg('<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>')
  );
  const txt = el('span');
  txt.innerHTML = `<b>${id}</b> — 답지 페이지를 아직 구분하지 못했어요. 정답 등록 후 열람할 수 있어요.`;
  banner.append(txt);
  slot.append(banner);
  clearTimeout(view._warnTimer);
  view._warnTimer = setTimeout(() => {
    if (view.errSlot) view.errSlot.innerHTML = '';
  }, 4200);
}

async function refreshList() {
  const { grade, cert, listSlot } = view;
  if (!listSlot || !grade || !cert) return;
  listSlot.innerHTML = '';
  const skel = el('div', 'xl-list');
  for (let i = 0; i < 3; i += 1) skel.append(el('div', 'skeleton xl-row-skel'));
  listSlot.append(skel);

  let exams = [];
  let attemptMap = {};
  try {
    const [examData, map] = await Promise.all([
      getJson(`/api/exams?grade=${enc(grade)}&cert=${enc(cert)}`),
      loadAttemptMap(grade, cert),
    ]);
    exams = examData.exams || [];
    attemptMap = map;
  } catch (e) {
    listSlot.innerHTML = '';
    listSlot.append(el('p', 'error-text', e.message));
    return;
  }

  if (view.countEl) view.countEl.textContent = `${exams.length}개`;
  listSlot.innerHTML = '';
  if (exams.length === 0) {
    const empty = el('div', 'xl-empty');
    empty.append(el('p', null, '등록된 기출이 없어요. 오른쪽에서 PDF를 업로드하거나 정답을 수동 등록하세요.'));
    listSlot.append(empty);
    return;
  }
  for (const exam of exams) listSlot.append(examRow(exam, attemptMap[exam.id]));
}

function examRow(exam, rec) {
  const gradable = !!exam.채점가능;
  const viewable = !!exam.열람가능;
  const status = gradable ? 'gradable' : viewable ? 'viewonly' : 'locked';

  const row = el('div', 'xl-row' + (status === 'locked' ? ' locked' : ''));

  // 좌측 정보.
  const info = el('div', 'xl-row-info');
  const labelRow = el('div', 'xl-row-labelrow');
  labelRow.append(el('span', 'xl-row-label', examLabel(exam)));
  if (exam.fresh) labelRow.append(el('span', 'xl-row-new', 'NEW'));
  info.append(labelRow);
  const meta = el('div', 'xl-row-meta');
  const cnt = exam.문항수 != null && exam.문항수 !== '' ? `${exam.문항수}문항` : '문항수 미상';
  meta.append(el('span', null, cnt));
  if (exam.정답등록) meta.append(el('span', 'xl-meta-key', '✓ 정답 포함'));
  else meta.append(el('span', null, '정답 없음'));
  info.append(meta);
  row.append(info);

  // 최근 점수.
  if (rec && rec.총점 != null) {
    const last = el('span', `xl-row-last ${judgeCls(rec.합격여부)}`);
    last.textContent = `${Number(rec.총점).toFixed(0)} · ${rec.합격여부 || ''}`.trim();
    row.append(last);
  }

  // 상태 뱃지.
  const badgeMap = {
    gradable: ['xl-status gradable', '채점가능'],
    viewonly: ['xl-status viewonly', '열람만'],
    locked: ['xl-status locked', '열람불가'],
  };
  row.append(el('span', badgeMap[status][0], badgeMap[status][1]));

  // 액션.
  const actions = el('div', 'xl-row-actions');
  if (status === 'gradable') {
    const take = el('button', 'xl-btn-take', '시험치기');
    take.type = 'button';
    take.addEventListener('click', () => {
      location.hash = solveHash(view.grade, view.cert, exam.id);
    });
    const viewBtn = el('button', 'xl-btn-view');
    viewBtn.type = 'button';
    viewBtn.append(
      svg('<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S3.7 3.5 8 3.5 14.5 8 14.5 8 12.3 12.5 8 12.5 1.5 8 1.5 8z"></path><circle cx="8" cy="8" r="2"></circle></svg>'),
      document.createTextNode('답 포함 열람')
    );
    viewBtn.addEventListener('click', () => {
      location.hash = viewHash(view.grade, view.cert, exam.id);
    });
    actions.append(take, viewBtn);
  } else if (status === 'viewonly') {
    const readBtn = el('button', 'xl-btn-read', '열람');
    readBtn.type = 'button';
    readBtn.addEventListener('click', () => {
      location.hash = solveHash(view.grade, view.cert, exam.id);
    });
    actions.append(readBtn);
  } else {
    const lockedBtn = el('button', 'xl-btn-locked', '열람 불가');
    lockedBtn.type = 'button';
    lockedBtn.addEventListener('click', () => showLockedWarn(exam.id));
    actions.append(lockedBtn);
  }
  row.append(actions);
  return row;
}

export function unmount() {
  if (view.onFs) window.removeEventListener('qnet:fs-change', view.onFs);
  view.onFs = null;
  clearTimeout(view._warnTimer);
  if (view.mwCleanup) {
    try {
      view.mwCleanup();
    } catch (_e) {
      /* 무시 */
    }
  }
  view.mwCleanup = null;
  view.listSlot = null;
  view.errSlot = null;
}
