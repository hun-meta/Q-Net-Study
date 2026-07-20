// 앱 부트스트랩: 테마 적용 → 상태 로드 → 토스트/토글 마운트 → CLI 배너 → 닉네임 메뉴 → 라우터 → SSE.

import { loadState, getState, getTheme, setTheme } from './store.js';
import { startRouter } from './router.js';
import { renderNicknameMenu } from './components/nicknameMenu.js';
import { mountToast } from './components/toast.js';

// 저장된 테마를 <html data-theme>에 즉시 반영(로드 전 깜빡임 최소화).
function applyStoredTheme() {
  setTheme(getTheme());
}

// 헤더 테마 토글: auto → light → dark 순환.
function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const order = ['auto', 'light', 'dark'];
  const icon = { auto: '◐', light: '☀', dark: '☾' };
  const label = { auto: '자동', light: '라이트', dark: '다크' };
  function paint() {
    const t = getTheme();
    btn.textContent = icon[t];
    btn.setAttribute('aria-label', `테마 전환 (현재: ${label[t]})`);
    btn.title = `테마: ${label[t]}`;
  }
  btn.addEventListener('click', () => {
    const cur = getTheme();
    setTheme(order[(order.indexOf(cur) + 1) % order.length]);
    paint();
  });
  paint();
}

// 사이드바 토글(풀이 몰입 모드에서 재노출용). CSS가 route-solve/sidebar-open 상태를 스타일링.
function setupSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
}

// CLI(agy·claude) 감지 배너: 정상(ok)이면 5초 후 자동 축소(헤더 도트로 대체), 경고는 유지.
function renderCliBanner() {
  const banner = document.getElementById('cli-banner');
  const dot = document.getElementById('cli-dot');
  const { cli } = getState();
  const missing = [];
  if (!cli.chat.available) missing.push('agy(챗)');
  if (!cli.record.available) missing.push('claude(기록)');

  if (missing.length === 0) {
    banner.className = 'cli-banner ok';
    banner.textContent = 'agy·claude 감지됨 — AI 챗·기록 기능 사용 가능';
    banner.hidden = false;
    if (dot) {
      dot.className = 'cli-dot ok';
      dot.title = 'agy·claude 감지됨';
      dot.hidden = true;
    }
    // 5초 후 축소: 배너 숨기고 헤더 상태 도트 노출.
    setTimeout(() => {
      banner.hidden = true;
      if (dot) dot.hidden = false;
    }, 5000);
  } else {
    banner.className = 'cli-banner warn';
    banner.textContent = `${missing.join(', ')} 미설치 — 해당 AI 기능은 비활성화되며, 풀이·채점·기록 열람 등 핵심 기능은 정상 동작합니다.`;
    banner.hidden = false;
    if (dot) {
      dot.className = 'cli-dot warn';
      dot.title = banner.textContent;
      dot.hidden = true; // 경고는 배너로 상시 표시(도트 중복 억제)
    }
  }
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

  // 파일 변경 이벤트: 화면 모듈이 갱신 훅으로 사용(전역 이벤트 재발행).
  // 워처가 여러 파일을 연쇄 저장하거나 이벤트가 폭주하면 리스너들(사이드바·대시보드·
  // 자격증상세·개념 패널)이 각각 API를 재조회해 요청 폭주가 발생한다. 트레일링 디바운스
  // (400ms)로 버스트를 코얼레싱해 마지막 이벤트만 1회 재발행한다.
  const FS_DEBOUNCE_MS = 400;
  let fsTimer = null;
  let fsLastDetail = null; // 버스트 마지막 이벤트의 detail(재발행 기준)
  let fsBurstCount = 0; // 버스트 동안 합쳐진 이벤트 수
  let fsBurstPaths = []; // 버스트 동안 수집된 변경 경로

  function flushFsChange() {
    fsTimer = null;
    // 마지막 detail을 그대로 보존. 실제로 여러 이벤트가 합쳐진 경우에만 코얼레싱 정보를 첨부
    // (수신부는 detail 구조에 민감하지 않아 단일 이벤트는 기존 계약 그대로 유지된다).
    const detail = { ...(fsLastDetail || {}) };
    if (fsBurstCount > 1) {
      detail.coalesced = true;
      detail.coalescedPaths = fsBurstPaths;
    }
    fsLastDetail = null;
    fsBurstCount = 0;
    fsBurstPaths = [];
    window.dispatchEvent(new CustomEvent('qnet:fs-change', { detail }));
  }

  es.addEventListener('fs-change', (evt) => {
    try {
      const detail = JSON.parse(evt.data);
      fsLastDetail = detail;
      fsBurstCount += 1;
      // 서버 이벤트 형태별 변경 경로 수집(있으면). watcher는 changes, 라우트는 paths 사용.
      if (Array.isArray(detail.paths)) fsBurstPaths.push(...detail.paths);
      else if (Array.isArray(detail.changes)) fsBurstPaths.push(...detail.changes);
      if (fsTimer) clearTimeout(fsTimer);
      fsTimer = setTimeout(flushFsChange, FS_DEBOUNCE_MS);
    } catch (_e) {
      /* noop */
    }
  });

  return es;
}

async function main() {
  applyStoredTheme();
  try {
    await loadState();
  } catch (e) {
    document.getElementById('app').innerHTML = `<p class="error-text">${e.message}</p>`;
    return;
  }

  mountToast();
  setupThemeToggle();
  setupSidebarToggle();
  renderCliBanner();

  const nickArea = document.getElementById('nickname-area');
  renderNicknameMenu(nickArea);
  window.addEventListener('qnet:nickname-changed', () => renderNicknameMenu(nickArea));

  startRouter();
  connectSse();
}

main();
