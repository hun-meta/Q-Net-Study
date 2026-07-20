// OMR 레일: ①~④ 선택 + 찍음 표시. 디바운스 임시저장·이어풀기.
// 솔브 뷰(views/solve.js)가 renderOmr가 반환한 controller로 솔브바(진행률·경과·제출)와
// 키보드를 구동한다. 정답 미등록 시 열람만(채점 불가) → controller 없이 null 반환.
//
// 계산 로직 계약(불변): 드래프트 선로드 / 디바운스 저장 / 제출 시 무응답 null 채움 / 소요시간(분).
// 드래프트 미러: 저장 성공 시 mirrorDraft, 제출 성공 시 removeDraftMirror(로컬 이어풀기 목록 갱신).

import { apiFetch, mirrorDraft, removeDraftMirror } from '../store.js';

const OPTIONS = ['①', '②', '③', '④']; // 표시용. 값은 index+1 (1~4).
const DEBOUNCE_MS = 800;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// renderOmr(container, ctx) → controller | null
// ctx: { grade, cert, id, onProgress?(done,total), onConcept?(qno), onChat?(qno), onCurrentChange?(qno) }
export async function renderOmr(container, ctx) {
  const { grade, cert, id } = ctx;
  container.innerHTML = '<p class="loading">OMR 불러오는 중…</p>';

  const q = `grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}`;
  const 구조 = await getJson(`/api/exams/${encodeURIComponent(id)}/omr?${q}`);

  container.innerHTML = '';

  if (!구조.등록) {
    container.append(
      el('p', 'exam-notice', '정답이 등록되지 않은 기출입니다 — 채점 불가(열람만 가능).')
    );
    // 정답이 나중에 등록되면(fs-change) 자동 재시도. 컨테이너가 사라지면 리스너 해제(누수 방지).
    const onFs = () => {
      window.removeEventListener('qnet:fs-change', onFs);
      if (container.isConnected) renderOmr(container, ctx).catch(() => {});
    };
    window.addEventListener('qnet:fs-change', onFs);
    return null;
  }

  // 상태: 답(1~4), 찍음(bool). 이어풀기용 드래프트 선로드.
  const answers = {}; // { 문번: 1~4 }
  const marked = {}; // { 문번: true }
  const startedAt = Date.now();

  try {
    const { draft } = await getJson(`/api/draft/${encodeURIComponent(id)}`);
    if (draft && draft.answers) Object.assign(answers, draft.answers);
    if (draft && draft.찍음) Object.assign(marked, draft.찍음);
  } catch (_e) {
    /* 드래프트 없음/실패는 무시하고 새로 시작 */
  }

  const total = Number(구조.문항수) || 0;
  const rowRefs = {}; // 문번 → { row, optBtns, mark }
  let currentN = null; // 현재 문항(키보드·하이라이트 대상)

  function doneCount() {
    return Object.keys(answers).filter((k) => answers[k] != null).length;
  }
  function updateProgress() {
    if (typeof ctx.onProgress === 'function') ctx.onProgress(doneCount(), total);
  }

  // --- 과목별 문항 렌더 ---
  for (const subj of 구조.과목들 || []) {
    container.append(el('div', 'omr-subject', `${subj.과목명} (${subj.시작}-${subj.끝})`));
    for (let n = subj.시작; n <= subj.끝; n += 1) {
      container.append(renderRow(n));
    }
  }
  updateProgress();

  function renderRow(n) {
    const row = el('div', 'omr-row');
    row.dataset.qno = String(n);
    row.append(el('span', 'qno', String(n)));
    const optBtns = [];
    OPTIONS.forEach((label, idx) => {
      const val = idx + 1;
      const b = el('button', 'omr-opt', label);
      b.setAttribute('aria-label', `${n}번 ${val}번 보기 선택`);
      if (answers[n] === val) b.classList.add('sel');
      b.addEventListener('click', () => {
        setCurrent(n);
        setOption(n, val, true); // 클릭: 같은 값 재선택 시 해제
      });
      optBtns.push(b);
      row.append(b);
    });
    const mark = el('span', `omr-mark${marked[n] ? ' on' : ''}`, '찍음');
    mark.title = '모르고 찍은 문항 표시(확신도=찍음)';
    mark.setAttribute('role', 'button');
    mark.setAttribute('tabindex', '0');
    mark.setAttribute('aria-label', `${n}번 찍음 표시 토글`);
    const markToggle = () => {
      setCurrent(n);
      toggleMark(n);
    };
    mark.addEventListener('click', markToggle);
    mark.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        markToggle();
      }
    });
    row.append(mark);

    // 문항별 개념 보기·챗 트리거(상위에서 콜백 주입).
    if (typeof ctx.onConcept === 'function') {
      const c = el('button', 'omr-qtool', '개념');
      c.title = '이 문항 개념·풀이 보기';
      c.setAttribute('aria-label', `${n}번 개념 보기`);
      c.addEventListener('click', () => {
        setCurrent(n);
        ctx.onConcept(n);
      });
      row.append(c);
    }
    if (typeof ctx.onChat === 'function') {
      const ch = el('button', 'omr-qtool', '챗');
      ch.title = '이 문항 AI 챗';
      ch.setAttribute('aria-label', `${n}번 챗`);
      ch.addEventListener('click', () => {
        setCurrent(n);
        ctx.onChat(n);
      });
      row.append(ch);
    }
    rowRefs[n] = { row, optBtns, mark };
    return row;
  }

  // --- 상태 변경 ---
  function setOption(n, val, fromClick) {
    if (fromClick && answers[n] === val) {
      delete answers[n]; // 클릭 시 같은 값 다시 누르면 해제
    } else {
      answers[n] = val;
    }
    const refs = rowRefs[n];
    if (refs) refs.optBtns.forEach((ob, i) => ob.classList.toggle('sel', answers[n] === i + 1));
    updateProgress();
    scheduleSave();
  }
  function toggleMark(n) {
    if (marked[n]) delete marked[n];
    else marked[n] = true;
    const refs = rowRefs[n];
    if (refs) refs.mark.classList.toggle('on', !!marked[n]);
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
    while (n >= 1 && n <= total && !rowRefs[n]) n += delta; // 빈 번호 건너뛰기
    if (rowRefs[n]) setCurrent(n);
  }

  // 초기 현재 문항: 첫 문항.
  const first = 구조.과목들 && 구조.과목들[0] ? 구조.과목들[0].시작 : null;
  if (first != null) setCurrent(first);

  // --- 디바운스 임시저장 ---
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, DEBOUNCE_MS);
  }
  async function saveDraft() {
    saveTimer = null;
    try {
      await apiFetch(`/api/draft/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { answers, 찍음: marked, grade, cert },
      });
      // 저장 성공 → 로컬 이어풀기 미러 갱신(실패해도 저장 자체엔 영향 없음).
      try {
        mirrorDraft({ grade, cert, examId: id, done: doneCount(), total, ts: Date.now() });
      } catch (_e) {
        /* 미러는 부가 — 실패 무시 */
      }
    } catch (_e) {
      /* 자동저장 실패는 조용히 넘어가고 다음 변경에서 재시도 */
    }
  }

  // --- 제출·채점 ---
  // 결과 UI(result.js)가 qnet:attempt-submitted 로 수신. 반환값은 솔브바 상태 표시에 사용.
  async function submit() {
    // 마지막 변경을 즉시 반영(디바운스 대기 취소).
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // 무응답은 null로 채운다(계약: answers:{[문번]:1~4|null}).
    const answersOut = {};
    for (let n = 1; n <= total; n += 1) answersOut[n] = answers[n] != null ? answers[n] : null;
    const body = {
      grade,
      cert,
      answers: answersOut,
      찍음: marked,
      소요시간: Math.max(0, Math.round((Date.now() - startedAt) / 60000)),
    };
    const res = await apiFetch(`/api/attempts/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '제출 실패');
    window.dispatchEvent(new CustomEvent('qnet:attempt-submitted', { detail: data }));
    // 제출 성공 → 로컬 이어풀기 미러 제거(서버는 draft 삭제됨).
    try {
      removeDraftMirror(grade, cert, id);
    } catch (_e) {
      /* 미러 정리는 부가 — 실패 무시 */
    }
    return data;
  }

  return {
    등록: true,
    total,
    get current() {
      return currentN;
    },
    setCurrent,
    moveCurrent,
    // 키보드용: 대상 문항을 현재로 만들고 값 설정(토글 없이 지정).
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
  };
}
