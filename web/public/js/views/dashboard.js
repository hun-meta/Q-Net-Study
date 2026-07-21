// 홈 대시보드(#/): "대시보드" 헤더 + 자격증 등록 + 종류(분야) 탭 + 자격증 카드 그리드.
// 기존 기능(이어풀기 CTA)은 디자인에 맞춰 accent 카드로 유지한다.
// 데이터: /api/repo(certs·participants) + 자격증별 /api/attempts(최근 점수) + 드래프트 미러.
// 뷰 계약: mount(container, params) / unmount().

import { apiFetch, listDraftMirrors, removeDraftMirror } from '../store.js';
import { certHash, solveHash } from '../router.js';
import { toast } from '../components/toast.js';

const enc = encodeURIComponent;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svg(html) {
  const s = document.createElement('span');
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

// 자격증별 최근 시도(점수·판정). /api/attempts 는 현재 닉네임 기준.
async function latestAttempt(grade, cert) {
  try {
    const d = await getJson(`/api/attempts?grade=${enc(grade)}&cert=${enc(cert)}`);
    const arr = d.attempts || [];
    if (!arr.length) return null;
    const sorted = arr.slice().sort((a, b) => {
      const x = String(a.풀이일 || '').localeCompare(String(b.풀이일 || ''));
      if (x !== 0) return x;
      return (Number(a.시도) || 0) - (Number(b.시도) || 0);
    });
    const l = sorted[sorted.length - 1];
    return { score: l.총점, judge: l.합격여부 };
  } catch (_e) {
    return null;
  }
}

const view = { alive: false, onFs: null, activeGrade: null };

export async function mount(container, _params) {
  view.alive = true;
  container.innerHTML = '';

  const page = el('section', 'home');

  // 헤더.
  const head = el('div', 'home-head');
  const headL = el('div');
  headL.append(
    el('div', 'home-eyebrow', '대시보드'),
    el('h1', 'home-title', '자격증 선택'),
    el('p', 'home-desc', '종류를 고르고 자격증에 들어가 기출을 풀어보세요.')
  );
  const regBtn = el('button', 'home-reg-btn');
  regBtn.type = 'button';
  regBtn.append(
    svg('<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"></path></svg>'),
    document.createTextNode('자격증 등록')
  );
  head.append(headL, regBtn);

  const resumeSlot = el('div', 'home-resume-slot');
  const tabsSlot = el('div', 'home-tabs-slot');
  const gridSlot = el('div', 'home-grid-slot');

  page.append(head, resumeSlot, tabsSlot, gridSlot);
  container.append(page);

  // 스켈레톤.
  const skel = el('div', 'home-grid');
  for (let i = 0; i < 4; i += 1) skel.append(el('div', 'skeleton home-skel-card'));
  gridSlot.append(skel);

  regBtn.addEventListener('click', () => openCertRegDialog(view.gradeNames || []));

  await Promise.all([renderResume(resumeSlot), renderData(tabsSlot, gridSlot)]);

  view.onFs = () => {
    if (!view.alive) return;
    renderData(tabsSlot, gridSlot);
    renderResume(resumeSlot);
  };
  window.addEventListener('qnet:fs-change', view.onFs);
}

// ── 이어풀기 ─────────────────────────────────────────────────────────────────
async function renderResume(slot) {
  const mirrors = listDraftMirrors();
  slot.innerHTML = '';
  if (mirrors.length === 0) return;

  const checks = await Promise.all(
    mirrors.map(async (m) => {
      try {
        const data = await getJson(`/api/draft/${enc(m.examId)}`);
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
  const btn = el('button', 'home-resume');
  btn.type = 'button';
  const main = el('div', 'home-resume-main');
  const progress = top.total ? ` · 응답 ${top.done}/${top.total}` : '';
  main.append(
    el('div', 'home-resume-title', `이어풀기 — ${top.examId}${progress}`),
    el('div', 'home-resume-sub', '이어서 답안을 마저 작성하고 제출할 수 있어요.')
  );
  btn.append(
    (() => {
      const i = el('span', 'home-resume-icon');
      i.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7-4.5z"></path></svg>';
      return i;
    })(),
    main,
    el('span', 'home-resume-cert', `${top.grade} / ${top.cert}`)
  );
  btn.addEventListener('click', () => {
    location.hash = solveHash(top.grade, top.cert, top.examId);
  });
  slot.append(btn);
}

// ── 종류 탭 + 자격증 카드 ────────────────────────────────────────────────────
async function renderData(tabsSlot, gridSlot) {
  let repo;
  try {
    repo = await getJson('/api/repo');
  } catch (e) {
    tabsSlot.innerHTML = '';
    gridSlot.innerHTML = '';
    gridSlot.append(el('p', 'error-text', e.message));
    return;
  }
  if (!view.alive) return;

  const certs = repo.certs || [];
  // 종류(grade)별 그룹.
  const groups = new Map();
  for (const c of certs) {
    if (!groups.has(c.grade)) groups.set(c.grade, []);
    groups.get(c.grade).push(c);
  }
  const grades = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  view.gradeNames = grades;

  if (!view.activeGrade || !groups.has(view.activeGrade)) {
    view.activeGrade = grades[0] || null;
  }

  // 최근 점수 병렬 조회.
  const lastMap = {};
  await Promise.all(
    certs.map(async (c) => {
      lastMap[`${c.grade}//${c.cert}`] = await latestAttempt(c.grade, c.cert);
    })
  );
  if (!view.alive) return;

  // 탭.
  tabsSlot.innerHTML = '';
  const tabs = el('div', 'home-tabs');
  if (grades.length === 0) {
    // 자격증 없음 — 빈 상태 + 등록 유도.
    gridSlot.innerHTML = '';
    const empty = el('div', 'home-empty');
    empty.append(el('p', null, '아직 등록된 자격증이 없어요. 우측 상단 “자격증 등록”으로 시작하세요.'));
    gridSlot.append(empty);
    return;
  }
  for (const g of grades) {
    const tab = el('button', 'home-tab' + (g === view.activeGrade ? ' active' : ''));
    tab.type = 'button';
    tab.append(document.createTextNode(g), el('span', 'home-tab-count', String(groups.get(g).length)));
    tab.addEventListener('click', () => {
      view.activeGrade = g;
      renderData(tabsSlot, gridSlot);
    });
    tabs.append(tab);
  }
  tabsSlot.append(tabs);

  // 카드 그리드.
  gridSlot.innerHTML = '';
  const grid = el('div', 'home-grid');
  const items = groups.get(view.activeGrade).slice().sort((a, b) => String(a.cert).localeCompare(String(b.cert), 'ko'));
  for (const c of items) {
    grid.append(certCard(c, lastMap[`${c.grade}//${c.cert}`]));
  }
  gridSlot.append(grid);
}

function certCard(c, last) {
  const card = el('button', 'home-card');
  card.type = 'button';

  const top = el('div', 'home-card-top');
  const icon = el('span', 'home-card-icon');
  icon.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H9l1.5 1.6h5A1.5 1.5 0 0 1 17 7v7.5A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5z"></path></svg>';
  top.append(icon);
  if (c.hasCommon) top.append(el('span', 'home-card-common', '_공통 있음'));

  const mid = el('div');
  mid.append(el('div', 'home-card-name', c.cert), el('div', 'home-card-grade', c.grade));

  const foot = el('div', 'home-card-foot');
  const part = el('span', 'home-card-part');
  part.append(
    svg('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.5" r="2.6"></circle><path d="M3 13.5a5 5 0 0 1 10 0"></path></svg>'),
    document.createTextNode(`참여자 ${(c.participants || []).length}`)
  );
  foot.append(part);
  if (last && last.score != null) {
    const label = `${Number(last.score).toFixed(0)} · ${last.judge || ''}`.trim();
    foot.append(el('span', `home-card-last ${judgeCls(last.judge)}`, label));
  } else {
    foot.append(el('span', 'home-card-none', '기록 없음'));
  }

  card.append(top, mid, foot);
  card.addEventListener('click', () => {
    location.hash = certHash(c.grade, c.cert);
  });
  return card;
}

// ── 자격증 등록 다이얼로그 ───────────────────────────────────────────────────
function openCertRegDialog(gradeNames) {
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box');
  box.style.maxWidth = '440px';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  box.append(el('h2', 'dlg-title', '자격증 등록'));
  box.append(el('p', 'dlg-desc', '_공통 골격이 자동으로 생성돼요.'));

  box.append(el('label', 'dlg-label', '종류 (분야)'));
  const gradeInput = el('input', 'dlg-input');
  gradeInput.type = 'text';
  gradeInput.placeholder = '예: 정보처리';
  gradeInput.setAttribute('list', 'home-grade-list');
  const datalist = document.createElement('datalist');
  datalist.id = 'home-grade-list';
  for (const g of gradeNames) datalist.append(new Option(g, g));
  box.append(gradeInput, datalist);

  box.append(el('label', 'dlg-label', '자격증명'));
  const certInput = el('input', 'dlg-input');
  certInput.type = 'text';
  certInput.placeholder = '예: 정보처리기사';
  box.append(certInput);

  const err = el('div', 'dlg-error');
  err.hidden = true;
  box.append(err);
  const showErr = (msg) => {
    err.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>';
    err.append(document.createTextNode(msg));
    err.hidden = false;
  };

  const actions = el('div', 'dlg-actions');
  const cancel = el('button', 'dlg-btn-cancel', '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const submit = el('button', 'dlg-btn-primary', '생성');
  submit.type = 'button';
  actions.append(cancel, submit);
  box.append(actions);

  submit.addEventListener('click', async () => {
    const 종류 = (gradeInput.value || '').trim().normalize('NFC');
    const 자격증 = (certInput.value || '').trim().normalize('NFC');
    if (!종류 || !자격증) {
      showErr('종류와 자격증명을 모두 입력해 주세요.');
      return;
    }
    submit.disabled = true;
    try {
      const res = await apiFetch('/api/certs', { method: 'POST', body: { 종류, 자격증 } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErr(res.status === 409 ? '이미 있는 자격증이에요.' : data.error || '등록 실패');
        submit.disabled = false;
        return;
      }
      toast(`${자격증} 등록 완료`, 'ok');
      overlay.remove();
      location.hash = certHash(종류, 자격증);
    } catch (e) {
      showErr(e.message);
      submit.disabled = false;
    }
  });

  overlay.append(box);
  document.body.append(overlay);
  gradeInput.focus();
}

export function unmount() {
  view.alive = false;
  if (view.onFs) window.removeEventListener('qnet:fs-change', view.onFs);
  view.onFs = null;
}
