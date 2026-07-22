'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const questionRunner = require('../server/questionRunner');
const questionStore = require('../server/questionStore');
const { createBridge } = require('../server/cliBridge');

const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const FAKE_AGY = path.join(__dirname, 'fixtures', 'fake-agy.js');

// 테스트 저장소 골격: 자격증 + 기출문제/{정답 md, PDF}.
// 정답 md는 과목 2개(각 2문항)로 구성 — 과목 단위 청킹(잡 2개)을 검증한다.
function makeRepo(examId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-qrunner-'));
  const 기출 = path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제');
  fs.mkdirSync(path.join(기출, '정답'), { recursive: true });
  fs.writeFileSync(path.join(기출, `${examId}.pdf`), '%PDF-1.4 fake', 'utf8');
  const 정답md = [
    '---',
    '문항수: 4',
    '숨김페이지수: 1',
    '추출도구: claude',
    '추출일: 2026-07-21',
    '---',
    '',
    '## 과목A (1-2)',
    '',
    '| 문번 | 정답 |',
    '|------|------|',
    '| 1 | ① |',
    '| 2 | ② |',
    '',
    '## 과목B (3-4)',
    '',
    '| 문번 | 정답 |',
    '|------|------|',
    '| 3 | ③ |',
    '| 4 | ④ |',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(기출, '정답', `${examId}.md`), 정답md, 'utf8');
  return root;
}

function makeDeps(root) {
  const events = [];
  const bridge = createBridge({
    config: { cliChat: `node ${FAKE_AGY}`, cliRecord: `node ${FAKE_CLAUDE}` },
    repoRoot: root,
    cli: { chat: true, record: true },
  });
  return {
    deps: { repoRoot: root, bridge, broadcast: (event, payload) => events.push({ event, payload }) },
    events,
  };
}

async function waitDone(jobId, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const j = questionRunner.getJob(jobId);
    if (j && j.status === 'done') return j;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('잡이 제한 시간 내 끝나지 않음');
}

test('러너 happy path: 과목 2잡 순차 → 문항 4개 생성·검증 통과·SSE 통지', async () => {
  const examId = '2023-1-필기';
  const root = makeRepo(examId);
  const { deps, events } = makeDeps(root);

  const out = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
  assert.ok(out.jobId, JSON.stringify(out));
  const j = await waitDone(out.jobId);
  assert.strictEqual(j.result.ok, true, JSON.stringify(j.result));
  assert.strictEqual(j.result.존재수, 4);
  assert.deepStrictEqual(j.result.누락문번, []);
  assert.deepStrictEqual(j.result.검증오류, []);
  assert.strictEqual(j.result.과목결과.length, 2);

  // 파일 실재 + 내용 대조(정답은 정답 md 복사본).
  const q3 = questionStore.read(root, '정보처리', '정보처리기사', examId, 3);
  assert.ok(q3);
  assert.strictEqual(q3.정답, 3);
  assert.strictEqual(q3.과목, '과목B');

  // SSE: 진행 2회 + 완료 1회 + fs-change.
  assert.strictEqual(events.filter((e) => e.event === 'questions-progress').length, 2);
  const done = events.find((e) => e.event === 'questions-done');
  assert.ok(done && done.payload.ok);
  assert.ok(events.some((e) => e.event === 'fs-change' && e.payload.kind === 'questions'));
});

test('멱등: 완비 시 skipped, force면 재실행', async () => {
  const examId = '2024-1-필기';
  const root = makeRepo(examId);
  const { deps } = makeDeps(root);

  const first = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
  await waitDone(first.jobId);

  const again = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
  assert.strictEqual(again.skipped, true, JSON.stringify(again));
  assert.strictEqual(again.존재수, 4);

  const forced = questionRunner.start(deps, {
    grade: '정보처리',
    cert: '정보처리기사',
    examId,
    force: true,
  });
  assert.ok(forced.jobId);
  const j = await waitDone(forced.jobId);
  assert.strictEqual(j.result.ok, true);
});

test('모델 고정: questions 잡이 --model 을 claude 에 전달(기본 opus, config 재정의)', async () => {
  const examId = '2026-1-필기';
  const root = makeRepo(examId);
  const events = [];
  const argvOut = path.join(os.tmpdir(), `qnet-argv-${Date.now()}.txt`);
  process.env.QNET_ARGV_OUT = argvOut;
  try {
    // 기본값(config.questionsModel 미지정) → 브리지가 넘긴 model 파라미터로 --model 결정.
    const bridge = createBridge({
      config: { cliChat: `node ${FAKE_AGY}`, cliRecord: `node ${FAKE_CLAUDE}`, questionsModel: 'opus' },
      repoRoot: root,
      cli: { chat: true, record: true },
    });
    const deps = { repoRoot: root, bridge, broadcast: (e, p) => events.push({ e, p }) };
    const out = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
    await waitDone(out.jobId);
    // 각 줄 = 한 claude 호출의 argv(JSON 배열). 문항추출 잡만 골라 --model opus 검증.
    const calls = fs
      .readFileSync(argvOut, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const 잡들 = calls.filter((a) => a.some((x) => x.includes('문항별 md 파일 작성')));
    assert.ok(잡들.length >= 2, `문항추출 호출이 부족함(과목 2개 기대): ${JSON.stringify(calls)}`);
    for (const a of 잡들) {
      const i = a.indexOf('--model');
      assert.ok(i >= 0 && a[i + 1] === 'opus', `--model opus 없음: ${JSON.stringify(a)}`);
    }
  } finally {
    delete process.env.QNET_ARGV_OUT;
    try {
      fs.rmSync(argvOut, { force: true });
    } catch (_e) {
      /* noop */
    }
  }
});

test('모델 고정: questionsModel 빈 값이면 --model 미지정(CLI 기본)', async () => {
  const examId = '2026-2-필기';
  const root = makeRepo(examId);
  const argvOut = path.join(os.tmpdir(), `qnet-argv2-${Date.now()}.txt`);
  process.env.QNET_ARGV_OUT = argvOut;
  try {
    const bridge = createBridge({
      config: { cliChat: `node ${FAKE_AGY}`, cliRecord: `node ${FAKE_CLAUDE}`, questionsModel: '' },
      repoRoot: root,
      cli: { chat: true, record: true },
    });
    const deps = { repoRoot: root, bridge, broadcast: () => {} };
    const out = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
    await waitDone(out.jobId);
    const dumped = fs.readFileSync(argvOut, 'utf8');
    assert.ok(!/--model/.test(dumped), `빈 값인데 --model 이 붙음:\n${dumped}`);
  } finally {
    delete process.env.QNET_ARGV_OUT;
    try {
      fs.rmSync(argvOut, { force: true });
    } catch (_e) {
      /* noop */
    }
  }
});

test('이어하기: 이미 완비된 과목은 재추출 skip(파일 보존), 부분 과목만 재실행', async () => {
  const examId = '2026-3-필기';
  const root = makeRepo(examId); // 과목A(1-2), 과목B(3-4)
  const { deps } = makeDeps(root);
  const dir = questionStore.문항Dir(root, '정보처리', '정보처리기사', examId);
  fs.mkdirSync(dir, { recursive: true });
  // 과목A(1-2)를 미리 완비시켜 둔다(센티넬 본문). 과목B는 비운다.
  const 센티넬 = (q) =>
    ['---', `시험: ${examId}`, `문번: ${q}`, '과목: 과목A', `정답: ${q === 1 ? '①' : '②'}`, '추출도구: claude', '추출일: 2026-01-01', '---', 'SENTINEL 기존본문', '', '① 하나', '② 둘', '③ 셋', '④ 넷', ''].join('\n');
  fs.writeFileSync(path.join(dir, '1.md'), 센티넬(1), 'utf8');
  fs.writeFileSync(path.join(dir, '2.md'), 센티넬(2), 'utf8');

  const argvOut = path.join(os.tmpdir(), `qnet-resume-${Date.now()}.txt`);
  process.env.QNET_ARGV_OUT = argvOut;
  try {
    const out = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId });
    const j = await waitDone(out.jobId);
    assert.strictEqual(j.result.ok, true, JSON.stringify(j.result));
    // 과목A는 skip 되어 센티넬 보존, 과목B는 새로 생성.
    assert.ok(fs.readFileSync(path.join(dir, '1.md'), 'utf8').includes('SENTINEL'), '과목A 재추출됨(보존 실패)');
    assert.ok(fs.existsSync(path.join(dir, '3.md')) && fs.existsSync(path.join(dir, '4.md')), '과목B 미생성');
    // claude 호출은 과목B 한 번뿐(과목A는 호출 없음).
    const calls = fs.readFileSync(argvOut, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const 과목잡 = calls.filter((a) => a.some((x) => x.includes('문항별 md 파일 작성')));
    assert.strictEqual(과목잡.length, 1, `과목B만 호출돼야 함: ${JSON.stringify(과목잡)}`);
    assert.ok(과목잡[0].some((x) => x.includes('과목B')), '호출이 과목B가 아님');
    // 과목결과에 skip 표시.
    assert.ok(j.result.과목결과.some((r) => r.과목명 === '과목A' && r.skipped), JSON.stringify(j.result.과목결과));
  } finally {
    delete process.env.QNET_ARGV_OUT;
    fs.rmSync(argvOut, { force: true });
  }
});

test('시험 단위 순차: 두 시험 동시 start 여도 과목이 인터리브되지 않는다', async () => {
  const rootA = makeRepo('2027-1-필기');
  // 같은 저장소에 두 번째 시험 추가.
  const 기출 = path.join(rootA, '정보처리', '정보처리기사', '_공통', '기출문제');
  fs.writeFileSync(path.join(기출, '2027-2-필기.pdf'), '%PDF', 'utf8');
  fs.writeFileSync(
    path.join(기출, '정답', '2027-2-필기.md'),
    fs.readFileSync(path.join(기출, '정답', '2027-1-필기.md'), 'utf8').replace(/2027-1/g, '2027-2'),
    'utf8'
  );
  const argvOut = path.join(os.tmpdir(), `qnet-seq-${Date.now()}.txt`);
  process.env.QNET_ARGV_OUT = argvOut;
  try {
    const { deps } = makeDeps(rootA);
    // 백필처럼 두 시험을 연속 start(동시).
    const o1 = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId: '2027-1-필기' });
    const o2 = questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId: '2027-2-필기' });
    await Promise.all([waitDone(o1.jobId), waitDone(o2.jobId)]);
    // 호출 순서: 2027-1 의 두 과목이 모두 끝난 뒤 2027-2 시작(인터리브 아님).
    const calls = fs.readFileSync(argvOut, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const 시험순서 = calls
      .filter((a) => a.some((x) => x.includes('문항별 md 파일 작성')))
      .map((a) => (a.some((x) => x.includes('2027-1-필기')) ? '1' : '2'))
      .join('');
    assert.strictEqual(시험순서, '1122', `인터리브 발생(기대 1122): ${시험순서}`);
  } finally {
    delete process.env.QNET_ARGV_OUT;
    fs.rmSync(argvOut, { force: true });
  }
});

test('전제조건: 정답 md 부재 / PDF 부재 → status 400 오류', () => {
  const examId = '2025-1-필기';
  const root = makeRepo(examId);
  const { deps } = makeDeps(root);

  assert.throws(
    () => questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId: '2020-9-필기' }),
    (err) => err.status === 400 && /정답 md/.test(err.message)
  );

  fs.rmSync(path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제', `${examId}.pdf`));
  assert.throws(
    () => questionRunner.start(deps, { grade: '정보처리', cert: '정보처리기사', examId }),
    (err) => err.status === 400 && /PDF/.test(err.message)
  );
});
