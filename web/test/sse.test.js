'use strict';

// SSE 허브 재동기화 + 워처→브로드캐스트 통합 테스트.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter, once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSseHub } = require('../server/sse');
const { startWatcher } = require('../server/watcher');

// SSE res/req 목 객체.
function mockRes() {
  const chunks = [];
  return {
    chunks,
    writeHead() {},
    write(s) {
      chunks.push(s);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

function mockReq(headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  req.query = {};
  return req;
}

test('SSE 재동기화: Last-Event-ID 이후 이벤트만 재전송', () => {
  const hub = createSseHub();
  hub.broadcast('fs-change', { n: 1 });
  hub.broadcast('fs-change', { n: 2 });
  hub.broadcast('fs-change', { n: 3 });
  assert.equal(hub.currentId(), 3);

  const req = mockReq({ 'last-event-id': '1' });
  const res = mockRes();
  hub.handleConnection(req, res);
  const out = res.text();

  // id 2, 3 만 재전송되어야 함
  assert.ok(out.includes('"n":2'));
  assert.ok(out.includes('"n":3'));
  assert.ok(!out.includes('"n":1'));
  assert.ok(out.includes('id: 2'));
  assert.ok(out.includes('id: 3'));

  req.emit('close'); // heartbeat 정리
});

test('SSE 브로드캐스트: 연결된 클라이언트에 실시간 전달', () => {
  const hub = createSseHub();
  const req = mockReq();
  const res = mockRes();
  hub.handleConnection(req, res);
  assert.equal(hub.clientCount(), 1);

  hub.broadcast('fs-change', { path: 'a.md' });
  assert.ok(res.text().includes('"path":"a.md"'));

  req.emit('close');
  assert.equal(hub.clientCount(), 0);
});

test('워처: 파일 생성 시 fs-change 브로드캐스트', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-watch-'));
  const hub = createSseHub();
  const events = [];
  const origBroadcast = hub.broadcast;
  // broadcast 감시
  const wrapped = {
    broadcast: (event, payload) => {
      events.push({ event, payload });
      return origBroadcast(event, payload);
    },
  };

  const w = startWatcher(root, wrapped, { debounceMs: 30 });
  // chokidar 초기 스캔 완료(ready)까지 대기 후 파일 생성 — 고정 sleep 대신 결정적 대기.
  await once(w.watcher, 'ready');
  fs.writeFileSync(path.join(root, 'test.md'), '# 테스트\n');

  // 디바운스 + 이벤트 대기
  await new Promise((r) => setTimeout(r, 600));
  await w.close();

  const fsEvent = events.find((e) => e.event === 'fs-change');
  assert.ok(fsEvent, 'fs-change 이벤트가 발생해야 함');
  const changed = fsEvent.payload.changes.find((c) => c.path === 'test.md');
  assert.ok(changed, 'test.md 변경이 포함되어야 함');
});

test('워처: .qnet-web 내부 변경은 무시', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-watch-ig-'));
  fs.mkdirSync(path.join(root, '.qnet-web'), { recursive: true });
  const hub = createSseHub();
  const events = [];
  const w = startWatcher(root, { broadcast: (e, p) => events.push({ e, p }) }, { debounceMs: 30 });
  await once(w.watcher, 'ready');
  fs.writeFileSync(path.join(root, '.qnet-web', 'cache.json'), '{}');
  await new Promise((r) => setTimeout(r, 500));
  await w.close();
  assert.equal(events.length, 0, '.qnet-web 변경은 이벤트를 만들지 않아야 함');
});
