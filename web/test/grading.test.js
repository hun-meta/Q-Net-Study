'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { grade } = require('../server/grading');
const answerKey = require('../server/answerKey');
const passCriteria = require('../server/passCriteria');

const 기본기준 = { 과목과락: 40, 평균합격: 60, 출처: '기본값' };

// 합성 answerKey 빌더: subjects=[{과목명, 정답들:[1..4]}] (문번 자동 순번)
function makeKey(subjects, extra) {
  let n = 1;
  const 과목들 = subjects.map((s) => {
    const 시작 = n;
    const 정답 = {};
    for (const a of s.정답들) 정답[n++] = a;
    return { 과목명: s.과목명, 시작, 끝: n - 1, 정답 };
  });
  return Object.assign(
    { 시험ID: 'T', 문항수: n - 1, 숨김페이지수: 1, 추출도구: 'test', 추출일: '2026-07-21', 과목들, 검증오류: [] },
    extra || {}
  );
}

// 전 문항 정답 제출 답안 생성
function allCorrect(key, overrides) {
  const 답안 = {};
  for (const s of key.과목들) for (let q = s.시작; q <= s.끝; q++) 답안[q] = { 답: s.정답[q], 찍음: false };
  return Object.assign(답안, overrides || {});
}

test('과목 정확도 100%면 총점 100·합격', () => {
  const key = makeKey([
    { 과목명: 'A', 정답들: [1, 2, 3, 4, 1] },
    { 과목명: 'B', 정답들: [2, 3, 4, 1, 2] },
  ]);
  const g = grade({ 답안: allCorrect(key), answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.총점, 100);
  assert.equal(g.합격여부, '합격');
  assert.equal(g.X수, 0);
  assert.equal(g.확신정답률, 100);
});

test('과락 경계: 과목 40점(정확히)은 과락 아님', () => {
  const key = makeKey([
    { 과목명: 'A', 정답들: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2] }, // 10문항
    { 과목명: 'B', 정답들: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2] },
  ]);
  const 답안 = allCorrect(key);
  // A과목 4문항만 정답(=40점), 나머지 6문항 오답
  for (let q = 5; q <= 10; q++) 답안[q] = { 답: 9, 찍음: false }; // 도메인 밖 → 오답 처리
  // B과목 8문항 정답(=80점)
  답안[19] = { 답: 9 }; 답안[20] = { 답: 9 };
  const g = grade({ 답안, answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.과목결과[0].점수, 40);
  assert.equal(g.과목결과[0].과락, false, '40점은 과락 아님(< 40만 과락)');
  assert.equal(g.총점, 60);
  assert.equal(g.과락발생, false);
  assert.equal(g.합격여부, '합격');
});

test('과락 경계: 과목 30점(<40)은 과락, 합격여부=과락', () => {
  const key = makeKey([
    { 과목명: 'A', 정답들: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2] },
    { 과목명: 'B', 정답들: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2] },
  ]);
  const 답안 = allCorrect(key);
  for (let q = 4; q <= 10; q++) 답안[q] = { 답: 9 }; // A 3문항 정답 = 30점
  const g = grade({ 답안, answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.과목결과[0].점수, 30);
  assert.equal(g.과목결과[0].과락, true);
  assert.equal(g.과락발생, true);
  assert.equal(g.합격여부, '과락', '과락은 평균과 무관하게 합격여부를 과락으로');
});

test('평균 경계: 과락 없이 평균 55는 불합격, 60은 합격', () => {
  const mk = () =>
    makeKey([
      { 과목명: 'A', 정답들: Array(10).fill(1) },
      { 과목명: 'B', 정답들: Array(10).fill(1) },
    ]);
  // 불합격: A 40, B 70 → 평균 55
  let key = mk();
  let 답안 = allCorrect(key);
  for (let q = 5; q <= 10; q++) 답안[q] = { 답: 9 }; // A 4정답=40
  for (let q = 18; q <= 20; q++) 답안[q] = { 답: 9 }; // B 7정답=70
  let g = grade({ 답안, answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.총점, 55);
  assert.equal(g.과락발생, false);
  assert.equal(g.합격여부, '불합격');

  // 합격: A 40, B 80 → 평균 60 (경계 포함)
  key = mk();
  답안 = allCorrect(key);
  for (let q = 5; q <= 10; q++) 답안[q] = { 답: 9 }; // A 40
  for (let q = 19; q <= 20; q++) 답안[q] = { 답: 9 }; // B 80
  g = grade({ 답안, answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.총점, 60);
  assert.equal(g.합격여부, '합격', '평균 60은 합격(>= 경계)');
});

test('과락 판정은 표시(반올림) 점수 기준 — raw는 미달이나 표시상 기준값이면 통과', () => {
  // 3문항 중 2정답 → raw 66.666…%, 표시 66.7. 과락 기준 66.7이면 표시 기준으로 과락 아님.
  const key = makeKey([
    { 과목명: 'A', 정답들: [1, 2, 3] },
    { 과목명: 'B', 정답들: [1, 2, 3] },
  ]);
  const 답안 = allCorrect(key);
  답안[3] = { 답: 9 }; // A 2/3 정답 → 66.666…%
  const g = grade({ 답안, answerKey: key, passCriteria: { 과목과락: 66.7, 평균합격: 60, 출처: 'info.md' } });
  assert.equal(g.과목결과[0].점수, 66.7, '표시 점수는 반올림값');
  assert.equal(g.과목결과[0].과락, false, 'raw 66.66<66.7 이지만 표시 66.7 == 기준이므로 과락 아님');
});

test('확신정답률: 찍음 문항은 분모에서 제외', () => {
  const key = makeKey([{ 과목명: 'A', 정답들: [1, 2, 3, 4] }]);
  const 답안 = {
    1: { 답: 1, 찍음: true }, // 정답+찍음 → O+찍음, 확신 분모 제외
    2: { 답: 2, 찍음: false }, // 정답 확신
    3: { 답: 9, 찍음: false }, // 오답 확신
    4: { 답: 4, 찍음: false }, // 정답 확신
  };
  const g = grade({ 답안, answerKey: key, passCriteria: 기본기준 });
  assert.equal(g.확신문항수, 3);
  assert.equal(g.확신정답수, 2);
  assert.equal(g.확신정답률, 67, 'round(2/3*100)=67');
  assert.equal(g.O찍음수, 1);
  assert.equal(g.X수, 1);
});

test('무응답(null)은 오답 처리되고 확신 문항으로 계산', () => {
  const key = makeKey([{ 과목명: 'A', 정답들: [1, 2] }]);
  const g = grade({ 답안: { 1: { 답: null, 찍음: false } }, answerKey: key, passCriteria: 기본기준 });
  const q1 = g.문항결과.find((q) => q.문번 === 1);
  assert.equal(q1.결과, 'X');
  assert.equal(q1.확신도, '확신');
});

test('검증오류가 있는 정답 데이터는 채점 불가(throw)', () => {
  const key = makeKey([{ 과목명: 'A', 정답들: [1, 2] }], { 검증오류: ['정답 행 수 불일치'] });
  assert.throws(() => grade({ 답안: {}, answerKey: key, passCriteria: 기본기준 }), /채점 불가/);
});

test('빈 정답 데이터는 채점 불가(throw)', () => {
  assert.throws(() => grade({ 답안: {}, answerKey: { 과목들: [] }, passCriteria: 기본기준 }), /채점 불가/);
});

test('실제 answerKey/passCriteria 파서 출력과 통합 채점', () => {
  const fixture = fs.readFileSync(
    path.join(__dirname, 'fixtures', '정답', '2023-1-필기.md'),
    'utf8'
  );
  const key = answerKey.parse(fixture, { 시험ID: '2023-1-필기' });
  assert.deepEqual(key.검증오류, [], '픽스처 정답은 검증 통과해야 한다');
  const pc = passCriteria.parse(''); // info.md 부재 → 기본 40/60
  assert.equal(pc.출처, '기본값');

  // 8문항 중 과목1(1-4) 전부 정답, 과목2(5-8) 전부 오답
  const 답안 = {
    1: { 답: 3 }, 2: { 답: 4 }, 3: { 답: 1 }, 4: { 답: 2 },
    5: { 답: 9 }, 6: { 답: 9 }, 7: { 답: 9 }, 8: { 답: 9 },
  };
  const g = grade({ 답안, answerKey: key, passCriteria: pc });
  assert.equal(g.과목결과[0].점수, 100);
  assert.equal(g.과목결과[1].점수, 0);
  assert.equal(g.과목결과[1].과락, true);
  assert.equal(g.합격여부, '과락');
  assert.equal(g.시험ID, '2023-1-필기');
  assert.equal(g.최저과목.과목명, '소프트웨어 개발');
  assert.equal(g.최저과목.점수, 0);
});
