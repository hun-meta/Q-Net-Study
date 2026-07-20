// 온보딩(닉네임 미설정 시 전체 화면): 앱 한 줄 소개 + 기존 참여자 드롭다운 + 새 닉네임 입력.
// 성공 시 setNickname 후 대시보드(#/)로 이동한다.
// 뷰 인터페이스: export async function mount(container, params) / export function unmount().

import { apiFetch, setNickname } from '../store.js';
import { toast } from '../components/toast.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

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

export async function mount(container, _params) {
  container.innerHTML = '';
  const view = el('section', 'onb');
  const card = el('div', 'onb-card');

  const brand = el('div', 'onb-brand');
  brand.append(el('span', 'brand-mark', 'Q'), el('h2', 'onb-title', 'Q-Net 기출 풀이'));
  card.append(brand);

  card.append(
    el(
      'p',
      'onb-lead',
      '기출 PDF를 풀고, 자동 채점받고, 오답을 복습하는 로컬 스터디 앱입니다.'
    )
  );

  // 기존 참여자 드롭다운.
  const pickField = el('label', 'field onb-field');
  pickField.append(el('span', null, '닉네임 선택 (기존 참여자)'));
  const select = el('select');
  select.disabled = true;
  select.append(new Option('불러오는 중…', ''));
  pickField.append(select);

  // 새 닉네임 입력.
  const newField = el('label', 'field onb-field');
  newField.append(el('span', null, '또는 새 닉네임'));
  const newRow = el('div', 'onb-new-row');
  const input = el('input');
  input.type = 'text';
  input.placeholder = '새 닉네임 입력';
  const start = el('button', 'btn onb-start', '시작하기');
  start.type = 'button';
  newRow.append(input, start);
  newField.append(newRow);

  const err = el('span', 'error-text onb-err');

  card.append(pickField, newField, err);
  view.append(card);
  container.append(view);

  fetchParticipants().then((participants) => {
    select.innerHTML = '';
    select.append(new Option('기존 참여자 선택…', ''));
    for (const p of participants) select.append(new Option(p, p));
    select.disabled = false;
  });

  async function submit(value) {
    const v = (value || '').trim();
    if (!v) {
      err.textContent = '닉네임을 선택하거나 입력하세요.';
      return;
    }
    err.textContent = '';
    start.disabled = true;
    try {
      const res = await apiFetch('/api/nickname', { method: 'POST', body: { nickname: v } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '등록 실패');
      setNickname(data.nickname);
      toast(`환영합니다, ${data.nickname}`, 'ok');
      window.dispatchEvent(
        new CustomEvent('qnet:nickname-changed', { detail: { nickname: data.nickname } })
      );
      location.hash = '#/'; // 대시보드로(닉네임 설정 → 홈 라우트가 대시보드로 해석됨)
    } catch (e) {
      err.textContent = e.message;
      start.disabled = false;
    }
  }

  select.addEventListener('change', () => {
    if (select.value) submit(select.value);
  });
  start.addEventListener('click', () => submit(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit(input.value);
  });
}

export function unmount() {
  // 문서 레벨 리스너 없음 — 컨테이너 정리는 라우터가 담당.
}
