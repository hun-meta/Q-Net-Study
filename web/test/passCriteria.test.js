'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const passCriteria = require('../server/passCriteria');

test('grading 블록 파싱 — 출처 info.md', () => {
  const info = `# 정보처리기사\n\n<!-- grading: 과목과락: 40 / 평균합격: 60 -->\n\n본문`;
  const r = passCriteria.parse(info);
  assert.strictEqual(r.과목과락, 40);
  assert.strictEqual(r.평균합격, 60);
  assert.strictEqual(r.출처, 'info.md');
});

test('비표준 값도 블록에서 그대로 파싱', () => {
  const info = `<!-- grading: 과목과락: 35 / 평균합격: 70 -->`;
  const r = passCriteria.parse(info);
  assert.strictEqual(r.과목과락, 35);
  assert.strictEqual(r.평균합격, 70);
  assert.strictEqual(r.출처, 'info.md');
});

test('블록 부재 → 기본 40/60, 출처 기본값', () => {
  const r = passCriteria.parse('# info\n합격 기준 언급 없음');
  assert.strictEqual(r.과목과락, 40);
  assert.strictEqual(r.평균합격, 60);
  assert.strictEqual(r.출처, '기본값');
});

test('빈/비문자 입력 → 기본값', () => {
  assert.strictEqual(passCriteria.parse('').출처, '기본값');
  assert.strictEqual(passCriteria.parse(null).출처, '기본값');
  assert.strictEqual(passCriteria.parse(undefined).과목과락, 40);
});

test('공백 변형 허용', () => {
  const info = `<!--grading:과목과락:40/평균합격:60-->`;
  const r = passCriteria.parse(info);
  assert.strictEqual(r.출처, 'info.md');
  assert.strictEqual(r.평균합격, 60);
});
