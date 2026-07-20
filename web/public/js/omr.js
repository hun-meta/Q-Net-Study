// OMR 시트: ①~④ 선택 + 찍음 표시. 디바운스 임시저장·이어풀기.
// 정답 미등록 시 열람만(채점 불가). 제출 seam 계약은 worker-3(#6)와 합의된 형태.

import { apiFetch } from './store.js';

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
    return;
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

  // --- 툴바(진행률·경과시간·제출) ---
  const toolbar = el('div', 'omr-toolbar');
  const progress = el('span', 'omr-progress');
  const elapsed = el('span', 'omr-elapsed');
  const submitBtn = el('button', 'btn', '제출·채점');
  const status = el('span', 'error-text');
  toolbar.append(submitBtn, progress, elapsed, status);
  container.append(toolbar);

  // 진행 바(툴바 아래): 트랙 + 채움 요소. 폭은 updateProgress()에서 갱신.
  const progressbar = el('div', 'omr-progressbar');
  const progressFill = el('div', 'omr-progressbar-fill');
  progressbar.append(progressFill);
  container.append(progressbar);

  // 경과시간 라이브 표시. 컨테이너가 사라지면 타이머 자동 정리.
  const fmtElapsed = (ms) => {
    const s = Math.floor(ms / 1000);
    return `경과 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  elapsed.textContent = fmtElapsed(0);
  const timer = setInterval(() => {
    if (!elapsed.isConnected) {
      clearInterval(timer);
      return;
    }
    elapsed.textContent = fmtElapsed(Date.now() - startedAt);
  }, 1000);

  const total = Number(구조.문항수) || 0;
  const rowRefs = {}; // 문번 → { opt버튼들, mark버튼 }

  function updateProgress() {
    const done = Object.keys(answers).filter((k) => answers[k] != null).length;
    progress.textContent = `응답 ${done}/${total}`;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
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
    row.append(el('span', 'qno', String(n)));
    const optBtns = [];
    OPTIONS.forEach((label, idx) => {
      const val = idx + 1;
      const b = el('button', 'omr-opt', label);
      if (answers[n] === val) b.classList.add('sel');
      b.addEventListener('click', () => {
        if (answers[n] === val) {
          delete answers[n]; // 다시 누르면 해제
        } else {
          answers[n] = val;
        }
        optBtns.forEach((ob, i) => ob.classList.toggle('sel', answers[n] === i + 1));
        updateProgress();
        scheduleSave();
      });
      optBtns.push(b);
      row.append(b);
    });
    const mark = el('span', `omr-mark${marked[n] ? ' on' : ''}`, '찍음');
    mark.title = '모르고 찍은 문항 표시(확신도=찍음)';
    mark.addEventListener('click', () => {
      if (marked[n]) delete marked[n];
      else marked[n] = true;
      mark.classList.toggle('on', !!marked[n]);
      scheduleSave();
    });
    row.append(mark);

    // 문항별 개념 보기·챗 트리거(상위에서 콜백 주입).
    if (typeof ctx.onConcept === 'function') {
      const c = el('button', 'omr-qtool', '개념');
      c.title = '이 문항 개념·풀이 보기';
      c.addEventListener('click', () => ctx.onConcept(n));
      row.append(c);
    }
    if (typeof ctx.onChat === 'function') {
      const ch = el('button', 'omr-qtool', '챗');
      ch.title = '이 문항 AI 챗';
      ch.addEventListener('click', () => ctx.onChat(n));
      row.append(ch);
    }
    rowRefs[n] = { optBtns, mark };
    return row;
  }

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
    } catch (_e) {
      /* 자동저장 실패는 조용히 넘어가고 다음 변경에서 재시도 */
    }
  }

  // --- 제출·채점 ---
  submitBtn.addEventListener('click', async () => {
    status.textContent = '';
    submitBtn.disabled = true;
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
    try {
      const res = await apiFetch(`/api/attempts/${encodeURIComponent(id)}/submit`, {
        method: 'POST',
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '제출 실패');
      // 결과 UI(worker-3 result.js)가 수신.
      window.dispatchEvent(new CustomEvent('qnet:attempt-submitted', { detail: data }));
      status.className = '';
      status.textContent = `채점 완료 — 총점 ${data.총점 ?? '?'} (${data.합격여부 ?? ''})`;
      clearInterval(timer);
      // 제출 후 게이트 통과 → 원본(답지 포함) 열람 버튼 제공.
      if (!toolbar.querySelector('.pdf-full-btn')) {
        const fullBtn = el('button', 'btn secondary pdf-full-btn', '원본(답지 포함) 보기');
        fullBtn.addEventListener('click', () => {
          window.open(`/api/exams/${encodeURIComponent(id)}/pdf-full?${q}`, '_blank');
        });
        toolbar.append(fullBtn);
      }
    } catch (e) {
      status.className = 'error-text';
      status.textContent = e.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
