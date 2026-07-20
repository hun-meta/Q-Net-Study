'use strict';

// 쓰기 경계(realpath·NFC)와 닉네임 검증 단위 테스트.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const security = require('../server/security');
const nickname = require('../server/nickname');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-sec-'));
}

test('assertWithinRoots: 경계 내부 경로는 허용', () => {
  const root = mkTmp();
  const target = path.join(root, 'hun', 'notes', 'a.md');
  const real = security.assertWithinRoots(target, [root]);
  assert.ok(real.startsWith(fs.realpathSync.native(root)));
});

test('assertWithinRoots: ../ 경로 탈출은 차단', () => {
  const root = mkTmp();
  const target = path.join(root, '..', '..', 'etc', 'passwd');
  assert.throws(
    () => security.assertWithinRoots(target, [root]),
    (err) => err.code === 'EWRITEBOUNDARY'
  );
});

test('assertWithinRoots: 다른 닉네임(경계 밖) 디렉토리는 차단', () => {
  const root = mkTmp();
  const allowed = path.join(root, 'hun');
  fs.mkdirSync(allowed, { recursive: true });
  const other = path.join(root, 'someone-else', 'notes', 'x.md');
  assert.throws(
    () => security.assertWithinRoots(other, [allowed]),
    (err) => err.code === 'EWRITEBOUNDARY'
  );
});

test('assertWithinRoots: 심볼릭 링크로 경계를 벗어나면 차단', () => {
  const root = mkTmp();
  const outside = mkTmp();
  const allowed = path.join(root, 'hun');
  fs.mkdirSync(allowed, { recursive: true });
  // hun/escape -> outside 로 심볼릭 링크
  const link = path.join(allowed, 'escape');
  fs.symlinkSync(outside, link);
  const target = path.join(link, 'evil.md');
  assert.throws(
    () => security.assertWithinRoots(target, [allowed]),
    (err) => err.code === 'EWRITEBOUNDARY'
  );
});

test('isWithin: 동일 경로와 하위 경로 판정', () => {
  assert.equal(security.isWithin('/a/b', '/a/b'), true);
  assert.equal(security.isWithin('/a/b/c', '/a/b'), true);
  assert.equal(security.isWithin('/a', '/a/b'), false);
  assert.equal(security.isWithin('/x', '/y'), false);
});

test('닉네임 검증: 정상값 통과 및 NFC 정규화', () => {
  assert.equal(nickname.validateNickname('hun'), 'hun');
  assert.equal(nickname.validateNickname('  홍길동  '), '홍길동');
});

test('timingSafeEqualStr: 상수시간 토큰 비교(값·길이 불일치 처리)', () => {
  // 동일 값 → true
  assert.equal(security.timingSafeEqualStr('abc123', 'abc123'), true);
  // 값 불일치 → false
  assert.equal(security.timingSafeEqualStr('abc123', 'abc124'), false);
  // 길이 불일치 → false (timingSafeEqual 예외 없이 처리)
  assert.equal(security.timingSafeEqualStr('abc', 'abcdef'), false);
  assert.equal(security.timingSafeEqualStr('abcdef', 'abc'), false);
  // null/undefined/빈 문자열 안전 처리
  assert.equal(security.timingSafeEqualStr(undefined, 'x'), false);
  assert.equal(security.timingSafeEqualStr(null, ''), true);
  assert.equal(security.timingSafeEqualStr('', ''), true);
  // 유니코드(멀티바이트) 동일/불일치
  assert.equal(security.timingSafeEqualStr('토큰', '토큰'), true);
  assert.equal(security.timingSafeEqualStr('토큰', '토크'), false);
});

test('writeGuard 미들웨어: 경계 밖 대상 → 403, 내부 → next()', () => {
  const root = mkTmp();
  const allowed = path.join(root, 'hun');
  fs.mkdirSync(allowed, { recursive: true });

  const guard = security.writeGuard(
    (req) => req.targetPath,
    () => [allowed]
  );

  // 경계 밖(다른 닉네임)
  let status = null;
  guard(
    { targetPath: path.join(root, 'other', 'x.md') },
    { status: (c) => ({ json: () => (status = c) }) },
    () => (status = 'next')
  );
  assert.equal(status, 403);

  // 경계 내부 → next 호출 + req.resolvedWritePath 설정
  const req = { targetPath: path.join(allowed, 'notes', 'a.md') };
  let nexted = false;
  guard(req, { status: () => ({ json: () => {} }) }, () => (nexted = true));
  assert.equal(nexted, true);
  assert.ok(req.resolvedWritePath);
});

test('닉네임 검증: 경로 구분자·공용명·점 시작 차단', () => {
  assert.throws(() => nickname.validateNickname('a/b'));
  assert.throws(() => nickname.validateNickname('a\\b'));
  assert.throws(() => nickname.validateNickname('_공통'));
  assert.throws(() => nickname.validateNickname('.hidden'));
  assert.throws(() => nickname.validateNickname('..'));
  assert.throws(() => nickname.validateNickname(''));
});
