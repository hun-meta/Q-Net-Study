'use strict';

// 관리 API 통합 테스트: 닉네임 삭제(경계·confirm·usage) + 자격증 생성.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const app = require('../server/app');
const { createApp } = app;
const { createSseHub } = require('../server/sse');
const participants = require('../server/participants');

const TOKEN = 'admin-token-xyz';

function request(port, { method = 'GET', reqPath = '/', headers = {}, body } = {}) {
  const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const finalHeaders = { ...headers };
  if (payload !== null) {
    // Content-Length 명시(브라우저 fetch와 동일) — DELETE 본문이 청크 전송으로 누락되는 것 방지.
    finalHeaders['Content-Type'] = 'application/json';
    finalHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers: finalHeaders },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function startServer() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-admin-'));
  const hub = createSseHub();
  const server = createApp({
    token: TOKEN,
    cli: { chat: false, record: false },
    repoRoot,
    hub,
    config: { cliChat: 'agy', cliRecord: 'claude', nickname: null },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port, repoRoot };
}

function auth(extra = {}) {
  return { 'X-QNet-Token': TOKEN, ...extra };
}

test('GET /api/nickname/:name/usage: 삭제될 디렉토리·파일 수 미리보기', async (t) => {
  const { server, port, repoRoot } = await startServer();
  t.after(() => server.close());
  fs.mkdirSync(path.join(repoRoot, '정보처리', '정보처리기사', 'hun'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '정보처리', '정보처리기사', 'hun', 'a.md'), 'a');
  fs.writeFileSync(path.join(repoRoot, '정보처리', '정보처리기사', 'hun', 'b.md'), 'b');
  fs.mkdirSync(path.join(repoRoot, '.qnet-web', 'drafts', 'hun'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.qnet-web', 'drafts', 'hun', 'x.json'), '{}');

  const res = await request(port, { reqPath: '/api/nickname/hun/usage' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.nickname, 'hun');
  assert.equal(data.totalFiles, 3);
  assert.equal(data.directories.length, 2);
});

test('DELETE /api/nickname: confirm 불일치 → 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/nickname',
    headers: auth(),
    body: { nickname: 'hun', confirm: '틀림' },
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/nickname: 대상 닉네임 디렉토리만 삭제(_공통·타 참여자 보존)', async (t) => {
  const { server, port, repoRoot } = await startServer();
  t.after(() => server.close());
  const base = path.join(repoRoot, '정보처리', '정보처리기사');
  fs.mkdirSync(path.join(base, '_공통', '기출문제'), { recursive: true });
  fs.mkdirSync(path.join(base, 'hun'), { recursive: true });
  fs.writeFileSync(path.join(base, 'hun', 'note.md'), 'n');
  fs.mkdirSync(path.join(base, 'jane'), { recursive: true });
  participants.upsert(repoRoot, 'hun', '2026-07-21');

  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/nickname',
    headers: auth(),
    body: { nickname: 'hun', confirm: 'hun' },
  });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.nickname, 'hun');
  assert.ok(data.deleted.length >= 1);

  // hun 디렉토리 삭제됨, _공통·jane 보존
  assert.equal(fs.existsSync(path.join(base, 'hun')), false);
  assert.equal(fs.existsSync(path.join(base, '_공통')), true);
  assert.equal(fs.existsSync(path.join(base, 'jane')), true);
  // 레지스트리에서 제거
  assert.equal(participants.registryNicknames(repoRoot).includes('hun'), false);
});

test('DELETE /api/nickname: 닉네임 누락 → 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'DELETE',
    reqPath: '/api/nickname',
    headers: auth(),
    body: { confirm: '' },
  });
  assert.equal(res.status, 400);
});

test('deleteParticipant: 드래프트 심볼릭 링크가 경계 밖이면 차단(외부 보존)', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-bnd-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-out-'));
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'x');
  const draftsParent = path.join(repoRoot, '.qnet-web', 'drafts');
  fs.mkdirSync(draftsParent, { recursive: true });
  fs.symlinkSync(outside, path.join(draftsParent, 'evil'));

  assert.throws(
    () => app.deleteParticipant(repoRoot, 'evil'),
    (err) => err.code === 'EWRITEBOUNDARY'
  );
  // 경계 밖 외부 파일은 보존됨
  assert.equal(fs.existsSync(path.join(outside, 'keep.txt')), true);
});

test('POST /api/certs: 자격증 골격 생성 → 201 + 스켈레톤 파일', async (t) => {
  const { server, port, repoRoot } = await startServer();
  t.after(() => server.close());
  const res = await request(port, {
    method: 'POST',
    reqPath: '/api/certs',
    headers: auth(),
    body: { 종류: '조리', 자격증: '한식조리기능사' },
  });
  assert.equal(res.status, 201);
  const common = path.join(repoRoot, '조리', '한식조리기능사', '_공통');
  assert.ok(fs.existsSync(path.join(common, '기출문제', 'INDEX.md')));
  assert.ok(fs.existsSync(path.join(common, '출제기준', '.gitkeep')));
  assert.ok(fs.existsSync(path.join(common, 'info.md')));
  // INDEX 9칼럼 헤더 + info grading 블록 확인
  const index = fs.readFileSync(path.join(common, '기출문제', 'INDEX.md'), 'utf8');
  assert.ok(index.includes('| 파일명 | 연도 | 회차 | 구분 | 문항수 | 정답포함 | 숨김페이지수 | 등록자 | 비고 |'));
  const info = fs.readFileSync(path.join(common, 'info.md'), 'utf8');
  assert.ok(info.includes('<!-- grading: 과목과락: 40 / 평균합격: 60 -->'));
  assert.ok(info.includes('| 종류(분야) | 조리 |'));
});

test('POST /api/certs: 중복 → 409', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const body = { 종류: '조리', 자격증: '한식조리기능사' };
  const first = await request(port, { method: 'POST', reqPath: '/api/certs', headers: auth(), body });
  assert.equal(first.status, 201);
  const dup = await request(port, { method: 'POST', reqPath: '/api/certs', headers: auth(), body });
  assert.equal(dup.status, 409);
});

test('POST /api/certs: 이름 검증(블록리스트 종류·잘못된 문자·접두사) → 400', async (t) => {
  const { server, port } = await startServer();
  t.after(() => server.close());
  const bad = [
    { 종류: 'web', 자격증: 'x' }, // 블록리스트 종류
    { 종류: '조리', 자격증: '_숨김' }, // '_' 시작
    { 종류: '조리', 자격증: 'a/b' }, // 경로 구분자
    { 종류: '.hidden', 자격증: 'x' }, // '.' 시작
    { 종류: '', 자격증: 'x' }, // 빈 종류
  ];
  for (const body of bad) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(port, { method: 'POST', reqPath: '/api/certs', headers: auth(), body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} → 400 기대`);
  }
});
