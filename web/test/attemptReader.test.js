'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { grade } = require('../server/grading');
const answerKey = require('../server/answerKey');
const w = require('../server/attemptWriter');
const r = require('../server/attemptReader');

const 기준 = { 과목과락: 40, 평균합격: 60, 출처: '기본값' };

function model(옵션) {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', '정답', '2023-1-필기.md'), 'utf8');
  const key = answerKey.parse(fixture, { 시험ID: '2023-1-필기' });
  const 답안 = {
    1: { 답: 3 }, 2: { 답: 1 }, 3: { 답: 1 }, 4: { 답: 3, 찍음: true },
    5: { 답: 2 }, 6: { 답: 4, 찍음: true }, 7: { 답: 2 }, 8: { 답: 3 },
  };
  const g = grade({ 답안, answerKey: key, passCriteria: 기준 });
  return Object.assign(
    { 자격증: '정보처리기사', 시험ID: '2023-1-필기', 시도: 1, 풀이일: '2026-07-21', 소요시간: 75, gradingResult: g },
    옵션 || {}
  );
}

test('parseAttempt: 골든 라운드트립 (문항·확신도·메모 복원)', () => {
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'attempt-golden.md'), 'utf8');
  const p = r.parseAttempt(golden);
  assert.equal(p.자격증, '정보처리기사');
  assert.equal(p.시험, '2023-1-필기');
  assert.equal(p.시도, 1);
  assert.equal(p.총점, 62.5);
  assert.equal(p.합격여부, '합격');
  assert.deepEqual(p.과목별점수, { '소프트웨어 설계': 50, '소프트웨어 개발': 75 });
  assert.equal(p.문항들.length, 8);
  const q2 = p.문항들.find((q) => q.문번 === 2);
  assert.deepEqual(
    { 과목: q2.과목, 내답: q2.내답, 정답: q2.정답, 결과: q2.결과, 확신도: q2.확신도, 메모: q2.메모 },
    { 과목: '소프트웨어 설계', 내답: 1, 정답: 4, 결과: 'X', 확신도: '확신', 메모: '정규화' }
  );
  const q4 = p.문항들.find((q) => q.문번 === 4);
  assert.equal(q4.확신도, '찍음');
  assert.equal(q4.메모, '정렬알고리즘');
});

test('computeTrend: 시험별 시도 순 총점', () => {
  const idx = w.upsertIndex(
    w.upsertIndex('', w.buildIndexRow(model())),
    w.buildIndexRow(model({ 시도: 2, 풀이일: '2026-07-28' }))
  );
  const trend = r.computeTrend(r.parseIndex(idx));
  assert.ok(trend['2023-1-필기']);
  assert.deepEqual(trend['2023-1-필기'].map((t) => t.시도), [1, 2]);
  assert.equal(trend['2023-1-필기'][0].결과, '합격');
});

test('patchAttemptKeywords: 표 칸 + 오답 헤딩 갱신, 멱등', () => {
  const base = w.renderAttempt(model()); // 키워드 없음
  const map = { 2: '정규화', 4: '정렬알고리즘' };
  const once = r.patchAttemptKeywords(base, map);

  // 문항 표 마지막 칸 갱신
  assert.match(once, /\| 2 \| ① \| ④ \| X \| 확신 \| 정규화 \|/);
  assert.match(once, /\| 4 \| ③ \| ② \| X \| 찍음 \| 정렬알고리즘 \|/);
  // 오답 헤딩 갱신
  assert.match(once, /### #2 정규화/);
  assert.match(once, /### #4 정렬알고리즘/);
  // 대상 아닌 정답 문항(#1) 표 칸은 비어 있음
  assert.match(once, /\| 1 \| ③ \| ③ \| O \| 확신 \| {2}\|/);

  // 멱등: 같은 맵 재적용 시 동일
  const twice = r.patchAttemptKeywords(once, map);
  assert.equal(twice, once);
});

test('patchKeywordsFile: mtime 변화 감지 + 원자 커밋', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-reader-'));
  try {
    const p = path.join(dir, '2023-1-필기-1.md');
    w.atomicWrite(p, w.renderAttempt(model()));
    const before = fs.statSync(p).mtimeMs;

    const res = r.patchKeywordsFile(p, { 7: '트리순회' }, { expectedMtimeMs: before });
    assert.equal(res.mtimeChanged, false);
    assert.match(fs.readFileSync(p, 'utf8'), /### #7 트리순회/);

    // 외부에서 mtime이 바뀐 상황 시뮬레이션 → 감지 플래그, 그래도 멱등 적용
    const res2 = r.patchKeywordsFile(p, { 7: '트리순회' }, { expectedMtimeMs: before - 1000 });
    assert.equal(res2.mtimeChanged, true);
    assert.match(fs.readFileSync(p, 'utf8'), /### #7 트리순회/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listAttempts: attempts 디렉토리 요약(INDEX/WRONG 제외)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-list-'));
  try {
    w.writeAttemptBundle(dir, model());
    w.writeAttemptBundle(dir, model({ 시도: 2, 풀이일: '2026-07-28' }));
    const list = r.listAttempts(dir);
    assert.equal(list.length, 2, 'attempt 파일만(INDEX/WRONG 제외)');
    assert.deepEqual(list.map((a) => a.시도), [1, 2]);
    assert.equal(list[0].시험, '2023-1-필기');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
