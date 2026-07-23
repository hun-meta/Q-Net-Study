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

function makeDeps(root, cli, extra = {}) {
  const events = [];
  return {
    deps: {
      token: 'test-token',
      cli,
      repoRoot: root,
      hub: { broadcast: (event, payload) => events.push({ event, payload }) },
      config: { cliChat: `node ${FAKE_AGY}`, cliRecord: `node ${FAKE_CLAUDE}` },
      // 기본: Z.AI 비활성 고정 — 개발 머신 secrets.json 에 실 키가 등록돼 있어도
      // 테스트가 실제 Z.AI API 로 새지 않게 한다(zai 경로 테스트만 extra 로 켠다).
      resolveZai: () => ({ enabled: false, apiKey: '', source: null, baseUrl: '', model: '', effort: '' }),
      ...extra,
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

test('[레이스 회귀] 잡 실행 중 두 번째 업로드가 첫 잡을 원복시키지 않는다', async () => {
  // 재현된 버그: 잡 A 실행 중 사용자가 B 를 업로드하면 서버가 즉시 쓴 B 의 PDF 가
  // 감사 A 에 "경계 밖 변경"으로 잡혀 잡 A 전체 원복(+B PDF 삭제)됐다.
  // 수정: PDF 배치를 잡 큐 안(prepare, 스냅샷 직전)으로 직렬화 → 둘 다 성공해야 한다.
  const rR = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-race-'));
  const { deps } = makeDeps(rR, { chat: true, record: true });
  deps.config = { ...deps.config, cliRecord: `node ${path.join(__dirname, 'fixtures', 'fake-claude-slow.js')}` };
  const started = await 앱시작(deps);
  try {
    const upload = (시험ID) =>
      fetch(`${started.base}/api/exams/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: '정보처리',
          cert: '정보처리기사',
          filename: `${시험ID}.pdf`,
          시험ID,
          총페이지: 8,
          contentBase64: Buffer.from('%PDF fake').toString('base64'),
        }),
      }).then((r) => r.json());

    const pA = upload('2030-1-필기');
    await new Promise((r) => setTimeout(r, 400)); // 잡 A 실행 중(느린 fake claude 1.2s)
    const pB = upload('2030-2-필기');
    const [a, b] = await Promise.all([pA, pB]);

    assert.strictEqual(a.ok, true, `A 실패: ${JSON.stringify(a)}`);
    assert.strictEqual(a.audit.clean, true, `A 감사 위반: ${JSON.stringify(a.audit)}`);
    assert.strictEqual(b.ok, true, `B 실패: ${JSON.stringify(b)}`);
    assert.strictEqual(b.audit.clean, true, `B 감사 위반: ${JSON.stringify(b.audit)}`);
    // 두 정답 파일·두 PDF 모두 살아있어야 한다.
    const 기출 = path.join(rR, '정보처리', '정보처리기사', '_공통', '기출문제');
    assert.ok(fs.existsSync(path.join(기출, '정답', '2030-1-필기.md')));
    assert.ok(fs.existsSync(path.join(기출, '정답', '2030-2-필기.md')));
    assert.ok(fs.existsSync(path.join(기출, '2030-1-필기.pdf')));
    assert.ok(fs.existsSync(path.join(기출, '2030-2-필기.pdf')));
  } finally {
    started.server.close();
  }
});

test('업로드: 추출이 정답 파일을 안 만들면 사유·추출메시지 노출(수동 폼)', async () => {
  const rX = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routesX-'));
  const { deps } = makeDeps(rX, { chat: true, record: true });
  // 파일을 만들지 않고 사유만 출력하는 가짜 claude 로 교체.
  deps.config = { ...deps.config, cliRecord: `node ${path.join(__dirname, 'fixtures', 'fake-claude-noanswer.js')}` };
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: '2025-3-필기.pdf',
        시험ID: '2025-3-필기',
        총페이지: 8,
        contentBase64: Buffer.from('%PDF fake').toString('base64'),
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(data));
    assert.strictEqual(data.ok, false, JSON.stringify(data));
    assert.strictEqual(data.needsManualForm, true);
    assert.ok(data.reason && data.reason.length > 0, '사유 문구가 있어야 함');
    assert.ok(data.추출메시지 && data.추출메시지.includes('저작권'), 'claude 실제 사유가 노출돼야 함');
    assert.strictEqual(data.isError, false);
    // 정답 파일은 만들어지지 않음. PDF 는 배치됨.
    const 기출 = path.join(rX, '정보처리', '정보처리기사', '_공통', '기출문제');
    assert.ok(!fs.existsSync(path.join(기출, '정답', '2025-3-필기.md')));
    assert.ok(fs.existsSync(path.join(기출, '2025-3-필기.pdf')));
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
    assert.strictEqual(done.usage, null); // usage는 zai 경로 전용 — agy 경로는 null 고정.
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
    const data = await res.json();
    assert.strictEqual(data.cli, 'chat');
    assert.ok(data.error.includes('Z.AI'), 'zai 미등록도 안내에 포함돼야 함');
  } finally {
    started.server.close();
  }
});

// [설계 A-4] 챗 가용성은 저장된 플래그가 아니라 사용 시점 파생값이다:
// zai.enabled || cli.chat. agy 가 미감지여도 Z.AI 키가 등록돼 있으면 503 게이트를 통과한다.
// (deps.resolveZai 주입으로 라우트 계약 검증을 config 파일 I/O와 격리한다 —
//  파일 I/O 자체의 검증은 zaiChat.test.js 가 담당한다.)
test('[A-4] zai 활성 + agy 미설치 → requireCli 통과(챗 라우트가 503으로 막히지 않음)', async () => {
  const r9 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes9-'));
  const { deps } = makeDeps(
    r9,
    { chat: false, record: true }, // agy 미감지
    {
      resolveZai: () => ({
        enabled: true,
        apiKey: 'sk-test',
        source: 'file',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        model: 'glm-5.2',
        effort: 'none',
      }),
    }
  );
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/chat/2023-1-필기/5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: '정보처리', cert: '정보처리기사', message: '질문' }),
    });
    assert.notStrictEqual(res.status, 503, `zai 활성인데도 503으로 막힘: ${await res.text()}`);
    assert.strictEqual(res.status, 200);
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

test('정리 승인(요청/잡 분리): 즉시 202+jobId → 완료 시 record-done 통지 + 상태 조회', async () => {
  const rA = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-approve-'));
  const nickMod = require('../server/nickname');
  const origGet = nickMod.getNickname;
  nickMod.getNickname = () => '테스터'; // 실제 config 오염 없이 닉네임 스텁.
  const { deps, events } = makeDeps(rA, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const t0 = Date.now();
    const res = await fetch(`${started.base}/api/chat/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        examId: '2023-1-필기',
        qno: '5',
        conversation: '[사용자] 질문\n[어시스턴트] 답변',
        destinations: { note: true, shared: true },
      }),
    });
    const data = await res.json();
    // 요청/잡 분리: 잡 완주를 기다리지 않고 즉시 202+jobId 로 반환.
    assert.strictEqual(res.status, 202, JSON.stringify(data));
    assert.ok(data.jobId, 'jobId 가 반환돼야 함');
    assert.ok(Date.now() - t0 < 5000, '요청은 잡 완료를 기다리지 않고 즉시 반환해야 함');

    // 완료는 SSE(record-done) 로 통지된다(fake-claude 는 즉시 성공 종료 → 감사 clean).
    let done = null;
    for (let i = 0; i < 100 && !done; i += 1) {
      done = events.find((e) => e.event === 'record-done' && e.payload.jobId === data.jobId);
      if (!done) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(done, 'record-done 이 브로드캐스트돼야 함');
    assert.strictEqual(done.payload.ok, true, JSON.stringify(done.payload));

    // 상태 조회 폴백(GET).
    const st = await fetch(`${started.base}/api/chat/approve/${data.jobId}`);
    const stData = await st.json();
    assert.strictEqual(st.status, 200);
    assert.strictEqual(stData.status, 'done');
    assert.strictEqual(stData.ok, true, JSON.stringify(stData));

    // 없는 jobId 는 404.
    const miss = await fetch(`${started.base}/api/chat/approve/nope-nope`);
    assert.strictEqual(miss.status, 404);
  } finally {
    nickMod.getNickname = origGet;
    started.server.close();
  }
});

test('정리 승인: 목적지 0개면 400(잡을 만들지 않음)', async () => {
  const rB = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-approve-'));
  const nickMod = require('../server/nickname');
  const origGet = nickMod.getNickname;
  nickMod.getNickname = () => '테스터';
  const { deps } = makeDeps(rB, { chat: true, record: true });
  const started = await 앱시작(deps);
  try {
    const res = await fetch(`${started.base}/api/chat/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        examId: '2023-1-필기',
        qno: '5',
        conversation: 'x',
        destinations: { note: false, shared: false },
      }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    nickMod.getNickname = origGet;
    started.server.close();
  }
});
