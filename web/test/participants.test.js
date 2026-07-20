'use strict';

// 참여자 레지스트리(참여자.md) 파싱·upsert·remove·합집합 테스트.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const participants = require('../server/participants');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-part-'));
}

test('upsert: 신규 추가 후 파싱', () => {
  const root = tmpRoot();
  participants.upsert(root, 'hun', '2026-07-21');
  const rows = participants.parseRegistry(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nickname, 'hun');
  assert.equal(rows[0].registeredAt, '2026-07-21');
});

test('upsert: 중복은 등록일 유지(재추가 안 함)', () => {
  const root = tmpRoot();
  participants.upsert(root, 'hun', '2026-01-01');
  participants.upsert(root, 'hun'); // 날짜 없이 재호출 → 기존 유지
  const rows = participants.parseRegistry(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].registeredAt, '2026-01-01');
});

test('upsert: 여러 명 정렬 저장', () => {
  const root = tmpRoot();
  participants.upsert(root, 'jane', '2026-07-21');
  participants.upsert(root, 'hun', '2026-07-21');
  const names = participants.registryNicknames(root);
  assert.deepEqual(names, ['hun', 'jane']);
});

test('remove: 제거', () => {
  const root = tmpRoot();
  participants.upsert(root, 'hun', '2026-07-21');
  participants.upsert(root, 'jane', '2026-07-21');
  const removed = participants.remove(root, 'hun');
  assert.equal(removed, true);
  assert.deepEqual(participants.registryNicknames(root), ['jane']);
});

test('listAll: 레지스트리 ∪ 디렉토리 스캔 합집합', () => {
  const root = tmpRoot();
  // 레지스트리에만 있는 참여자
  participants.upsert(root, 'onlyRegistry', '2026-07-21');
  // 디렉토리에만 있는 참여자
  fs.mkdirSync(path.join(root, '정보처리', '정보처리기사', 'onlyDir'), { recursive: true });
  fs.mkdirSync(path.join(root, '정보처리', '정보처리기사', 'onlyRegistry'), { recursive: true });
  const all = participants.listAll(root);
  assert.ok(all.includes('onlyRegistry'));
  assert.ok(all.includes('onlyDir'));
  // 중복 제거
  assert.equal(all.filter((n) => n === 'onlyRegistry').length, 1);
});

test('parseRegistry: 파일 없으면 빈 배열', () => {
  const root = tmpRoot();
  assert.deepEqual(participants.parseRegistry(root), []);
});
