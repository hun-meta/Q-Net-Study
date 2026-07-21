// 온보딩(닉네임 미설정 시 전체 화면): 로고 + 기존 참여자 select / 새 닉네임 입력 2모드.
// 성공 시 setNickname 후 홈(#/)으로 이동. 뷰 계약: mount(container, params) / unmount().

import { apiFetch, setNickname } from '../store.js';
import { toast } from '../components/toast.js';
import { navigate } from '../router.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 프로토타입과 동일한 클라이언트 검증(서버도 재검증).
function validateNick(n) {
  n = (n || '').trim();
  if (!n) return '닉네임을 입력해 주세요.';
  if (n.length > 40) return '40자 이내로 입력해 주세요.';
  if (n === '_공통') return '_공통은 예약어라 쓸 수 없어요.';
  if (n[0] === '.') return '.으로 시작할 수 없어요.';
  if (/[\\/:*?"<>|]/.test(n)) return '경로에 쓸 수 없는 문자가 있어요.';
  return '';
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

  let mode = 'select'; // 'select' | 'new'
  let selectedVal = '';
  let newVal = '';
  let participants = [];

  const wrap = el('section', 'onb');
  const inner = el('div', 'onb-inner');

  // 로고 헤더.
  const brand = el('div', 'onb-brand');
  brand.append(el('div', 'onb-logo', 'Q'));
  const btext = el('div', 'onb-brand-text');
  btext.append(el('div', 'onb-brand-title', 'Q-Net 기출 풀이'), el('div', 'onb-brand-sub', '로컬 전용 · 127.0.0.1'));
  brand.append(btext);

  // 카드.
  const card = el('div', 'onb-card');
  card.append(el('h1', 'onb-title', '누구로 학습할까요?'));
  const lead = el('p', 'onb-lead');
  lead.innerHTML = '닉네임은 이 저장소에서 <b>내 기록 폴더의 이름</b>이 돼요. 스터디원과 커밋으로 공유됩니다.';
  card.append(lead);

  const body = el('div', 'onb-body');
  card.append(body);

  const errLine = el('div', 'onb-error');
  errLine.hidden = true;
  card.append(errLine);

  const submit = el('button', 'btn onb-submit', '시작하기');
  submit.type = 'button';
  card.append(submit);

  const rules = el('p', 'onb-rules');
  rules.innerHTML =
    '빈 값·40자 초과·경로 문자·<code>.</code> 시작·<code>_공통</code>은 사용할 수 없어요.';

  inner.append(brand, card, rules);
  wrap.append(inner);
  container.append(wrap);

  function clearErr() {
    errLine.hidden = true;
    errLine.textContent = '';
  }
  function showErr(msg) {
    errLine.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 5v3.5M8 11h.01"></path></svg>';
    errLine.append(document.createTextNode(msg));
    errLine.hidden = false;
  }

  function renderBody() {
    body.innerHTML = '';
    if (mode === 'select') {
      body.append(el('label', 'onb-field-label', '참여자 선택'));
      const sw = el('div', 'onb-select-wrap');
      const select = el('select', 'onb-select');
      select.append(new Option('참여자 선택…', ''));
      for (const p of participants) select.append(new Option(p, p));
      select.append(new Option('+ 새 닉네임 등록…', '__new'));
      select.value = selectedVal;
      select.addEventListener('change', () => {
        if (select.value === '__new') {
          mode = 'new';
          newVal = '';
          clearErr();
          renderBody();
          const i = body.querySelector('.onb-input');
          if (i) i.focus();
        } else {
          selectedVal = select.value;
          clearErr();
        }
      });
      const chev = el('span', 'onb-select-chevron');
      chev.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></svg>';
      sw.append(select, chev);
      body.append(sw);
    } else {
      const head = el('div', 'onb-new-head');
      head.append(el('label', 'onb-field-label', '새 닉네임'));
      const back = el('button', 'onb-back-link', '← 기존에서 선택');
      back.type = 'button';
      back.addEventListener('click', () => {
        mode = 'select';
        clearErr();
        renderBody();
      });
      head.append(back);
      body.append(head);

      const input = el('input', 'onb-input');
      input.type = 'text';
      input.maxLength = 41;
      input.placeholder = '예: 민준';
      input.value = newVal;
      input.addEventListener('input', () => {
        newVal = input.value;
        clearErr();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSubmit();
      });
      body.append(input);
    }
  }

  async function doSubmit() {
    const value = mode === 'new' ? newVal : selectedVal;
    if (mode === 'select' && !value) {
      showErr('참여자를 선택해 주세요.');
      return;
    }
    const verr = validateNick(value);
    if (verr) {
      showErr(verr);
      return;
    }
    submit.disabled = true;
    try {
      const res = await apiFetch('/api/nickname', { method: 'POST', body: { nickname: value.trim() } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '등록 실패');
      setNickname(data.nickname);
      toast(`환영합니다, ${data.nickname}`, 'ok');
      window.dispatchEvent(new CustomEvent('qnet:nickname-changed', { detail: { nickname: data.nickname } }));
      navigate('#/');
    } catch (e) {
      showErr(e.message);
      submit.disabled = false;
    }
  }
  submit.addEventListener('click', doSubmit);

  renderBody();
  fetchParticipants().then((list) => {
    participants = list;
    if (mode === 'select') renderBody();
  });
}

export function unmount() {}
