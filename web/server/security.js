'use strict';

// 보안 모델 (계획 v5 "보안 모델" 절 그대로):
// - 127.0.0.1 전용 바인딩 (index.js에서 바인딩).
// - Host 헤더 화이트리스트: 127.0.0.1:{port}/localhost:{port} 만 허용 (DNS 리바인딩 차단).
// - Origin 존재 시 화이트리스트 검증.
// - 상태 변경/CLI 트리거 요청은 커스텀 헤더 X-QNet-Token 필수 (드라이브바이 CSRF 차단).
// - 허용적 CORS 헤더(Access-Control-Allow-Origin)를 절대 내보내지 않음.
// - 서버 쓰기 경계: realpath + NFC 정규화 기반 경계 검증(강제).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 상수시간 문자열 비교: 타이밍 사이드채널로 토큰을 점진 추정하는 공격을 차단한다.
// 길이가 다르면 timingSafeEqual이 예외를 던지므로, 먼저 동일 길이 버퍼로 비교해
// 실제 값 비교를 항상 수행한 뒤 길이 일치 여부를 AND 로 결합한다(조기 반환 없음).
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bufB = Buffer.from(String(b == null ? '' : b), 'utf8');
  // 길이가 달라도 동일 길이 버퍼끼리 비교해 조기 분기를 없앤다.
  const len = Math.max(bufA.length, bufB.length, 1);
  const normA = Buffer.alloc(len);
  const normB = Buffer.alloc(len);
  bufA.copy(normA);
  bufB.copy(normB);
  const equalContent = crypto.timingSafeEqual(normA, normB);
  return equalContent && bufA.length === bufB.length;
}

// 실제 연결이 도착한 로컬 포트를 기준으로 검증한다.
// 설정 포트와 결합하지 않아 포트 폴백/테스트(임의 포트)에서도 견고하다.
function localPortOf(req) {
  return req.socket && req.socket.localPort;
}

// Host 헤더 가드: hostname은 127.0.0.1/localhost, port는 실제 바인딩 포트와 일치해야 함.
function hostGuard(req, res, next) {
  const host = req.headers.host || '';
  const port = localPortOf(req);
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(host)) {
    return res.status(403).json({ error: '잘못된 Host 헤더 — 로컬 접속만 허용됩니다.' });
  }
  return next();
}

// Origin 가드: Origin 헤더가 존재하면 로컬 화이트리스트여야 함(없으면 통과 — 같은 출처 GET).
function originGuard(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    const port = localPortOf(req);
    const allowed = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]);
    if (!allowed.has(origin)) {
      return res.status(403).json({ error: '허용되지 않은 Origin 입니다.' });
    }
  }
  return next();
}

// X-QNet-Token 가드: 안전하지 않은 메서드(POST/PUT/PATCH/DELETE)에 토큰 필수.
// 상태 변경 + CLI 트리거 API가 모두 비-GET 이므로 메서드 기준으로 커버된다.
function tokenGuard(token) {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
  return function tokenMiddleware(req, res, next) {
    if (SAFE.has(req.method)) return next();
    if (!timingSafeEqualStr(req.headers['x-qnet-token'], token)) {
      return res.status(403).json({ error: '유효한 X-QNet-Token 이 필요합니다.' });
    }
    return next();
  };
}

// 세 가드를 순서대로 적용하는 헬퍼(전역 미들웨어로 장착).
function applySecurity(app, token) {
  app.use(hostGuard);
  app.use(originGuard);
  app.use(tokenGuard(token));
}

// --- 서버 쓰기 경계 ---------------------------------------------------------

// 존재하지 않는 대상 경로도 처리: 존재하는 최상위 조상을 realpath로 해석한 뒤
// 나머지 미존재 구간을 이어 붙인다(심볼릭 링크 탈출 차단).
function resolveRealPath(target) {
  const resolved = path.resolve(String(target).normalize('NFC'));
  let existing = resolved;
  const tail = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // 루트 도달
    existing = parent;
  }
  const realExisting = fs.realpathSync.native(existing);
  return tail.length ? path.join(realExisting, ...tail) : realExisting;
}

// child가 parent 내부(또는 동일)인지 판정.
function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// targetPath가 allowedRoots 중 하나의 내부에 있으면 해석된 실제 경로를 반환,
// 아니면 EWRITEBOUNDARY 예외를 던진다. NFC 정규화 + realpath 로 우회 차단.
function assertWithinRoots(targetPath, allowedRoots) {
  const real = resolveRealPath(targetPath);
  for (const root of allowedRoots) {
    const realRoot = fs.realpathSync.native(path.resolve(String(root).normalize('NFC')));
    if (isWithin(real, realRoot)) return real;
  }
  const err = new Error('허용되지 않은 경로입니다 — 쓰기 경계 밖입니다.');
  err.code = 'EWRITEBOUNDARY';
  throw err;
}

// 쓰기 가드 미들웨어 팩토리: 서버 쓰기 라우트에서 대상 경로가 허용 경계 내부인지
// 강제 검증한다. resolveTarget(req)=쓰려는 절대경로, resolveRoots(req)=허용 루트 배열.
// 경계 밖이면 403, 그 외 오류는 400. 통과 시 req.resolvedWritePath 에 실제 경로 저장.
function writeGuard(resolveTarget, resolveRoots) {
  return function writeGuardMiddleware(req, res, next) {
    try {
      const target = resolveTarget(req);
      const roots = resolveRoots(req);
      req.resolvedWritePath = assertWithinRoots(target, roots);
      return next();
    } catch (err) {
      if (err.code === 'EWRITEBOUNDARY') {
        return res.status(403).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
  };
}

module.exports = {
  timingSafeEqualStr,
  hostGuard,
  originGuard,
  tokenGuard,
  applySecurity,
  resolveRealPath,
  isWithin,
  assertWithinRoots,
  writeGuard,
};
