'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { grade } = require('../server/grading');
const answerKey = require('../server/answerKey');
const w = require('../server/attemptWriter');

const 기준 = { 과목과락: 40, 평균합격: 60, 출처: '기본값' };

// 골든 픽스처와 동일한 model 구성
function goldenModel() {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', '정답', '2023-1-필기.md'), 'utf8');
  const key = answerKey.parse(fixture, { 시험ID: '2023-1-필기' });
  const 답안 = {
    1: { 답: 3 }, 2: { 답: 1 }, 3: { 답: 1 }, 4: { 답: 3, 찍음: true },
    5: { 답: 2 }, 6: { 답: 4, 찍음: true }, 7: { 답: 2 }, 8: { 답: 3 },
  };
  const g = grade({ 답안, answerKey: key, passCriteria: 기준 });
  return {
    자격증: '정보처리기사', 시험ID: '2023-1-필기', 시도: 1, 풀이일: '2026-07-21', 소요시간: 75,
    gradingResult: g,
    키워드맵: { 2: '정규화', 4: '정렬알고리즘', 6: '스택', 7: '트리순회' },
  };
}

test('renderAttempt: 골든 스냅샷과 정확히 일치 (템플릿 양식 준수)', () => {
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'attempt-golden.md'), 'utf8');
  assert.equal(w.renderAttempt(goldenModel()), golden);
});

test('renderAttempt: frontmatter 키·제목·과목 범위 형식', () => {
  const md = w.renderAttempt(goldenModel());
  assert.match(md, /^---\n자격증: 정보처리기사\n시험: 2023-1-필기\n시도: 1\n풀이일: 2026-07-21\n소요시간: 75\n총점: 62\.5\n과목별점수:\n {2}소프트웨어 설계: 50\n {2}소프트웨어 개발: 75\n합격여부: 합격\n---/);
  assert.match(md, /# 2023년 1회 필기 — 1차 시도/);
  assert.match(md, /### 소프트웨어 설계 \(1~4\)/);
  assert.match(md, /### 소프트웨어 개발 \(5~8\)/);
  // 오답·불확신 정리 블록 = WRONG 대상 4문항(2,4,6,7)
  const blocks = md.match(/^### #\d+/gm) || [];
  assert.equal(blocks.length, 4);
});

test('parse시험ID: CBT 상시 식별자도 3분할', () => {
  assert.deepEqual(w.parse시험ID('2024-0415상시-필기'), { 연도: '2024', 회차: '0415상시', 구분: '필기' });
  assert.deepEqual(w.parse시험ID('2023-1-필기'), { 연도: '2023', 회차: '1', 구분: '필기' });
});

test('upsertIndex: 신규 행 + 재시도 추이', () => {
  const m1 = goldenModel();
  let idx = w.upsertIndex('', w.buildIndexRow(m1));
  assert.match(idx, /# 풀이 이력/);
  assert.match(idx, /\| 2023-1-필기 \| 1 \| 2026-07-21 \| 62\.5 \| 50 \(소프트웨어 설계\) \| 합격 \| 3 \| 1 \| 67% \| \[링크\]\(2023-1-필기-1\.md\) \|/);

  // 2차 시도 추가
  const m2 = goldenModel();
  m2.시도 = 2;
  m2.풀이일 = '2026-07-28';
  m2.gradingResult.총점 = 80;
  idx = w.upsertIndex(idx, w.buildIndexRow(m2));
  const rows = idx.split('\n').filter((l) => l.startsWith('| 2023-1-필기'));
  assert.equal(rows.length, 2, '두 시도 행이 모두 존재');
  assert.match(idx, /- 2023-1-필기: 62\.5 → 80\.0/, '추이에 시도 순 총점');
});

test('upsertIndex: 같은 시험+시도는 교체(멱등)', () => {
  const m = goldenModel();
  const once = w.upsertIndex('', w.buildIndexRow(m));
  const twice = w.upsertIndex(once, w.buildIndexRow(m));
  const rows = twice.split('\n').filter((l) => l.startsWith('| 2023-1-필기'));
  assert.equal(rows.length, 1, '중복 행이 생기지 않는다');
});

test('upsertWrong: 과목별 우선순위 정렬(🔴 > ⛔ > 🟡)', () => {
  const wrong = w.upsertWrong('', w.buildWrongEntries(goldenModel()));
  const 설계 = wrong.split('## 소프트웨어 설계')[1].split('##')[0];
  const 순서 = (설계.match(/[🔴🟠⛔🟡⚪]/gu) || []);
  assert.deepEqual(순서, ['🔴', '⛔'], 'X+찍음(🔴)이 X+확신(⛔)보다 먼저');
  assert.match(wrong, /⛔ 2023-1-필기 #2 정규화.*확신하고 틀림/);
});

test('upsertWrong: 기존 졸업(취소선) 항목 보존 + 중복 방지', () => {
  const 기존 = [
    '# 오답·불확신 인덱스', '', '> 우선순위: 🔴 X+찍음 > 🟠 X+애매 > ⛔ X+확신(오개념!) > 🟡 O+찍음 > ⚪ O+애매',
    '> 복습(재풀이)에서 확신+정답 2회 연속이면 취소선 처리로 졸업.', '',
    '## 소프트웨어 설계', '',
    '- [x] ~~🔴 2023-1-필기 #4 정렬알고리즘~~ (졸업)',
    '',
  ].join('\n');
  const merged = w.upsertWrong(기존, w.buildWrongEntries(goldenModel()));
  // 졸업 라인 보존
  assert.match(merged, /~~🔴 2023-1-필기 #4 정렬알고리즘~~ \(졸업\)/);
  // #4는 이미(졸업으로) 존재 → 활성 라인으로 부활하지 않음
  const 활성4 = merged.split('\n').filter((l) => /\[ \].*#4 /.test(l));
  assert.equal(활성4.length, 0, '졸업된 #4가 활성으로 되살아나지 않는다');
  // #2는 신규로 추가됨
  assert.match(merged, /\[ \] ⛔ 2023-1-필기 #2 정규화/);
});

test('patchWrongKeywords: 활성 항목 키워드 갱신, 졸업/불일치 보존, 멱등', () => {
  const wrong = w.upsertWrong('', w.buildWrongEntries(goldenModel()));
  // #2(빈 키워드였다면)·#4 등에 키워드 세팅
  const once = w.patchWrongKeywords(wrong, '2023-1-필기', { 4: '병합정렬', 6: '스택자료구조' });
  assert.match(once, /🔴 2023-1-필기 #4 병합정렬 → \[기록\]/);
  assert.match(once, /🟡 2023-1-필기 #6 스택자료구조 → \[기록\]/);
  // ⛔ 접미(확신하고 틀림) 보존
  assert.match(once, /#2 정규화 → .*확신하고 틀림/);
  // 멱등
  assert.equal(w.patchWrongKeywords(once, '2023-1-필기', { 4: '병합정렬', 6: '스택자료구조' }), once);
  // 다른 시험ID는 건드리지 않음
  const other = w.patchWrongKeywords(once, '9999-9-필기', { 4: '엉뚱' });
  assert.equal(other, once);
});

test('atomicWrite + writeAttemptBundle: 3종 파일 생성', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-attempt-'));
  try {
    const paths = w.writeAttemptBundle(dir, goldenModel());
    assert.ok(fs.existsSync(paths.attempt));
    assert.ok(fs.existsSync(paths.index));
    assert.ok(fs.existsSync(paths.wrong));
    assert.equal(path.basename(paths.attempt), '2023-1-필기-1.md');
    const idx = fs.readFileSync(paths.index, 'utf8');
    assert.match(idx, /2023-1-필기 \| 1 /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
