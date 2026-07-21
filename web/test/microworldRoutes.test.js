'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const microworldRoutes = require('../server/microworldRoutes');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');

function 앱시작(deps) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(microworldRoutes.router(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// 출제기준 과목이 있는 최소 저장소 골격 생성.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-mw-'));
  const 출제기준 = path.join(root, '정보처리', '정보처리기사', '_공통', '출제기준');
  fs.mkdirSync(출제기준, { recursive: true });
  fs.writeFileSync(path.join(출제기준, '프로그래밍언어활용.md'), '# 프로그래밍언어활용\n', 'utf8');
  return root;
}

function makeDeps(root, cli) {
  const events = [];
  return {
    deps: {
      token: 'test-token',
      cli,
      repoRoot: root,
      hub: { broadcast: (event, payload) => events.push({ event, payload }) },
      config: { cliChat: '', cliRecord: `node ${FAKE_CLAUDE}` },
    },
    events,
  };
}

test('목록: 초기 빈 상태 + 생성 가능한 과목 반환', async () => {
  const root = makeRepo();
  const { deps } = makeDeps(root, { chat: false, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/microworld?grade=정보처리&cert=정보처리기사`);
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.deepStrictEqual(data.items, []);
    assert.ok(data.subjects.includes('프로그래밍언어활용'));
    assert.strictEqual(data.canGenerate, true);
  } finally {
    started.server.close();
  }
});

test('생성 happy path → HTML 작성 + 감사 clean + 목록/열람 반영', async () => {
  const root = makeRepo();
  const { deps, events } = makeDeps(root, { chat: false, record: true });
  const started = await 앱시작(deps);
  try {
    const gen = await fetch(`${started.base}/api/microworld/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        과목: '프로그래밍언어활용',
        개념: 'CPU 스케줄링',
      }),
    });
    const gd = await gen.json();
    assert.strictEqual(gen.status, 200, JSON.stringify(gd));
    assert.strictEqual(gd.ok, true, JSON.stringify(gd));
    assert.strictEqual(gd.file, 'CPU-스케줄링.html');
    assert.strictEqual(gd.audit.clean, true, JSON.stringify(gd.audit));

    // 실제 파일이 목적지에 작성됨.
    const abs = path.join(root, '정보처리', '정보처리기사', '_공통', '마이크로월드', '프로그래밍언어활용', 'CPU-스케줄링.html');
    assert.ok(fs.existsSync(abs));
    // fs-change 브로드캐스트됨.
    assert.ok(events.some((e) => e.event === 'fs-change' && e.payload.kind === 'microworld'));

    // 목록에 나타남.
    const list = await (await fetch(`${started.base}/api/microworld?grade=정보처리&cert=정보처리기사`)).json();
    assert.strictEqual(list.items.length, 1);
    assert.strictEqual(list.items[0].과목, '프로그래밍언어활용');
    assert.strictEqual(list.items[0].title, '테스트 마이크로월드');

    // 내용 조회(임베드용 html).
    const content = await (
      await fetch(`${started.base}/api/microworld/content?grade=정보처리&cert=정보처리기사&과목=프로그래밍언어활용&file=CPU-스케줄링.html`)
    ).json();
    assert.ok(content.html.includes('테스트 개념 시뮬레이션'));
  } finally {
    started.server.close();
  }
});

test('생성: 출제기준에 없는 과목 → 400', async () => {
  const root = makeRepo();
  const { deps } = makeDeps(root, { chat: false, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/microworld/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', 과목: '없는과목', 개념: 'X' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    started.server.close();
  }
});

test('생성: record CLI 미감지 → 503(핵심 루프 유지)', async () => {
  const root = makeRepo();
  const { deps } = makeDeps(root, { chat: false, record: false });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/microworld/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', 과목: '프로그래밍언어활용', 개념: 'CPU 스케줄링' }),
    });
    assert.strictEqual(res.status, 503);
  } finally {
    started.server.close();
  }
});

test('내용 조회: 경로 탈출 시도(과목=..) → 400', async () => {
  const root = makeRepo();
  const { deps } = makeDeps(root, { chat: false, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(
      `${started.base}/api/microworld/content?grade=정보처리&cert=정보처리기사&과목=${encodeURIComponent('..')}&file=x.html`
    );
    assert.strictEqual(res.status, 400);
    // 확장자 아닌 파일 → 400.
    const res2 = await fetch(
      `${started.base}/api/microworld/content?grade=정보처리&cert=정보처리기사&과목=프로그래밍언어활용&file=x.txt`
    );
    assert.strictEqual(res2.status, 400);
    // 존재하지 않는 파일 → 404.
    const res3 = await fetch(
      `${started.base}/api/microworld/content?grade=정보처리&cert=정보처리기사&과목=프로그래밍언어활용&file=none.html`
    );
    assert.strictEqual(res3.status, 404);
  } finally {
    started.server.close();
  }
});
