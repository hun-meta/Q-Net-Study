// 앱 부트스트랩: 상태 로드 → CLI 배너·닉네임 렌더 → SSE 연결.

import { loadState, getState } from './store.js';
import { renderNickname } from './nickname.js';
import { renderExamBrowser } from './examList.js';

function renderCliBanner() {
  const banner = document.getElementById('cli-banner');
  const { cli } = getState();
  const missing = [];
  if (!cli.chat.available) missing.push('agy(챗)');
  if (!cli.record.available) missing.push('claude(기록)');

  if (missing.length === 0) {
    banner.className = 'cli-banner ok';
    banner.textContent = 'agy·claude 감지됨 — AI 챗·기록 기능 사용 가능';
  } else {
    banner.className = 'cli-banner';
    banner.textContent = `${missing.join(', ')} 미설치 — 해당 AI 기능은 비활성화되며, 풀이·채점·기록 열람 등 핵심 기능은 정상 동작합니다.`;
  }
  banner.hidden = false;
}

function renderMain() {
  const main = document.getElementById('app');
  // 기출 브라우저(자격증 선택 → 기출 목록 → 뷰어+OMR) 마운트.
  renderExamBrowser(main).catch((e) => {
    main.innerHTML = `<p class="error-text">${e.message}</p>`;
  });
}

// SSE 연결(파일 변경 실시간 반영). Last-Event-ID 재동기화는 브라우저가 자동 처리.
function connectSse() {
  const statusEl = document.getElementById('conn-status');
  const es = new EventSource('/api/events');

  es.addEventListener('open', () => {
    statusEl.textContent = '실시간 연결됨';
    statusEl.className = 'conn-status on';
  });

  es.addEventListener('error', () => {
    statusEl.textContent = '연결 끊김 — 재연결 중';
    statusEl.className = 'conn-status off';
  });

  // 파일 변경 이벤트: 관련 화면 모듈이 갱신 훅으로 사용(전역 이벤트 재발행).
  es.addEventListener('fs-change', (evt) => {
    try {
      const detail = JSON.parse(evt.data);
      window.dispatchEvent(new CustomEvent('qnet:fs-change', { detail }));
    } catch (_e) {
      /* noop */
    }
  });

  return es;
}

async function main() {
  try {
    await loadState();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<p class="error-text">${e.message}</p>`;
    return;
  }
  renderCliBanner();
  renderNickname(document.getElementById('nickname-area'));
  renderMain();
  connectSse();
}

main();
