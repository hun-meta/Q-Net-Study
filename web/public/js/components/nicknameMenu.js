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
  const chip = el('button', 'nick-chip');
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'menu');
  chip.setAttribute('aria-expanded', 'false');
  const initial = (String(nickname).trim()[0] || '?').toUpperCase();
  const avatar = el('span', 'nick-avatar', initial);
  const nameEl = el('span', 'nick-name', nickname);
  const caret = el('span', 'nick-caret');
  caret.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>';
  chip.append(avatar, nameEl, caret);
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
    const head = el('div', 'nick-menu-head');
    head.append(el('div', 'nick-menu-role', '현재 사용자'), el('div', 'nick-menu-name', nickname));
    const sep = el('div', 'nick-menu-sep');
    const change = el('button', 'nick-menu-item');
    change.type = 'button';
    change.setAttribute('role', 'menuitem');
    change.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"></path></svg>';
    change.append(document.createTextNode('닉네임 변경'));
    change.addEventListener('click', () => {
      closeMenu();
      openChangePanel();
    });
    const del = el('button', 'nick-menu-item danger');
    del.type = 'button';
    del.setAttribute('role', 'menuitem');
    del.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8"></path></svg>';
    del.append(document.createTextNode('닉네임 삭제'));
    del.addEventListener('click', () => {
      closeMenu();
      openDeleteDialog(nickname, container);
    });
    menu.append(head, sep, change, del);
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
    const actions = el('div', 'nick-change-actions');
    actions.append(save, cancel);
    panel.append(select, input, actions, err);
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

// 삭제 확인 다이얼로그(디자인): danger 헤더 + 삭제 대상 목록 + 닉네임 직접입력 확인 + 결과 상태.
async function openDeleteDialog(nickname, container) {
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box del-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `닉네임 삭제 — ${nickname}`);
  overlay.append(box);
  document.body.append(overlay);

  const prevFocus = document.activeElement;
  const close = () => {
    releaseTrap();
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  };
  const releaseTrap = trapFocus(overlay, close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  function targetRow(path, count) {
    const row = el('div', 'del-target-row');
    row.append(el('span', null, path));
    if (count != null && count !== '') row.append(el('span', 'del-target-count', count));
    return row;
  }

  function renderConfirm() {
    box.innerHTML = '';
    const head = el('div', 'del-head');
    const ic = el('span', 'del-icon');
    ic.innerHTML =
      '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.2"></path></svg>';
    head.append(ic, el('h2', 'dlg-title', '닉네임 삭제'));
    box.append(head);

    const warn = el('p', 'del-warn');
    warn.innerHTML = '<b>모든 자격증의 개인 디렉토리가 삭제됩니다.</b> git 커밋 전 기록은 복구할 수 없어요.';
    box.append(warn);

    box.append(el('div', 'del-target-label', '삭제 대상'));
    const targets = el('div', 'del-targets');
    targets.append(el('p', 'status-msg', '조회 중…'));
    box.append(targets);

    box.append(el('p', 'del-note', '공유 해설(_공통/풀이/)의 내 서명 섹션은 공유 자산이라 보존됩니다.'));

    const label = el('label', 'del-confirm-label');
    label.innerHTML = `확인을 위해 <b>${nickname}</b>을 정확히 입력하세요`;
    box.append(label);
    const input = el('input', 'del-input');
    input.type = 'text';
    input.placeholder = nickname;
    box.append(input);

    const status = el('div', 'del-status');
    status.hidden = true;
    box.append(status);

    const actions = el('div', 'dlg-actions');
    const cancel = el('button', 'dlg-btn-cancel', '취소');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    const del = el('button', 'dlg-btn-danger', '영구 삭제');
    del.type = 'button';
    del.disabled = true;
    actions.append(cancel, del);
    box.append(actions);

    input.addEventListener('input', () => {
      del.disabled = input.value.normalize('NFC') !== String(nickname).normalize('NFC');
    });
    input.focus();

    fetch(`/api/nickname/${encodeURIComponent(nickname)}/usage`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || '사용량 조회 실패');
        targets.innerHTML = '';
        const dirs = d.directories || d.dirs || [];
        if (!dirs.length) targets.append(targetRow('삭제할 개인 디렉토리가 없습니다.', ''));
        for (const dir of dirs) targets.append(targetRow(`${dir.path}/`, `${dir.files}개`));
      })
      .catch((e) => {
        targets.innerHTML = '';
        targets.append(el('p', 'error-text', e.message));
      });

    del.addEventListener('click', async () => {
      del.disabled = true;
      status.hidden = false;
      status.className = 'del-status';
      status.textContent = '삭제 중…';
      try {
        const res = await apiFetch('/api/nickname', { method: 'DELETE', body: { nickname, confirm: input.value } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '삭제 실패');
        toast(`닉네임 ${nickname} 삭제됨`, 'ok');
        if (getState().nickname === nickname) setNickname(null);
        window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { deleted: nickname } }));
        renderResult(data.deleted || []);
      } catch (e) {
        del.disabled = false;
        status.hidden = false;
        status.className = 'del-status err';
        status.textContent = e.message;
      }
    });
  }

  function renderResult(deleted) {
    box.innerHTML = '';
    const res = el('div', 'del-result');
    const ic = el('div', 'del-result-icon');
    ic.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-8"></path></svg>';
    res.append(ic, el('h2', 'del-result-title', '삭제 완료'), el('p', 'del-result-sub', '아래 경로가 삭제됐어요.'));
    const targets = el('div', 'del-targets del-targets-result');
    for (const item of deleted) {
      const text = typeof item === 'string' ? item : `${item.path}${item.files != null ? ` — ${item.files}개` : ''}`;
      targets.append(targetRow(text, ''));
    }
    if (!deleted.length) targets.append(targetRow('삭제된 경로가 없습니다.', ''));
    res.append(targets);
    const done = el('button', 'del-result-btn', getState().nickname ? '닫기' : '온보딩으로');
    done.type = 'button';
    done.addEventListener('click', () => {
      close();
      renderNicknameMenu(container);
      if (!getState().nickname && location.hash !== '#/' && location.hash !== '') location.hash = '#/';
    });
    res.append(done);
    box.append(res);
  }

  renderConfirm();
}
