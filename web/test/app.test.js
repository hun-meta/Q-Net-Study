'use strict';

// HTTP 통합 테스트: 보안 가드(Host·Origin·X-QNet-Token) + 핵심 API.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/app');
const { createSseHub } = require('../server/sse');

const TOKEN = 'test-token-abc';

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

async function startServer() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-app-'));
  const hub = createSseHub();
  const app = createApp({
    token: TOKEN,
    cli: { chat: false, record: false },
    repoRoot,
    hub,
    config: { cliChat: 'agy', cliRecord: 'claude', nickname: null },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, repoRoot };
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
