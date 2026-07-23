'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const draftStore = require('../server/draftStore');

let base;

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-draft-'));
});
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

test('write → read 라운드트립 + examId·updatedAt 스탬프', () => {
  const saved = draftStore.writeDraft('hun', '2023-1-필기', { answers: { 1: 3 } }, base);
  assert.strictEqual(saved.examId, '2023-1-필기');
  assert.ok(saved.updatedAt);
  const read = draftStore.readDraft('hun', '2023-1-필기', base);
  assert.deepStrictEqual(read.answers, { 1: 3 });
  assert.strictEqual(read.examId, '2023-1-필기');
});

test('정답열람 필드 라운드트립(화이트리스트 없음 — 임의 객체 키 보존)', () => {
  draftStore.writeDraft('hun', '2023-2-필기', { answers: { 1: 2 }, 찍음: { 1: true }, 정답열람: { 1: true, 3: true } }, base);
  const read = draftStore.readDraft('hun', '2023-2-필기', base);
  assert.deepStrictEqual(read.정답열람, { 1: true, 3: true });
  assert.deepStrictEqual(read.찍음, { 1: true });
});

test('없는 드래프트 → null', () => {
  assert.strictEqual(draftStore.readDraft('hun', '2099-9-필기', base), null);
});

test('손상 JSON → null', () => {
  const p = draftStore.draftPath('hun', '2022-2-필기', base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ 깨진 json');
  assert.strictEqual(draftStore.readDraft('hun', '2022-2-필기', base), null);
});

test('객체 아닌 본문 거부', () => {
  assert.throws(() => draftStore.writeDraft('hun', '2023-1-필기', null, base), /객체/);
  assert.throws(() => draftStore.writeDraft('hun', '2023-1-필기', [1, 2], base), /객체/);
});

test('경로 탈출 차단 — 닉네임·examId', () => {
  assert.throws(() => draftStore.writeDraft('../evil', '2023-1-필기', {}, base), /닉네임/);
  assert.throws(() => draftStore.writeDraft('hun/sub', '2023-1-필기', {}, base), /닉네임/);
  assert.throws(() => draftStore.writeDraft('hun', '../../etc/passwd', {}, base), /시험 id/);
  assert.throws(() => draftStore.writeDraft('hun', '2023-1-객관식', {}, base), /시험 id/);
});

test('delete — 있으면 true, 없으면 false', () => {
  draftStore.writeDraft('hun', '2021-1-실기', { a: 1 }, base);
  assert.strictEqual(draftStore.deleteDraft('hun', '2021-1-실기', base), true);
  assert.strictEqual(draftStore.deleteDraft('hun', '2021-1-실기', base), false);
});

test('CBT 상시 식별자 허용', () => {
  const saved = draftStore.writeDraft('hun', '2024-0415상시-필기', { answers: {} }, base);
  assert.strictEqual(saved.examId, '2024-0415상시-필기');
});
