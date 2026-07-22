// 기출 업로드 aside(디자인) + 수동 정답 입력 모달.
// 드롭존 클릭/드롭 → 자동 추출(4단계) → 목록 갱신. 실패/미설치 → 수동 정답 모달(막다른 길 없음).
// 계약 유지: POST /api/exams/upload, POST /api/exams/:id/answer-key.

import { apiFetch, getState } from '../store.js';
import { toast } from './toast.js';

const EXAM_ID = /^\d{4}-[0-9A-Za-z가-힣]+-(필기|실기)$/u;
const OPTIONS = ['①', '②', '③', '④'];
const STEPS = [
  { key: 'upload', label: '업로드' },
  { key: 'read', label: '답지 판독' },
  { key: 'verify', label: '구조 검증' },
  { key: 'register', label: '목록 등록' },
];

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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('파일 읽기 실패'));
    r.readAsDataURL(file);
  });
}

function inferId(name) {
  const g = String(name).replace(/\.pdf$/i, '').normalize('NFC');
  return EXAM_ID.test(g) ? g : null;
}

// 업로드 aside 렌더. scope={grade, cert}, onDone=목록 갱신 콜백.
export function renderUploadPanel(container, scope, onDone) {
  const { cli } = getState();
  const claudeOk = !!(cli && cli.record && cli.record.available);

  container.innerHTML = '';
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf,.pdf';
  fileInput.style.display = 'none';

  container.append(el('div', 'ul-title', '기출 업로드'));
  const desc = el('p', 'ul-desc');
  desc.innerHTML = 'PDF를 올리면 <b>답지를 자동 판독</b>해 채점가능으로 등록해요.';
  container.append(desc);
  const body = el('div', 'ul-body');
  container.append(body, fileInput);

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (f) startUpload(f);
  });

  let stepNodes = {};
  function renderSteps() {
    body.innerHTML = '';
    const wrap = el('div', 'ul-steps');
    stepNodes = {};
    STEPS.forEach((s, i) => {
      const row = el('div', 'ul-step');
      row.dataset.state = 'pending';
      const dot = el('span', 'ul-step-dot', String(i + 1));
      const lab = el('span', 'ul-step-label', s.label);
      row.append(dot, lab);
      stepNodes[s.key] = { row, dot };
      wrap.append(row);
    });
    body.append(wrap);
  }
  function setStep(key, state) {
    const n = stepNodes[key];
    if (!n) return;
    n.row.dataset.state = state;
    if (state === 'done') n.dot.textContent = '✓';
    else if (state === 'active')
      n.dot.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="animation:qspin .8s linear infinite"><path d="M8 1.6a6.4 6.4 0 1 1-6.3 5.2"></path></svg>';
    else if (state === 'error') n.dot.textContent = '!';
  }

  function renderIdle() {
    body.innerHTML = '';
    if (claudeOk) {
      const dz = el('button', 'ul-dropzone');
      dz.type = 'button';
      dz.append(
        svg('<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M12 16V4M8 8l4-4 4 4"></path><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path></svg>'),
        el('span', 'ul-dz-main', 'PDF를 여기에 놓거나 클릭'),
        el('span', 'ul-dz-sub', '2024-1-필기.pdf 형식으로 저장돼요')
      );
      dz.addEventListener('click', () => fileInput.click());
      ['dragenter', 'dragover'].forEach((ev) =>
        dz.addEventListener(ev, (e) => {
          e.preventDefault();
          dz.classList.add('drag');
        })
      );
      ['dragleave', 'dragend'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('drag');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) startUpload(f);
      });
      body.append(dz);
    } else {
      const notice = el('div', 'ul-notice');
      const head = el('div', 'ul-notice-head');
      head.append(el('span', 'ul-notice-dot'), document.createTextNode('claude 미설치'));
      notice.append(head);
      notice.append(document.createTextNode('자동 추출을 쓸 수 없어요. 정답을 수동으로 등록해 주세요.'));
      body.append(notice);
      const mbtn = el('button', 'ul-manual-btn', '수동 정답 입력');
      mbtn.type = 'button';
      mbtn.addEventListener('click', () => openManualDialog(scope, '', onDone));
      body.append(mbtn);
    }

    const link = el('button', 'ul-manual-link', '스캔 등 자동 추출이 어려우면 → 수동 입력');
    link.type = 'button';
    link.addEventListener('click', () => openManualDialog(scope, '', onDone));
    body.append(link);

    const copy = el('div', 'ul-copyright');
    copy.append(
      svg('<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>'),
      document.createTextNode('저작권 자료(시중 문제집 스캔)는 업로드하지 마세요.')
    );
    body.append(copy);
  }

  async function startUpload(file) {
    const id = inferId(file.name);
    if (!id) {
      toast('파일명을 2024-1-필기.pdf 형식으로 바꾸거나 수동 입력을 이용하세요.', 'error');
      openManualDialog(scope, '', onDone);
      return;
    }
    renderSteps();
    setStep('upload', 'active');
    try {
      const contentBase64 = await fileToBase64(file);
      setStep('upload', 'done');
      setStep('read', 'active');
      const res = await apiFetch('/api/exams/upload', {
        method: 'POST',
        body: { grade: scope.grade, cert: scope.cert, filename: `${id}.pdf`, contentBase64, 시험ID: id },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setStep('read', 'done');
        setStep('verify', 'done');
        setStep('register', 'done');
        toast(`${id} 등록 완료 — 문항 ${data.문항수}, 숨김 ${data.숨김페이지수}`, 'ok');
        if (data.questionsJobId) {
          toast('문항 원문 추출을 백그라운드에서 진행해요 — 완료되면 알려드릴게요.', 'info');
        }
        setTimeout(() => {
          renderIdle();
          if (onDone) onDone();
        }, 700);
        return;
      }
      if (data.needsManualForm || res.status === 503) {
        setStep('read', 'error');
        setStep('verify', 'error');
        const reason = data.reason || (data.검증오류 ? data.검증오류.join('; ') : '자동 추출을 사용할 수 없어요.');
        toast(`${reason} — 수동 입력으로 등록하세요.`, 'info');
        renderIdle();
        openManualDialog(scope, id, onDone, {
          reason,
          추출메시지: data.추출메시지 || null,
          검증오류: data.검증오류 || null,
          감사위반: data.audit && !data.audit.clean ? data.audit.violations || [] : null,
          timedOut: !!data.timedOut,
          isError: !!data.isError,
        });
      } else {
        setStep('read', 'error');
        toast(data.error || '업로드 실패', 'error');
        setTimeout(renderIdle, 1400);
      }
    } catch (e) {
      setStep('upload', 'error');
      toast(e.message, 'error');
      setTimeout(renderIdle, 1400);
    }
  }

  renderIdle();
}

// ── 수동 정답 입력 모달 ──────────────────────────────────────────────────────
export function openManualDialog(scope, presetId, onDone, failInfo) {
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box mdl-manual');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // 헤더.
  const head = el('div', 'mdl-head');
  head.append(el('h2', 'dlg-title', '수동 정답 입력'), el('p', 'dlg-desc', '자동 추출이 어려운 기출의 정답을 직접 등록해요. 막다른 길은 없어요.'));
  head.querySelector('.dlg-desc').style.margin = '0';

  // 본문(스크롤).
  const bodyEl = el('div', 'mdl-body qsc');

  // 자동 추출 실패 사유(있으면) — 왜 수동 입력으로 왔는지 그 자리에서 보여준다.
  if (failInfo && (failInfo.reason || failInfo.추출메시지 || (failInfo.검증오류 && failInfo.검증오류.length))) {
    const notice = el('div', 'mdl-failnotice');
    const title = failInfo.timedOut
      ? '⏱ 자동 추출이 제한 시간(5분)을 초과했어요.'
      : failInfo.isError
      ? '⚠️ 자동 추출 중 오류가 발생했어요.'
      : `ℹ️ ${failInfo.reason || '자동 추출이 정답 파일을 만들지 못했어요.'}`;
    notice.append(el('div', 'mdl-failnotice-title', title));
    if (failInfo.검증오류 && failInfo.검증오류.length) {
      notice.append(el('div', 'mdl-failnotice-detail', `검증 오류: ${failInfo.검증오류.join('; ')}`));
    }
    if (failInfo.감사위반 && failInfo.감사위반.length) {
      notice.append(el('div', 'mdl-failnotice-detail', `감사 위반: ${failInfo.감사위반.join(' / ')}`));
    }
    if (failInfo.추출메시지) {
      const det = el('details', 'mdl-failnotice-msg');
      det.append(el('summary', null, '자동 추출 도구가 남긴 메시지 보기'));
      det.append(el('pre', 'mdl-failnotice-pre', failInfo.추출메시지));
      notice.append(det);
    }
    bodyEl.append(notice);
  }

  const idRow = el('div', 'mdl-row');
  const idField = el('div', 'mdl-field');
  idField.append(el('label', 'dlg-label', '시험ID (예: 2023-1-필기)'));
  const idInput = el('input', 'mdl-input');
  idInput.type = 'text';
  idInput.placeholder = '2023-1-필기';
  idInput.value = presetId || '';
  idField.append(idInput);
  const hiddenField = el('div', 'mdl-field mdl-field-narrow');
  hiddenField.append(el('label', 'dlg-label', '숨김 페이지수'));
  const hiddenInput = el('input', 'mdl-input');
  hiddenInput.type = 'number';
  hiddenInput.min = '0';
  hiddenInput.value = '1';
  hiddenField.append(hiddenInput);
  idRow.append(idField, hiddenField);
  bodyEl.append(idRow);

  bodyEl.append(el('div', 'mdl-section-label', '과목 구성'));
  const subjectsWrap = el('div', 'mdl-subjects');
  bodyEl.append(subjectsWrap);

  function addSubjectRow(name = '', start = '', end = '') {
    const row = el('div', 'mdl-subject-row');
    const n = el('input', 'mdl-input');
    n.type = 'text';
    n.placeholder = '과목명';
    n.value = name;
    const s = el('input', 'mdl-input mdl-input-num');
    s.type = 'number';
    s.min = '1';
    s.placeholder = '시작';
    s.value = start;
    const e = el('input', 'mdl-input mdl-input-num');
    e.type = 'number';
    e.min = '1';
    e.placeholder = '끝';
    e.value = end;
    const del = el('button', 'mdl-subject-del', '✕');
    del.type = 'button';
    del.title = '과목 삭제';
    del.addEventListener('click', () => row.remove());
    row.append(n, s, e, del);
    row._get = () => ({ 과목명: n.value.trim(), 시작: Number(s.value), 끝: Number(e.value) });
    subjectsWrap.append(row);
  }
  addSubjectRow();

  const subActions = el('div', 'mdl-sub-actions');
  const addBtn = el('button', 'dlg-btn-cancel', '+ 과목 추가');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => addSubjectRow());
  const gridBtn = el('button', 'dlg-btn-primary', '답안 입력 열기');
  gridBtn.type = 'button';
  subActions.append(addBtn, gridBtn);
  bodyEl.append(subActions);

  const status = el('div', 'dlg-error');
  status.hidden = true;
  bodyEl.append(status);
  const showErr = (msg) => {
    status.className = 'dlg-error';
    status.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>';
    status.append(document.createTextNode(msg));
    status.hidden = false;
  };

  const gridWrap = el('div', 'mdl-grid');
  bodyEl.append(gridWrap);

  const answers = {}; // { 문번: 1~4 }

  gridBtn.addEventListener('click', () => {
    const subs = [...subjectsWrap.querySelectorAll('.mdl-subject-row')].map((r) => r._get());
    for (const s of subs) {
      if (!s.과목명 || !Number.isInteger(s.시작) || !Number.isInteger(s.끝) || s.시작 < 1 || s.끝 < s.시작) {
        showErr('과목명·시작·끝을 올바르게 입력하세요 (시작 ≤ 끝, 1 이상).');
        return;
      }
    }
    status.hidden = true;
    gridWrap.innerHTML = '';
    for (const s of subs) {
      const secHead = el('div', 'mdl-grid-subject');
      secHead.append(el('span', null, s.과목명), el('span', 'mdl-grid-range', `${s.시작}–${s.끝}`));
      gridWrap.append(secHead);
      const grid = el('div', 'mdl-answer-grid');
      for (let q = s.시작; q <= s.끝; q += 1) grid.append(answerRow(q));
      gridWrap.append(grid);
    }
    saveBtn.hidden = false;
    saveBtn.dataset.subs = '1';
    saveBtn._subs = subs;
  });

  function answerRow(q) {
    const row = el('div', 'mdl-answer-row');
    row.append(el('span', 'mdl-answer-qno', String(q)));
    const opts = el('div', 'mdl-answer-opts');
    const btns = [];
    OPTIONS.forEach((label, idx) => {
      const v = idx + 1;
      const b = el('button', 'mdl-answer-opt' + (answers[q] === v ? ' sel' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => {
        answers[q] = v;
        btns.forEach((ob, i) => ob.classList.toggle('sel', answers[q] === i + 1));
      });
      btns.push(b);
      opts.append(b);
    });
    row.append(opts);
    return row;
  }

  // 푸터.
  const foot = el('div', 'mdl-foot');
  const hint = el('span', 'mdl-foot-hint', '저장 시 서버가 검증 후 등록해요');
  const cancel = el('button', 'dlg-btn-cancel', '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const saveBtn = el('button', 'dlg-btn-primary', '저장하고 등록');
  saveBtn.type = 'button';
  saveBtn.hidden = true;
  foot.append(hint, cancel, saveBtn);

  saveBtn.addEventListener('click', async () => {
    const 시험ID = (idInput.value || '').trim().normalize('NFC');
    if (!EXAM_ID.test(시험ID)) {
      showErr('시험ID 형식이 올바르지 않습니다 (연도-회차-구분).');
      return;
    }
    const subs = saveBtn._subs || [];
    const 과목들 = subs.map((s) => {
      const 정답 = {};
      for (let q = s.시작; q <= s.끝; q += 1) if (answers[q]) 정답[q] = answers[q];
      return { 과목명: s.과목명, 시작: s.시작, 끝: s.끝, 정답 };
    });
    saveBtn.disabled = true;
    try {
      const qs = `grade=${encodeURIComponent(scope.grade)}&cert=${encodeURIComponent(scope.cert)}`;
      const res = await apiFetch(`/api/exams/${encodeURIComponent(시험ID)}/answer-key?${qs}`, {
        method: 'POST',
        body: { 숨김페이지수: Number(hiddenInput.value) || 0, 과목들 },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErr((data.error || '저장 실패') + (data.검증오류 ? ` — ${data.검증오류.join('; ')}` : ''));
        saveBtn.disabled = false;
        return;
      }
      toast(`${시험ID} 정답 등록 완료 — 문항 ${data.문항수}`, 'ok');
      overlay.remove();
      if (onDone) onDone();
    } catch (e) {
      showErr(e.message);
      saveBtn.disabled = false;
    }
  });

  box.append(head, bodyEl, foot);
  overlay.append(box);
  document.body.append(overlay);
  (presetId ? subjectsWrap.querySelector('input') : idInput).focus();
}
