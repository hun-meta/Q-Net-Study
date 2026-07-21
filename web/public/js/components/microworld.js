// 마이크로월드 패널: 개념 인터랙티브 시뮬레이션을 목록·생성·체험한다.
//   목록/과목: GET /api/microworld?grade&cert
//   생성:      POST /api/microworld/generate (claude 잡, 최대 몇 분)
//   열람:      GET /api/microworld/content → 샌드박스 iframe(srcdoc, allow-scripts)로 임베드.
// 반환값은 cleanup 함수(뷰 unmount 시 호출).

import { apiFetch } from '../store.js';
import { toast } from './toast.js';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export function renderMicroworldPanel(host, { grade, cert }) {
  let destroyed = false;
  const state = { items: [], subjects: [], canGenerate: false };

  host.innerHTML = '';
  const wrap = el('div', 'mw-panel');
  wrap.append(
    el('p', 'mw-intro', '개념을 직접 조작하며 이해하는 인터랙티브 시뮬레이션입니다. Claude Code가 생성하고, 여기서 바로 체험합니다.')
  );
  const genBox = el('div', 'mw-gen');
  const listBox = el('div', 'mw-list');
  const viewer = el('div', 'mw-viewer');
  wrap.append(genBox, listBox, viewer);
  host.append(wrap);

  async function load() {
    try {
      const res = await fetch(`/api/microworld?grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '목록을 불러오지 못했습니다.');
      if (destroyed) return;
      state.items = data.items || [];
      state.subjects = data.subjects || [];
      state.canGenerate = !!data.canGenerate;
      renderGen();
      renderList();
    } catch (e) {
      if (destroyed) return;
      listBox.innerHTML = '';
      listBox.append(el('p', 'error-text', e.message));
    }
  }

  function renderGen() {
    genBox.innerHTML = '';
    const form = el('div', 'mw-form');
    const sel = document.createElement('select');
    sel.className = 'mw-subject';
    for (const s of state.subjects) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.append(o);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mw-concept';
    input.placeholder = '개념/주제 (예: CPU 스케줄링)';
    input.maxLength = 80;
    const btn = el('button', 'btn sm', '＋ 마이크로월드 생성');
    btn.type = 'button';
    if (!state.canGenerate || !state.subjects.length) btn.disabled = true;
    form.append(sel, input, btn);
    genBox.append(form);
    if (!state.canGenerate) {
      genBox.append(
        el('p', 'muted mw-hint', 'claude(기록) CLI 미감지 — 생성은 비활성이며 기존 마이크로월드 열람은 가능합니다.')
      );
    }
    btn.addEventListener('click', () => generate(sel.value, input.value.trim(), btn));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) generate(sel.value, input.value.trim(), btn);
    });
  }

  async function generate(과목, 개념, btn) {
    if (!과목) return toast('과목을 선택하세요.', 'info');
    if (!개념) return toast('개념을 입력하세요.', 'info');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = '생성 중… (최대 몇 분)';
    try {
      const res = await apiFetch('/api/microworld/generate', { method: 'POST', body: { grade, cert, 과목, 개념 } });
      const data = await res.json();
      if (res.status === 503) return toast(data.error || 'claude CLI 미감지', 'error');
      if (!res.ok) throw new Error(data.error || '생성에 실패했습니다.');
      if (!data.생성됨) return toast('생성 결과 파일이 없습니다. 다시 시도해 주세요.', 'error');
      if (data.audit && !data.audit.clean) toast('생성됐으나 감사 경고가 있습니다 — 확인이 필요합니다.', 'error');
      else toast('마이크로월드를 생성했습니다.', 'info');
      await load();
      if (!destroyed) openMicroworld(과목, data.file);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  function renderList() {
    listBox.innerHTML = '';
    if (!state.items.length) {
      listBox.append(el('p', 'muted', '아직 생성된 마이크로월드가 없습니다. 과목·개념을 정해 생성해 보세요.'));
      return;
    }
    const groups = new Map();
    for (const it of state.items) {
      if (!groups.has(it['과목'])) groups.set(it['과목'], []);
      groups.get(it['과목']).push(it);
    }
    for (const [과목, arr] of groups) {
      const g = el('div', 'mw-group');
      g.append(el('div', 'mw-group-title', 과목));
      const chips = el('div', 'mw-chips');
      for (const it of arr) {
        const chip = el('button', 'mw-chip', it.title);
        chip.type = 'button';
        chip.title = it.rel;
        chip.addEventListener('click', () => openMicroworld(it['과목'], it.file));
        chips.append(chip);
      }
      g.append(chips);
      listBox.append(g);
    }
  }

  async function openMicroworld(과목, file) {
    viewer.innerHTML = '';
    viewer.append(el('p', 'muted', '불러오는 중…'));
    try {
      const url =
        `/api/microworld/content?grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}` +
        `&${encodeURIComponent('과목')}=${encodeURIComponent(과목)}&file=${encodeURIComponent(file)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '열람에 실패했습니다.');
      if (destroyed) return;
      viewer.innerHTML = '';
      const bar = el('div', 'mw-viewer-bar');
      bar.append(el('span', 'mw-viewer-title', `${과목} · ${file}`));
      const big = el('button', 'btn sm secondary', '크게 보기');
      big.type = 'button';
      bar.append(big);
      const frame = document.createElement('iframe');
      frame.className = 'mw-frame';
      // same-origin 미포함 → 생성 HTML은 앱과 격리된 opaque origin에서 실행(토큰·DOM 접근 불가).
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('title', `${과목} ${file} 마이크로월드`);
      frame.srcdoc = data.html;
      big.addEventListener('click', () => frame.classList.toggle('big'));
      viewer.append(bar, frame);
      viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (destroyed) return;
      viewer.innerHTML = '';
      viewer.append(el('p', 'error-text', e.message));
    }
  }

  const onFs = () => {
    if (!destroyed) load();
  };
  window.addEventListener('qnet:fs-change', onFs);
  load();

  return function cleanup() {
    destroyed = true;
    window.removeEventListener('qnet:fs-change', onFs);
  };
}
