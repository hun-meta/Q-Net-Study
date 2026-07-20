'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const cliRoutes = require('../server/cliRoutes');

const FAKE_AGY = path.join(__dirname, 'fixtures', 'fake-agy.js');
const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');

// 테스트용 앱: 전역 보안 가드 없이 express.json + 라우터만(라우터 단위 검증).
function 앱시작(deps) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(cliRoutes.router(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function makeDeps(root, cli) {
  const events = [];
  return {
    deps: {
      token: 'test-token',
      cli,
      repoRoot: root,
      hub: { broadcast: (event, payload) => events.push({ event, payload }) },
      config: { cliChat: `node ${FAKE_AGY}`, cliRecord: `node ${FAKE_CLAUDE}` },
    },
    events,
  };
}

let ctx;
let root;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes-'));
});
after(() => {
  if (ctx && ctx.server) ctx.server.close();
});

test('업로드→추출→구조검증 통과→INDEX 부기(happy path)', async () => {
  const { deps } = makeDeps(root, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: '2023-1-필기.pdf',
        시험ID: '2023-1-필기',
        총페이지: 10,
        contentBase64: Buffer.from('%PDF-1.4 fake').toString('base64'),
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.strictEqual(data.ok, true, JSON.stringify(data));
    assert.strictEqual(data.문항수, 2);
    // 정답 md + INDEX.md 가 실제로 기록됨.
    const 기출 = path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제');
    assert.ok(fs.existsSync(path.join(기출, '정답', '2023-1-필기.md')));
    const indexMd = fs.readFileSync(path.join(기출, 'INDEX.md'), 'utf8');
    assert.ok(indexMd.includes('2023-1-필기.pdf'));
    // 감사 clean.
    assert.strictEqual(data.audit.clean, true, JSON.stringify(data.audit));
  } finally {
    started.server.close();
  }
});

test('업로드: record CLI 미감지 → PDF 배치 후 503(수동 폼 경로)', async () => {
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes2-'));
  const { deps } = makeDeps(r2, { chat: true, record: false });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: '2024-1-필기.pdf',
        시험ID: '2024-1-필기',
        총페이지: 10,
        contentBase64: Buffer.from('%PDF fake').toString('base64'),
      }),
    });
    assert.strictEqual(res.status, 503);
    // PDF 는 서버 결정적 쓰기로 이미 배치됨(추출만 비활성).
    const pdf = path.join(r2, '정보처리', '정보처리기사', '_공통', '기출문제', '2024-1-필기.pdf');
    assert.ok(fs.existsSync(pdf));
  } finally {
    started.server.close();
  }
});

test('챗: fake-agy NDJSON 스트리밍(chunk+done)', async () => {
  const r3 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes3-'));
  const { deps } = makeDeps(r3, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/chat/2023-1-필기/5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', message: '질문' }),
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === 'chunk'));
    const done = events.find((e) => e.type === 'done');
    assert.ok(done);
    assert.strictEqual(done.audit.clean, true);
  } finally {
    started.server.close();
  }
});

test('챗: agy 미감지 → 503', async () => {
  const r4 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes4-'));
  const { deps } = makeDeps(r4, { chat: false, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/chat/2023-1-필기/5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', message: '질문' }),
    });
    assert.strictEqual(res.status, 503);
  } finally {
    started.server.close();
  }
});

test('[CR-3] 상시 시험ID(하이픈 식별자) 업로드 → INDEX 식별자 정확 등록', async () => {
  const r6 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes6-'));
  const { deps } = makeDeps(r6, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: '2024-상시-2-필기.pdf',
        시험ID: '2024-상시-2-필기', // 식별자에 하이픈 포함(상시-2)
        총페이지: 10,
        contentBase64: Buffer.from('%PDF fake').toString('base64'),
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    const 기출 = path.join(r6, '정보처리', '정보처리기사', '_공통', '기출문제');
    const indexMd = fs.readFileSync(path.join(기출, 'INDEX.md'), 'utf8');
    // naive split('-') 였다면 연도=2024, 식별자='상시', 구분='2'로 오배정됐을 것.
    const examIndex = require('../server/examIndex');
    const rows = examIndex.parse(indexMd);
    const row = rows.find((r) => r.연도 === 2024);
    assert.ok(row, JSON.stringify(rows));
    assert.strictEqual(row.식별자, '상시-2');
    assert.strictEqual(row.구분, '필기');
  } finally {
    started.server.close();
  }
});

test('[CR-3] 잘못된 시험ID 형식 → 400', async () => {
  const r7 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes7-'));
  const { deps } = makeDeps(r7, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: 'bad.pdf',
        시험ID: '엉터리ID', // 연도-식별자-구분 형식 아님
        총페이지: 10,
        contentBase64: Buffer.from('%PDF fake').toString('base64'),
      }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    started.server.close();
  }
});

test('입력 검증: 예약된 디렉토리명을 종류로 → 400 (blocklist)', async () => {
  const r5 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes5-'));
  const { deps } = makeDeps(r5, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    // 화이트리스트 폐지 후에도 예약어(node_modules)·'_' 시작은 종류로 불가.
    const res = await fetch(`${started.base}/api/chat/2023-1-필기/5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: 'node_modules', cert: '정보처리기사', message: '질문' }),
    });
    assert.strictEqual(res.status, 400);
    // '_' 시작도 400.
    const res2 = await fetch(`${started.base}/api/chat/2023-1-필기/5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '_비공개', cert: '정보처리기사', message: '질문' }),
    });
    assert.strictEqual(res2.status, 400);
  } finally {
    started.server.close();
  }
});
