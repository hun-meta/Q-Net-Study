// 기출 브라우저: 자격증 선택 → 기출 목록 → 선택 시 뷰어 + OMR + (문항별)개념/챗 + 결과.
// 업로드/수동 정답 입력 패널 포함. qnet:fs-change 수신 시 목록 자동 갱신.

import { renderViewer } from './viewer.js';
import { renderOmr } from './omr.js';
import { renderConcept, closeConcept } from './concept.js';
import { renderChat } from './chat.js';
import { renderUploadPanel } from './upload.js';
import { apiFetch } from './store.js';
import './result.js'; // side-effect: qnet:attempt-submitted 리스너 등록(#result 렌더)

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

// 현재 선택된 자격증 컨텍스트(fs-change 목록 갱신용).
const scope = { grade: null, cert: null, listWrap: null, stage: null, sidebar: null };

export async function renderExamBrowser(root) {
  root.innerHTML = '';
  const layout = el('div', 'exam-browser');
  const sidebar = el('div', 'exam-sidebar');
  const stage = el('div', 'exam-stage');
  stage.innerHTML = '<p class="stage-empty">왼쪽에서 자격증과 기출을 선택하세요.</p>';
  layout.append(sidebar, stage);
  root.append(layout);
  scope.stage = stage;
  scope.sidebar = sidebar;

  await loadCerts(sidebar, stage);
}

// 자격증 목록을 (재)불러와 사이드바를 렌더. preselect={grade,cert} 시 해당 자격증 자동 선택.
async function loadCerts(sidebar, stage, preselect) {
  try {
    const { certs } = await getJson('/api/repo');
    renderCertPicker(sidebar, stage, certs || [], preselect);
  } catch (e) {
    sidebar.innerHTML = '';
    sidebar.append(el('p', 'error-text', e.message));
  }
}

function renderCertPicker(sidebar, stage, certs, preselect) {
  sidebar.innerHTML = '';
  sidebar.append(el('h3', null, '자격증'));

  // 새 자격증 등록 폼(종류=분야 datalist + 자격증명).
  renderCertRegister(sidebar, stage, certs);

  if (certs.length === 0) {
    sidebar.append(el('p', 'muted', '등록된 자격증이 없습니다. 위에서 새로 등록하세요.'));
    return;
  }

  const select = el('select', 'field');
  select.append(new Option('— 선택 —', ''));
  for (const c of certs) {
    select.append(new Option(`${c.grade} / ${c.cert}`, JSON.stringify({ grade: c.grade, cert: c.cert })));
  }
  const uploadWrap = el('div', 'upload-wrap');
  const listWrap = el('div', 'exam-list-wrap');
  scope.listWrap = listWrap;

  select.addEventListener('change', async () => {
    listWrap.innerHTML = '';
    uploadWrap.innerHTML = '';
    stage.innerHTML = '<p class="stage-empty">기출을 선택하세요.</p>';
    if (!select.value) {
      scope.grade = scope.cert = null;
      return;
    }
    const { grade, cert } = JSON.parse(select.value);
    scope.grade = grade;
    scope.cert = cert;
    renderUploadPanel(uploadWrap, { grade, cert }, () => refreshList());
    await renderExamList(listWrap, stage, grade, cert);
  });
  sidebar.append(select, uploadWrap, listWrap);

  // 신규 등록 직후 자동 선택.
  if (preselect) {
    const target = JSON.stringify({ grade: preselect.grade, cert: preselect.cert });
    if ([...select.options].some((o) => o.value === target)) {
      select.value = target;
      select.dispatchEvent(new Event('change'));
    }
  }
}

// 라운드2 신규 요소용 최소 스타일(1회 주입 — main.css 동시편집 충돌 회피).
function ensureCertStyles() {
  if (document.getElementById('cert-register-styles')) return;
  const s = document.createElement('style');
  s.id = 'cert-register-styles';
  s.textContent = `
    .cert-register { margin: 0.4rem 0 0.6rem; }
    .cert-register summary { cursor: pointer; font-size: 0.9rem; }
    .cert-form { padding: 0.4rem 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .cert-form input[type=text] { width: 100%; box-sizing: border-box; padding: 0.3rem; }
    .muted { color: #888; font-size: 0.85rem; }
  `;
  document.head.append(s);
}

// 새 자격증 등록 폼(접이식). 성공 시 목록 재로드 + 자동 선택. 라벨은 "종류"(분야).
function renderCertRegister(sidebar, stage, certs) {
  ensureCertStyles();
  const details = el('details', 'cert-register');
  const summary = document.createElement('summary');
  summary.textContent = '+ 새 자격증 등록';
  details.append(summary);

  const form = el('div', 'cert-form');
  const gradeField = el('label', 'ufield');
  gradeField.append(el('span', null, '종류 (분야, 예: 정보처리)'));
  const gradeInput = el('input');
  gradeInput.type = 'text';
  gradeInput.setAttribute('list', 'grade-suggestions');
  const datalist = document.createElement('datalist');
  datalist.id = 'grade-suggestions';
  for (const g of [...new Set(certs.map((c) => c.grade))].sort()) datalist.append(new Option(g, g));
  gradeField.append(gradeInput, datalist);

  const certField = el('label', 'ufield');
  certField.append(el('span', null, '자격증명 (예: 정보처리기사)'));
  const certInput = el('input');
  certInput.type = 'text';
  certField.append(certInput);

  const btn = el('button', 'btn', '등록');
  const status = el('span', 'status-msg');
  form.append(gradeField, certField, btn, status);
  details.append(form);
  sidebar.append(details);

  btn.addEventListener('click', async () => {
    const 종류 = (gradeInput.value || '').trim().normalize('NFC');
    const 자격증 = (certInput.value || '').trim().normalize('NFC');
    if (!종류 || !자격증) {
      status.className = 'status-msg error-text';
      status.textContent = '종류와 자격증명을 모두 입력하세요.';
      return;
    }
    btn.disabled = true;
    status.className = 'status-msg';
    status.textContent = '등록 중…';
    try {
      const res = await apiFetch('/api/certs', { method: 'POST', body: { 종류, 자격증 } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        status.className = 'status-msg error-text';
        status.textContent = res.status === 409 ? '이미 존재하는 자격증입니다.' : data.error || '등록 실패';
        return;
      }
      // 목록 재로드 + 방금 등록한 자격증 자동 선택.
      await loadCerts(sidebar, stage, { grade: 종류, cert: 자격증 });
    } catch (e) {
      status.className = 'status-msg error-text';
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// 현재 스코프의 기출 목록 재조회(fs-change·업로드 후).
async function refreshList() {
  if (scope.grade && scope.cert && scope.listWrap && scope.stage) {
    await renderExamList(scope.listWrap, scope.stage, scope.grade, scope.cert);
  }
}

async function renderExamList(listWrap, stage, grade, cert) {
  listWrap.innerHTML = '<p class="loading">불러오는 중…</p>';
  let data;
  try {
    data = await getJson(`/api/exams?grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}`);
  } catch (e) {
    listWrap.innerHTML = '';
    listWrap.append(el('p', 'error-text', e.message));
    return;
  }
  listWrap.innerHTML = '';
  const exams = data.exams || [];
  if (exams.length === 0) {
    listWrap.append(el('p', null, '등록된 기출이 없습니다.'));
    return;
  }
  const ul = el('ul', 'exam-list');
  for (const exam of exams) {
    const li = el('li');
    li.append(el('span', null, exam.id));
    const meta = el('span', 'meta');
    if (!exam.pdf존재) {
      meta.textContent = 'PDF 없음 (INDEX 등록만)';
    } else if (!exam.열람가능) {
      meta.className = 'meta locked';
      meta.textContent = '숨김 페이지수 미확정 — 정답 등록 후 열람';
    } else if (exam.채점가능) {
      meta.textContent = `문항 ${exam.문항수 || '?'} · 채점 가능`;
    } else {
      meta.className = 'meta locked';
      meta.textContent = '정답 미등록 — 열람만';
    }
    li.append(meta);
    li.addEventListener('click', () => {
      ul.querySelectorAll('li').forEach((n) => n.classList.remove('active'));
      li.classList.add('active');
      openExam(stage, exam, grade, cert);
    });
    ul.append(li);
  }
  listWrap.append(ul);
}

// 문항 컨텍스트 조립기(챗용): 시험ID·문번·PDF 경로·연결 노트/해설 경로.
async function buildContextText({ grade, cert, examId, qno }) {
  const pdfRel = `${grade}/${cert}/_공통/기출문제/${examId}.pdf`;
  const lines = [
    '[문항 컨텍스트]',
    `시험: ${examId} / 문번: ${qno}`,
    `자격증: ${grade} / ${cert}`,
    `기출 PDF: ${pdfRel} (문번 ${qno} 문항 페이지를 직접 확인)`,
  ];
  try {
    const res = await fetch(`/api/concept/${encodeURIComponent(examId)}/${encodeURIComponent(qno)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.노트 && data.노트.length) {
        lines.push('연결 노트:');
        for (const n of data.노트) lines.push(`- ${n.과목} · ${n.섹션제목} (${n.닉네임}): ${n.파일}`);
      }
      if (data.해설 && data.해설.length) {
        lines.push('연결 해설:');
        for (const s of data.해설) lines.push(`- ${s.닉네임}(${s.날짜}): ${s.파일}`);
      }
    }
  } catch (_e) {
    /* 컨텍스트 부가정보 — 실패해도 기본 컨텍스트로 진행 */
  }
  return lines.join('\n');
}

function openExam(stage, exam, grade, cert) {
  closeConcept(); // 이전 개념 패널의 fs-change 자동 새로고침 해제
  stage.innerHTML = '';
  stage.append(el('h3', null, `${grade} / ${cert} — ${exam.id}`));
  if (!exam.pdf존재) {
    stage.append(el('p', 'exam-notice', '이 기출은 PDF 파일이 없어 열람할 수 없습니다.'));
    return;
  }
  if (!exam.열람가능) {
    stage.append(
      el('p', 'exam-notice', '숨김 페이지수가 확정되지 않아 열람할 수 없습니다. 정답(자동 추출 또는 수동 입력)을 먼저 등록하세요.')
    );
    return;
  }

  const panes = el('div', 'exam-panes');
  const viewerPane = el('div', 'viewer-pane');
  const side = el('div', 'exam-side');
  const omrPane = el('div', 'omr-pane');
  const toolPane = el('div', 'tool-pane');
  side.append(omrPane, toolPane);
  panes.append(viewerPane, side);
  stage.append(panes);

  const result = el('div', 'result-area');
  result.id = 'result';
  stage.append(result);

  const ctx = { grade, cert, id: exam.id };

  function toolHead(title) {
    const head = el('div', 'tool-head');
    head.append(el('span', null, title));
    const close = el('button', 'close', '✕');
    close.addEventListener('click', resetTool);
    head.append(close);
    return head;
  }
  function resetTool() {
    closeConcept();
    toolPane.innerHTML = '';
    toolPane.append(el('p', null, '문항 옆의 "개념"·"챗" 버튼을 누르면 여기에 표시됩니다.'));
  }
  function showConcept(qno) {
    toolPane.innerHTML = '';
    toolPane.append(toolHead(`개념 보기 — #${qno}`));
    const body = el('div');
    toolPane.append(body);
    renderConcept(body, exam.id, qno);
  }
  async function showChat(qno) {
    toolPane.innerHTML = '';
    toolPane.append(toolHead(`문항 챗 — #${qno}`), el('p', 'status-msg', '컨텍스트 준비 중…'));
    const contextText = await buildContextText({ grade, cert, examId: exam.id, qno });
    const body = el('div');
    toolPane.innerHTML = '';
    toolPane.append(toolHead(`문항 챗 — #${qno}`), body);
    renderChat(body, { grade, cert, examId: exam.id, qno, contextText });
  }
  resetTool();

  renderViewer(viewerPane, ctx).catch((e) => {
    viewerPane.innerHTML = '';
    viewerPane.append(el('p', 'error-text', `PDF 표시 실패: ${e.message}`));
  });
  renderOmr(omrPane, { ...ctx, onConcept: showConcept, onChat: showChat }).catch((e) => {
    omrPane.innerHTML = '';
    omrPane.append(el('p', 'error-text', `OMR 로드 실패: ${e.message}`));
  });
}

// 파일 변경(SSE) 시 기출 목록 갱신(업로드·정답 등록·인덱스 변경 즉시 반영).
window.addEventListener('qnet:fs-change', () => {
  refreshList();
});
