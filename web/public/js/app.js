// 앱 부트스트랩: 테마 적용 → 상태 로드 → 토스트 → 테마 토글 → CLI 뱃지 → 닉네임 메뉴 → 라우터 → SSE.
// 헤더의 브레드크럼/노출 토글은 router.js 가 담당한다. SSE 이벤트(fs-change/audit-warning/
// participants-change)를 window 커스텀 이벤트로 재발행해 각 화면이 실시간 반영에 사용한다.

import { loadState, getState, getTheme, setTheme, resolvedTheme, apiFetch } from './store.js';
import { startRouter } from './router.js';
import { renderNicknameMenu } from './components/nicknameMenu.js';
import { mountToast, toast } from './components/toast.js';

const ICON_SUN =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"></circle><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"></path></svg>';
const ICON_MOON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.3A5.4 5.4 0 0 1 6.7 2.5 5.5 5.5 0 1 0 13.5 9.3z"></path></svg>';

// 저장된 테마를 <html data-theme>에 즉시 반영(로드 전 깜빡임 최소화).
function applyStoredTheme() {
  setTheme(getTheme());
}

// 헤더 테마 토글: auto → light → dark 순환. 아이콘은 현재 실효 테마(해·달)를 표시.
function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const order = ['auto', 'light', 'dark'];
  const label = { auto: '자동', light: '라이트', dark: '다크' };
  function paint() {
    const t = getTheme();
    btn.innerHTML = resolvedTheme() === 'dark' ? ICON_MOON : ICON_SUN;
    btn.title = `테마: ${label[t]} (클릭해 전환)`;
    btn.setAttribute('aria-label', `테마 전환 (현재: ${label[t]})`);
  }
  btn.addEventListener('click', () => {
    const cur = getTheme();
    setTheme(order[(order.indexOf(cur) + 1) % order.length]);
    paint();
  });
  try {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (getTheme() === 'auto') paint();
      });
  } catch (_e) {
    /* matchMedia 미지원 — 무시 */
  }
  paint();
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 헤더 CLI 뱃지(agy/Z.AI=cli.chat / claude=cli.record). 미설치 시 취소선+흐림.
function cliBadge(name, available, tip) {
  const s = document.createElement('span');
  s.className = 'cli-badge' + (available ? ' on' : ' off');
  s.title = tip;
  const dot = document.createElement('span');
  dot.className = 'cli-dot';
  s.append(dot, document.createTextNode(name));
  return s;
}

// 챗 배지 표시 정보: provider==='zai'면 Z.AI 라벨 + 모델/effort 툴팁, 아니면 기존 agy 표시.
function chatBadgeInfo() {
  const { cli } = getState();
  const chat = (cli && cli.chat) || {};
  if (chat.provider === 'zai') {
    const effortLabel = chat.effort && chat.effort !== 'none' ? chat.effort : 'thinking off';
    const base = `Z.AI 챗 (${chat.model || 'glm-5.2'} · ${effortLabel})`;
    const removable = chat.keySource === 'file';
    return {
      label: 'Z.AI',
      available: !!chat.available,
      tip: removable ? `${base} — 클릭해 키 삭제` : `${base} — 환경변수로 등록됨`,
      removable,
    };
  }
  return {
    label: 'agy',
    available: !!chat.available,
    tip: chat.available ? 'agy(챗) 감지됨 — 문항 챗 사용 가능' : 'agy(챗) 미설치·미로그인 — 챗 비활성',
    removable: false,
  };
}

function renderCliBadges() {
  const host = document.getElementById('cli-badges');
  if (!host) return;
  const { cli } = getState();
  const claude = !!(cli && cli.record && cli.record.available);
  const chatInfo = chatBadgeInfo();
  host.innerHTML = '';
  const chatBadgeEl = cliBadge(chatInfo.label, chatInfo.available, chatInfo.tip);
  if (chatInfo.removable) {
    chatBadgeEl.classList.add('removable');
    chatBadgeEl.addEventListener('click', onZaiKeyDeleteClick);
  }
  host.append(
    chatBadgeEl,
    cliBadge(
      'claude',
      claude,
      claude ? 'claude(기록) 감지됨 — 자동 추출·정리 기록 사용 가능' : 'claude(기록) 미설치·미로그인 — 자동 추출·정리 비활성'
    )
  );
  renderZaiKeyButton();
}

// 헤더 "API Key 등록하기" 버튼: cli.chat.provider가 'zai'가 아닐 때만 노출.
function renderZaiKeyButton() {
  const host = document.getElementById('zai-key-area');
  if (!host) return;
  host.innerHTML = '';
  const { cli } = getState();
  const isZai = !!(cli && cli.chat && cli.chat.provider === 'zai');
  if (isZai) return;
  const btn = el('button', 'btn secondary sm zai-key-btn', 'API Key 등록하기');
  btn.id = 'zai-key-btn';
  btn.type = 'button';
  btn.addEventListener('click', openZaiKeyModal);
  host.append(btn);
}

// Z.AI API Key 등록 모달: type=password 입력 + 안내 문구 + 등록/취소. Enter로 제출.
function openZaiKeyModal() {
  const overlay = el('div', 'modal-overlay zai-key-modal');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const box = el('div', 'modal-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Z.AI API Key 등록');

  box.append(el('h2', 'dlg-title', 'Z.AI API Key 등록'));
  box.append(
    el('p', 'dlg-desc', '키는 이 PC의 .qnet-web/secrets.json에만 저장되며 git에 커밋되지 않아요.')
  );

  const input = document.createElement('input');
  input.type = 'password';
  input.className = 'dlg-input';
  input.id = 'zai-key-input';
  input.placeholder = 'Z.AI API Key';
  input.autocomplete = 'off';
  input.spellcheck = false;
  box.append(input);

  const err = el('div', 'dlg-error');
  err.hidden = true;
  box.append(err);
  const showErr = (msg) => {
    err.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>';
    err.append(document.createTextNode(msg));
    err.hidden = false;
  };

  const actions = el('div', 'dlg-actions');
  const cancel = el('button', 'dlg-btn-cancel', '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const submit = el('button', 'dlg-btn-primary', '등록');
  submit.type = 'button';
  actions.append(cancel, submit);
  box.append(actions);

  overlay.append(box);
  document.body.append(overlay);
  input.focus();

  async function submitKey() {
    const apiKey = input.value.trim();
    if (!apiKey) {
      showErr('API Key를 입력하세요.');
      return;
    }
    submit.disabled = true;
    cancel.disabled = true;
    err.hidden = true;
    try {
      const res = await apiFetch('/api/zai/key', { method: 'POST', body: { apiKey } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'API Key 등록에 실패했어요.');
      overlay.remove();
      toast('Z.AI API Key가 등록됐어요.', 'ok');
      const { cli } = getState();
      if (cli && cli.chat) {
        cli.chat.available = true;
        cli.chat.provider = 'zai';
        cli.chat.keySource = data.keySource || 'file';
      }
      renderCliBadges();
      // model/effort 등 세부값은 /api/state 재조회로 보강 동기화(부가, 실패해도 무해).
      loadState().then(renderCliBadges).catch(() => {});
    } catch (e) {
      showErr(e.message);
      submit.disabled = false;
      cancel.disabled = false;
      input.focus();
    }
  }

  submit.addEventListener('click', submitKey);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitKey();
    }
  });
}

// Z.AI 배지 클릭(키 삭제, keySource==='file'일 때만 바인딩됨) — 확인 후 DELETE.
async function onZaiKeyDeleteClick() {
  if (!window.confirm('Z.AI API Key를 삭제할까요? 삭제하면 agy 감지 여부로 챗이 전환돼요.')) return;
  try {
    const res = await apiFetch('/api/zai/key', { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'API Key 삭제에 실패했어요.');
    await loadState();
    renderCliBadges();
    toast('Z.AI API Key를 삭제했어요.', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 감사 경고 배너: 허용 경계 밖 수정이 원복됐을 때(SSE audit-warning) 표시.
function showAuditBanner(detail) {
  const banner = document.getElementById('audit-banner');
  if (!banner) return;
  const violations = (detail && detail.violations) || [];
  banner.innerHTML = '';

  const icon = document.createElement('span');
  icon.style.cssText = 'flex:none;margin-top:1px;display:inline-flex';
  icon.innerHTML =
    '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.7 15 14H1z"></path><path d="M8 6.3v3.4"></path><path d="M8 11.7h.01"></path></svg>';

  const body = document.createElement('div');
  body.className = 'audit-banner-body';
  const b = document.createElement('b');
  b.textContent = 'AI가 허용 범위 밖 파일을 수정하려 해 원복했어요.';
  body.append(b);
  if (violations.length) {
    const p = document.createElement('div');
    p.className = 'audit-banner-path';
    p.textContent = violations.join(' · ');
    body.append(p);
  }

  const close = document.createElement('button');
  close.className = 'audit-banner-close';
  close.type = 'button';
  close.setAttribute('aria-label', '닫기');
  close.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
  close.addEventListener('click', () => {
    banner.hidden = true;
  });

  banner.append(icon, body, close);
  banner.hidden = false;
}

// SSE 연결(파일 변경 실시간 반영). Last-Event-ID 재동기화는 브라우저가 자동 처리.
function connectSse() {
  const badge = document.getElementById('sse-badge');
  function setBadge(on) {
    if (!badge) return;
    badge.className = 'sse-badge' + (on ? ' on' : ' off');
    badge.innerHTML = `<span class="sse-dot"></span>${on ? '실시간' : '연결 끊김'}`;
    badge.title = on
      ? '실시간 반영(SSE) — md 파일 변경을 자동 감지'
      : '연결 끊김 — 재연결 중';
  }
  setBadge(false);

  const es = new EventSource('/api/events');
  es.addEventListener('open', () => setBadge(true));
  es.addEventListener('error', () => setBadge(false));

  // 파일 변경(fs-change): 워처가 버스트로 연쇄 저장할 때 트레일링 디바운스(400ms)로
  // 코얼레싱해 마지막 이벤트만 1회 qnet:fs-change 로 재발행한다.
  const FS_DEBOUNCE_MS = 400;
  let fsTimer = null;
  let fsLastDetail = null;
  let fsBurstCount = 0;
  let fsBurstPaths = [];

  function flushFsChange() {
    fsTimer = null;
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
      if (Array.isArray(detail.paths)) fsBurstPaths.push(...detail.paths);
      else if (Array.isArray(detail.changes)) fsBurstPaths.push(...detail.changes);
      if (fsTimer) clearTimeout(fsTimer);
      fsTimer = setTimeout(flushFsChange, FS_DEBOUNCE_MS);
    } catch (_e) {
      /* noop */
    }
  });

  // 감사 경고(audit-warning): 배너 표시 + 재발행(개별 화면이 필요 시 구독).
  es.addEventListener('audit-warning', (evt) => {
    try {
      const detail = JSON.parse(evt.data);
      showAuditBanner(detail);
      window.dispatchEvent(new CustomEvent('qnet:audit-warning', { detail }));
    } catch (_e) {
      /* noop */
    }
  });

  // 참여자 변경(participants-change): 온보딩·닉네임 드롭다운 등이 구독.
  es.addEventListener('participants-change', (evt) => {
    try {
      const detail = JSON.parse(evt.data);
      window.dispatchEvent(new CustomEvent('qnet:participants-change', { detail }));
    } catch (_e) {
      /* noop */
    }
  });

  // CLI 감지 변경(cli-change): 서버가 미감지 CLI 를 재검사로 찾거나(agy),
  // Z.AI 키가 웹 UI 로 등록·삭제되면 배지·기능을 즉시 갱신한다.
  es.addEventListener('cli-change', (evt) => {
    try {
      const detail = JSON.parse(evt.data); // { chat: bool, record: bool, provider?: 'zai'|'agy' }
      const { cli } = getState();
      if (cli && cli.chat) {
        cli.chat.available = !!detail.chat;
        if (detail.provider) cli.chat.provider = detail.provider;
      }
      if (cli && cli.record) cli.record.available = !!detail.record;
      renderCliBadges();
      // model/effort/keySource 는 payload에 없으므로 /api/state 재조회로 보강 동기화.
      loadState().then(renderCliBadges).catch(() => {});
      window.dispatchEvent(new CustomEvent('qnet:cli-change', { detail }));
    } catch (_e) {
      /* noop */
    }
  });

  // 정리 완료(record-done): 요청/잡 분리로 백그라운드에서 끝난 정리 잡의 결과.
  // 패널(승인 다이얼로그)이 jobId 로 자기 잡을 구독해 완료/실패 토스트를 띄운다.
  es.addEventListener('record-done', (evt) => {
    try {
      const detail = JSON.parse(evt.data); // { jobId, examId, qno, ok, timedOut?, isError?, audit?, error? }
      window.dispatchEvent(new CustomEvent('qnet:record-done', { detail }));
    } catch (_e) {
      /* noop */
    }
  });

  // 문항 추출 진행/완료(questions-*): 업로드·수동등록·백필 후 백그라운드 잡의 통지.
  es.addEventListener('questions-progress', (evt) => {
    try {
      window.dispatchEvent(
        new CustomEvent('qnet:questions-progress', { detail: JSON.parse(evt.data) })
      );
    } catch (_e) {
      /* noop */
    }
  });
  es.addEventListener('questions-done', (evt) => {
    try {
      const detail = JSON.parse(evt.data); // { jobId, examId, ok, 존재수?, 문항수?, 누락문번?, 검증오류?, error? }
      window.dispatchEvent(new CustomEvent('qnet:questions-done', { detail }));
      const say = (message, type) =>
        window.dispatchEvent(new CustomEvent('qnet:toast', { detail: { message, type } }));
      if (detail.ok) {
        say(`문항 추출 완료 — ${detail.examId} (${detail.존재수}/${detail.문항수})`, 'ok');
      } else {
        const 사유 =
          detail.error ||
          (detail.누락문번 && detail.누락문번.length
            ? `누락 ${detail.누락문번.length}문항`
            : '검증 오류');
        say(`문항 추출 실패 — ${detail.examId}: ${사유}`, 'error');
      }
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
    document.getElementById('app').innerHTML =
      `<p class="error-text" style="padding:40px">${e.message}</p>`;
    return;
  }

  mountToast();
  setupThemeToggle();
  renderCliBadges();

  const nickArea = document.getElementById('nickname-area');
  renderNicknameMenu(nickArea);
  window.addEventListener('qnet:nickname-changed', () => renderNicknameMenu(nickArea));

  startRouter();
  connectSse();
}

main();
