// 문제 개념 및 풀이 보기: 🔁 태그로 연결된 내/타인 노트 섹션 + 공유 해설을 렌더한다.
// 서버(GET /api/concept/:examId/:qno)가 marked로 렌더한 본문html을 제공한다.

// 현재 열려 있는 개념 패널 컨텍스트(파일 변경 시 자동 새로고침용).
let current = null; // { container, examId, qno }

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 서버가 렌더한 html이 있으면 주입, 없으면(marked 부재) 원본 md를 pre로 표시.
function renderBody(item) {
  const body = el('div', 'concept-body md-body');
  if (item.본문html) body.innerHTML = item.본문html;
  else body.append(el('pre', 'concept-md', item.본문md || ''));
  return body;
}

function noteCard(note) {
  const card = el('article', 'concept-note' + (note.본인여부 ? ' mine' : ''));
  const meta = el('div', 'concept-meta');
  meta.append(
    el('span', 'concept-nick', note.본인여부 ? `${note.닉네임} (나)` : note.닉네임),
    el('span', 'concept-subject', `${note.과목} · ${note.섹션제목}`)
  );
  card.append(meta, renderBody({ 본문html: note.본문html, 본문md: note.본문md }));
  return card;
}

function solutionCard(sol) {
  const card = el('article', 'concept-solution');
  card.append(
    el('div', 'concept-meta', `${sol.닉네임} (${sol.날짜})`),
    renderBody({ 본문html: sol.본문html, 본문md: sol.본문 })
  );
  return card;
}

function renderData(container, data) {
  container.innerHTML = '';
  const head = el('h3', 'concept-title', `문제 개념 및 풀이 — ${data.시험} #${data.문번}`);
  container.append(head);

  if ((!data.노트 || data.노트.length === 0) && (!data.해설 || data.해설.length === 0)) {
    container.append(
      el('p', 'concept-empty', '연결된 노트·해설이 없습니다. 노트에 🔁 기출 태그를 남기면 여기에 표시됩니다.')
    );
    return;
  }

  const mine = (data.노트 || []).filter((n) => n.본인여부);
  const others = (data.노트 || []).filter((n) => !n.본인여부);

  if (mine.length) {
    container.append(el('h4', 'concept-section-title', '내 노트'));
    for (const n of mine) container.append(noteCard(n));
  }
  if (others.length) {
    container.append(el('h4', 'concept-section-title', '다른 스터디원 노트'));
    for (const n of others) container.append(noteCard(n));
  }
  if (data.해설 && data.해설.length) {
    container.append(el('h4', 'concept-section-title', '공유 풀이 해설 (_공통/풀이)'));
    for (const s of data.해설) container.append(solutionCard(s));
  }
}

// 개념 패널을 컨테이너에 렌더한다. examId="{연도}-{식별자}-{구분}", qno=문번.
export async function renderConcept(container, examId, qno) {
  current = { container, examId, qno };
  container.innerHTML = '';
  container.append(el('p', 'concept-loading', '개념·풀이를 불러오는 중…'));
  try {
    const url = `/api/concept/${encodeURIComponent(examId)}/${encodeURIComponent(qno)}`;
    // 읽기(GET)는 다른 조회 경로와 일관되게 plain fetch 사용(토큰 불필요).
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '개념 보기를 불러오지 못했습니다.');
    // 응답 도착 시 다른 문항으로 이동했으면 무시.
    if (!current || current.container !== container || current.examId !== examId || current.qno !== qno) return;
    renderData(container, data);
  } catch (e) {
    container.innerHTML = '';
    container.append(el('p', 'concept-error error-text', e.message));
  }
}

// 개념 패널을 닫는다(자동 새로고침 대상에서 해제).
export function closeConcept() {
  current = null;
}

// 파일 변경(SSE) 시 현재 열린 개념 패널을 조용히 새로고침한다.
// 노트/해설 md가 워칭으로 바뀌면 즉시 반영(계획 "워칭 즉시 반영").
window.addEventListener('qnet:fs-change', () => {
  if (current) renderConcept(current.container, current.examId, current.qno);
});
