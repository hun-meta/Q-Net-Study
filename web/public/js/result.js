// 채점 결과·추이·키워드 폼: 제출(qnet:attempt-submitted) 후 결과를 렌더한다.
// - 채점표: 총점·합격 판정·과목별 점수/과락·X수·O찍음수·확신 정답률
// - 추이: 같은 기출 시도별 총점 변화 (GET /api/attempts)
// - 키워드 폼: X·찍음 문항의 개념 키워드/메모 입력 → POST keywords (선택·건너뛰기 가능)

import { apiFetch } from './store.js';

const 원문자 = ['①', '②', '③', '④'];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 합격여부 → 배지 클래스
function 판정클래스(합격여부) {
  if (합격여부 === '합격') return 'pass';
  if (합격여부 === '과락') return 'fail flunk';
  return 'fail';
}

function renderScoreboard(data) {
  const box = el('section', 'result-scoreboard');
  const head = el('div', 'result-head');
  const verdict = el('span', `result-verdict ${판정클래스(data.합격여부)}`, data.합격여부);
  head.append(
    el('h3', 'result-title', `${data.시험} — ${data.시도}차 시도 채점 결과`),
    verdict
  );
  box.append(head);

  const 총점 = Number(data.총점).toFixed(1);
  const pct = data.확신정답률 == null ? '-' : `${data.확신정답률}%`;
  const 요약 = el('div', 'result-summary');
  요약.append(
    stat('총점', 총점),
    stat('틀린 문항(X)', `${data.X수}개`),
    stat('찍어서 맞음(O+찍음)', `${data.O찍음수}개`),
    stat('확신 정답률', pct)
  );
  box.append(요약);

  // 과목별 표
  const table = el('table', 'result-subjects');
  const thead = el('thead');
  thead.innerHTML = '<tr><th>과목</th><th>점수</th><th>판정</th></tr>';
  const tbody = el('tbody');
  for (const s of data.과목결과) {
    const tr = el('tr');
    tr.append(
      el('td', null, s.과목명),
      el('td', 's-score', String(s.점수)),
      el('td', null, s.과락 ? '과락' : '통과')
    );
    if (s.과락) tr.classList.add('flunk-row');
    tbody.append(tr);
  }
  table.append(thead, tbody);
  box.append(table);
  return box;
}

function stat(label, value) {
  const s = el('div', 'result-stat');
  s.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return s;
}

// 시도별 추이(총점 시퀀스). 서버에서 이력을 받아 렌더.
async function renderTrend(container, data) {
  try {
    const params = new URLSearchParams({ grade: data.grade, cert: data.cert, examId: data.시험 });
    const res = await apiFetch(`/api/attempts?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || '추이를 불러오지 못했습니다.');
    const seq = (payload.trend && payload.trend[data.시험]) || [];
    if (seq.length < 2) return; // 추이는 2회 이상일 때만 의미
    const box = el('section', 'result-trend');
    box.append(el('h4', 'result-subtitle', '시도별 추이'));
    const line = seq
      .map((t) => `${t.시도}차 ${Number(t.총점).toFixed(1)}`)
      .join('  →  ');
    box.append(el('div', 'trend-line', line));
    container.append(box);
  } catch (_e) {
    /* 추이는 부가정보 — 실패해도 채점 결과 표시엔 영향 없음 */
  }
}

// 키워드/메모 폼: X·찍음 문항 대상(선택·건너뛰기 가능).
function renderKeywordForm(container, data) {
  const targets = data.wrongTargets || [];
  if (targets.length === 0) return;

  const box = el('section', 'result-keywords');
  box.append(el('h4', 'result-subtitle', '개념 키워드 보강 (선택 — 건너뛸 수 있습니다)'));
  box.append(
    el('p', 'result-hint', 'X·찍음 문항의 개념 키워드를 남기면 attempt·WRONG(복습 재료)에 반영됩니다.')
  );

  const inputs = new Map();
  for (const t of targets) {
    const row = el('div', 'keyword-row');
    const label = el('label', 'keyword-label', `#${t.문번} (${t.과목명} · ${t.결과}/${t.확신도})`);
    const input = el('input', 'keyword-input');
    input.type = 'text';
    input.placeholder = '개념 키워드 / 메모';
    inputs.set(t.문번, input);
    row.append(label, input);
    box.append(row);
  }

  const actions = el('div', 'keyword-actions');
  const save = el('button', 'btn', '키워드 저장');
  const skip = el('button', 'btn secondary', '건너뛰기');
  const msg = el('span', 'keyword-msg');
  actions.append(save, skip, msg);
  box.append(actions);

  skip.addEventListener('click', () => box.remove());

  save.addEventListener('click', async () => {
    const 키워드맵 = {};
    for (const [문번, input] of inputs) {
      const v = input.value.trim();
      if (v) 키워드맵[문번] = v;
    }
    if (Object.keys(키워드맵).length === 0) {
      box.remove();
      return;
    }
    save.disabled = true;
    msg.textContent = '저장 중…';
    try {
      const res = await apiFetch(`/api/attempts/${encodeURIComponent(data.시험)}/keywords`, {
        method: 'POST',
        body: { grade: data.grade, cert: data.cert, 시도: data.시도, 키워드맵 },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '키워드 저장 실패');
      msg.className = 'keyword-msg ok';
      msg.textContent = '저장됨 — WRONG.md에 반영되었습니다.';
      save.disabled = true;
      skip.textContent = '닫기';
    } catch (e) {
      save.disabled = false;
      msg.className = 'keyword-msg error-text';
      msg.textContent = e.message;
    }
  });

  container.append(box);
}

// 제출 응답을 컨테이너에 렌더한다.
export function renderResult(container, data) {
  container.innerHTML = '';
  container.append(renderScoreboard(data));
  renderKeywordForm(container, data);
  renderTrend(container, data);
}

// 결과 전용 컨테이너(#result)에만 렌더한다. 없으면 no-op —
// 과거 #app 폴백은 기출 브라우저 전체(#app)를 innerHTML=''로 파괴하는 버그였다(제거).
function resultContainer() {
  return document.getElementById('result');
}

// 제출 성공 이벤트 수신 → 채점 결과 렌더(#result 존재 시에만).
window.addEventListener('qnet:attempt-submitted', (evt) => {
  const data = evt.detail;
  if (!data || !data.ok) return;
  const container = resultContainer();
  if (container) {
    renderResult(container, data);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
