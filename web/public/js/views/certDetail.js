// 자격증 상세(#/cert/{분야}/{자격증}): 브레드크럼 + 기출 목록(뱃지·상태·내 기록) + 접이식 업로드.
// 기존 examList.js의 목록·fs-change 갱신·업로드 배치 로직을 이식했다. 행 클릭(열람가능)→풀이 라우트.
// 뷰 인터페이스: export async function mount(container, params) / export function unmount().

import { renderUploadPanel } from '../components/upload.js';
import { solveHash } from '../router.js';
import { toast } from '../components/toast.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `요청 실패 (${res.status})`);
  }
  return res.json();
}

// 현재 뷰 상태(fs-change 갱신·정리용).
const view = { grade: null, cert: null, listWrap: null, uploadDetails: null, onFsChange: null };

// 내 시도 기록을 시험ID별로 집계: { [시험]: { count, 총점, 합격여부 } } (최신 시도 기준).
async function loadAttemptMap(grade, cert) {
  try {
    const params = new URLSearchParams({ grade, cert });
    const data = await getJson(`/api/attempts?${params.toString()}`);
    const byExam = {};
    for (const a of data.attempts || []) {
      const cur = byExam[a.시험];
      if (!cur) {
        byExam[a.시험] = { count: 1, 시도: a.시도, 총점: a.총점, 합격여부: a.합격여부 };
      } else {
        cur.count += 1;
        if ((Number(a.시도) || 0) >= (Number(cur.시도) || 0)) {
          cur.시도 = a.시도;
          cur.총점 = a.총점;
          cur.합격여부 = a.합격여부;
        }
      }
    }
    return byExam;
  } catch (_e) {
    return {}; // 닉네임 미설정 등 — 기록 없이 목록만 표시
  }
}

export async function mount(container, params) {
  const grade = params.grade;
  const cert = params.cert;
  view.grade = grade;
  view.cert = cert;

  container.innerHTML = '';
  const page = el('section', 'cert');

  // 브레드크럼.
  const crumb = el('nav', 'crumb');
  crumb.setAttribute('aria-label', '경로');
  const home = el('a', 'crumb-link', '대시보드');
  home.href = '#/';
  crumb.append(home, el('span', 'crumb-sep', '/'), el('span', 'crumb-seg', grade), el('span', 'crumb-sep', '/'), el('span', 'crumb-seg cert-current', cert));
  page.append(crumb);

  // 헤더: 제목 + 업로드 토글.
  const head = el('div', 'cert-head');
  head.append(el('h2', 'cert-title', cert));
  const uploadToggle = el('button', 'btn secondary sm', '＋ 기출 업로드');
  uploadToggle.type = 'button';
  head.append(uploadToggle);
  page.append(head);

  // 기출 목록.
  const listWrap = el('div', 'cert-list-wrap');
  view.listWrap = listWrap;
  page.append(listWrap);

  // 접이식 업로드 패널.
  const uploadDetails = el('details', 'cert-upload');
  view.uploadDetails = uploadDetails;
  const uploadSummary = document.createElement('summary');
  uploadSummary.className = 'cert-upload-summary';
  uploadSummary.textContent = '기출 업로드 / 정답 등록';
  uploadDetails.append(uploadSummary);
  const uploadBody = el('div', 'cert-upload-body');
  uploadDetails.append(uploadBody);
  page.append(uploadDetails);

  container.append(page);

  renderUploadPanel(uploadBody, { grade, cert }, () => refreshList());
  uploadToggle.addEventListener('click', () => {
    uploadDetails.open = !uploadDetails.open;
    if (uploadDetails.open) uploadDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  await refreshList();

  // 파일 변경(SSE) 시 목록 자동 갱신(업로드·정답 등록 즉시 반영).
  view.onFsChange = () => refreshList();
  window.addEventListener('qnet:fs-change', view.onFsChange);
}

async function refreshList() {
  const { grade, cert, listWrap } = view;
  if (!listWrap || !grade || !cert) return;
  listWrap.innerHTML = '';
  const skel = el('div', 'cert-list skeleton-list');
  for (let i = 0; i < 3; i += 1) skel.append(el('div', 'skeleton cert-row-skel'));
  listWrap.append(skel);

  let exams = [];
  let attemptMap = {};
  try {
    const [examData, map] = await Promise.all([
      getJson(`/api/exams?grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}`),
      loadAttemptMap(grade, cert),
    ]);
    exams = examData.exams || [];
    attemptMap = map;
  } catch (e) {
    listWrap.innerHTML = '';
    listWrap.append(el('p', 'error-text', e.message));
    return;
  }

  listWrap.innerHTML = '';
  if (exams.length === 0) {
    const empty = el('div', 'cert-empty');
    empty.append(el('p', null, '등록된 기출이 없습니다.'));
    const cta = el('button', 'btn', '기출 업로드 열기');
    cta.type = 'button';
    cta.addEventListener('click', () => {
      if (view.uploadDetails) {
        view.uploadDetails.open = true;
        view.uploadDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    empty.append(cta);
    listWrap.append(empty);
    return;
  }

  const list = el('ul', 'cert-list');
  for (const exam of exams) {
    list.append(examRow(exam, attemptMap[exam.id]));
  }
  listWrap.append(list);
}

// 상태 뱃지: 채점 가능(ok) / 열람만(warn) / 잠김·PDF없음(muted).
function statusBadge(exam) {
  if (!exam.pdf존재) return el('span', 'badge muted', 'PDF 없음');
  if (!exam.열람가능) return el('span', 'badge muted', '잠김');
  if (exam.채점가능) return el('span', 'badge ok', '채점 가능');
  return el('span', 'badge warn', '열람만');
}

function examRow(exam, rec) {
  const li = el('li', 'cert-row');
  li.tabIndex = 0;
  li.setAttribute('role', 'button');

  const badges = el('div', 'cert-row-badges');
  if (exam.연도 !== '' && exam.연도 != null) badges.append(el('span', 'badge', String(exam.연도)));
  if (exam.식별자 !== '' && exam.식별자 != null) badges.append(el('span', 'badge', `${exam.식별자}회`));
  if (exam.구분) badges.append(el('span', 'badge', String(exam.구분)));
  li.append(badges);

  const mid = el('div', 'cert-row-main');
  mid.append(el('span', 'cert-row-id', exam.id));
  mid.append(statusBadge(exam));
  li.append(mid);

  const meta = el('div', 'cert-row-meta');
  if (rec) {
    const 총점 = rec.총점 != null ? Number(rec.총점).toFixed(1) : '-';
    meta.append(el('span', 'cert-row-score', `최근 ${총점}`));
    if (rec.합격여부) meta.append(el('span', `badge ${rec.합격여부 === '합격' ? 'pass' : 'fail'}`, rec.합격여부));
    meta.append(el('span', 'muted', `시도 ${rec.count}회`));
  } else if (exam.채점가능) {
    meta.append(el('span', 'muted', '미응시'));
  }
  li.append(meta);

  const go = () => {
    if (exam.열람가능) {
      location.hash = solveHash(view.grade, view.cert, exam.id);
    } else {
      // 잠김 → 업로드/정답 등록 안내.
      toast('정답 등록 후 열람할 수 있습니다.', 'info');
      if (view.uploadDetails) {
        view.uploadDetails.open = true;
        view.uploadDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };
  li.addEventListener('click', go);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });
  if (!exam.열람가능) li.classList.add('cert-row-locked');
  return li;
}

export function unmount() {
  if (view.onFsChange) window.removeEventListener('qnet:fs-change', view.onFsChange);
  view.onFsChange = null;
  view.listWrap = null;
  view.uploadDetails = null;
}
