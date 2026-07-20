'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const answerKey = require('../server/answerKey');

const fixture정답 = fs.readFileSync(
  path.join(__dirname, 'fixtures', '정답', '2023-1-필기.md'),
  'utf8'
);

test('정상 정답 md 파싱 — 계약 shape 반환', () => {
  const r = answerKey.parse(fixture정답, { 시험ID: '2023-1-필기' });
  assert.strictEqual(r.시험ID, '2023-1-필기');
  assert.strictEqual(r.문항수, 8);
  assert.strictEqual(r.숨김페이지수, 1);
  assert.strictEqual(r.추출도구, 'claude');
  assert.strictEqual(r.추출일, '2026-07-21');
  assert.strictEqual(r.과목들.length, 2);
  assert.deepStrictEqual(r.검증오류, []);
});

test('과목 범위·정답 매핑 정확', () => {
  const r = answerKey.parse(fixture정답);
  const [s1, s2] = r.과목들;
  assert.strictEqual(s1.과목명, '소프트웨어 설계');
  assert.strictEqual(s1.시작, 1);
  assert.strictEqual(s1.끝, 4);
  assert.deepStrictEqual(s1.정답, { 1: 3, 2: 4, 3: 1, 4: 2 });
  assert.strictEqual(s2.과목명, '소프트웨어 개발');
  assert.deepStrictEqual(s2.정답, { 5: 2, 6: 4, 7: 1, 8: 3 });
});

test('①~④ 와 1~4 모두 숫자 1~4로 정규화', () => {
  assert.strictEqual(answerKey.정답정규화('①'), 1);
  assert.strictEqual(answerKey.정답정규화('④'), 4);
  assert.strictEqual(answerKey.정답정규화('2'), 2);
  assert.strictEqual(answerKey.정답정규화('⑤'), null);
  assert.strictEqual(answerKey.정답정규화('x'), null);
});

test('시험ID 미지정 시 frontmatter 시험 필드 사용', () => {
  const md = `---\n시험: 2020-2-필기\n문항수: 1\n---\n\n## 과목 (1-1)\n\n| 문번 | 정답 |\n|---|---|\n| 1 | ① |\n`;
  const r = answerKey.parse(md);
  assert.strictEqual(r.시험ID, '2020-2-필기');
});

test('문항수 불일치 → 검증오류(throw 안 함)', () => {
  const md = `---\n문항수: 10\n---\n\n## 과목 (1-2)\n\n| 문번 | 정답 |\n|---|---|\n| 1 | ① |\n| 2 | ② |\n`;
  const r = answerKey.parse(md);
  assert.ok(r.검증오류.length > 0);
  assert.ok(r.검증오류.some((e) => /과목 범위 합/.test(e)));
  assert.ok(r.검증오류.some((e) => /정답 행 수/.test(e)));
});

test('정답 도메인 위반 → 검증오류', () => {
  const md = `---\n문항수: 2\n---\n\n## 과목 (1-2)\n\n| 문번 | 정답 |\n|---|---|\n| 1 | ⑤ |\n| 2 | ② |\n`;
  const r = answerKey.parse(md);
  assert.ok(r.검증오류.some((e) => /도메인/.test(e)));
  assert.strictEqual(r.과목들[0].정답[1], null);
});

test('문번 중복 → 검증오류', () => {
  const md = `---\n문항수: 2\n---\n\n## 과목 (1-2)\n\n| 문번 | 정답 |\n|---|---|\n| 1 | ① |\n| 1 | ② |\n`;
  const r = answerKey.parse(md);
  assert.ok(r.검증오류.some((e) => /중복/.test(e)));
});

test('총페이지 주어지면 숨김페이지수 범위 검증', () => {
  const 정상 = answerKey.parse(fixture정답, { 총페이지: 5 });
  assert.ok(!정상.검증오류.some((e) => /숨김페이지수/.test(e)));
  const 위반 = answerKey.parse(fixture정답, { 총페이지: 1 });
  assert.ok(위반.검증오류.some((e) => /숨김페이지수/.test(e)));
});

test('빈/비정상 입력 — throw 없이 검증오류 반환', () => {
  const r = answerKey.parse('');
  assert.ok(Array.isArray(r.검증오류));
  assert.ok(r.검증오류.length > 0);
  assert.deepStrictEqual(r.과목들, []);
});
