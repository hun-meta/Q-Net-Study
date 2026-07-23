// OMR: ①~④ 선택(34px 원형) + 찍음 + 문항 도구(개념/챗). 디바운스 임시저장·이어풀기.
// renderOmr → controller(solve 뷰가 진행률·경과·제출·키보드 구동). 정답 미등록 → 등록:false.
// renderAnswerTable → view(답 포함 열람) 모드 정답표(읽기 전용). 서버 /answers 사용.

import { apiFetch, mirrorDraft, removeDraftMirror } from '../store.js';
import { toast } from './toast.js';

const OPTIONS = ['①', '②', '③', '④'];
const DEBOUNCE_MS = 800;
const enc = encodeURIComponent;

const ICON_CONCEPT =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5h5a1.5 1.5 0 0 1 1.5 1.5v8"></path><path d="M13 3.5H8A1.5 1.5 0 0 0 6.5 5v8"></path></svg>';
const ICON_CHAT =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5A1.5 1.5 0 0 1 12 10.5H6l-3 2.5V4z"></path></svg>';
// 눈(👁) 아이콘 — solve 모드 "정답 보기" 버튼(개념/챗과 동일 스트로크 스타일).
const ICON_EYE =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"></path><circle cx="8" cy="8" r="1.8"></circle></svg>';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function subjectHeader(name, from, to) {
  const h = el('div', 'omr-subject');
  h.append(el('span', 'omr-subject-name', name), el('span', 'omr-subject-range', `${from}–${to}`), el('div', 'omr-subject-line'));
  return h;
}

// renderOmr(container, ctx) → controller | { 등록:false, unmount }
// ctx: { grade, cert, id, onProgress?(done,total), onConcept?(qno), onChat?(qno), onCurrentChange?(qno) }
export async function renderOmr(container, ctx) {
  const { grade, cert, id } = ctx;
  container.innerHTML = '<p class="loading" style="padding:16px">OMR 불러오는 중…</p>';

  const q = `grade=${enc(grade)}&cert=${enc(cert)}`;
  const 구조 = await getJson(`/api/exams/${enc(id)}/omr?${q}`);
  container.innerHTML = '';

  if (!구조.등록) {
    // 정답 미등록(열람만) — solve 뷰가 안내 카드/비활성 제출을 담당. 등록 시 자동 재시도.
    const onFs = () => {
      window.removeEventListener('qnet:fs-change', onFs);
      if (container.isConnected) renderOmr(container, ctx).catch(() => {});
    };
    window.addEventListener('qnet:fs-change', onFs);
    return {
      등록: false,
      unmount() {
        window.removeEventListener('qnet:fs-change', onFs);
      },
    };
  }

  const answers = {}; // { 문번: 1~4 }
  const marked = {}; // { 문번: true }
  const 정답열람 = {}; // { 문번: true } — "정답 보기"를 한 번이라도 연 문항(드래프트 지속)
  const 정답캐시 = {}; // { 문번: 1~4 } — 단건 fetch 결과 캐시(중복 요청 방지)
  const 정답표시 = {}; // { 문번: true } — 현재 라벨을 화면에 보여주는 중인지(비지속)
  let 찍음안내됨 = false; // 정답 열람 → 자동 찍음 안내 토스트 1회 가드
  const startedAt = Date.now();

  try {
    const { draft } = await getJson(`/api/draft/${enc(id)}`);
    if (draft && draft.answers) Object.assign(answers, draft.answers);
    if (draft && draft.찍음) Object.assign(marked, draft.찍음);
    if (draft && draft.정답열람) Object.assign(정답열람, draft.정답열람);
  } catch (_e) {
    /* 드래프트 없음 — 새로 시작 */
  }

  const total = Number(구조.문항수) || 0;
  const rowRefs = {};
  let currentN = null;

  function doneCount() {
    return Object.keys(answers).filter((k) => answers[k] != null).length;
  }
  function guessedCount() {
    return Object.keys(marked).filter((k) => marked[k]).length;
  }
  function updateProgress() {
    if (typeof ctx.onProgress === 'function') ctx.onProgress(doneCount(), total, guessedCount());
  }

  for (const subj of 구조.과목들 || []) {
    container.append(subjectHeader(subj.과목명, subj.시작, subj.끝));
    for (let n = subj.시작; n <= subj.끝; n += 1) container.append(renderRow(n));
  }
  updateProgress();

  function toolBtn(kind, n) {
    const b = el('button', 'omr-tool-btn');
    b.type = 'button';
    b.innerHTML = kind === 'concept' ? ICON_CONCEPT : ICON_CHAT;
    b.title = kind === 'concept' ? '개념 보기' : '문항 챗';
    b.setAttribute('aria-label', `${n}번 ${kind === 'concept' ? '개념 보기' : '챗'}`);
    b.addEventListener('click', () => {
      setCurrent(n);
      if (kind === 'concept') ctx.onConcept(n);
      else ctx.onChat(n);
    });
    return b;
  }

  function renderRow(n) {
    const row = el('div', 'omr-row');
    row.dataset.qno = String(n);
    row.append(el('span', 'omr-qno', String(n)));

    const opts = el('div', 'omr-opts');
    const optBtns = [];
    OPTIONS.forEach((label, idx) => {
      const val = idx + 1;
      const b = el('button', 'omr-opt' + (answers[n] === val ? ' sel' : ''), label);
      b.type = 'button';
      b.setAttribute('aria-label', `${n}번 ${val}번 보기 선택`);
      b.addEventListener('click', () => {
        setCurrent(n);
        setOption(n, val, true);
      });
      optBtns.push(b);
      opts.append(b);
    });
    row.append(opts);

    const guess = el('button', 'omr-guess' + (marked[n] ? ' on' : ''));
    guess.type = 'button';
    guess.title = '모르고 찍은 문항 표시(확신도=찍음)';
    guess.setAttribute('aria-label', `${n}번 찍음 표시 토글`);
    const gbox = el('span', 'omr-guess-box');
    gbox.textContent = marked[n] ? '✓' : '';
    guess.append(gbox, document.createTextNode('찍음'));
    guess.addEventListener('click', () => {
      setCurrent(n);
      toggleMark(n);
    });
    row.append(guess);

    // solve 모드 인라인 정답 라벨(view 모드 omr-answer-label 스타일 재사용). 기본 숨김.
    const ansLabel = el('span', 'omr-answer-label');
    ansLabel.hidden = true;
    const ansGlyph = el('span', 'omr-answer-glyph', '—');
    ansLabel.append(document.createTextNode('정답 '), ansGlyph);
    row.append(ansLabel);

    const tools = el('div', 'omr-tools');
    // "정답 보기"(👁) — 개념/챗 버튼 옆에 배치. 클릭 시 단건 정답을 열람/숨김 토글.
    const ansBtn = el('button', 'omr-tool-btn');
    ansBtn.type = 'button';
    ansBtn.innerHTML = ICON_EYE;
    ansBtn.title = '정답 보기';
    ansBtn.setAttribute('aria-label', `${n}번 정답 보기`);
    // 드래프트 복원 시 이전 열람 문항은 표시는 숨긴 채(더 단순한 쪽) 버튼만 '열람함'으로 둔다.
    if (정답열람[n]) ansBtn.classList.add('viewed');
    ansBtn.addEventListener('click', () => {
      setCurrent(n);
      toggleAnswer(n);
    });
    tools.append(ansBtn);
    if (typeof ctx.onConcept === 'function') tools.append(toolBtn('concept', n));
    if (typeof ctx.onChat === 'function') tools.append(toolBtn('chat', n));
    row.append(tools);

    rowRefs[n] = { row, optBtns, guess, gbox, ansBtn, ansLabel, ansGlyph };
    return row;
  }

  // 단건 정답 fetch(캐시). solve 설계 원칙상 요청한 문항 하나만 서버에서 내려온다.
  async function fetchAnswer(n) {
    if (정답캐시[n] != null) return 정답캐시[n];
    const res = await fetch(`/api/exams/${enc(id)}/answer/${n}?${q}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `정답을 불러오지 못했어요 (${res.status})`);
    }
    const data = await res.json();
    정답캐시[n] = data.정답;
    return data.정답;
  }

  function showAnswer(n, key) {
    const refs = rowRefs[n];
    if (!refs) return;
    정답표시[n] = true;
    refs.ansGlyph.textContent = key >= 1 && key <= 4 ? OPTIONS[key - 1] : '—';
    refs.ansLabel.hidden = false;
    refs.optBtns.forEach((ob, i) => ob.classList.toggle('ans', key === i + 1));
    refs.ansBtn.classList.add('on');
    refs.ansBtn.classList.remove('viewed');
    refs.ansBtn.title = '정답 숨기기';
    refs.ansBtn.setAttribute('aria-label', `${n}번 정답 숨기기`);
  }

  function hideAnswer(n) {
    const refs = rowRefs[n];
    if (!refs) return;
    정답표시[n] = false;
    refs.ansLabel.hidden = true;
    refs.optBtns.forEach((ob) => ob.classList.remove('ans'));
    refs.ansBtn.classList.remove('on');
    // 표시만 숨기고 열람 이력은 유지 → 버튼은 '열람함' 상태로 남긴다.
    if (정답열람[n]) refs.ansBtn.classList.add('viewed');
    refs.ansBtn.title = '정답 보기';
    refs.ansBtn.setAttribute('aria-label', `${n}번 정답 보기`);
  }

  async function toggleAnswer(n) {
    const refs = rowRefs[n];
    if (!refs) return;
    if (정답표시[n]) {
      hideAnswer(n); // 표시만 숨김(열람 이력 유지)
      return;
    }
    let key;
    try {
      key = await fetchAnswer(n);
    } catch (err) {
      toast(err.message, 'error'); // fetch 실패(404 등)는 토스트로 안내
      return;
    }
    // 무결성 규칙: 최초 열람 + 미응답이면 자동 찍음(복습 대상에 포함). 이미 응답한 문항은 제외.
    const 최초열람 = !정답열람[n];
    if (최초열람 && answers[n] == null && !marked[n]) {
      toggleMark(n); // 기존 찍음 경로로 UI·카운터·저장 갱신(marked[n]=true)
      if (!찍음안내됨) {
        찍음안내됨 = true;
        toast("정답을 본 문항은 '찍음'으로 표시돼 복습 대상에 들어가요.", 'info');
      }
    }
    정답열람[n] = true;
    showAnswer(n, key);
    scheduleSave();
  }

  function setOption(n, val, fromClick) {
    if (fromClick && answers[n] === val) delete answers[n];
    else answers[n] = val;
    const refs = rowRefs[n];
    if (refs) refs.optBtns.forEach((ob, i) => ob.classList.toggle('sel', answers[n] === i + 1));
    updateProgress();
    scheduleSave();
  }
  function toggleMark(n) {
    if (marked[n]) delete marked[n];
    else marked[n] = true;
    const refs = rowRefs[n];
    if (refs) {
      refs.guess.classList.toggle('on', !!marked[n]);
      refs.gbox.textContent = marked[n] ? '✓' : '';
    }
    updateProgress(); // 찍음 수 카운터 갱신(솔브바 onProgress가 guessed 재조회)
    scheduleSave();
  }
  function setCurrent(n) {
    if (n == null || !rowRefs[n] || currentN === n) return;
    if (currentN != null && rowRefs[currentN]) rowRefs[currentN].row.classList.remove('current');
    currentN = n;
    rowRefs[n].row.classList.add('current');
    rowRefs[n].row.scrollIntoView({ block: 'nearest' });
    if (typeof ctx.onCurrentChange === 'function') ctx.onCurrentChange(n);
  }
  function moveCurrent(delta) {
    if (currentN == null) return;
    let n = currentN + delta;
    while (n >= 1 && n <= total && !rowRefs[n]) n += delta;
    if (rowRefs[n]) setCurrent(n);
  }

  // 초기 현재 문항: 이어풀기 시 첫 미응답(없으면 마지막), 아니면 첫 문항.
  const orderedNos = [];
  for (const subj of 구조.과목들 || []) {
    for (let n = subj.시작; n <= subj.끝; n += 1) if (rowRefs[n]) orderedNos.push(n);
  }
  if (orderedNos.length) {
    const firstUnanswered = orderedNos.find((n) => answers[n] == null);
    setCurrent(firstUnanswered != null ? firstUnanswered : orderedNos[orderedNos.length - 1]);
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, DEBOUNCE_MS);
  }
  async function saveDraft() {
    saveTimer = null;
    try {
      await apiFetch(`/api/draft/${enc(id)}`, { method: 'PUT', body: { answers, 찍음: marked, 정답열람, grade, cert } });
      try {
        mirrorDraft({ grade, cert, examId: id, done: doneCount(), total, ts: Date.now() });
      } catch (_e) {
        /* 미러 부가 */
      }
    } catch (_e) {
      /* 자동저장 실패는 조용히 재시도 */
    }
  }

  async function submit() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const answersOut = {};
    for (let n = 1; n <= total; n += 1) answersOut[n] = answers[n] != null ? answers[n] : null;
    const body = {
      grade,
      cert,
      answers: answersOut,
      찍음: marked,
      소요시간: Math.max(0, Math.round((Date.now() - startedAt) / 60000)),
    };
    const res = await apiFetch(`/api/attempts/${enc(id)}/submit`, { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '제출 실패');
    window.dispatchEvent(new CustomEvent('qnet:attempt-submitted', { detail: data }));
    try {
      removeDraftMirror(grade, cert, id);
    } catch (_e) {
      /* 미러 정리 부가 */
    }
    return data;
  }

  return {
    등록: true,
    total,
    get answered() {
      return doneCount();
    },
    get guessed() {
      return Object.keys(marked).filter((k) => marked[k]).length;
    },
    get current() {
      return currentN;
    },
    setCurrent,
    moveCurrent,
    setOption(n, val) {
      setCurrent(n);
      setOption(n, val, false);
    },
    toggleMark(n) {
      setCurrent(n);
      toggleMark(n);
    },
    submit,
    getElapsedMs() {
      return Date.now() - startedAt;
    },
    unmount() {
      if (saveTimer) clearTimeout(saveTimer);
    },
  };
}

// view(답 포함 열람) 모드 정답표(읽기 전용). 서버 GET /api/exams/:id/answers.
// ctx: { grade, cert, id, onConcept?(qno), onChat?(qno) } — 콜백을 주면 문항별 개념/챗 버튼 표시.
export async function renderAnswerTable(container, ctx) {
  const { grade, cert, id } = ctx;
  container.innerHTML = '<p class="loading" style="padding:16px">정답표 불러오는 중…</p>';
  const q = `grade=${enc(grade)}&cert=${enc(cert)}`;
  const res = await fetch(`/api/exams/${enc(id)}/answers?${q}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    container.innerHTML = '';
    container.append(el('p', 'exam-notice', e.error || '정답표를 불러오지 못했어요.'));
    return { 등록: false };
  }
  const data = await res.json();
  container.innerHTML = '';
  let total = 0;
  for (const subj of data.과목들 || []) {
    container.append(subjectHeader(subj.과목명, subj.시작, subj.끝));
    for (let n = subj.시작; n <= subj.끝; n += 1) {
      total += 1;
      const key = subj.정답 && subj.정답[n];
      const row = el('div', 'omr-row view');
      row.append(el('span', 'omr-qno', String(n)));
      const opts = el('div', 'omr-opts');
      OPTIONS.forEach((label, idx) => {
        const on = key === idx + 1;
        opts.append(el('div', 'omr-opt-v' + (on ? ' correct' : ''), label));
      });
      row.append(opts);
      const ans = el('span', 'omr-answer-label');
      ans.append(document.createTextNode('정답 '), el('span', 'omr-answer-glyph', key ? OPTIONS[key - 1] : '—'));
      row.append(ans);

      // 열람 모드에서도 문항별 개념/챗 진입(시험치기와 동일 버튼).
      const tools = el('div', 'omr-tools');
      for (const kind of ['concept', 'chat']) {
        const cb = kind === 'concept' ? ctx.onConcept : ctx.onChat;
        if (typeof cb !== 'function') continue;
        const qno = n;
        const b = el('button', 'omr-tool-btn');
        b.type = 'button';
        b.innerHTML = kind === 'concept' ? ICON_CONCEPT : ICON_CHAT;
        b.title = kind === 'concept' ? '개념 보기' : '문항 챗';
        b.setAttribute('aria-label', `${qno}번 ${kind === 'concept' ? '개념 보기' : '챗'}`);
        b.addEventListener('click', () => cb(qno));
        tools.append(b);
      }
      if (tools.childNodes.length) row.append(tools);

      container.append(row);
    }
  }
  return { 등록: true, 문항수: data.문항수 || total };
}
