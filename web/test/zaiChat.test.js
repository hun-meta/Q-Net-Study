'use strict';

// Z.AI 챗 프로바이더 테스트: 설정 우선순위(config.js) + 스트리밍 파싱·오류·타임아웃(zaiChat.js).
//
// 주의: config.js의 SECRETS_PATH는 실 저장소 .qnet-web/secrets.json 고정 경로다(설계상
// 오버라이드 지점 없음). 실 STATE_DIR을 오염시키지 않도록, 이 파일 전체 실행 전후로
// 원래 상태(파일 존재 여부·내용)를 백업/복원한다.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const config = require('../server/config');
const zaiChat = require('../server/zaiChat');

const SECRETS_PATH = config.SECRETS_PATH;
let originalSecrets = null; // null = 원래 파일 없었음. Buffer = 원래 내용(복원용).

before(() => {
  try {
    originalSecrets = fs.readFileSync(SECRETS_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    originalSecrets = null;
  }
});

after(() => {
  if (originalSecrets === null) {
    try {
      fs.unlinkSync(SECRETS_PATH);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  } else {
    fs.writeFileSync(SECRETS_PATH, originalSecrets, { mode: 0o600 });
  }
});

// 매 테스트 종료 시 secrets.json을 지워 다음 테스트에 영향 없게 한다(idempotent no-op 허용).
function cleanupSecrets() {
  config.deleteZaiKey();
}

// ── resolveZai: 설정 우선순위 ──────────────────────────────────────────────

test('resolveZai: 키가 전혀 없으면 disabled', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  const r = config.resolveZai({});
  assert.strictEqual(r.enabled, false);
  assert.strictEqual(r.apiKey, '');
  assert.strictEqual(r.source, null);
  assert.deepStrictEqual(
    { baseUrl: r.baseUrl, model: r.model, effort: r.effort },
    config.ZAI_DEFAULTS
  );
});

test('resolveZai: env ZAI_API_KEY가 있으면 최우선(source=env), 공백 트림', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  const r = config.resolveZai({ ZAI_API_KEY: '  env-key-1  ' });
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.apiKey, 'env-key-1');
  assert.strictEqual(r.source, 'env');
});

test('resolveZai: env ZAI_MODEL/ZAI_EFFORT/ZAI_BASE_URL이 상수 기본값보다 우선(트림 포함)', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  const r = config.resolveZai({
    ZAI_API_KEY: 'k',
    ZAI_MODEL: '  glm-custom  ',
    ZAI_EFFORT: ' medium ',
    ZAI_BASE_URL: ' https://custom.example/v4 ',
  });
  assert.strictEqual(r.model, 'glm-custom');
  assert.strictEqual(r.effort, 'medium');
  assert.strictEqual(r.baseUrl, 'https://custom.example/v4');
});

test('resolveZai: 키 우선순위 env > secrets.json — file만 있으면 source=file', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  config.saveZaiKey('file-key-1');
  const fileOnly = config.resolveZai({});
  assert.strictEqual(fileOnly.enabled, true);
  assert.strictEqual(fileOnly.apiKey, 'file-key-1');
  assert.strictEqual(fileOnly.source, 'file');

  // env와 file이 동시에 있으면 env가 이긴다.
  const both = config.resolveZai({ ZAI_API_KEY: 'env-key-2' });
  assert.strictEqual(both.apiKey, 'env-key-2');
  assert.strictEqual(both.source, 'env');
});

// ── secrets.json 저장/삭제 ─────────────────────────────────────────────────

test('saveZaiKey: tmp→rename 원자 쓰기 + mode 0600, deleteZaiKey로 빈 상태 복귀', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  assert.strictEqual(config.readZaiKey(), '');

  config.saveZaiKey('  saved-key  ');
  assert.strictEqual(config.readZaiKey(), 'saved-key'); // 트림되어 저장됨.
  const st = fs.statSync(SECRETS_PATH);
  assert.strictEqual(st.mode & 0o777, 0o600);
  // tmp 파일이 남아있지 않아야 한다(원자 rename 완료).
  const leftoverTmp = fs
    .readdirSync(config.STATE_DIR)
    .filter((name) => name.startsWith('.secrets.') && name.endsWith('.tmp'));
  assert.deepStrictEqual(leftoverTmp, []);

  config.deleteZaiKey();
  assert.strictEqual(config.readZaiKey(), '');
  assert.strictEqual(fs.existsSync(SECRETS_PATH), false);

  // 삭제 후 재삭제는 no-op(에러 없음).
  assert.doesNotThrow(() => config.deleteZaiKey());
});

test('saveZaiKey: 빈 값·제어문자(개행 포함)는 Error throw', (t) => {
  t.after(cleanupSecrets);
  cleanupSecrets();
  assert.throws(() => config.saveZaiKey(''));
  assert.throws(() => config.saveZaiKey('   '));
  assert.throws(() => config.saveZaiKey('bad\nkey'));
  assert.throws(() => config.saveZaiKey('bad\tkey'));
  // 검증 실패 후에도 파일이 생기지 않아야 한다.
  assert.strictEqual(fs.existsSync(SECRETS_PATH), false);
});

// ── zaiChat.effortPayload ──────────────────────────────────────────────────

test('effortPayload: 기본값·falsy·none → thinking disabled', () => {
  assert.deepStrictEqual(zaiChat.effortPayload(undefined), { thinking: { type: 'disabled' } });
  assert.deepStrictEqual(zaiChat.effortPayload(''), { thinking: { type: 'disabled' } });
  assert.deepStrictEqual(zaiChat.effortPayload('none'), { thinking: { type: 'disabled' } });
});

test('effortPayload: low/medium/high → thinking enabled + reasoning_effort 전송', () => {
  assert.deepStrictEqual(zaiChat.effortPayload('medium'), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'medium',
  });
  assert.deepStrictEqual(zaiChat.effortPayload('high'), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
  });
});

// ── zaiChat.streamChat ───────────────────────────────────────────────────

const BASE_ZAI = { baseUrl: 'https://z.example/v4', apiKey: 'secret-key', model: 'glm-5.2', effort: 'none' };

// getReader() 기반 fetch Response 목(실제 Node fetch의 body 인터페이스와 동일한 형태).
function makeSseResponse(chunks, { ok = true, status = 200, errorText = '' } = {}) {
  let i = 0;
  return {
    ok,
    status,
    text: async () => errorText,
    body: {
      getReader() {
        return {
          async read() {
            if (i >= chunks.length) return { done: true, value: undefined };
            const value = Buffer.from(chunks[i], 'utf8');
            i += 1;
            return { done: false, value };
          },
        };
      },
    },
  };
}

// AbortSignal을 실제로 관찰해 타임아웃 시 read()가 reject 되는 스트림 목(중간 스트리밍 타임아웃용).
function makeAbortAwareResponse(initialChunks, signal) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    text: async () => '',
    body: {
      getReader() {
        return {
          read() {
            if (i < initialChunks.length) {
              const value = Buffer.from(initialChunks[i], 'utf8');
              i += 1;
              return Promise.resolve({ done: false, value });
            }
            return new Promise((resolve, reject) => {
              const abort = () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
              };
              if (signal.aborted) return abort();
              signal.addEventListener('abort', abort);
            });
          },
        };
      },
    },
  };
}

test('streamChat: SSE 델타 순서대로 onData 릴레이 + 최종 text (청크 경계 미완 라인 carry-over)', async () => {
  const full =
    'data: {"choices":[{"delta":{"content":"안"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"녕"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"하세요"}}]}\n\n' +
    'data: [DONE]\n\n';
  // 라인 중간(미완 지점)에서 강제로 두 "네트워크 청크"로 쪼갠다.
  const splitAt = full.indexOf('안') + 1; // 멀티바이트 한글 중간이 아니라 JSON 값 중간 지점.
  const c1 = full.slice(0, splitAt);
  const c2 = full.slice(splitAt);

  const onDataCalls = [];
  const res = await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: '질문',
    onData: (chunk) => onDataCalls.push(chunk),
    fetchImpl: async () => makeSseResponse([c1, c2]),
  });

  assert.deepStrictEqual(onDataCalls, ['안', '녕', '하세요']);
  assert.strictEqual(res.text, '안녕하세요');
  assert.strictEqual(res.timedOut, false);
  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(res.audit, { clean: true, skipped: 'zai-http' });
});

test('streamChat: 마지막 델타 라인이 개행 없이 스트림이 닫혀도(비정상 종료) 유실 없이 릴레이+최종 text 포함', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"안녕"}}]}\n\n',
    // 마지막 라인: [DONE]도, 트레일링 개행도 없이 그대로 스트림이 닫히는 케이스.
    'data: {"choices":[{"delta":{"content":"하세요"}}]}',
  ];
  const onDataCalls = [];
  const res = await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: '질문',
    onData: (chunk) => onDataCalls.push(chunk),
    fetchImpl: async () => makeSseResponse(chunks),
  });

  assert.deepStrictEqual(onDataCalls, ['안녕', '하세요']);
  assert.strictEqual(res.text, '안녕하세요');
  assert.strictEqual(res.timedOut, false);
});

test('streamChat: 델타 N개 → onData가 모아 보내지 않고 N회 즉시 호출', async () => {
  const chunks = ['가', '나', '다', '라'].map(
    (c) => `data: {"choices":[{"delta":{"content":"${c}"}}]}\n\n`
  );
  chunks.push('data: [DONE]\n\n');

  const onDataCalls = [];
  await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: 'q',
    onData: (c) => onDataCalls.push(c),
    // 델타마다 별도 read() 청크로 나눠, 배치로 모아 보내면 즉시 감지되게 한다.
    fetchImpl: async () => makeSseResponse(chunks),
  });

  assert.strictEqual(onDataCalls.length, 4);
  assert.deepStrictEqual(onDataCalls, ['가', '나', '다', '라']);
});

test('streamChat: reasoning_content 델타는 무시(릴레이·최종 text 모두 제외)', async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"reasoning_content":"생각 중..."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"답"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const onDataCalls = [];
  const res = await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: 'q',
    onData: (c) => onDataCalls.push(c),
    fetchImpl: async () => makeSseResponse(chunks),
  });
  assert.deepStrictEqual(onDataCalls, ['답']);
  assert.strictEqual(res.text, '답');
  assert.ok(!res.text.includes('생각'));
});

test('streamChat: 기본 effort(none) → 요청 바디에 thinking disabled', async () => {
  let capturedBody = null;
  await zaiChat.streamChat({
    zai: BASE_ZAI, // effort: 'none'
    message: 'q',
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeSseResponse(['data: [DONE]\n\n']);
    },
  });
  assert.deepStrictEqual(capturedBody.thinking, { type: 'disabled' });
  assert.strictEqual(capturedBody.reasoning_effort, undefined);
  assert.strictEqual(capturedBody.model, 'glm-5.2');
  assert.strictEqual(capturedBody.stream, true);
});

test('streamChat: ZAI_EFFORT=medium(zai.effort) → thinking enabled + reasoning_effort 전송', async () => {
  let capturedBody = null;
  await zaiChat.streamChat({
    zai: { ...BASE_ZAI, effort: 'medium' },
    message: 'q',
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeSseResponse(['data: [DONE]\n\n']);
    },
  });
  assert.deepStrictEqual(capturedBody.thinking, { type: 'enabled' });
  assert.strictEqual(capturedBody.reasoning_effort, 'medium');
});

test('streamChat: 메시지 매핑 — system(+문항 컨텍스트)·history·마지막 user', async () => {
  let capturedBody = null;
  await zaiChat.streamChat({
    zai: BASE_ZAI,
    contextText: '[문항 원문] 1번 문제',
    history: [
      { role: 'user', text: '이전 질문' },
      { role: 'assistant', text: '이전 답변' },
    ],
    message: '이번 질문',
    fetchImpl: async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeSseResponse(['data: [DONE]\n\n']);
    },
  });
  const { messages } = capturedBody;
  assert.strictEqual(messages[0].role, 'system');
  assert.ok(messages[0].content.includes('문항 컨텍스트'));
  assert.ok(messages[0].content.includes('1번 문제'));
  assert.strictEqual(messages[1].role, 'user');
  assert.strictEqual(messages[1].content, '이전 질문');
  assert.strictEqual(messages[2].role, 'assistant');
  assert.strictEqual(messages[2].content, '이전 답변');
  assert.strictEqual(messages[3].role, 'user');
  assert.strictEqual(messages[3].content, '이번 질문');
});

test('streamChat: 401 오류 → 상태코드 포함 Error, 키 값은 메시지에 없음', async () => {
  await assert.rejects(
    () =>
      zaiChat.streamChat({
        zai: BASE_ZAI,
        message: 'q',
        fetchImpl: async () => makeSseResponse([], { ok: false, status: 401, errorText: 'invalid api key' }),
      }),
    (err) => {
      assert.ok(/401/.test(err.message), err.message);
      assert.ok(!err.message.includes(BASE_ZAI.apiKey), '오류 메시지에 API 키가 노출되면 안 됨');
      return true;
    }
  );
});

test('streamChat: 429/5xx 오류도 상태코드 포함 Error로 매핑', async () => {
  await assert.rejects(
    () =>
      zaiChat.streamChat({
        zai: BASE_ZAI,
        message: 'q',
        fetchImpl: async () => makeSseResponse([], { ok: false, status: 429, errorText: 'rate limited' }),
      }),
    /429/
  );
  await assert.rejects(
    () =>
      zaiChat.streamChat({
        zai: BASE_ZAI,
        message: 'q',
        fetchImpl: async () => makeSseResponse([], { ok: false, status: 503, errorText: 'server error' }),
      }),
    /503/
  );
});

test('streamChat: 네트워크 오류(fetch 자체 실패) → Error로 매핑(reject)', async () => {
  await assert.rejects(
    () =>
      zaiChat.streamChat({
        zai: BASE_ZAI,
        message: 'q',
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    /Z\.AI|ECONNREFUSED/
  );
});

test('streamChat: 타임아웃 시 throw가 아니라 timedOut:true 반환(요청 단계)', async () => {
  const t0 = Date.now();
  const res = await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: 'q',
    timeoutMs: 50,
    fetchImpl: (url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
  });
  assert.strictEqual(res.timedOut, true);
  assert.strictEqual(res.text, '');
  assert.ok(Date.now() - t0 < 2000, '타임아웃이 timeoutMs 근방에서 즉시 반환되어야 함');
});

test('streamChat: 스트리밍 도중 타임아웃 시 지금까지 누적된 text와 함께 timedOut:true 반환', async () => {
  const res = await zaiChat.streamChat({
    zai: BASE_ZAI,
    message: 'q',
    timeoutMs: 50,
    fetchImpl: async (url, opts) =>
      makeAbortAwareResponse(['data: {"choices":[{"delta":{"content":"부분 답변"}}]}\n\n'], opts.signal),
  });
  assert.strictEqual(res.timedOut, true);
  assert.strictEqual(res.text, '부분 답변');
});
