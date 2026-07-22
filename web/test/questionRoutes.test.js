'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const questionRoutes = require('../server/questionRoutes');
const questionStore = require('../server/questionStore');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const FAKE_AGY = path.join(__dirname, 'fixtures', 'fake-agy.js');

function 앱시작(deps) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(questionRoutes.router(deps));
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

// 자격증 골격 + (선택) 정답 md·PDF 배치.
function makeRepo({ examId, withAnswer, withPdf } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-qroutes-'));
  const 기출 = path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제');
  fs.mkdirSync(path.join(기출, '정답'), { recursive: true });
  if (examId && withPdf) fs.writeFileSync(path.join(기출, `${examId}.pdf`), '%PDF fake', 'utf8');
  if (examId && withAnswer) {
    const md = [
      '---',
      '문항수: 2',
      '숨김페이지수: 1',
      '추출도구: claude',
      '추출일: 2026-07-21',
      '---',
      '',
      '## 테스트과목 (1-2)',
      '',
      '| 문번 | 정답 |',
      '|------|------|',
      '| 1 | ① |',
      '| 2 | ② |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(기출, '정답', `${examId}.md`), md, 'utf8');
  }
  return root;
}

async function pollStatus(base, jobId, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${base}/api/questions/status/${jobId}`);
    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();
    if (data.status === 'done') return data;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('잡이 제한 시간 내 끝나지 않음');
}

test('GET /api/question: 부재 404 → 존재 시 기본 정답 제외, withAnswer=1 포함', async () => {
  const root = makeRepo({});
  const { deps } = makeDeps(root, { chat: true, record: true });
  const started = await 앱시작(deps);
  const qs = 'grade=%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC&cert=%EC%A0%95%EB%B3%B4%EC%B2%98%EB%A6%AC%EA%B8%B0%EC%82%AC';
  try {
    const miss = await fetch(`${started.base}/api/question/2023-1-필기/1?${qs}`);
    assert.strictEqual(miss.status, 404);

    const dir = questionStore.문항Dir(root, '정보처리', '정보처리기사', '2023-1-필기');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '1.md'),
      ['---', '시험: 2023-1-필기', '문번: 1', '과목: 테스트과목', '정답: ②', '추출도구: claude', '추출일: 2026-07-22', '---', '본문입니다.', '', '① 하나', '② 둘', '③ 셋', '④ 넷', ''].join('\n'),
      'utf8'
    );

    const res = await fetch(`${started.base}/api/question/2023-1-필기/1?${qs}`);
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.strictEqual(data.문번, 1);
    assert.strictEqual(data.선택지.length, 4);
    assert.ok(!('정답' in data), '기본 응답에 정답이 없어야 함');

    const full = await fetch(`${started.base}/api/question/2023-1-필기/1?${qs}&withAnswer=1`);
    const fullData = await full.json();
    assert.strictEqual(fullData.정답, 2);

    // 잘못된 자격증 → 404.
    const bad = await fetch(`${started.base}/api/question/2023-1-필기/1?grade=%EC%97%86%EC%9D%8C&cert=x`);
    assert.ok([400, 404].includes(bad.status));
  } finally {
    started.server.close();
  }
});

test('POST /api/questions/extract: 202 → status done → 문항 생성, 재요청은 skipped', async () => {
  const examId = '2024-2-필기';
  const root = makeRepo({ examId, withAnswer: true, withPdf: true });
  const { deps, events } = makeDeps(root, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/questions/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', examId }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 202, JSON.stringify(data));
    assert.ok(data.jobId);

    const done = await pollStatus(started.base, data.jobId);
    assert.strictEqual(done.ok, true, JSON.stringify(done));
    assert.strictEqual(done.존재수, 2);
    assert.ok(questionStore.read(root, '정보처리', '정보처리기사', examId, 2));
    assert.ok(events.some((e) => e.event === 'questions-done'));

    // 완비 후 재요청 → skipped.
    const again = await fetch(`${started.base}/api/questions/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', examId }),
    });
    const againData = await again.json();
    assert.strictEqual(again.status, 200);
    assert.strictEqual(againData.skipped, true);
  } finally {
    started.server.close();
  }
});

test('POST /api/questions/extract: record CLI 미감지 → 503, 전제조건 위반 → 400', async () => {
  const examId = '2025-2-필기';
  const root = makeRepo({ examId, withAnswer: false, withPdf: true });
  const off = makeDeps(root, { chat: true, record: false });
  const startedOff = await 앱시작(off.deps);
  try {
    const res = await fetch(`${startedOff.base}/api/questions/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', examId }),
    });
    assert.strictEqual(res.status, 503);
  } finally {
    startedOff.server.close();
  }

  const on = makeDeps(root, { chat: true, record: true });
  const startedOn = await 앱시작(on.deps);
  try {
    // 정답 md 없음 → 400.
    const res = await fetch(`${startedOn.base}/api/questions/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', examId }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400, JSON.stringify(data));
    assert.ok(/정답 md/.test(data.error));
  } finally {
    startedOn.server.close();
  }
});

test('POST /api/questions/backfill: 대상 열거(미완비 큐잉·완비 skipped·PDF 없음 제외)', async () => {
  const examId = '2022-1-필기';
  const root = makeRepo({ examId, withAnswer: true, withPdf: true });
  // PDF 없는 등록 시험(백필 제외 대상) — 정답만 있는 기출.
  const 기출 = path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제');
  fs.writeFileSync(
    path.join(기출, '정답', '2021-1-필기.md'),
    fs.readFileSync(path.join(기출, '정답', `${examId}.md`), 'utf8'),
    'utf8'
  );
  const { deps } = makeDeps(root, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/questions/backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사' }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 202, JSON.stringify(data));
    assert.strictEqual(data.queued.length, 1);
    assert.strictEqual(data.queued[0].examId, examId);
    assert.ok(!data.queued.some((j) => j.examId === '2021-1-필기'), 'PDF 없는 기출은 제외');

    const done = await pollStatus(started.base, data.queued[0].jobId);
    assert.strictEqual(done.ok, true, JSON.stringify(done));

    // 완비 후 재백필 → skipped 목록으로.
    const again = await fetch(`${started.base}/api/questions/backfill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사' }),
    });
    const againData = await again.json();
    assert.strictEqual(againData.queued.length, 0, JSON.stringify(againData));
    assert.ok(againData.skipped.some((s) => s.examId === examId));
  } finally {
    started.server.close();
  }
});
