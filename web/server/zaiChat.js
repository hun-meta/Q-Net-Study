'use strict';

// Z.AI 챗 프로바이더: OpenAI 호환 챗 컴플리션(stream:true)을 HTTP로 직접 호출한다.
// agy CLI spawn 경로와 달리 로컬 파일시스템을 만지지 않으므로 잡 큐·사후 감사가 불필요하다
// (cliBridge.chat() 이 zai 활성 시 이 모듈로 바로 위임한다).
//
// 신규 npm 의존성 없음 — Node 18+ 전역 fetch 사용, fetchImpl 주입 가능(테스트).
// API 키는 요청 헤더 조립에만 쓰고 어떤 로그·반환값에도 남기지 않는다.

// CHAT_ROLE·buildChatMeta 는 cliBridge.js 가 소유(재사용 목적으로 그쪽에서 export).
// cliBridge.js 는 이 모듈을 함수 호출 시점에 지연 require 하므로(순환 require 회피),
// 이 top-level require 는 안전하다 — 이 파일이 먼저 로드돼도 cliBridge.js는 자기
// 완결적으로 끝까지 로드된 뒤 export 한다.
const { CHAT_ROLE, buildChatMeta } = require('./cliBridge');

// effort → Z.AI 요청 필드 매핑을 한 함수에 격리(스펙 변경 시 여기만 수정).
// 기본('none'/falsy) = deep think(thinking) 비활성 — 챗은 빠른 답변이 목적이라 기본으로 끈다.
// 'low'|'medium'|'high' 등을 주면 그때만 thinking 활성 + reasoning_effort 전송.
function effortPayload(effort) {
  if (!effort || effort === 'none') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

// system(역할+문항 메타+문항 컨텍스트) · history · message → OpenAI 호환 messages 배열.
//
// 접두사 캐싱 설계: Z.AI 는 암묵적(implicit) 접두사 캐싱이라 별도 파라미터가 없다 —
// 히트 조건은 "같은 접두사가 바이트 단위로 반복"되는 것뿐이다. 그래서 변하지 않는 것
// (역할 → 문항 메타 → 문항 원문)을 system 맨 앞에 고정하고, 대화는 append-only 로
// 뒤에만 쌓아 같은 문항의 2턴째부터 system+이전 대화 전체가 캐시 히트되게 한다.
function buildMessages({ meta, contextText, history, message }) {
  let system = CHAT_ROLE;
  const metaBlock = buildChatMeta(meta || {});
  if (metaBlock) system += `\n\n${metaBlock}`;
  if (contextText) system += `\n\n# 문항 컨텍스트\n${contextText}`;
  const messages = [{ role: 'system', content: system }];
  if (Array.isArray(history)) {
    for (const turn of history) {
      const role = turn && turn.role === 'assistant' ? 'assistant' : 'user';
      messages.push({ role, content: String((turn && turn.text) || '') });
    }
  }
  messages.push({ role: 'user', content: String(message || '') });
  return messages;
}

// SSE 한 줄("data: {...}" / "data: [DONE]")을 처리해 델타를 즉시 릴레이한다.
// reasoning_content 델타는 화면 오염 방지를 위해 릴레이하지 않는다(무시).
// usage 필드(stream_options.include_usage 로 요청한 마지막 청크)는 state.usage 에
// 보관한다 — prompt_tokens_details.cached_tokens 가 접두사 캐시 히트의 유일한 증거다.
// 반환: '[DONE]' 수신 시 true(스트림 종료 신호), 그 외 false.
function handleSseLine(line, state, onData) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return false;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return true;
  if (!payload) return false;
  let evt;
  try {
    evt = JSON.parse(payload);
  } catch (_e) {
    return false; // 파싱 불가 라인은 무시(방어적).
  }
  if (evt && evt.usage) state.usage = evt.usage; // 뒤에 온 usage가 이긴다(통상 최종 1회).
  const delta = evt && evt.choices && evt.choices[0] && evt.choices[0].delta;
  if (delta && typeof delta.content === 'string' && delta.content) {
    state.text += delta.content;
    if (typeof onData === 'function') onData(delta.content);
  }
  // delta.reasoning_content 는 의도적으로 무시.
  return false;
}

// Z.AI 챗 컴플리션을 스트리밍 호출한다.
// → Promise<{ text, timedOut, code: 0, usage: object|null,
//             audit: { clean: true, skipped: 'zai-http' } }>
// usage 는 OpenAI 호환 형태 그대로: { prompt_tokens, completion_tokens,
// prompt_tokens_details: { cached_tokens }, ... } — 미수신 시 null.
async function streamChat({ zai, meta, contextText, history, message, onData, timeoutMs, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) {
    throw new Error('전역 fetch를 사용할 수 없습니다(Node 18 이상이 필요합니다).');
  }

  const body = JSON.stringify({
    model: zai.model,
    messages: buildMessages({ meta, contextText, history, message }),
    stream: true,
    // 스트림 마지막 청크로 usage(캐시 히트 관측)를 받기 위한 OpenAI 호환 옵션.
    stream_options: { include_usage: true },
    ...effortPayload(zai.effort),
  });

  const controller = new AbortController();
  let timedOut = false;
  // 주의: 이 타이머는 unref 하지 않는다 — HTTP 스트림이 조용히 멈춘 경우(응답 없음) 이
  // 타이머 자체가 유일한 탈출구이므로, 이벤트 루프를 계속 살려서라도 반드시 발화해야 한다.
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  const state = { text: '', usage: null };

  try {
    let res;
    try {
      res = await doFetch(`${zai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${zai.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      // AbortController가 타임아웃으로 요청 자체를 취소한 경우 — throw가 아니라
      // 지금까지 누적된 텍스트(요청 단계라 보통 빈 문자열)와 함께 timedOut:true 반환.
      if (timedOut) return { text: state.text, timedOut: true, code: 0, usage: state.usage, audit: { clean: true, skipped: 'zai-http' } };
      throw new Error(`Z.AI 챗 API 요청 실패: ${err.message}`);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // 키 값은 담지 않는다 — 상태코드 + 본문 요약만.
      throw new Error(`Z.AI 챗 API 오류 (${res.status}): ${String(errBody || '').slice(0, 300)}`);
    }

    if (!res.body) throw new Error('Z.AI 응답 본문이 비어 있습니다.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';
    let done = false;

    while (!done) {
      let chunk;
      try {
        // eslint-disable-next-line no-await-in-loop
        chunk = await reader.read();
      } catch (err) {
        if (timedOut) break; // 스트리밍 도중 타임아웃 — 누적된 만큼만 반환.
        throw err;
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      // 네트워크 청크 경계에서 라인이 잘릴 수 있으므로 마지막(미완일 수 있는) 라인은
      // 버퍼에 carry-over 하고 완결된 라인만 처리한다.
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (handleSseLine(line, state, onData)) {
          done = true;
          break;
        }
      }
      if (timedOut) break;
    }

    // 정상 SSE는 [DONE]으로 끝나지만, 개행 없이 스트림이 그대로 닫히는 비정상 종료에서는
    // 마지막(미완결로 취급돼 carry-over된) 라인이 한 번도 처리되지 못하고 버퍼에 남아
    // 유실된다 — 루프 종료 후 남은 버퍼가 있으면 한 번 더 처리해 마지막 델타를 방어한다.
    if (buffer.trim()) {
      handleSseLine(buffer, state, onData);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { text: state.text, timedOut, code: 0, usage: state.usage, audit: { clean: true, skipped: 'zai-http' } };
}

module.exports = {
  streamChat,
  effortPayload,
};
