// 문항 챗 UI: agy 스트리밍 답변(말풍선 + 스트리밍 커서 ▍) + 승인 정리(claude 직접 쓰기, 목적지 선택).
//
// 사용: renderChat(container, { grade, cert, examId, qno, contextText })
// 서버 계약(불변):
//   POST /api/chat/:examId/:qno → NDJSON 스트림({type:'chunk'|'done'|'error'})
//   POST /api/chat/approve      → { ok, audit }

import { apiFetch, getState } from '../store.js';

// 대화 이력(멀티턴 재주입용). [{ role:'user'|'assistant', text }]
export function renderChat(container, ctx) {
  const { cli } = getState();
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'chat';

  if (!cli.record || !cli.chat) {
    const note = document.createElement('p');
    note.className = 'chat-note';
    const 없음 = [];
    if (!cli.chat) 없음.push('agy(챗)');
    if (!cli.record) 없음.push('claude(기록)');
    note.textContent = `${없음.join(', ')} 미설치 — 해당 AI 기능은 비활성입니다. 풀이·채점·기록 열람은 정상 동작합니다.`;
    wrap.appendChild(note);
  }

  const 로그 = document.createElement('div');
  로그.className = 'chat-log';

  const 입력행 = document.createElement('div');
  입력행.className = 'chat-input-row';
  const 입력 = document.createElement('textarea');
  입력.className = 'chat-input';
  입력.rows = 2;
  입력.placeholder = cli.chat ? '이 문항에 대해 질문하세요…' : 'agy 미설치 — 챗 비활성';
  입력.disabled = !cli.chat;
  const 보내기 = document.createElement('button');
  보내기.className = 'btn';
  보내기.textContent = '질문';
  보내기.disabled = !cli.chat;
  입력행.append(입력, 보내기);

  const 도구행 = document.createElement('div');
  도구행.className = 'chat-tools';
  const 정리 = document.createElement('button');
  정리.className = 'btn secondary';
  정리.textContent = '이 대화 정리·기록';
  정리.disabled = true; // 대화가 쌓이면 활성
  도구행.appendChild(정리);

  const history = [];

  // 말풍선 생성. assistant는 본문 span + 스트리밍 커서(▍) span 구조로 만들어
  // 스트리밍 중 커서를 노출하고 완료 시 제거한다. 반환값은 { el, text, cursor }.
  function 말풍선(role, text) {
    const box = document.createElement('div');
    box.className = `chat-msg ${role}`;
    const 본문 = document.createElement('span');
    본문.className = 'chat-msg-text';
    본문.textContent = text || '';
    box.appendChild(본문);
    let cursor = null;
    if (role === 'assistant') {
      cursor = document.createElement('span');
      cursor.className = 'chat-cursor';
      cursor.textContent = '▍';
      box.appendChild(cursor);
    }
    로그.appendChild(box);
    로그.scrollTop = 로그.scrollHeight;
    return { el: box, text: 본문, cursor };
  }

  // 스트리밍 커서 제거(완료/오류 시).
  function 커서제거(bubble) {
    if (bubble.cursor) {
      bubble.cursor.remove();
      bubble.cursor = null;
    }
  }

  async function 질문전송() {
    const msg = 입력.value.trim();
    if (!msg) return;
    입력.value = '';
    보내기.disabled = true;
    입력.disabled = true;
    말풍선('user', msg);
    history.push({ role: 'user', text: msg });
    const 답 = 말풍선('assistant', '');

    try {
      const res = await apiFetch(`/api/chat/${encodeURIComponent(ctx.examId)}/${encodeURIComponent(ctx.qno)}`, {
        method: 'POST',
        body: {
          grade: ctx.grade,
          cert: ctx.cert,
          contextText: ctx.contextText || '',
          history,
          message: msg,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        답.text.textContent = data.error || '챗 요청 실패';
        답.el.classList.add('error');
        커서제거(답);
        return;
      }
      let acc = '';
      await 스트림읽기(res, (evt) => {
        if (evt.type === 'chunk') {
          acc += evt.text;
          답.text.textContent = acc;
          로그.scrollTop = 로그.scrollHeight;
        } else if (evt.type === 'done') {
          커서제거(답);
          if (evt.audit && !evt.audit.clean) {
            const warn = document.createElement('div');
            warn.className = 'chat-audit-warn';
            warn.textContent = `⚠️ 사후 감사 경고: ${(evt.audit.violations || []).join(' / ')}`;
            로그.appendChild(warn);
          }
        } else if (evt.type === 'error') {
          답.text.textContent = evt.error || '오류';
          답.el.classList.add('error');
          커서제거(답);
        }
      });
      커서제거(답);
      history.push({ role: 'assistant', text: acc });
      정리.disabled = false;
    } catch (e) {
      답.text.textContent = e.message;
      답.el.classList.add('error');
      커서제거(답);
    } finally {
      보내기.disabled = false;
      입력.disabled = false;
      입력.focus();
    }
  }

  보내기.addEventListener('click', 질문전송);
  입력.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) 질문전송();
  });
  정리.addEventListener('click', () => 승인다이얼로그(container, ctx, history));

  wrap.append(로그, 입력행, 도구행);
  container.appendChild(wrap);
}

// NDJSON 스트림 리더: 응답 본문을 줄 단위로 파싱해 콜백 호출.
async function 스트림읽기(res, onEvent) {
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
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (_e) {
        /* 부분 라인 무시 */
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

// 승인 다이얼로그: 목적지 선택([내 개념 노트]/[공유 문항 해설]/둘 다, 기본 둘 다 체크).
function 승인다이얼로그(container, ctx, history) {
  const 기존 = container.querySelector('.chat-approve');
  if (기존) 기존.remove();

  const box = document.createElement('div');
  box.className = 'chat-approve';

  const 제목 = document.createElement('p');
  제목.className = 'chat-approve-title';
  제목.textContent = '기록 목적지를 선택하세요 (claude 가 규칙에 맞게 md 로 직접 기록합니다)';

  const mkChk = (id, label) => {
    const wrapEl = document.createElement('label');
    wrapEl.className = 'chat-chk';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = true; // 기본: 둘 다 체크
    c.id = id;
    const t = document.createElement('span');
    t.textContent = label;
    wrapEl.append(c, t);
    return { wrapEl, c };
  };
  const note = mkChk('dst-note', '내 개념 노트 (notes/)');
  const shared = mkChk('dst-shared', '공유 문항 해설 (_공통/풀이/)');

  const 확인 = document.createElement('button');
  확인.className = 'btn';
  확인.textContent = '기록';
  const 취소 = document.createElement('button');
  취소.className = 'btn secondary';
  취소.textContent = '취소';
  const 상태 = document.createElement('span');
  상태.className = 'chat-approve-status';

  취소.addEventListener('click', () => box.remove());
  확인.addEventListener('click', async () => {
    if (!note.c.checked && !shared.c.checked) {
      상태.textContent = '목적지를 하나 이상 선택하세요.';
      return;
    }
    확인.disabled = true;
    상태.textContent = '기록 중… (claude 잡 실행)';
    try {
      const conversation = history
        .map((h) => `[${h.role === 'assistant' ? '어시스턴트' : '사용자'}] ${h.text}`)
        .join('\n');
      const res = await apiFetch('/api/chat/approve', {
        method: 'POST',
        body: {
          grade: ctx.grade,
          cert: ctx.cert,
          examId: ctx.examId,
          qno: ctx.qno,
          conversation,
          destinations: { note: note.c.checked, shared: shared.c.checked },
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        상태.textContent = data.error || '기록 실패';
        return;
      }
      if (data.audit && !data.audit.clean) {
        상태.textContent = `⚠️ 감사 경고: ${(data.audit.violations || []).join(' / ')}`;
      } else {
        상태.textContent = data.ok ? '기록 완료 — 워처가 화면을 갱신합니다.' : '기록 처리됨(결과 확인 필요).';
      }
    } catch (e) {
      상태.textContent = e.message;
    } finally {
      확인.disabled = false;
    }
  });

  const 버튼행 = document.createElement('div');
  버튼행.className = 'chat-approve-actions';
  버튼행.append(확인, 취소, 상태);
  box.append(제목, note.wrapEl, shared.wrapEl, 버튼행);
  container.appendChild(box);
}
