'use strict';

// HTTP 통합 테스트: GET /api/concept/:examId/:qno (app.js 자동 마운트).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/app');
const { createSseHub } = require('../server/sse');
const concept = require('../server/conceptRoutes');

const TOKEN = 'test-token-concept';

function request(port, { method = 'GET', reqPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      // 한글 등 비ASCII 경로를 인코딩(이미 %XX로 인코딩된 부분은 유지).
      { host: '127.0.0.1', port, method, path: encodeURI(reqPath), headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function seedRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-concept-'));
  const write = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  // 노트(🔁 태그) — 내(hun) + 타인(sora)
  write(
    path.join('기사', '정보처리기사', 'hun', 'notes', '소프트웨어설계', '01-요구사항확인.md'),
    '## 요구사항 분석\n요구공학 개념 정리.\n### 기출 연계\n- 🔁 기출 2023-1-필기 #23: 정규화\n\n## 다음항목\n무관.\n'
  );
  write(
    path.join('기사', '정보처리기사', 'sora', 'notes', '소프트웨어설계', '01-요구사항확인.md'),
    '## 유스케이스\n액터/시나리오.\n- 🔁 기출 2023-1 #23: 무구분 매핑\n'
  );
  // 공유 해설
  write(
    path.join('기사', '정보처리기사', '_공통', '풀이', '2023-1-필기', '23.md'),
    '# 2023-1-필기 #23 풀이\n\n## hun (2026-07-21)\n정답은 정규화 3차.\n\n## sora (2026-07-22)\n보충 설명.\n'
  );
  return root;
}

async function startServer(repoRoot) {
  const hub = createSseHub();
  const app = createApp({
    token: TOKEN,
    cli: { chat: false, record: false },
    repoRoot,
    hub,
    config: { cliChat: 'agy', cliRecord: 'claude', nickname: null },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

test('GET /api/concept: 내/타인 노트 섹션 + 무구분 태그 매칭 + 공유 해설', async (t) => {
  const repoRoot = seedRepo();
  const { server, port } = await startServer(repoRoot);
  t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

  const res = await request(port, { reqPath: '/api/concept/2023-1-필기/23' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.시험, '2023-1-필기');
  assert.equal(data.문번, 23);
  // 노트 2건(hun 구분 태그 + sora 무구분→필기)
  assert.equal(data.노트.length, 2);
  const hun = data.노트.find((n) => n.닉네임 === 'hun');
  assert.equal(hun.섹션제목, '요구사항 분석');
  assert.match(hun.본문md, /요구공학 개념 정리/);
  assert.doesNotMatch(hun.본문md, /다음항목/, '다음 ## 섹션은 포함되지 않는다');
  // 공유 해설 2개 서명 섹션
  assert.equal(data.해설.length, 2);
  assert.deepEqual(data.해설.map((h) => h.닉네임), ['hun', 'sora']);
  assert.equal(data.해설[0].날짜, '2026-07-21');
});

test('GET /api/concept: 잘못된 시험ID/문번은 400', async (t) => {
  const repoRoot = seedRepo();
  const { server, port } = await startServer(repoRoot);
  t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

  const bad = await request(port, { reqPath: '/api/concept/..%2F..%2Fetc/23' });
  assert.equal(bad.status, 400);
  const bad2 = await request(port, { reqPath: '/api/concept/2023-1-필기/abc' });
  assert.equal(bad2.status, 400);
});

test('GET /api/concept: 매칭 없는 문항은 빈 목록', async (t) => {
  const repoRoot = seedRepo();
  const { server, port } = await startServer(repoRoot);
  t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

  const res = await request(port, { reqPath: '/api/concept/2023-1-필기/99' });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.deepEqual(data.노트, []);
  assert.deepEqual(data.해설, []);
});

test('parseSignatureSections/extractSection 단위 동작', () => {
  const secs = concept.parseSignatureSections('## a (2026-01-02)\n본문1\n## b (2026-03-04)\n본문2\n');
  assert.equal(secs.length, 2);
  assert.deepEqual(secs[0], { 닉네임: 'a', 날짜: '2026-01-02', 본문: '본문1' });
  const sec = concept.extractSection('## X\n내용X\n## Y\n내용Y\n', 'X');
  assert.equal(sec, '## X\n내용X');
});
