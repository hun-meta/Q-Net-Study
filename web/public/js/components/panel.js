// 우측 슬라이드오버 패널: 개념 ↔ 챗 탭. solve 뷰(및 결과 퍼널)가 문항별로 연다.
// 개념: /api/concept 섹션 렌더(내/타인 노트·공유 해설). 챗: agy 스트리밍(표시 전용) + 정리해줘 승인.

import { apiFetch, getState } from '../store.js';

const enc = encodeURIComponent;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function icon(html, cls) {
  const s = el('span', cls);
  s.style.display = 'inline-flex';
  s.innerHTML = html;
  return s;
}

let active = null; // { overlay, ctx, qno, tab, bodyEl, onFs, history }

export function closePanel() {
  if (!active) return;
  if (active.onFs) window.removeEventListener('qnet:fs-change', active.onFs);
  active.overlay.remove();
  active = null;
}

export function openPanel(ctx, qno, tab) {
  closePanel();
  const overlay = el('div', 'panel-overlay');
  overlay.addEventListener('click', closePanel);
  const aside = el('aside', 'panel');
  aside.addEventListener('click', (e) => e.stopPropagation());

  // 헤더: 탭 + #문번 + 닫기.
  const head = el('div', 'panel-head');
  const tabs = el('div', 'panel-tabs');
  const tabConcept = el('button', 'panel-tab', '개념');
  tabConcept.type = 'button';
  const tabChat = el('button', 'panel-tab', '챗');
  tabChat.type = 'button';
  tabs.append(tabConcept, tabChat);
  const qnoLabel = el('span', 'panel-qno', `#${qno}`);
  const close = el('button', 'panel-close');
  close.type = 'button';
  close.setAttribute('aria-label', '닫기');
  close.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
  close.addEventListener('click', closePanel);
  head.append(tabs, qnoLabel, close);

  const bodyEl = el('div', 'panel-body qsc');

  aside.append(head, bodyEl);
  overlay.append(aside);
  document.body.append(overlay);

  active = { overlay, ctx, qno, tab: tab || 'concept', bodyEl, history: [], onFs: null };

  tabConcept.addEventListener('click', () => switchTab('concept'));
  tabChat.addEventListener('click', () => switchTab('chat'));

  function paintTabs() {
    tabConcept.classList.toggle('active', active.tab === 'concept');
    tabChat.classList.toggle('active', active.tab === 'chat');
  }

  function switchTab(t) {
    if (!active) return;
    active.tab = t;
    paintTabs();
    if (t === 'concept') renderConceptTab();
    else renderChatTab();
  }
  active.switchTab = switchTab;

  // fs-change → 개념 탭이면 조용히 갱신(정리 기록 후 반영).
  active.onFs = () => {
    if (active && active.tab === 'concept') renderConceptTab();
  };
  window.addEventListener('qnet:fs-change', active.onFs);

  paintTabs();
  switchTab(active.tab);
}

// ── 개념 탭 ──────────────────────────────────────────────────────────────────
async function renderConceptTab() {
  const { ctx, qno, bodyEl } = active;
  bodyEl.className = 'panel-body qsc';
  bodyEl.innerHTML = '<p class="loading" style="padding:18px">개념·풀이를 불러오는 중…</p>';
  let data;
  try {
    const res = await fetch(`/api/concept/${enc(ctx.examId)}/${enc(qno)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || '개념 보기를 불러오지 못했어요.');
  } catch (e) {
    bodyEl.innerHTML = '';
    bodyEl.append(el('p', 'error-text', e.message));
    return;
  }
  if (!active || active.tab !== 'concept') return;

  bodyEl.innerHTML = '';
  const notes = data.노트 || [];
  const 해설 = data.해설 || [];
  const mine = notes.filter((n) => n.본인여부);
  const others = notes.filter((n) => !n.본인여부);

  const subj = notes[0] ? notes[0].과목 : '';
  const caption = el('div', 'panel-concept-caption', `${subj ? subj + ' · ' : ''}${qno}번 문항에 🔁 연결된 정리`);
  bodyEl.append(caption);

  if (mine.length === 0 && others.length === 0 && 해설.length === 0) {
    const empty = el('div', 'panel-empty');
    empty.append(
      icon(
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7a2 2 0 0 1 2 2v12"></path><path d="M20 5h-7a2 2 0 0 0-2 2"></path></svg>',
        'panel-empty-icon'
      )
    );
    const p = el('p', 'panel-empty-text');
    p.innerHTML = '아직 이 문항과 연결된 정리가 없어요.<br>챗으로 물어보고 정리해 보세요.';
    empty.append(p);
    const cta = el('button', 'panel-empty-cta', '챗으로 물어보기');
    cta.type = 'button';
    cta.addEventListener('click', () => active.switchTab('chat'));
    empty.append(cta);
    bodyEl.append(empty);
    return;
  }

  if (mine.length) bodyEl.append(conceptSection('내 개념 노트', 'notes/', false, mine.map(noteCard)));
  if (others.length) bodyEl.append(conceptSection('타인 개념 노트', '읽기 전용', true, others.map(noteCard)));
  if (해설.length) bodyEl.append(conceptSection('공유 문항 해설', '_공통/풀이/', true, 해설.map(solutionCard)));
}

function conceptSection(label, badge, lock, cards) {
  const sec = el('div', 'panel-concept-section');
  const head = el('div', 'panel-section-head');
  head.append(el('span', 'panel-section-label', label), el('span', 'panel-section-badge', badge));
  if (lock)
    head.append(
      icon(
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--fg-3)" stroke-width="1.4" stroke-linecap="round"><rect x="3.5" y="7" width="9" height="6" rx="1.2"></rect><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>',
        'panel-section-lock'
      )
    );
  sec.append(head);
  const list = el('div', 'panel-cards');
  for (const c of cards) list.append(c);
  sec.append(list);
  return sec;
}

function noteCard(note) {
  const card = el('div', 'panel-note' + (note.본인여부 ? ' mine' : ''));
  const meta = el('div', 'panel-note-meta', note.본인여부 ? `${note.닉네임} (나) · ${note.섹션제목}` : `${note.닉네임} · ${note.섹션제목}`);
  card.append(meta);
  const body = el('div', 'md-body');
  if (note.본문html) body.innerHTML = note.본문html;
  else body.append(el('pre', 'panel-note-pre', note.본문md || ''));
  card.append(body);
  return card;
}

function solutionCard(sol) {
  const card = el('div', 'panel-note');
  card.append(el('div', 'panel-note-meta', `${sol.닉네임} (${sol.날짜})`));
  const body = el('div', 'md-body');
  if (sol.본문html) body.innerHTML = sol.본문html;
  else body.append(el('pre', 'panel-note-pre', sol.본문 || ''));
  card.append(body);
  return card;
}

// ── 챗 탭 ────────────────────────────────────────────────────────────────────
async function buildContextText(ctx, qno) {
  const lines = [
    '[문항 컨텍스트]',
    `시험: ${ctx.examId} / 문번: ${qno}`,
    `자격증: ${ctx.grade} / ${ctx.cert}`,
  ];
  // 문항 md가 추출되어 있으면 서버가 챗 요청 시 [문항 원문]을 직접 주입한다
  // (mode별 정답 스트립도 서버 소유). 그 경우 PDF 전체 참조는 불필요 —
  // 미추출 기출만 PDF 경로 폴백을 남긴다.
  let 문항있음 = false;
  try {
    const qres = await fetch(
      `/api/question/${enc(ctx.examId)}/${enc(qno)}?grade=${enc(ctx.grade)}&cert=${enc(ctx.cert)}`
    );
    문항있음 = qres.ok;
  } catch (_e) {
    /* 부가정보 */
  }
  if (!문항있음) {
    const pdfRel = `${ctx.grade}/${ctx.cert}/_공통/기출문제/${ctx.examId}.pdf`;
    lines.push(`기출 PDF: ${pdfRel} (문번 ${qno} 문항 페이지를 직접 확인)`);
  }
  let counts = { notes: 0, sols: 0 };
  try {
    const res = await fetch(`/api/concept/${enc(ctx.examId)}/${enc(qno)}`);
    if (res.ok) {
      const data = await res.json();
      counts.notes = (data.노트 || []).length;
      counts.sols = (data.해설 || []).length;
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
    /* 부가정보 */
  }
  return { text: lines.join('\n'), counts, 문항있음 };
}

function renderChatTab() {
  const { ctx, qno, bodyEl } = active;
  const { cli } = getState();
  const agyOk = !!(cli && cli.chat && cli.chat.available);

  bodyEl.className = 'panel-body panel-chat';
  bodyEl.innerHTML = '';

  const chips = el('div', 'panel-chat-chips');
  chips.append(chatChip(ctx.examId), chatChip(`#${qno}`));
  bodyEl.append(chips);

  const warn = el('div', 'panel-chat-warn');
  warn.append(
    icon(
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.7 15 14H1z"></path><path d="M8 6.3v3.4M8 11.7h.01"></path></svg>'
    ),
    document.createTextNode('이 대화는 표시만 될 뿐 어떤 파일에도 기록되지 않아요.')
  );
  bodyEl.append(warn);

  const log = el('div', 'panel-chat-log qsc');
  bodyEl.append(log);

  const footer = el('div', 'panel-chat-foot');
  bodyEl.append(footer);

  // 컨텍스트 칩 보강(문항 데이터·노트/해설 수).
  buildContextText(ctx, qno).then(({ text, counts, 문항있음 }) => {
    active._contextText = text;
    if (!active || active.tab !== 'chat') return;
    if (문항있음) chips.append(chatChip('문항 ✓'));
    if (counts.notes) chips.append(chatChip(`연결 노트 ${counts.notes}`));
    if (counts.sols) chips.append(chatChip(`공유 해설 ${counts.sols}`));
  });

  if (!agyOk) {
    const notice = el('div', 'panel-chat-noagy');
    const head = el('div', 'panel-chat-noagy-head');
    head.append(el('span', 'ul-notice-dot'), document.createTextNode('agy 미설치 · 미로그인'));
    notice.append(head);
    notice.append(document.createTextNode('이 기능은 agy 설치·로그인 후 사용할 수 있어요.'));
    footer.append(notice);
    return;
  }

  const approveBtn = el('button', 'panel-chat-approve');
  approveBtn.type = 'button';
  approveBtn.append(
    icon(
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.7 3.6 3.9.5-2.8 2.7.7 3.9L8 10.9 4.5 12.7l.7-3.9L2.4 6.1l3.9-.5z"></path></svg>'
    ),
    document.createTextNode('정리해줘 — 승인 후 노트에 기록')
  );
  approveBtn.disabled = active.history.length === 0;
  approveBtn.addEventListener('click', () => openApproveDialog(ctx, qno, active.history));

  const inputRow = el('div', 'panel-chat-input-row');
  const input = el('textarea', 'panel-chat-input');
  input.rows = 1;
  input.placeholder = '이 문항에 대해 물어보세요…';
  const send = el('button', 'panel-chat-send');
  send.type = 'button';
  send.setAttribute('aria-label', '전송');
  send.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8L2.5 3l2 5-2 5z"></path></svg>';
  inputRow.append(input, send);
  footer.append(approveBtn, inputRow);

  // 이력 재표시(탭 전환 후 복원).
  for (const m of active.history) bubble(log, m.role, m.text);

  async function ask() {
    const msg = input.value.trim();
    if (!msg || active._streaming) return;
    input.value = '';
    send.disabled = true;
    input.disabled = true;
    active._streaming = true;
    bubble(log, 'user', msg);
    active.history.push({ role: 'user', text: msg });
    const ans = bubble(log, 'assistant', '', true);
    try {
      const res = await apiFetch(`/api/chat/${enc(ctx.examId)}/${enc(qno)}`, {
        method: 'POST',
        body: { grade: ctx.grade, cert: ctx.cert, mode: ctx.mode === 'view' ? 'view' : 'solve', contextText: active._contextText || '', history: active.history.slice(0, -1), message: msg },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        ans.textEl.textContent = d.error || '챗 요청 실패';
        ans.bubbleEl.classList.add('error');
        stopCursor(ans);
        return;
      }
      let acc = '';
      await readNdjson(res, (evt) => {
        if (evt.type === 'chunk') {
          acc += evt.text;
          ans.textEl.textContent = acc;
          log.scrollTop = log.scrollHeight;
        } else if (evt.type === 'error') {
          ans.textEl.textContent = evt.error || '오류';
          ans.bubbleEl.classList.add('error');
        }
      });
      stopCursor(ans);
      active.history.push({ role: 'assistant', text: acc });
      approveBtn.disabled = false;
    } catch (e) {
      ans.textEl.textContent = e.message;
      ans.bubbleEl.classList.add('error');
      stopCursor(ans);
    } finally {
      active._streaming = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }
  send.addEventListener('click', ask);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  });
}

function chatChip(text) {
  return el('span', 'panel-chat-chip', text);
}

function bubble(log, role, text, streaming) {
  const wrap = el('div', 'panel-bubble-wrap ' + role);
  const b = el('div', 'panel-bubble ' + role);
  const t = el('span', null, text || '');
  b.append(t);
  let cursor = null;
  if (streaming) {
    cursor = el('span', 'panel-bubble-cursor');
    b.append(cursor);
  }
  wrap.append(b);
  log.append(wrap);
  log.scrollTop = log.scrollHeight;
  return { bubbleEl: b, textEl: t, cursor };
}
function stopCursor(ref) {
  if (ref.cursor) {
    ref.cursor.remove();
    ref.cursor = null;
  }
}

async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line));
        } catch (_e) {
          /* 부분 라인 무시 */
        }
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onEvent(JSON.parse(tail));
    } catch (_e) {
      /* noop */
    }
  }
}

// 정리 잡 완료(record-done)를 jobId 로 구독해 결과 토스트를 띄운다.
// SSE 를 놓쳐도 영구 대기하지 않도록 가드 타임아웃(잡 상한 10분 + 여유)을 둔다.
function waitForRecordDone(jobId, toast) {
  let guard = null;
  const onDone = (e) => {
    const d = (e && e.detail) || {};
    if (d.jobId !== jobId) return;
    window.removeEventListener('qnet:record-done', onDone);
    if (guard) clearTimeout(guard);
    if (d.ok) {
      toast('정리 완료 — 개념 보기에 반영됐어요.', 'ok');
    } else if (d.timedOut) {
      toast('정리가 시간 초과로 중단됐어요(10분). 대화를 줄여 다시 시도해 주세요.', 'error');
    } else if (d.audit && d.audit.clean === false) {
      toast('감사 경고 — 일부 변경이 원복됐어요.', 'error');
    } else {
      toast(d.error || '정리 실패 — 다시 시도해 주세요.', 'error');
    }
  };
  window.addEventListener('qnet:record-done', onDone);
  guard = setTimeout(() => {
    window.removeEventListener('qnet:record-done', onDone);
    toast('정리 상태를 확인하지 못했어요. 개념 보기에서 반영 여부를 확인해 주세요.', 'info');
  }, 11 * 60 * 1000);
}

// ── 승인 다이얼로그(정리해줘 → 저장 위치) ────────────────────────────────────
function openApproveDialog(ctx, qno, history) {
  const overlay = el('div', 'modal-overlay');
  overlay.style.zIndex = '90';
  const box = el('div', 'modal-box');
  box.style.maxWidth = '460px';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const title = el('div', 'apv-title');
  title.append(
    icon(
      '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.7 3.6 3.9.5-2.8 2.7.7 3.9L8 10.9 4.5 12.7l.7-3.9L2.4 6.1l3.9-.5z"></path></svg>'
    ),
    el('h2', 'dlg-title', '어디에 저장할까요?')
  );
  box.append(title);
  box.append(el('p', 'dlg-desc', 'claude가 출제기준 계층에 맞는 노트 파일·섹션을 자동으로 골라 기록하고, 🔁 태그를 넣어요.'));

  const optNote = approveOption('내 개념 노트', '내 notes/ 아래 알맞은 과목·항목 파일에 기록', true);
  const optShared = approveOption('공유 문항 해설', '_공통/풀이/ 내 서명 섹션에 append', true);
  box.append(optNote.wrap, optShared.wrap);

  const status = el('div', 'apv-status');
  status.hidden = true;
  box.append(status);

  const actions = el('div', 'dlg-actions');
  const cancel = el('button', 'dlg-btn-cancel', '취소');
  cancel.type = 'button';
  cancel.addEventListener('click', () => overlay.remove());
  const confirm = el('button', 'dlg-btn-primary', '승인하고 기록');
  confirm.type = 'button';
  actions.append(cancel, confirm);
  box.append(actions);

  confirm.addEventListener('click', () => {
    if (!optNote.input.checked && !optShared.input.checked) {
      status.hidden = false;
      status.className = 'apv-status err';
      status.textContent = '목적지를 하나 이상 선택하세요.';
      return;
    }
    // 승인 시점의 대화를 스냅샷(이후 채팅이 이어져도 이 내용으로 고정).
    const conversation = history
      .map((h) => `[${h.role === 'assistant' ? '어시스턴트' : '사용자'}] ${h.text}`)
      .join('\n');
    const destinations = { note: optNote.input.checked, shared: optShared.input.checked };

    // 요청/잡 분리: POST 는 즉시 202+jobId 로 반환한다. 다이얼로그를 닫고,
    // 완료는 SSE 'record-done'(qnet:record-done)에서 해당 jobId 를 구독해 통지받는다.
    // (잡은 서버 공유 큐에서 계속 돌므로 요청 수명·10분 타임아웃과 무관하게 완주한다.)
    overlay.remove();
    const toast = (message, type) =>
      window.dispatchEvent(new CustomEvent('qnet:toast', { detail: { message, type } }));

    apiFetch('/api/chat/approve', {
      method: 'POST',
      body: { grade: ctx.grade, cert: ctx.cert, examId: ctx.examId, qno: String(qno), conversation, destinations },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status !== 202 || !data.jobId) {
          toast(data.error || '정리 요청을 시작하지 못했어요.', 'error');
          return;
        }
        toast('정리를 백그라운드에서 진행해요… 완료되면 알려드릴게요.', 'info');
        waitForRecordDone(data.jobId, toast);
      })
      .catch((e) => toast(e.message, 'error'));
  });

  overlay.append(box);
  document.body.append(overlay);
}

function approveOption(title, desc, checked) {
  const wrap = el('label', 'apv-option');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const txt = el('div');
  txt.append(el('div', 'apv-option-title', title), el('div', 'apv-option-desc', desc));
  wrap.append(input, txt);
  return { wrap, input };
}
