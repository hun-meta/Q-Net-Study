'use strict';

// 서버 쓰기 ↔ CLI 잡 직렬화 회귀 테스트.
// 재현된 사고: CLI 잡(추출, 몇 분)이 실행 중일 때 서버가 저장소 영역에 파일을 쓰면
// (풀이 제출·수동 정답 등록 등) 잡의 사후 감사가 이를 "경계 밖 무단 변경"으로 오인해
// 잡 전체 원복 + 그 파일 삭제가 일어났다. 수정: 모든 저장소 서버 쓰기를 공유 잡 큐로 직렬화.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const cliRoutes = require('../server/cliRoutes');
const attemptRoutes = require('../server/attemptRoutes');

const FAKE_SLOW = path.join(__dirname, 'fixtures', 'fake-claude-slow.js');

function 앱시작(deps) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(cliRoutes.router(deps));
  app.use(attemptRoutes.router(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const 정답MD = [
  '---',
  '문항수: 2',
  '숨김페이지수: 1',
  '추출도구: manual',
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

test('[직렬화 회귀] 추출 잡 실행 중 풀이 제출 — 잡 원복 없음 + 제출 기록 생존', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-ser-'));
  // 제출 채점용 정답 md 를 미리 배치(잡과 무관한 기존 파일 = 스냅샷에 포함).
  const 기출 = path.join(root, '정보처리', '정보처리기사', '_공통', '기출문제');
  fs.mkdirSync(path.join(기출, '정답'), { recursive: true });
  fs.writeFileSync(path.join(기출, '정답', '2030-9-필기.md'), 정답MD, 'utf8');

  const events = [];
  const deps = {
    token: 'test-token',
    cli: { chat: false, record: true },
    repoRoot: root,
    hub: { broadcast: (event, payload) => events.push({ event, payload }) },
    config: { cliChat: '', cliRecord: `node ${FAKE_SLOW}` },
  };
  const started = await 앱시작(deps);
  try {
    // 1) 느린 추출 잡 시작(1.2초 실행창).
    const pUpload = fetch(`${started.base}/api/exams/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        filename: '2030-8-필기.pdf',
        시험ID: '2030-8-필기',
        총페이지: 8,
        contentBase64: Buffer.from('%PDF fake').toString('base64'),
      }),
    }).then((r) => r.json());

    // 2) 잡 실행 중에 풀이 제출(예전 코드라면 잡 감사가 이 기록을 오인·삭제).
    await new Promise((r) => setTimeout(r, 400));
    const pSubmit = fetch(`${started.base}/api/attempts/2030-9-필기/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: '정보처리',
        cert: '정보처리기사',
        answers: { 1: 1, 2: 3 }, // 1번 정답, 2번 오답(WRONG 기록 유발)
        찍음: { 2: true },
      }),
    }).then((r) => r.json());

    const [up, sub] = await Promise.all([pUpload, pSubmit]);

    // 추출 잡: 성공 + 감사 clean(제출 쓰기가 잡 창과 겹치지 않았음).
    assert.strictEqual(up.ok, true, `업로드 실패: ${JSON.stringify(up)}`);
    assert.strictEqual(up.audit.clean, true, `감사 위반: ${JSON.stringify(up.audit)}`);
    // 제출: 성공 + 기록 3종 생존.
    assert.strictEqual(sub.ok, true, `제출 실패: ${JSON.stringify(sub)}`);
    const abs = (rel) => path.join(root, rel);
    assert.ok(fs.existsSync(abs(sub.파일.attempt)), 'attempt 기록이 삭제됨(감사 오인 원복)');
    assert.ok(fs.existsSync(abs(sub.파일.index)), 'INDEX 가 삭제됨');
    assert.ok(fs.existsSync(abs(sub.파일.wrong)), 'WRONG 이 삭제됨');
    // 추출 산출물도 생존.
    assert.ok(fs.existsSync(path.join(기출, '정답', '2030-8-필기.md')));
  } finally {
    started.server.close();
  }
});
