// 닉네임 온보딩·관리 UI.
// - 미설정: 기존 참여자 드롭다운 + "새 닉네임 등록…" → 입력 폼. 선택/등록 → POST /api/nickname.
// - 설정: `닉네임: {값}` + [변경](드롭다운 재표시) + [삭제](확인 다이얼로그).
// - 삭제: GET /api/nickname/:name/usage 로 삭제 대상 표시 → 경고 → 닉네임 직접입력 확인 → DELETE.

import { apiFetch, getState, setNickname } from './store.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function ensureStyles() {
  if (document.getElementById('nickname-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'nickname-ui-styles';
  style.textContent = `
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-box { background: #fff; color: #222; border-radius: 8px; padding: 1rem 1.2rem; width: min(520px, 92vw); max-height: 86vh; overflow: auto; box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
    .modal-box h3 { margin: 0 0 0.6rem; }
    .modal-warn { background: #fdecea; border: 1px solid #f5b5ae; color: #b3261e; padding: 0.5rem 0.6rem; border-radius: 6px; }
    .modal-actions { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.8rem; }
    .modal-box .usage-area ul { margin: 0.3rem 0; padding-left: 1.2rem; }
    .modal-box input[type=text] { width: 100%; box-sizing: border-box; padding: 0.35rem; }
    .btn.danger { background: #d32f2f; color: #fff; border-color: #d32f2f; }
    .btn.danger:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (prefers-color-scheme: dark) {
      .modal-box { background: #26282c; color: #eee; }
      .modal-warn { background: #3a2320; border-color: #7a3b34; color: #ff9c8f; }
    }
  `;
  document.head.append(style);
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

export function renderNickname(container) {
  ensureStyles();
  const { nickname } = getState();
  container.innerHTML = '';
  if (nickname) renderCurrent(container, nickname);
  else renderOnboarding(container);
}

function renderCurrent(container, nickname) {
  const label = el('span', 'nick-chip', `닉네임: ${nickname}`);
  const change = el('button', 'btn ghost sm', '변경');
  change.addEventListener('click', () => renderOnboarding(container));
  const del = el('button', 'btn ghost sm', '삭제');
  del.addEventListener('click', () => openDeleteDialog(nickname, container));
  container.append(label, change, del);
}

async function renderOnboarding(container) {
  container.innerHTML = '';
  const wrap = el('div', 'field');
  const select = el('select');
  select.disabled = true;
  select.append(new Option('닉네임 불러오는 중…', ''));
  const err = el('span', 'error-text');
  wrap.append(select, err);
  container.append(wrap);

  const participants = await fetchParticipants();
  select.innerHTML = '';
  select.append(new Option('닉네임 선택…', ''));
  for (const p of participants) select.append(new Option(p, p));
  select.append(new Option('+ 새 닉네임 등록…', '__new__'));
  select.disabled = false;

  select.addEventListener('change', async () => {
    err.textContent = '';
    const v = select.value;
    if (!v) return;
    if (v === '__new__') {
      renderForm(container);
      return;
    }
    await submitNickname(v, container, err);
  });
}

function renderForm(container) {
  container.innerHTML = '';
  const wrap = el('div', 'field');
  const input = el('input');
  input.type = 'text';
  input.placeholder = '새 닉네임 입력';
  const save = el('button', 'btn', '등록');
  const back = el('button', 'btn ghost sm', '목록');
  const err = el('span', 'error-text');
  wrap.append(input, save, back, err);
  container.append(wrap);
  input.focus();

  const go = () => submitNickname(input.value, container, err);
  save.addEventListener('click', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  back.addEventListener('click', () => renderOnboarding(container));
}

async function submitNickname(nickname, container, err) {
  try {
    const res = await apiFetch('/api/nickname', { method: 'POST', body: { nickname } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '등록 실패');
    setNickname(data.nickname);
    renderNickname(container);
    window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { nickname: data.nickname } }));
  } catch (e) {
    if (err) err.textContent = e.message;
  }
}

// 삭제 확인 다이얼로그(모달): usage 표시 → 경고 → 닉네임 직접입력 확인 → DELETE.
async function openDeleteDialog(nickname, container) {
  ensureStyles();
  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box');
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
  del.disabled = true;
  const cancel = el('button', 'btn ghost sm', '취소');
  const status = el('span', 'error-text');
  actions.append(del, cancel, status);
  box.append(actions);

  overlay.append(box);
  document.body.append(overlay);

  // 닉네임 정확 일치 시에만 삭제 활성화.
  confirmInput.addEventListener('input', () => {
    del.disabled = confirmInput.value.normalize('NFC') !== String(nickname).normalize('NFC');
  });
  cancel.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

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
      // 현재 닉네임을 지웠으면 온보딩으로 복귀.
      if (getState().nickname === nickname) {
        setNickname(null);
        renderNickname(container);
      }
      window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { deleted: nickname } }));
    } catch (e) {
      del.disabled = false;
      status.className = 'error-text';
      status.textContent = e.message;
    }
  });
}
