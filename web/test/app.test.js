'use strict';

// HTTP 통합 테스트: 보안 가드(Host·Origin·X-QNet-Token) + 핵심 API.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/app');
const { createSseHub } = require('../server/sse');
const config = require('../server/config');

const TOKEN = 'test-token-abc';

// ── Z.AI config 계약 스텁 (설계 A-1/A-7) ────────────────────────────────────
// resolveZai/saveZaiKey/deleteZaiKey 를 스텁으로 교체해, 이 라우트 계약(시그니처·반환
// shape·상태 전이) 검증을 config.js 의 실제 파일 I/O(secrets.json 읽기·쓰기)와 격리한다.
// 매 테스트마다 안전한 기본값(zai 비활성)으로 스텁을 깔고, 개별 테스트가 zaiState를
// 직접 바꿔치기해 시나리오를 만든다. 파일 저장·env 우선순위 등 config.js 자체의 동작
// 검증은 zaiChat.test.js 가 담당한다.
let zaiState;
let 원본resolveZai;
let 원본saveZaiKey;
let 원본deleteZaiKey;

function 기본zai상태() {
  return {
    enabled: false,
    apiKey: '',
    source: null,
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-5.2',
    effort: 'none',
  };
}

beforeEach(() => {
  zaiState = 기본zai상태();
  원본resolveZai = config.resolveZai;
  원본saveZaiKey = config.saveZaiKey;
  원본deleteZaiKey = config.deleteZaiKey;
  config.resolveZai = () => ({ ...zaiState });
  config.saveZaiKey = (key) => {
    const k = String(key == null ? '' : key).trim();
    if (!k) throw new Error('API Key 가 비어 있습니다.');
    if (/[\x00-\x1f\x7f]/.test(k)) throw new Error('API Key 에 제어문자를 쓸 수 없습니다.');
    zaiState = { ...zaiState, enabled: true, apiKey: k, source: 'file' };
  };
  config.deleteZaiKey = () => {
    zaiState = { ...zaiState, enabled: false, apiKey: '', source: null };
  };
});

afterEach(() => {
  config.resolveZai = 원본resolveZai;
  config.saveZaiKey = 원본saveZaiKey;
  config.deleteZaiKey = 원본deleteZaiKey;
});

// 원시 http 요청 헬퍼(Host/Origin/토큰 헤더 완전 제어).
function request(port, { method = 'GET', reqPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function startServer(overrides = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-app-'));
  const hub = createSseHub();
  // 브로드캐스트 스파이: 실제 SSE 동작(버퍼링 등)은 그대로 두되 호출을 기록한다.
  const events = [];
  const 원본broadcast = hub.broadcast;
  hub.broadcast = (event, payload) => {
    events.push({ event, payload });
    return 원본broadcast(event, payload);
  };
  const app = createApp({
    token: TOKEN,
    cli: { chat: false, record: false, ...overrides.cli },
    repoRoot,
    hub,
    config: { cliChat: 'agy', cliRecord: 'claude', nickname: null },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, repoRoot, hub, events };
}

test('GET /api/state: 토큰·CLI·포트 포함', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, { reqPath: '/api/state' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.token, TOKEN);
  assert.ok(data.cli && data.cli.chat && data.cli.record);
  assert.equal(typeof data.port, 'number');
});

test('허용적 CORS 헤더(ACAO)를 절대 내보내지 않음', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, { reqPath: '/api/state' });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('잘못된 Host 헤더 → 403 (DNS 리바인딩 차단)', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, { reqPath: '/api/state', headers: { Host: 'evil.example.com' } });
  assert.equal(res.status, 403);
});

test('외부 Origin → 403', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    reqPath: '/api/state',
    headers: { Origin: 'http://evil.example.com' },
  });
  assert.equal(res.status, 403);
});

test('무토큰 상태 변경(POST) → 403', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/nickname',
    headers: { 'Content-Type': 'application/json' },
    body: { nickname: 'x' },
  });
  assert.equal(res.status, 403);
});

test('토큰 포함하되 잘못된 닉네임 → 400 (검증 동작, 저장 안 함)', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/nickname',
    headers: { 'Content-Type': 'application/json', 'X-QNet-Token': TOKEN },
    body: { nickname: 'a/b' },
  });
  assert.equal(res.status, 400);
});

test('GET /api/repo: 자격증 배열 반환', async (t) => {
  const { server, port, repoRoot } = await startServer();
  t.after(() => server.close());
  // fixture: 기사/정보처리기사/{_공통, hun}
  fs.mkdirSync(path.join(repoRoot, '기사', '정보처리기사', '_공통'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '기사', '정보처리기사', 'hun'), { recursive: true });
  const res = await request(port, { reqPath: '/api/repo' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(Array.isArray(data.certs));
  const cert = data.certs.find((c) => c.cert === '정보처리기사');
  assert.ok(cert);
  assert.deepEqual(cert.participants, ['hun']);
  assert.equal(cert.hasCommon, true);
});

// ── Z.AI API Key 웹 등록 (설계 A-7) ─────────────────────────────────────────

test('GET /api/state: zai 비활성 기본값 — provider agy, available은 agy 감지값', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, { reqPath: '/api/state' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.cli.chat.provider, 'agy');
  assert.equal(data.cli.chat.available, false); // startServer 기본 cli.chat=false
  assert.equal(data.cli.chat.model, undefined);
});

test('POST /api/zai/key: 토큰 없음 → 403 (기존 가드가 그대로 차단)', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/zai/key',
    headers: { 'Content-Type': 'application/json' },
    body: { apiKey: 'sk-test' },
  });
  assert.equal(res.status, 403);
});

test('POST /api/zai/key: 빈 값 → 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/zai/key',
    headers: { 'Content-Type': 'application/json', 'X-QNet-Token': TOKEN },
    body: { apiKey: '   ' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/zai/key: 제어문자·개행 포함 → 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/zai/key',
    headers: { 'Content-Type': 'application/json', 'X-QNet-Token': TOKEN },
    body: { apiKey: 'sk-\x01bad\ncontinued' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/zai/key: 환경변수 키 존재 시 → 400(환경변수 우선 안내)', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  zaiState.enabled = true;
  zaiState.source = 'env';
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/zai/key',
    headers: { 'Content-Type': 'application/json', 'X-QNet-Token': TOKEN },
    body: { apiKey: 'sk-new' },
  });
  assert.equal(res.status, 400);
});

test('POST /api/zai/key: 성공 — 응답에 키 미포함 + /api/state 반영 + cli-change 브로드캐스트', async (t) => {
  const { server, port, events } = await startServer();
  t.after(() => server.close());
  const SECRET = 'sk-매우비밀한값-12345';

  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/zai/key',
    headers: { 'Content-Type': 'application/json', 'X-QNet-Token': TOKEN },
    body: { apiKey: SECRET },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, provider: 'zai', keySource: 'file' });
  assert.ok(!res.body.includes(SECRET), '응답 본문에 키 값이 노출되면 안 됨');

  const state = await request(port, { reqPath: '/api/state' });
  const stateData = JSON.parse(state.body);
  assert.equal(stateData.cli.chat.available, true);
  assert.equal(stateData.cli.chat.provider, 'zai');
  assert.equal(stateData.cli.chat.keySource, 'file');
  assert.ok(!state.body.includes(SECRET), '/api/state 에도 키 값이 노출되면 안 됨');

  const bc = events.find((e) => e.event === 'cli-change');
  assert.ok(bc, 'cli-change 브로드캐스트가 발생해야 함');
  assert.equal(bc.payload.chat, true);
  assert.equal(bc.payload.provider, 'zai');
});

test('DELETE /api/zai/key: 삭제 후 available이 agy 감지값으로 복귀 + cli-change 브로드캐스트', async (t) => {
  const { server, port, events } = await startServer(); // cli.chat=false(agy 미감지) 기본
  t.after(() => server.close());
  zaiState.enabled = true;
  zaiState.source = 'file';
  zaiState.apiKey = 'sk-existing';

  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/zai/key',
    headers: { 'X-QNet-Token': TOKEN },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });

  const state = await request(port, { reqPath: '/api/state' });
  const stateData = JSON.parse(state.body);
  assert.equal(stateData.cli.chat.available, false); // agy도 미감지이므로 완전히 비활성 복귀
  assert.equal(stateData.cli.chat.provider, 'agy');

  const bc = events.find((e) => e.event === 'cli-change');
  assert.ok(bc, 'cli-change 브로드캐스트가 발생해야 함');
  assert.equal(bc.payload.chat, false);
  assert.equal(bc.payload.provider, 'agy');
});

test('DELETE /api/zai/key: agy 감지 상태면 삭제 후에도 available은 true(agy 폴백)', async (t) => {
  const { server, port } = await startServer({ cli: { chat: true } });
  t.after(() => server.close());
  zaiState.enabled = true;
  zaiState.source = 'file';

  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/zai/key',
    headers: { 'X-QNet-Token': TOKEN },
  });
  assert.equal(res.status, 200);

  const state = await request(port, { reqPath: '/api/state' });
  const stateData = JSON.parse(state.body);
  assert.equal(stateData.cli.chat.available, true); // agy 폴백
  assert.equal(stateData.cli.chat.provider, 'agy');
});

test('DELETE /api/zai/key: 환경변수 키 사용 중이면 400(UI로 관리 불가)', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  zaiState.enabled = true;
  zaiState.source = 'env';
  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/zai/key',
    headers: { 'X-QNet-Token': TOKEN },
  });
  assert.equal(res.status, 400);
});
