'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const examIndex = require('../server/examIndex');

const oldMd = fs.readFileSync(path.join(__dirname, 'fixtures', 'INDEX-old.md'), 'utf8');
const newMd = fs.readFileSync(path.join(__dirname, 'fixtures', 'INDEX-new.md'), 'utf8');

test('신 9칼럼 파싱 — 계약 shape', () => {
  const rows = examIndex.parse(newMd);
  assert.strictEqual(rows.length, 2);
  const r = rows[0];
  assert.strictEqual(r.파일명, '2023-1-필기.pdf');
  assert.strictEqual(r.연도, 2023);
  assert.strictEqual(r.식별자, '1');
  assert.strictEqual(r.구분, '필기');
  assert.strictEqual(r.문항수, 100);
  assert.strictEqual(r.정답포함, true);
  assert.strictEqual(r.숨김페이지수, 2);
  assert.strictEqual(r.등록자, 'hun');
  assert.strictEqual(r.비고, '해설 포함');
});

test('CBT 상시 식별자·정답포함 X·숨김0 파싱', () => {
  const rows = examIndex.parse(newMd);
  const cbt = rows.find((r) => r.식별자 === '0415상시');
  assert.ok(cbt);
  assert.strictEqual(cbt.연도, 2024);
  assert.strictEqual(cbt.정답포함, false);
  assert.strictEqual(cbt.숨김페이지수, 0);
});

test('구 8칼럼 하위호환 — 숨김페이지수 기본 1', () => {
  const rows = examIndex.parse(oldMd);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.숨김페이지수 === 1));
  assert.strictEqual(rows[0].정답포함, true);
  assert.strictEqual(rows[1].정답포함, false);
});

test('빈/표없는 입력 → 빈 배열', () => {
  assert.deepStrictEqual(examIndex.parse(''), []);
  assert.deepStrictEqual(examIndex.parse('# 제목\n\n본문뿐'), []);
});

test('시험ID 유도', () => {
  const rows = examIndex.parse(newMd);
  assert.strictEqual(examIndex.시험ID(rows[0]), '2023-1-필기');
});

test('upsert — 신규 행 추가 후 재파싱 라운드트립', () => {
  const 갱신 = examIndex.upsert(newMd, {
    파일명: '2025-2-필기.pdf',
    연도: 2025,
    회차: 2,
    구분: '필기',
    문항수: 80,
    정답포함: true,
    숨김페이지수: 3,
    등록자: 'hun',
    비고: '',
  });
  const rows = examIndex.parse(갱신);
  assert.strictEqual(rows.length, 3);
  const added = rows.find((r) => r.식별자 === '2');
  assert.strictEqual(added.연도, 2025);
  assert.strictEqual(added.숨김페이지수, 3);
  // 연도 내림차순 정렬 확인
  assert.strictEqual(rows[0].연도, 2025);
});

test('upsert — 동일 시험ID 갱신(중복 행 안 생김)', () => {
  const 갱신 = examIndex.upsert(newMd, {
    파일명: '2023-1-필기.pdf',
    연도: 2023,
    식별자: '1',
    구분: '필기',
    문항수: 100,
    정답포함: true,
    숨김페이지수: 5,
    등록자: 'hun',
    비고: '재추출',
  });
  const rows = examIndex.parse(갱신);
  assert.strictEqual(rows.length, 2);
  const 대상 = rows.find((r) => examIndex.시험ID(r) === '2023-1-필기');
  assert.strictEqual(대상.숨김페이지수, 5);
  assert.strictEqual(대상.비고, '재추출');
});

test('upsert — 빈 콘텐츠에서 새 인덱스 생성', () => {
  const 만듦 = examIndex.upsert('', {
    파일명: '2021-1-필기.pdf',
    연도: 2021,
    식별자: '1',
    구분: '필기',
    문항수: 100,
    정답포함: false,
    등록자: 'hun',
  });
  const rows = examIndex.parse(만듦);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].숨김페이지수, 1);
});

test('upsert — 표 외 제목·설명 보존', () => {
  const 갱신 = examIndex.upsert(newMd, {
    파일명: '2025-1-필기.pdf',
    연도: 2025,
    식별자: '1',
    구분: '필기',
    문항수: 100,
    정답포함: true,
    등록자: 'hun',
  });
  assert.ok(갱신.includes('# 기출문제 인덱스'));
});
