// views/solve.js — 풀이 몰입 모드 뷰.
// 계약: mount(container, { grade, cert, examId }) / unmount(). D의 해시 라우터가 lazy import.
//
// 구성:
//  - 솔브바(sticky): 뒤로 링크(#/cert/...) + 시험ID + 진행률 바 + 경과시간 + 제출 버튼
//  - 본문: 좌 PDF 뷰어(넓게) + 우 OMR 레일(고정 스크롤, 현재 문항 하이라이트)
//  - 도구 패널(우측 슬라이드 오버, ~400px): 개념/챗 렌더 + 문항 컨텍스트 칩(#문번 · 시험ID)
//  - 결과 영역(#result): 제출 후 result.js가 렌더·스크롤 진입
//  - 키보드(입력 요소 포커스 시 전부 비활성): 1~4 답, g 찍음, ↑/↓ 문항 이동, c 개념, / 챗, ESC 닫기

import { renderViewer } from '../components/viewer.js';
import { renderOmr } from '../components/omr.js';
import { renderConcept, closeConcept } from '../components/concept.js';
import { renderChat } from '../components/chat.js';
import { configureResult } from '../components/result.js'; // side-effect: qnet:attempt-submitted 리스너 등록

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 입력 요소(텍스트 입력·선택·contenteditable)에 포커스가 있으면 키보드 단축키 비활성.
function isTypingTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

// 문항 컨텍스트 조립기(챗용): 시험ID·문번·PDF 경로·연결 노트/해설 경로.
// (examList.js buildContextText 로직 이식 — 챗 컨텍스트 계약 불변)
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

// 마운트 상태(unmount 정리용).
let active = null;

export async function mount(container, { grade, cert, examId }) {
  unmount(); // 중복 마운트 방지(정리 후 재구성)
  const ctx = { grade, cert, id: examId };
  container.innerHTML = '';

  const root = el('div', 'solve');

  // ── 솔브바(sticky) ──
  const bar = el('div', 'solve-bar');
  const back = el('a', 'solve-back');
  back.href = `#/cert/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}`;
  back.setAttribute('aria-label', `${cert} 상세로 돌아가기`);
  back.append(el('span', 'solve-back-icon', '←'), el('span', 'solve-back-label', cert));

  const examLabel = el('span', 'solve-examid', examId);

  const progWrap = el('div', 'solve-progress');
  const progText = el('span', 'solve-progress-text', '응답 0/0');
  const progBar = el('div', 'solve-progressbar');
  const progFill = el('div', 'solve-progressbar-fill');
  progBar.append(progFill);
  progWrap.append(progText, progBar);

  const elapsed = el('span', 'solve-elapsed', '경과 0:00');
  const submitBtn = el('button', 'btn solve-submit', '제출·채점');
  const status = el('span', 'solve-status');
  bar.append(back, examLabel, progWrap, elapsed, submitBtn, status);

  // ── 본문 ──
  const bodyEl = el('div', 'solve-body');
  const viewerPane = el('div', 'solve-viewer');
  const rail = el('div', 'solve-rail omr-rail');

  // 도구 패널(우측 슬라이드 오버). 기본 닫힘.
  const tool = el('aside', 'solve-tool');
  tool.hidden = true;
  const toolHead = el('div', 'solve-tool-head');
  const toolTitle = el('span', 'solve-tool-title');
  const toolChip = el('span', 'solve-tool-chip');
  const toolClose = el('button', 'close solve-tool-close', '✕');
  toolClose.setAttribute('aria-label', '도구 패널 닫기');
  toolHead.append(toolTitle, toolChip, toolClose);
  const toolBody = el('div', 'solve-tool-body');
  tool.append(toolHead, toolBody);

  bodyEl.append(viewerPane, rail, tool);

  // ── 결과 영역 ──
  const result = el('div', 'result-area');
  result.id = 'result';

  root.append(bar, bodyEl, result);
  container.append(root);

  // 정리 대상 등록. self = 이 마운트의 토큰(빠른 재마운트 시 낡은 async 결과 폐기용).
  active = { keydown: null, timer: null, omrCtrl: null, tool, toolBody };
  const self = active;

  const fmtElapsed = (ms) => {
    const s = Math.floor(ms / 1000);
    return `경과 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // ── 도구 패널 제어 ──
  // 도구 오픈 세대 토큰: 개념/챗 오픈마다 증가. 비동기 컨텍스트 fetch 가 늦게 도착해도
  // 그 사이 다른 도구가 열렸으면(gen 불일치) 폐기해 패널 덮어쓰기 레이스를 막는다.
  let toolGen = 0;
  function openTool(kind, qno) {
    if (qno == null) return;
    const gen = ++toolGen;
    closeConcept(); // 이전 개념 패널의 fs-change 자동 새로고침 해제
    toolBody.innerHTML = '';
    toolChip.textContent = `#${qno} · ${examId}`;
    tool.hidden = false;
    tool.classList.add('open');
    if (kind === 'concept') {
      toolTitle.textContent = '개념·풀이';
      renderConcept(toolBody, examId, qno);
    } else {
      toolTitle.textContent = '문항 챗';
      toolBody.append(el('p', 'solve-tool-loading', '컨텍스트 준비 중…'));
      buildContextText({ grade, cert, examId, qno }).then((contextText) => {
        // 준비 도중 패널이 닫혔거나 언마운트/재마운트되거나 다른 도구가 열렸으면 무시.
        if (active !== self || tool.hidden || gen !== toolGen) return;
        toolBody.innerHTML = '';
        renderChat(toolBody, { grade, cert, examId, qno, contextText });
      });
    }
  }
  function openConcept(qno) {
    openTool('concept', qno);
  }
  function openChat(qno) {
    openTool('chat', qno);
  }
  function closeTool() {
    closeConcept();
    tool.classList.remove('open');
    tool.hidden = true;
    toolBody.innerHTML = '';
  }
  toolClose.addEventListener('click', closeTool);

  // 결과 퍼널(오답 개념/챗) → 도구 패널 열기.
  configureResult({ openConcept, openChat });

  // ── PDF 뷰어 ──
  renderViewer(viewerPane, ctx).catch((e) => {
    viewerPane.innerHTML = '';
    viewerPane.append(el('p', 'error-text', `PDF 표시 실패: ${e.message}`));
  });

  // ── OMR 레일 + 컨트롤러 ──
  let omrCtrl = null;
  let omrLoadFailed = false; // renderOmr 예외(로드 실패)와 정답 미등록(등록:false)을 구분.
  try {
    omrCtrl = await renderOmr(rail, {
      grade,
      cert,
      id: examId,
      onProgress: (done, total) => {
        progText.textContent = `응답 ${done}/${total}`;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progFill.style.width = `${pct}%`;
      },
      onConcept: openConcept,
      onChat: openChat,
    });
  } catch (e) {
    omrLoadFailed = true;
    rail.innerHTML = '';
    rail.append(el('p', 'error-text', `OMR 로드 실패: ${e.message}`));
  }
  // 언마운트/재마운트가 await 사이에 발생했으면 이 마운트는 무효 — 중단.
  if (active !== self) return;
  active.omrCtrl = omrCtrl;

  if (omrLoadFailed) {
    // OMR 로드가 예외로 실패 — 미등록(채점 불가)과 구분해 새로고침을 안내.
    submitBtn.disabled = true;
    submitBtn.textContent = 'OMR 로드 실패';
    submitBtn.title = 'OMR 로드 실패 — 새로고침 후 재시도';
  } else if (!omrCtrl || !omrCtrl.등록) {
    // 정답 미등록(채점 불가) → 제출 비활성. 뷰어·열람은 정상.
    submitBtn.disabled = true;
    submitBtn.textContent = '채점 불가';
    submitBtn.title = '정답 미등록 기출 — 열람만 가능';
  } else {
    // 경과시간 라이브 표시(솔브바). 소요시간 계산은 omr controller 소유.
    elapsed.textContent = fmtElapsed(omrCtrl.getElapsedMs());
    const timer = setInterval(() => {
      if (active !== self || !elapsed.isConnected) {
        clearInterval(timer);
        return;
      }
      elapsed.textContent = fmtElapsed(omrCtrl.getElapsedMs());
    }, 1000);
    active.timer = timer;

    submitBtn.addEventListener('click', async () => {
      status.className = 'solve-status';
      status.textContent = '';
      submitBtn.disabled = true;
      try {
        const data = await omrCtrl.submit(); // qnet:attempt-submitted 발행 → result.js가 #result 렌더·스크롤
        status.className = 'solve-status ok';
        status.textContent = `채점 완료 — 총점 ${data.총점 ?? '?'} (${data.합격여부 ?? ''})`;
        window.dispatchEvent(
          new CustomEvent('qnet:toast', { detail: { message: '채점 완료 — 결과를 확인하세요.', type: 'ok' } })
        );
      } catch (e) {
        status.className = 'solve-status error-text';
        status.textContent = e.message;
        window.dispatchEvent(
          new CustomEvent('qnet:toast', { detail: { message: `제출 실패: ${e.message}`, type: 'error' } })
        );
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ── 키보드(전역 keydown; 입력 포커스 시 비활성) ──
  const onKey = (e) => {
    if (!active) return;
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // 등록된 컨트롤러만 키보드 대상(미등록 stub 은 채점 메서드가 없으므로 제외).
    const c = active.omrCtrl && active.omrCtrl.등록 ? active.omrCtrl : null;
    const code = e.code;

    if (code === 'Escape') {
      if (!tool.hidden) {
        closeTool();
        e.preventDefault();
      }
      return;
    }
    if (
      code === 'Digit1' || code === 'Digit2' || code === 'Digit3' || code === 'Digit4' ||
      code === 'Numpad1' || code === 'Numpad2' || code === 'Numpad3' || code === 'Numpad4'
    ) {
      if (c && c.current != null) {
        c.setOption(c.current, Number(code.slice(-1)));
        e.preventDefault();
      }
      return;
    }
    if (code === 'KeyG') {
      if (c && c.current != null) {
        c.toggleMark(c.current);
        e.preventDefault();
      }
      return;
    }
    if (code === 'ArrowUp') {
      if (c) {
        c.moveCurrent(-1);
        e.preventDefault();
      }
      return;
    }
    if (code === 'ArrowDown') {
      if (c) {
        c.moveCurrent(1);
        e.preventDefault();
      }
      return;
    }
    if (code === 'KeyC') {
      if (c && c.current != null) {
        openConcept(c.current);
        e.preventDefault();
      }
      return;
    }
    if (code === 'Slash') {
      if (c && c.current != null) {
        openChat(c.current);
        e.preventDefault();
      }
    }
  };
  window.addEventListener('keydown', onKey);
  active.keydown = onKey;
}

export function unmount() {
  if (!active) return;
  if (active.keydown) window.removeEventListener('keydown', active.keydown);
  if (active.timer) clearInterval(active.timer);
  // 미등록 OMR 컨트롤러가 등록한 fs-change 리스너 정리(누수 방지).
  if (active.omrCtrl && typeof active.omrCtrl.unmount === 'function') active.omrCtrl.unmount();
  closeConcept(); // 개념 패널 fs-change 자동 새로고침 해제
  configureResult(null); // 결과 퍼널 핸들러 해제(제거된 DOM 참조 방지)
  active = null;
}
