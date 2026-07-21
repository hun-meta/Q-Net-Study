// 풀이 화면(#/solve/... = 시험치기, #/view/... = 답 포함 열람).
// 상단 툴바 + 고정 높이 2분할(좌 PDF / 우 OMR 452px). solve 모드는 OMR, view 모드는 정답표.
// 문항별 개념/챗은 우측 슬라이드오버 패널. 뷰 계약: mount(container,{grade,cert,examId,mode}) / unmount.

import { createViewer } from '../components/viewer.js';
import { renderOmr, renderAnswerTable } from '../components/omr.js';
import { openPanel, closePanel } from '../components/panel.js';
import { setLastResult } from '../resultStore.js';
import { solveHash, resultHash, certHash } from '../router.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function icon(html, cls) {
  const s = el('span', cls);
  s.style.display = 'inline-flex';
  s.innerHTML = html;
  return s;
}
function iconBtn(html, title, onClick, cls) {
  const b = el('button', cls || 'sv-icon-btn');
  b.type = 'button';
  if (title) b.title = title;
  b.innerHTML = html;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function examLabelFromId(id) {
  const parts = String(id).split('-');
  if (parts.length >= 3) {
    const 연도 = parts[0];
    const 구분 = parts[parts.length - 1];
    const 식별자 = parts.slice(1, -1).join('-');
    const 회 = /^\d+$/.test(식별자) ? '회' : '';
    return `${연도}년 ${식별자}${회} ${구분}`;
  }
  return id;
}

function isTypingTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

let active = null;

export async function mount(container, { grade, cert, examId, mode }) {
  unmount();
  const ctx = { grade, cert, id: examId };
  const isView = mode === 'view';
  container.innerHTML = '';

  const root = el('section', 'sv');

  // ── 상단 툴바 ──
  const topbar = el('div', 'sv-topbar');
  topbar.append(el('div', 'sv-exam', examLabelFromId(examId)));
  const topStatus = el('div', 'sv-top-status');
  topbar.append(topStatus);

  // ── 작업 영역(2분할) ──
  const work = el('div', 'sv-work');

  // PDF 패널.
  const pdfPane = el('div', 'sv-pdf');
  const pdfBar = el('div', 'sv-pdf-bar');
  const modeChip = el('span', 'sv-mode-chip');
  const pdfCtrls = el('div', 'sv-pdf-ctrls');
  pdfBar.append(modeChip, pdfCtrls);
  const pdfBody = el('div', 'sv-pdf-body qsc');
  pdfPane.append(pdfBar, pdfBody);

  // OMR 패널.
  const omrPane = el('aside', 'sv-omr');
  const omrHead = el('div', 'sv-omr-head');
  const omrBody = el('div', 'sv-omr-body qsc');
  const omrFoot = el('div', 'sv-omr-foot');
  omrPane.append(omrHead, omrBody, omrFoot);

  work.append(pdfPane, omrPane);
  root.append(topbar, work);
  container.append(root);

  active = { keydown: null, timer: null, omrCtrl: null, viewer: null };
  const self = active;

  // ── PDF 뷰어 ──
  const zoomLabel = iconBtn('100%', '100%로 맞추기', null, 'sv-zoom-label');
  createViewer(pdfBody, ctx, { mode: isView ? 'view' : 'solve' })
    .then((viewer) => {
      if (active !== self) {
        viewer.destroy();
        return;
      }
      active.viewer = viewer;
      // 컨트롤 구성.
      pdfCtrls.innerHTML = '';
      const zoomOut = iconBtn(
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 8h9"></path></svg>',
        '축소',
        () => viewer.zoomOut()
      );
      const zoomIn = iconBtn(
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"></path></svg>',
        '확대',
        () => viewer.zoomIn()
      );
      zoomLabel.addEventListener('click', () => viewer.zoomReset());
      const sep = el('span', 'sv-pdf-sep');
      const prev = iconBtn(
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"></path></svg>',
        '이전 페이지',
        () => viewer.prev()
      );
      const pageLabel = el('span', 'sv-page-label', '1 / 1');
      const next = iconBtn(
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"></path></svg>',
        '다음 페이지',
        () => viewer.next()
      );
      pdfCtrls.append(zoomOut, zoomLabel, zoomIn, sep, prev, pageLabel, next);

      viewer.onChange(({ page, numPages, zoom, usedFull }) => {
        zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
        pageLabel.textContent = `${page} / ${numPages}`;
        // 모드 칩.
        if (isView) {
          if (usedFull) {
            modeChip.className = 'sv-mode-chip warn';
            modeChip.innerHTML =
              '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S3.7 3.5 8 3.5 14.5 8 14.5 8 12.3 12.5 8 12.5 1.5 8 1.5 8z"></path><circle cx="8" cy="8" r="2"></circle></svg>원본 · 정답 포함';
          } else {
            modeChip.className = 'sv-mode-chip neutral';
            modeChip.textContent = '문항 서브셋 (원본은 제출 후)';
          }
        } else {
          modeChip.className = 'sv-mode-chip ok';
          modeChip.innerHTML =
            '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--success)" stroke-width="1.5" stroke-linecap="round"><path d="M3 8.5l3 3 7-8"></path></svg>답지 제거 서브셋';
        }
      });
    })
    .catch((e) => {
      pdfBody.innerHTML = '';
      pdfBody.append(el('p', 'error-text', `PDF 표시 실패: ${e.message}`));
    });

  // ── OMR / 정답표 ──
  const openConcept = (qno) => openPanel({ grade, cert, examId }, qno, 'concept');
  const openChat = (qno) => openPanel({ grade, cert, examId }, qno, 'chat');

  if (isView) {
    await mountViewMode();
  } else {
    await mountSolveMode();
  }
  if (active !== self) return;

  // ── 키보드(입력 포커스 시 비활성) ──
  const onKey = (e) => {
    if (!active) return;
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = active.omrCtrl && active.omrCtrl.등록 ? active.omrCtrl : null;
    const code = e.code;
    if (code === 'Escape') {
      closePanel();
      return;
    }
    if (!c) return;
    if (/^(Digit|Numpad)[1-4]$/.test(code)) {
      if (c.current != null) {
        c.setOption(c.current, Number(code.slice(-1)));
        e.preventDefault();
      }
    } else if (code === 'KeyG') {
      if (c.current != null) {
        c.toggleMark(c.current);
        e.preventDefault();
      }
    } else if (code === 'ArrowUp') {
      c.moveCurrent(-1);
      e.preventDefault();
    } else if (code === 'ArrowDown') {
      c.moveCurrent(1);
      e.preventDefault();
    } else if (code === 'KeyC') {
      if (c.current != null) {
        openConcept(c.current);
        e.preventDefault();
      }
    } else if (code === 'Slash') {
      if (c.current != null) {
        openChat(c.current);
        e.preventDefault();
      }
    }
  };
  window.addEventListener('keydown', onKey);
  active.keydown = onKey;

  // ── solve 모드 ──
  async function mountSolveMode() {
    // 상단 상태.
    topStatus.innerHTML = '';
    const timer = el('span', 'sv-timer');
    timer.append(
      icon(
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 4.5V8l2.5 1.5"></path></svg>'
      ),
      (() => {
        const t = el('span', 'sv-timer-val');
        t.textContent = '0:00';
        return t;
      })()
    );
    const freeMode = el('span', 'sv-free', '· 자유 모드');
    const saved = el('span', 'sv-saved');
    saved.append(
      icon(
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5 6.5-8"></path></svg>'
      ),
      document.createTextNode('임시저장됨')
    );
    topStatus.append(timer, freeMode, saved);
    const timerVal = timer.querySelector('.sv-timer-val');

    // OMR 헤더(진행률) 슬롯.
    omrHead.innerHTML = '';
    const headTop = el('div', 'sv-omr-headtop');
    headTop.append(el('div', 'sv-omr-title', 'OMR 답안지'));
    const counter = el('div', 'sv-omr-counter', '0 / 0');
    headTop.append(counter);
    const progressTrack = el('div', 'sv-omr-progress');
    const progressFill = el('div', 'sv-omr-progress-fill');
    progressTrack.append(progressFill);
    omrHead.append(headTop, progressTrack);

    let omrCtrl = null;
    let loadFailed = false;
    try {
      omrCtrl = await renderOmr(omrBody, {
        grade,
        cert,
        id: examId,
        onProgress: (done, total, guessed) => {
          counter.innerHTML = `<b>${done}</b> / ${total} · 찍음 ${guessed || 0}`;
          progressFill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
        },
        onConcept: openConcept,
        onChat: openChat,
      });
    } catch (e) {
      loadFailed = true;
      omrBody.innerHTML = '';
      omrBody.append(el('p', 'error-text', `OMR 로드 실패: ${e.message}`));
    }
    if (active !== self) return;
    active.omrCtrl = omrCtrl;

    // 푸터.
    omrFoot.innerHTML = '';
    if (loadFailed) {
      const b = el('button', 'sv-submit', 'OMR 로드 실패');
      b.disabled = true;
      omrFoot.append(b);
    } else if (!omrCtrl || !omrCtrl.등록) {
      // 열람만(정답 미등록).
      omrHead.innerHTML = '';
      omrHead.append(headReadonlyOnly());
      const notice = el('div', 'sv-omr-notice');
      notice.append(
        icon(
          '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--fg-3)" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>'
        )
      );
      const nt = el('span');
      nt.innerHTML = '<b>정답 미등록 — 채점 불가</b><br>이 기출은 열람만 가능해요. PDF를 참고해 학습하고, 정답을 등록하면 OMR이 활성화됩니다.';
      notice.append(nt);
      omrBody.innerHTML = '';
      omrBody.append(notice);
      const b = el('button', 'sv-submit disabled', '채점 불가 — 정답 미등록');
      b.disabled = true;
      omrFoot.append(b);
    } else {
      // 경과시간 라이브.
      const fmt = (ms) => {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      timerVal.textContent = fmt(omrCtrl.getElapsedMs());
      active.timer = setInterval(() => {
        if (active !== self || !timerVal.isConnected) {
          clearInterval(active.timer);
          return;
        }
        timerVal.textContent = fmt(omrCtrl.getElapsedMs());
      }, 1000);

      const submit = el('button', 'sv-submit', '제출하고 채점하기');
      submit.type = 'button';
      submit.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = '채점 중…';
        try {
          const data = await omrCtrl.submit();
          setLastResult(data);
          location.hash = resultHash(grade, cert, examId);
        } catch (e) {
          submit.disabled = false;
          submit.textContent = '제출하고 채점하기';
          window.dispatchEvent(new CustomEvent('qnet:toast', { detail: { message: `제출 실패: ${e.message}`, type: 'error' } }));
        }
      });
      omrFoot.append(submit);
    }
  }

  function headReadonlyOnly() {
    const headTop = el('div', 'sv-omr-headtop');
    headTop.append(el('div', 'sv-omr-title', 'OMR 답안지'));
    headTop.append(el('div', 'sv-omr-sub', '열람만'));
    return headTop;
  }

  // ── view 모드(정답표) ──
  async function mountViewMode() {
    topStatus.innerHTML = '';
    const chip = el('span', 'sv-view-chip', '정답 포함 열람');
    const hint = el('span', 'sv-view-hint', '채점 없이 정답만 확인하는 모드예요');
    topStatus.append(chip, hint);

    omrHead.innerHTML = '';
    const headTop = el('div', 'sv-omr-headtop');
    const title = el('div', 'sv-omr-title');
    title.append(document.createTextNode('정답표'), el('span', 'sv-omr-ro', '읽기 전용'));
    headTop.append(title, el('div', 'sv-omr-sub', ''));
    omrHead.append(headTop);

    const res = await renderAnswerTable(omrBody, { grade, cert, id: examId });
    if (active !== self) return;
    headTop.querySelector('.sv-omr-sub').textContent = res.등록 ? `전체 ${res.문항수}문항` : '';

    omrFoot.innerHTML = '';
    const toTake = el('button', 'sv-submit', '시험치기로 전환');
    toTake.type = 'button';
    toTake.addEventListener('click', () => {
      location.hash = solveHash(grade, cert, examId);
    });
    const toList = el('button', 'sv-omr-list', '목록');
    toList.type = 'button';
    toList.addEventListener('click', () => {
      location.hash = certHash(grade, cert);
    });
    omrFoot.append(toTake, toList);
  }
}

export function unmount() {
  if (!active) return;
  if (active.keydown) window.removeEventListener('keydown', active.keydown);
  if (active.timer) clearInterval(active.timer);
  if (active.omrCtrl && typeof active.omrCtrl.unmount === 'function') active.omrCtrl.unmount();
  if (active.viewer && typeof active.viewer.destroy === 'function') active.viewer.destroy();
  closePanel();
  active = null;
}
