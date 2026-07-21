// 자격증 정리 모음(#/cert/{분야}/{자격증}/notes):
// 참여자 전원의 개념 노트(개인 notes/ — 기존 비공유 포함)와 공유 풀이(_공통/풀이/)를
// 한 화면에서 열람한다. 타인 정리는 읽기 전용(수정 경로 없음). 저자 필터로 좁혀 볼 수 있다.

import { getState } from '../store.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function svg(html, cls) {
  const s = el('span', cls);
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
const enc = encodeURIComponent;

const LOCK_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3.5" y="7" width="9" height="6" rx="1.2"></rect><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>';

const view = { alive: false, onFs: null, data: null, filter: '전체', grade: null, cert: null };

export async function mount(container, { grade, cert }) {
  view.alive = true;
  view.data = null;
  view.filter = '전체';
  view.grade = grade;
  view.cert = cert;
  container.innerHTML = '';
  const page = el('section', 'cn');
  page.append(el('p', 'loading', '정리를 불러오는 중…'));
  container.append(page);

  const me = getState().nickname;

  async function load() {
    let data;
    try {
      data = await getJson(`/api/notes/${enc(grade)}/${enc(cert)}`);
    } catch (e) {
      if (!view.alive) return;
      page.innerHTML = '';
      page.append(el('p', 'error-text', e.message));
      return;
    }
    if (!view.alive) return;
    view.data = data;
    paint();
  }

  function authorList() {
    const 노트 = view.data.노트 || [];
    const 풀이 = view.data.풀이 || [];
    const order = [];
    const seen = new Set();
    const add = (n) => {
      if (n && !seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
    };
    if (me) add(me);
    for (const n of 노트) add(n.닉네임);
    for (const p of 풀이) add(p.닉네임);
    return order;
  }

  function paint() {
    page.innerHTML = '';
    const data = view.data;
    const 노트All = data.노트 || [];
    const 풀이All = data.풀이 || [];

    // 헤더.
    const head = el('div', 'cn-head');
    const hL = el('div');
    hL.append(el('h1', 'cn-title', '정리 모음'));
    hL.append(
      el(
        'p',
        'cn-sub',
        `참여자 ${data.participants.length}명 · 개념 노트 ${노트All.length}개 · 공유 풀이 ${풀이All.length}개`
      )
    );
    head.append(hL);
    page.append(head);

    // 저자 필터 칩.
    const chips = el('div', 'cn-filters');
    const mkChip = (label, value) => {
      const c = el('button', 'cn-chip' + (view.filter === value ? ' active' : ''), label);
      c.type = 'button';
      c.addEventListener('click', () => {
        view.filter = value;
        paint();
      });
      return c;
    };
    chips.append(mkChip('전체', '전체'));
    for (const a of authorList()) chips.append(mkChip(a === me ? `${a} (나)` : a, a));
    page.append(chips);

    const pass = (nick) => view.filter === '전체' || nick === view.filter;
    const 노트 = 노트All.filter((n) => pass(n.닉네임));
    const 풀이 = 풀이All.filter((p) => pass(p.닉네임));

    // ── 개념 노트 섹션(과목별 그룹) ──
    const sec1 = el('div', 'cn-section');
    const t1 = el('div', 'cn-section-title');
    t1.append(el('span', null, '개념 노트'), el('span', 'cn-count', String(노트.length)));
    sec1.append(t1);
    if (노트.length === 0) {
      sec1.append(el('p', 'cn-empty', '표시할 개념 노트가 없어요.'));
    } else {
      const byGrade = groupBy(노트, (n) => n.과목 || '(기타)');
      for (const 과목 of Object.keys(byGrade).sort()) {
        const g = el('div', 'cn-group');
        g.append(el('div', 'cn-group-label', 과목));
        for (const n of byGrade[과목].sort((a, b) => (a.항목 || '').localeCompare(b.항목 || ''))) {
          g.append(noteCard(n, me));
        }
        sec1.append(g);
      }
    }
    page.append(sec1);

    // ── 공유 풀이 섹션(시험별 그룹, 최신 내림차순) ──
    const sec2 = el('div', 'cn-section');
    const t2 = el('div', 'cn-section-title');
    t2.append(el('span', null, '공유 풀이'), el('span', 'cn-count', String(풀이.length)));
    sec2.append(t2);
    if (풀이.length === 0) {
      sec2.append(el('p', 'cn-empty', '표시할 공유 풀이가 없어요.'));
    } else {
      const byExam = groupBy(풀이, (p) => p.examId);
      for (const examId of Object.keys(byExam).sort().reverse()) {
        const g = el('div', 'cn-group');
        g.append(el('div', 'cn-group-label', examId));
        const rows = byExam[examId].slice().sort((a, b) => Number(a.문번) - Number(b.문번));
        for (const p of rows) g.append(solutionCard(p, me));
        sec2.append(g);
      }
    }
    page.append(sec2);
  }

  view.onFs = () => {
    if (view.alive) load();
  };
  window.addEventListener('qnet:fs-change', view.onFs);
  await load();
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

function authorBadge(nick, mine) {
  const b = el('span', 'cn-author' + (mine ? ' mine' : ''), mine ? `${nick} (나)` : nick);
  return b;
}

function noteCard(n, me) {
  const mine = !!n.본인여부;
  const d = el('details', 'cn-note' + (mine ? ' mine' : ''));
  const sum = el('summary', 'cn-note-sum');
  const left = el('div', 'cn-note-head');
  left.append(authorBadge(n.닉네임, mine));
  left.append(el('span', 'cn-note-item', n.항목 || n.주요항목 || '(제목 없음)'));
  const meta = el('div', 'cn-note-meta');
  if (n.진행도) meta.append(el('span', 'cn-tag', n.진행도));
  if (n.갱신일) meta.append(el('span', 'cn-date', n.갱신일));
  for (const ref of n.기출참조 || []) meta.append(el('span', 'cn-ref', `🔁 ${ref}`));
  if (!mine) meta.append(svg(LOCK_SVG, 'cn-lock'));
  left.append(meta);
  sum.append(left);
  d.append(sum);
  const body = el('div', 'md-body cn-body');
  if (n.본문html) body.innerHTML = n.본문html;
  else body.append(el('pre', 'cn-pre', n.본문md || ''));
  d.append(body);
  return d;
}

function solutionCard(p, me) {
  const mine = !!p.본인여부;
  const d = el('details', 'cn-note' + (mine ? ' mine' : ''));
  const sum = el('summary', 'cn-note-sum');
  const left = el('div', 'cn-note-head');
  left.append(el('span', 'cn-qno', `#${p.문번}`));
  left.append(authorBadge(p.닉네임, mine));
  const meta = el('div', 'cn-note-meta');
  if (p.날짜) meta.append(el('span', 'cn-date', p.날짜));
  if (!mine) meta.append(svg(LOCK_SVG, 'cn-lock'));
  left.append(meta);
  sum.append(left);
  d.append(sum);
  const body = el('div', 'md-body cn-body');
  if (p.본문html) body.innerHTML = p.본문html;
  else body.append(el('pre', 'cn-pre', p.본문md || ''));
  d.append(body);
  return d;
}

export function unmount() {
  view.alive = false;
  if (view.onFs) window.removeEventListener('qnet:fs-change', view.onFs);
  view.onFs = null;
  view.data = null;
}
