// 기출 PDF 업로드 → 추출(cliRoutes) → 실패 시 수동 정답 입력 폼(examList.js answer-key 라우트).
// 막다른 길 없음: 자동 추출 불가/검증 실패 시 사용자가 직접 정답 md 를 생성한다.

import { apiFetch } from './store.js';

const EXAM_ID = /^\d{4}-[0-9A-Za-z가-힣]+-(필기|실기)$/u;
const OPTIONS = ['①', '②', '③', '④'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('파일 읽기 실패'));
    r.readAsDataURL(file);
  });
}

export function renderUploadPanel(container, scope, onDone) {
  container.innerHTML = '';
  const panel = el('div', 'upload-panel');
  panel.append(el('h4', null, '기출 PDF 업로드'));

  const idField = el('label', 'ufield');
  idField.append(el('span', null, '시험ID (예: 2023-1-필기)'));
  const idInput = el('input');
  idInput.type = 'text';
  idInput.placeholder = '2023-1-필기';
  idField.append(idInput);

  const fileField = el('label', 'ufield');
  fileField.append(el('span', null, 'PDF 파일'));
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf,.pdf';
  fileField.append(fileInput);

  const pagesField = el('label', 'ufield');
  pagesField.append(el('span', null, '총 페이지(선택)'));
  const pagesInput = el('input');
  pagesInput.type = 'number';
  pagesInput.min = '1';
  pagesField.append(pagesInput);

  const btn = el('button', 'btn', '업로드·추출');
  const status = el('div', 'status-msg');
  const manualWrap = el('div');
  const manualBtn = el('button', 'btn secondary', '정답 수동 입력');

  panel.append(idField, fileField, pagesField, btn, manualBtn, status, manualWrap);
  container.append(panel);

  function idOk() {
    const 시험ID = (idInput.value || '').trim().normalize('NFC');
    if (!EXAM_ID.test(시험ID)) {
      status.className = 'status-msg error-text';
      status.textContent = '시험ID 형식이 올바르지 않습니다 (연도-회차-구분).';
      return null;
    }
    return 시험ID;
  }

  // 수동 입력만 필요할 때(PDF는 이미 있음/추출 불가)도 폼을 열 수 있게 한다.
  manualBtn.addEventListener('click', () => {
    const 시험ID = idOk();
    if (!시험ID) return;
    status.textContent = '';
    renderManualForm(manualWrap, { grade: scope.grade, cert: scope.cert, 시험ID }, onDone);
  });

  btn.addEventListener('click', async () => {
    const 시험ID = idOk();
    if (!시험ID) return;
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      status.className = 'status-msg error-text';
      status.textContent = 'PDF 파일을 선택하세요.';
      return;
    }
    btn.disabled = true;
    status.className = 'status-msg';
    status.textContent = '업로드·추출 중… (수 분 걸릴 수 있습니다)';
    try {
      const contentBase64 = await fileToBase64(file);
      const res = await apiFetch('/api/exams/upload', {
        method: 'POST',
        body: {
          grade: scope.grade,
          cert: scope.cert,
          filename: `${시험ID}.pdf`,
          contentBase64,
          시험ID,
          총페이지: pagesInput.value ? Number(pagesInput.value) : null,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        status.className = 'status-msg';
        status.textContent = `등록 완료 — 문항 ${data.문항수}, 숨김 ${data.숨김페이지수}`;
        if (onDone) onDone();
        return;
      }
      // 추출 실패/불가(검증오류·스캔이미지·claude 미설치 503) → 수동 정답 입력.
      if (data.needsManualForm || res.status === 503) {
        status.className = 'status-msg';
        const 사유 = data.error || (data.검증오류 ? data.검증오류.join('; ') : '자동 추출을 사용할 수 없습니다.');
        status.textContent = `${사유} — 아래에서 정답을 수동 입력하세요.`;
        renderManualForm(manualWrap, { grade: scope.grade, cert: scope.cert, 시험ID }, onDone);
      } else {
        status.className = 'status-msg error-text';
        status.textContent = data.error || '업로드 실패';
      }
    } catch (e) {
      status.className = 'status-msg error-text';
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// 수동 정답 입력 폼: 과목 구성 → 답안 그리드 → POST answer-key.
function renderManualForm(container, ctx, onDone) {
  container.innerHTML = '';
  const box = el('div', 'manual-form');
  box.append(el('h4', null, `정답 수동 입력 — ${ctx.시험ID}`));

  const hiddenField = el('label', 'ufield');
  hiddenField.append(el('span', null, '숨김(답지·해설) 페이지 수'));
  const hiddenInput = el('input');
  hiddenInput.type = 'number';
  hiddenInput.min = '0';
  hiddenInput.value = '1';
  hiddenField.append(hiddenInput);
  box.append(hiddenField);

  box.append(el('p', 'status-msg', '과목별 문항 범위를 입력한 뒤 [답안 입력]을 누르세요.'));
  const subjectsWrap = el('div', 'manual-subjects');
  box.append(subjectsWrap);

  function addSubjectRow(name = '', start = '', end = '') {
    const row = el('div', 'manual-subject-row');
    const n = el('input');
    n.type = 'text';
    n.placeholder = '과목명';
    n.value = name;
    const s = el('input');
    s.type = 'number';
    s.min = '1';
    s.placeholder = '시작';
    s.value = start;
    const e = el('input');
    e.type = 'number';
    e.min = '1';
    e.placeholder = '끝';
    e.value = end;
    const del = el('button', 'btn secondary', '삭제');
    del.addEventListener('click', () => row.remove());
    row.append(n, s, e, del);
    row._get = () => ({ 과목명: n.value.trim(), 시작: Number(s.value), 끝: Number(e.value) });
    subjectsWrap.append(row);
  }
  addSubjectRow();

  const addBtn = el('button', 'btn secondary', '과목 추가');
  addBtn.addEventListener('click', () => addSubjectRow());
  const gridBtn = el('button', 'btn', '답안 입력');
  const status = el('div', 'status-msg');
  const gridWrap = el('div', 'manual-grid');
  box.append(addBtn, gridBtn, status, gridWrap);
  container.append(box);

  const answers = {}; // { 문번: 1~4 }

  gridBtn.addEventListener('click', () => {
    const subs = [...subjectsWrap.querySelectorAll('.manual-subject-row')].map((r) => r._get());
    // 검증: 과목명·범위.
    for (const s of subs) {
      if (!s.과목명 || !Number.isInteger(s.시작) || !Number.isInteger(s.끝) || s.시작 < 1 || s.끝 < s.시작) {
        status.className = 'status-msg error-text';
        status.textContent = '과목명·시작·끝을 올바르게 입력하세요 (시작 ≤ 끝, 1 이상).';
        return;
      }
    }
    status.textContent = '';
    gridWrap.innerHTML = '';
    for (const s of subs) {
      gridWrap.append(el('div', 'omr-subject', `${s.과목명} (${s.시작}-${s.끝})`));
      for (let q = s.시작; q <= s.끝; q += 1) {
        gridWrap.append(answerRow(q));
      }
    }
    // 저장 버튼.
    if (!box.querySelector('.manual-save')) {
      const save = el('button', 'btn manual-save', '정답 저장');
      save.addEventListener('click', () => saveAnswerKey(subs));
      box.append(save);
    }
  });

  function answerRow(q) {
    const row = el('div', 'omr-row');
    row.append(el('span', 'qno', String(q)));
    const btns = [];
    OPTIONS.forEach((label, idx) => {
      const v = idx + 1;
      const b = el('button', 'omr-opt', label);
      if (answers[q] === v) b.classList.add('sel');
      b.addEventListener('click', () => {
        answers[q] = v;
        btns.forEach((ob, i) => ob.classList.toggle('sel', answers[q] === i + 1));
      });
      btns.push(b);
      row.append(b);
    });
    return row;
  }

  async function saveAnswerKey(subs) {
    const 과목들 = subs.map((s) => {
      const 정답 = {};
      for (let q = s.시작; q <= s.끝; q += 1) if (answers[q]) 정답[q] = answers[q];
      return { 과목명: s.과목명, 시작: s.시작, 끝: s.끝, 정답 };
    });
    status.className = 'status-msg';
    status.textContent = '저장 중…';
    try {
      const qs = `grade=${encodeURIComponent(ctx.grade)}&cert=${encodeURIComponent(ctx.cert)}`;
      const res = await apiFetch(`/api/exams/${encodeURIComponent(ctx.시험ID)}/answer-key?${qs}`, {
        method: 'POST',
        body: { 숨김페이지수: Number(hiddenInput.value) || 0, 과목들 },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        status.className = 'status-msg error-text';
        status.textContent = (data.error || '저장 실패') + (data.검증오류 ? ` — ${data.검증오류.join('; ')}` : '');
        return;
      }
      status.textContent = `정답 등록 완료 — 문항 ${data.문항수}`;
      container.innerHTML = '';
      if (onDone) onDone();
    } catch (e) {
      status.className = 'status-msg error-text';
      status.textContent = e.message;
    }
  }
}
