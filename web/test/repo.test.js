'use strict';

// 저장소 스캔: 분야(종류) 블록리스트 기반 스캔·참여자 목록·_공통 인식 테스트.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repo = require('../server/repo');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-repo-'));
  // 임의 분야명(화이트리스트 없음) — 종류 = 분야
  fs.mkdirSync(path.join(root, '정보처리', '정보처리기사', '_공통'), { recursive: true });
  fs.mkdirSync(path.join(root, '정보처리', '정보처리기사', 'hun'), { recursive: true });
  fs.mkdirSync(path.join(root, '정보처리', '정보처리기사', 'jane'), { recursive: true });
  fs.mkdirSync(path.join(root, '전기', '전기기능사', 'kim'), { recursive: true });
  // 블록리스트 루트 → 무시되어야 함
  fs.mkdirSync(path.join(root, 'web', 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'x'), { recursive: true });
  fs.mkdirSync(path.join(root, 'templates', 'y'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'z'), { recursive: true });
  // '_'/'.' 시작 루트 → 무시
  fs.mkdirSync(path.join(root, '_비공개', '어떤자격', 'me'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden', 'x'), { recursive: true });
  return root;
}

test('scanRepo: 블록리스트를 제외한 모든 루트 디렉토리를 분야로 스캔', () => {
  const root = fixture();
  const certs = repo.scanRepo(root);

  const info = certs.find((c) => c.cert === '정보처리기사');
  assert.ok(info);
  assert.equal(info.grade, '정보처리'); // grade 필드명 유지, 의미=분야
  assert.deepEqual([...info.participants].sort(), ['hun', 'jane']);
  assert.equal(info.hasCommon, true);

  const elec = certs.find((c) => c.cert === '전기기능사');
  assert.ok(elec);
  assert.equal(elec.grade, '전기');
  assert.deepEqual(elec.participants, ['kim']);
  assert.equal(elec.hasCommon, false);

  // 블록리스트/숨김/'_' 루트는 결과에 없음
  assert.equal(certs.find((c) => c.grade === 'web'), undefined);
  assert.equal(certs.find((c) => c.grade === 'docs'), undefined);
  assert.equal(certs.find((c) => c.grade === 'templates'), undefined);
  assert.equal(certs.find((c) => c.grade === 'node_modules'), undefined);
  assert.equal(certs.find((c) => c.grade === '_비공개'), undefined);
  assert.equal(certs.find((c) => c.grade === '.hidden'), undefined);
});

test('scanRepo: 임의 분야명도 인정(화이트리스트 없음)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-any-'));
  fs.mkdirSync(path.join(root, '조리', '한식조리기능사', 'chef'), { recursive: true });
  const certs = repo.scanRepo(root);
  const c = certs.find((x) => x.cert === '한식조리기능사');
  assert.ok(c);
  assert.equal(c.grade, '조리');
});

test('scanParticipants: 전체 참여자 합집합(중복 제거)', () => {
  const root = fixture();
  assert.deepEqual(repo.scanParticipants(root), ['hun', 'jane', 'kim']);
});

test('isFieldDir: 블록리스트·접두사 판정', () => {
  assert.equal(repo.isFieldDir('정보처리'), true);
  assert.equal(repo.isFieldDir('web'), false);
  assert.equal(repo.isFieldDir('docs'), false);
  assert.equal(repo.isFieldDir('templates'), false);
  assert.equal(repo.isFieldDir('node_modules'), false);
  assert.equal(repo.isFieldDir('_공통'), false);
  assert.equal(repo.isFieldDir('.git'), false);
});

test('scanRepo: 빈 저장소는 빈 배열', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-empty-'));
  assert.deepEqual(repo.scanRepo(root), []);
});
