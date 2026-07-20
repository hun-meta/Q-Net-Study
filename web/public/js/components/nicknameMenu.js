// 헤더 닉네임 칩 드롭다운(변경·삭제). 닉네임 미설정 시 아무것도 렌더하지 않는다(온보딩이 담당).
// 기존 nickname.js의 usage 조회·삭제 확인 모달 로직을 이식하되 JS <style> 주입은 제거했다
// (스타일은 CSS 담당). 변경/삭제 성공 시 홈 라우트로 이동하고 qnet:nickname-changed 를 발행한다.

import { apiFetch, getState, setNickname } from '../store.js';
import { toast } from './toast.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 포커스 트랩 + ESC. 반환값은 해제 함수. onEscape 호출 시 닫기 로직을 위임한다.
function trapFocus(root, onEscape) {
  const SELECTOR =
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
  const focusables = () => [...root.querySelectorAll(SELECTOR)].filter((n) => n.offsetParent !== null);
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

// 전체 참여자(닉네임) 합집합. 서버가 participants 를 주면 사용, 없으면 certs 에서 계산.
async function fetchParticipants() {
  try {
    const res = await fetch('/api/repo');
    if (!res.ok) return [];
    const data = await res.json();
    let list = Array.isArray(data.participants) ? data.participants.slice() : null;
    if (!list) {
      const set = new Set();
      for (const c of data.certs || []) for (const p of c.participants || []) set.add(p);
      list = [...set];
    }
    return list.sort((a, b) => String(a).localeCompare(String(b), 'ko'));
  } catch (_e) {
    return [];
  }
}

// 현재 등록된 문서 클릭 리스너(메뉴 바깥 클릭 닫기). 재렌더로 메뉴 DOM만 사라지고
// closeMenu 가 호출되지 않은 경우 리스너가 남는 누수를 막기 위해 모듈 레벨로 추적한다.
let activeOnOutside = null;

export function renderNicknameMenu(container) {
  if (!container) return;
  // 이전 렌더가 남긴 문서 클릭 리스너 제거(재렌더로 메뉴 DOM만 사라진 경우 대비).
  if (activeOnOutside) {
    document.removeEventListener('click', activeOnOutside, true);
    activeOnOutside = null;
  }
  const { nickname } = getState();
  container.innerHTML = '';
  if (!nickname) return; // 미설정 → 헤더 비움(온보딩 화면이 담당)

  const wrap = el('div', 'nick-menu-wrap');
  const chip = el('button', 'nick-chip', `${nickname} ▾`);
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'menu');
  chip.setAttribute('aria-expanded', 'false');
  wrap.append(chip);
  container.append(wrap);

  let menu = null;
  let releaseTrap = null;

  function closeMenu() {
    if (menu) menu.remove();
    menu = null;
    if (releaseTrap) releaseTrap();
    releaseTrap = null;
    chip.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    if (activeOnOutside === onOutside) activeOnOutside = null;
  }

  function onOutside(e) {
    if (menu && !wrap.contains(e.target)) closeMenu();
  }

  function openMenu() {
    if (menu) {
      closeMenu();
      return;
    }
    menu = el('div', 'nick-menu');
    menu.setAttribute('role', 'menu');
    const change = el('button', 'nick-menu-item', '닉네임 변경');
    change.type = 'button';
    change.setAttribute('role', 'menuitem');
    change.addEventListener('click', () => {
      closeMenu();
      openChangePanel();
    });
    const del = el('button', 'nick-menu-item danger', '닉네임 삭제');
    del.type = 'button';
    del.setAttribute('role', 'menuitem');
    del.addEventListener('click', () => {
      closeMenu();
      openDeleteDialog(nickname, container);
    });
    menu.append(change, del);
    wrap.append(menu);
    chip.setAttribute('aria-expanded', 'true');
    releaseTrap = trapFocus(menu, closeMenu);
    activeOnOutside = onOutside;
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    change.focus();
  }

  chip.addEventListener('click', openMenu);

  // 변경 패널: 참여자 드롭다운 + 새 닉네임 입력(간이). 헤더 영역 내부에 인라인 표시.
  function openChangePanel() {
    const panel = el('div', 'nick-change');
    const select = el('select', 'field');
    select.disabled = true;
    select.append(new Option('불러오는 중…', ''));
    const input = el('input', 'nick-change-new');
    input.type = 'text';
    input.placeholder = '새 닉네임';
    const save = el('button', 'btn sm', '적용');
    save.type = 'button';
    const cancel = el('button', 'btn ghost sm', '취소');
    cancel.type = 'button';
    const err = el('span', 'error-text');
    panel.append(select, input, save, cancel, err);
    container.innerHTML = '';
    container.append(wrap, panel);

    const closePanel = () => renderNicknameMenu(container);
    cancel.addEventListener('click', closePanel);

    fetchParticipants().then((participants) => {
      select.innerHTML = '';
      select.append(new Option('기존 참여자 선택…', ''));
      for (const p of participants) if (p !== nickname) select.append(new Option(p, p));
      select.disabled = false;
    });

    async function apply(value) {
      const v = (value || '').trim();
      if (!v) {
        err.textContent = '닉네임을 선택하거나 입력하세요.';
        return;
      }
      err.textContent = '';
      await submitNickname(v, container, err);
    }
    select.addEventListener('change', () => {
      if (select.value) apply(select.value);
    });
    save.addEventListener('click', () => apply(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply(input.value);
    });
    input.focus();
  }
}

async function submitNickname(nickname, container, err) {
  try {
    const res = await apiFetch('/api/nickname', { method: 'POST', body: { nickname } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '등록 실패');
    setNickname(data.nickname);
    renderNicknameMenu(container);
    toast(`닉네임: ${data.nickname}`, 'ok');
    window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { nickname: data.nickname } }));
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

// 삭제 확인 다이얼로그(모달): usage 표시 → 경고 → 닉네임 직접입력 확인 → DELETE.
async function openDeleteDialog(nickname, container) {
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `닉네임 삭제 — ${nickname}`);
  box.append(el('h3', null, `닉네임 삭제 — ${nickname}`));

  const usageArea = el('div', 'usage-area');
  usageArea.append(el('p', 'status-msg', '삭제 대상 조회 중…'));
  box.append(usageArea);

  box.append(
    el('p', 'modal-warn', '⚠️ 이 닉네임의 개인 디렉토리가 전부 삭제됩니다. git 커밋 전 기록은 복구할 수 없습니다.')
  );

  const confirmField = el('div', 'field');
  confirmField.append(el('label', null, `확인을 위해 닉네임 "${nickname}"을 그대로 입력하세요:`));
  const confirmInput = el('input');
  confirmInput.type = 'text';
  confirmField.append(confirmInput);
  box.append(confirmField);

  const actions = el('div', 'modal-actions');
  const del = el('button', 'btn danger', '영구 삭제');
  del.type = 'button';
  del.disabled = true;
  const cancel = el('button', 'btn ghost sm', '취소');
  cancel.type = 'button';
  const status = el('span', 'error-text');
  actions.append(del, cancel, status);
  box.append(actions);

  overlay.append(box);
  document.body.append(overlay);

  const prevFocus = document.activeElement;
  const close = () => {
    releaseTrap();
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  };
  const releaseTrap = trapFocus(overlay, close);

  // 닉네임 정확 일치 시에만 삭제 활성화.
  confirmInput.addEventListener('input', () => {
    del.disabled = confirmInput.value.normalize('NFC') !== String(nickname).normalize('NFC');
  });
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  confirmInput.focus();

  // 삭제 대상 조회.
  try {
    const res = await fetch(`/api/nickname/${encodeURIComponent(nickname)}/usage`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '사용량 조회 실패');
    usageArea.innerHTML = '';
    usageArea.append(el('p', null, `삭제될 디렉토리 (총 ${data.totalFiles ?? 0}개 파일):`));
    const dirs = data.directories || data.dirs || [];
    const ul = el('ul');
    for (const d of dirs) ul.append(el('li', null, `${d.path} — ${d.files}개 파일`));
    if (!dirs.length) ul.append(el('li', null, '삭제할 개인 디렉토리가 없습니다.'));
    usageArea.append(ul);
  } catch (e) {
    usageArea.innerHTML = '';
    usageArea.append(el('p', 'error-text', e.message));
  }

  del.addEventListener('click', async () => {
    del.disabled = true;
    status.className = 'status-msg';
    status.textContent = '삭제 중…';
    try {
      const res = await apiFetch('/api/nickname', {
        method: 'DELETE',
        body: { nickname, confirm: confirmInput.value },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '삭제 실패');
      usageArea.innerHTML = '';
      usageArea.append(el('p', null, `삭제 완료 — 총 ${data.totalFiles ?? 0}개 파일 제거`));
      const ul = el('ul');
      for (const item of data.deleted || []) {
        // 서버는 {path,files} 객체 배열을 반환(문자열 배열도 방어적으로 허용).
        const text = typeof item === 'string' ? item : `${item.path}${item.files != null ? ` — ${item.files}개 파일` : ''}`;
        ul.append(el('li', null, text));
      }
      usageArea.append(ul);
      confirmField.remove();
      del.remove();
      cancel.textContent = '닫기';
      toast(`닉네임 ${nickname} 삭제됨`, 'ok');
      // 현재 닉네임을 지웠으면 온보딩으로 복귀.
      if (getState().nickname === nickname) {
        setNickname(null);
        renderNicknameMenu(container);
        if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
      }
      window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { deleted: nickname } }));
    } catch (e) {
      del.disabled = false;
      status.className = 'error-text';
      status.textContent = e.message;
    }
  });
}
