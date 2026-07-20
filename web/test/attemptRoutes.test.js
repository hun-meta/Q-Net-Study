'use strict';

// HTTP 통합 테스트: 제출→채점→attempt 3종 기록 + 키워드 보강 (app.js 자동 마운트).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../server/app');
const { createSseHub } = require('../server/sse');
const nickModule = require('../server/nickname');
const draftStore = require('../server/draftStore');

const TOKEN = 'test-token-attempt';
const GRADE = '기사';
const CERT = '정보처리기사';
const NICK = 'hun';
const EXAM = '2023-1-필기';

function request(port, { method = 'GET', reqPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
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

// 현재 닉네임을 테스트 동안 고정한다. 전역 config.json(실 저장소 공유·병렬 테스트 경합)을
// 건드리지 않도록 nickname.getNickname을 이 프로세스 한정으로 오버라이드한다.
function withNickname(nick, fn) {
  const orig = nickModule.getNickname;
  nickModule.getNickname = () => nick;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      nickModule.getNickname = orig;
    });
}

// 종류(분야)/자격증을 인자로 받아 임시 저장소를 구성(기본은 등급형이지만 분야형도 지원).
function seedRepo(grade = GRADE, cert = CERT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-submit-'));
  const 정답 = fs.readFileSync(path.join(__dirname, 'fixtures', '정답', '2023-1-필기.md'), 'utf8');
  const dst = path.join(root, grade, cert, '_공통', '기출문제', '정답', `${EXAM}.md`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, 정답, 'utf8');
  // info.md: 합격기준 40/60 명시
  const info = path.join(root, grade, cert, '_공통', 'info.md');
  fs.writeFileSync(info, '# 정보처리기사\n\n<!-- grading: 과목과락: 40 / 평균합격: 60 -->\n', 'utf8');
  return root;
}

async function startServer(repoRoot) {
  const hub = createSseHub();
  const app = createApp({
    token: TOKEN,
    cli: { chat: false, record: false },
    repoRoot,
    hub,
    config: { cliChat: 'agy', cliRecord: 'claude', nickname: NICK },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

const H = { 'X-QNet-Token': TOKEN, 'Content-Type': 'application/json' };

test('제출→채점→attempt 3종 기록, 재시도 시도N 증가, 키워드 보강', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    // 과목1(1-4) 전부 정답, 과목2(5-8) 전부 오답 → 과목2 과락
    const answers = { 1: 3, 2: 4, 3: 1, 4: 2, 5: 1, 6: 1, 7: 2, 8: 4 };
    const 찍음 = { 8: true };
    const res = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers, 찍음, 소요시간: 40 },
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(data.시도, 1);
    assert.equal(data.과목결과[0].점수, 100);
    assert.equal(data.과목결과[1].점수, 0);
    assert.equal(data.합격여부, '과락');
    assert.equal(data.X수, 4);
    // wrongTargets: 오답 4문항(5,6,7,8) 전부
    assert.deepEqual(data.wrongTargets.map((w) => w.문번).sort((a, b) => a - b), [5, 6, 7, 8]);

    // 3종 파일 실제 생성 확인
    const attemptsDir = path.join(repoRoot, GRADE, CERT, NICK, 'attempts');
    assert.ok(fs.existsSync(path.join(attemptsDir, `${EXAM}-1.md`)));
    assert.ok(fs.existsSync(path.join(attemptsDir, 'INDEX.md')));
    const wrong0 = fs.readFileSync(path.join(attemptsDir, 'WRONG.md'), 'utf8');
    assert.match(wrong0, /2023-1-필기 #5/);

    // 재제출 → 시도 2
    const res2 = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers, 찍음: {} },
    });
    assert.equal(JSON.parse(res2.body).시도, 2);
    const idx = fs.readFileSync(path.join(attemptsDir, 'INDEX.md'), 'utf8');
    assert.match(idx, /- 2023-1-필기: /, '추이 섹션 존재');
    assert.equal(idx.split('\n').filter((l) => l.startsWith('| 2023-1-필기')).length, 2);

    // 키워드 보강(시도 1)
    const kwRes = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/keywords`, headers: H,
      body: { grade: GRADE, cert: CERT, 시도: 1, 키워드맵: { 5: '스택', 7: '트리순회' } },
    });
    assert.equal(kwRes.status, 200);
    const a1 = fs.readFileSync(path.join(attemptsDir, `${EXAM}-1.md`), 'utf8');
    assert.match(a1, /### #5 스택/);
    assert.match(a1, /\| 5 \|.*\| 스택 \|/);
    const wrong1 = fs.readFileSync(path.join(attemptsDir, 'WRONG.md'), 'utf8');
    assert.match(wrong1, /#5 스택 →/, 'WRONG 항목 키워드 갱신');
  });
});

test('GET /api/attempts: 시도 이력·추이 반환, 응답에 grade/cert 에코', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    const answers = { 1: 3, 2: 4, 3: 1, 4: 2, 5: 2, 6: 4, 7: 1, 8: 3 };
    const s1 = JSON.parse((await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers, 찍음: {} },
    })).body);
    assert.equal(s1.grade, GRADE, '응답에 grade 에코');
    assert.equal(s1.cert, CERT, '응답에 cert 에코');

    await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers: { 1: 9 }, 찍음: {} },
    });

    // 원시 쿼리(한글) — request 헬퍼의 encodeURI가 1회 인코딩. 사전 인코딩 시 이중 인코딩됨.
    const hist = await request(port, {
      reqPath: `/api/attempts?grade=${GRADE}&cert=${CERT}&examId=${EXAM}&user=${NICK}`,
    });
    assert.equal(hist.status, 200);
    const data = JSON.parse(hist.body);
    assert.equal(data.attempts.length, 2);
    assert.deepEqual(data.trend[EXAM].map((tr) => tr.시도), [1, 2]);
  });
});

test('examId NFC 정규화: NFD 입력도 기존 시도를 찾아 시도N 증가(덮어쓰기 방지)', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    const answers = { 1: 3, 2: 4, 3: 1, 4: 2, 5: 2, 6: 4, 7: 1, 8: 3 };
    // 1차: NFC 시험ID
    const r1 = JSON.parse((await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers, 찍음: {} },
    })).body);
    assert.equal(r1.시도, 1);

    // 2차: NFD로 분해한 동일 시험ID → 정규화되어 기존 시도 인식, 시도2
    const r2 = JSON.parse((await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM.normalize('NFD')}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers, 찍음: {} },
    })).body);
    assert.equal(r2.시도, 2, 'NFD 입력이 시도1로 리셋되지 않는다');

    // 파일명은 NFC로 통일 — 시도 1·2 파일 모두 존재
    const attemptsDir = path.join(repoRoot, GRADE, CERT, NICK, 'attempts');
    assert.ok(fs.existsSync(path.join(attemptsDir, `${EXAM}-1.md`)));
    assert.ok(fs.existsSync(path.join(attemptsDir, `${EXAM}-2.md`)));
  });
});

test('제출 성공 시 드래프트 삭제(재진입 시 낡은 답 방지)', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => {
      server.close();
      fs.rmSync(repoRoot, { recursive: true, force: true });
      try { draftStore.deleteDraft(NICK, EXAM); } catch (_e) { /* cleanup */ }
    });

    // 드래프트 선저장 → 존재 확인
    draftStore.writeDraft(NICK, EXAM, { answers: { 1: 3 }, 찍음: {} });
    assert.notEqual(draftStore.readDraft(NICK, EXAM), null);

    await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers: { 1: 3, 2: 4, 3: 1, 4: 2, 5: 2, 6: 4, 7: 1, 8: 3 }, 찍음: {} },
    });
    // 제출 후 드래프트 삭제됨
    assert.equal(draftStore.readDraft(NICK, EXAM), null, '제출 성공 후 드래프트가 삭제되어야 한다');
  });
});

test('종류=분야 구조(정보처리/정보처리기사)에서도 제출·기록 정상', async (t) => {
  const FIELD = '정보처리';
  const CERT2 = '정보처리기사';
  const repoRoot = seedRepo(FIELD, CERT2);
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    const res = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: FIELD, cert: CERT2, answers: { 1: 3, 2: 4, 3: 1, 4: 2, 5: 2, 6: 4, 7: 1, 8: 3 }, 찍음: {} },
    });
    assert.equal(res.status, 200, '개방형 분야명도 화이트리스트 없이 통과');
    const data = JSON.parse(res.body);
    assert.equal(data.grade, FIELD);
    assert.equal(data.합격여부, '합격');
    // 분야 경로 아래 attempt 기록 확인
    const attemptsDir = path.join(repoRoot, FIELD, CERT2, NICK, 'attempts');
    assert.ok(fs.existsSync(path.join(attemptsDir, `${EXAM}-1.md`)));
  });
});

test('정답 미등록 기출은 채점 불가(400, 채점불가 플래그)', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    const res = await request(port, {
      method: 'POST', reqPath: `/api/attempts/2099-9-필기/submit`, headers: H,
      body: { grade: GRADE, cert: CERT, answers: {} },
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).채점불가, true);
  });
});

test('무토큰 제출은 403(security), 안전하지 않은 종류(분야)명은 400', async (t) => {
  const repoRoot = seedRepo();
  await withNickname(NICK, async () => {
    const { server, port } = await startServer(repoRoot);
    t.after(() => { server.close(); fs.rmSync(repoRoot, { recursive: true, force: true }); });

    const noToken = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`,
      headers: { 'Content-Type': 'application/json' }, body: { grade: GRADE, cert: CERT, answers: {} },
    });
    assert.equal(noToken.status, 403);

    // 종류(분야)는 개방형이지만 경로 구분자가 든 값은 validateScope가 거부(400).
    const badGrade = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: '../etc', cert: CERT, answers: {} },
    });
    assert.equal(badGrade.status, 400);

    // 존재하지 않는(그러나 안전한) 분야명은 정답 부재로 채점 불가(400, 채점불가).
    const missingField = await request(port, {
      method: 'POST', reqPath: `/api/attempts/${EXAM}/submit`, headers: H,
      body: { grade: '없는분야', cert: CERT, answers: {} },
    });
    assert.equal(missingField.status, 400);
    assert.equal(JSON.parse(missingField.body).채점불가, true);
  });
});
