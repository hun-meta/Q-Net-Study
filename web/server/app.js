'use strict';

// express 앱 구성(리슨 없음 — 테스트에서 임의 포트로 재사용 가능).
// 보안 미들웨어 → 핵심 API → 워커 기능 라우트(가드된 require) → 정적 파일.
//
// ── 라우트 등록 관례 (다른 워커용, 충돌 없는 병렬 개발) ──────────────────────
// 각 워커는 아래 파일명 중 자기 것 하나만 server/ 에 만들면 된다(app.js 수정 불필요):
//     ./examList       (#4  기출 목록·PDF 서브셋)
//     ./attemptRoutes  (#6  채점·제출·키워드)
//     ./conceptRoutes  (#7  개념 보기)
//     ./cliRoutes      (#9  업로드·챗·승인 정리)
// 파일 계약:
//     module.exports = {
//       router(deps) {                       // deps = { token, cli, repoRoot, hub, config }
//         const express = require('express');
//         const r = express.Router();
//         r.post('/api/exams/upload', (req, res) => { ... }); // 전체 경로를 직접 정의
//         return r;                          // express.Router 반환 → app.use(r) 로 루트 마운트
//       },
//     };
// - 보안 가드(Host·Origin·X-QNet-Token)와 JSON 파서는 전역 적용되어 자동 상속됨.
// - SSE 푸시가 필요하면 deps.hub.broadcast(event, payload) 사용.
// - 쓰기 경계 검증은 require('./security').writeGuard / assertWithinRoots 사용.
// - 파일이 아직 없으면 자동 스킵(가드된 require)되므로 미구현 상태에서도 서버가 뜬다.
// ────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const express = require('express');
const security = require('./security');
const repo = require('./repo');
const nickname = require('./nickname');
const participants = require('./participants');
const config = require('./config');
const { serialize } = require('./cliBridge'); // 저장소 쓰기를 CLI 잡과 직렬화(감사 오인 방지)

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 완료 시 자동 마운트될 워커 기능 모듈(파일명 계약). 없으면 스킵.
const FEATURE_MODULES = ['./examList', './attemptRoutes', './conceptRoutes', './cliRoutes', './microworldRoutes', './questionRoutes'];

// 이름(종류·자격증) 검증용: 경로 구분자/제어문자 금지.
const NAME_INVALID = /[\\/\0\r\n\t]/;

// --- 관리 헬퍼(닉네임 삭제·자격증 골격) --------------------------------------

// 종류·자격증 이름 검증. field=true 면 루트 블록리스트도 금지.
function validateName(raw, { field = false, label = '이름' } = {}) {
  const name = repo.nfc(raw == null ? '' : raw).trim();
  if (!name) throw new Error(`${label}이(가) 비어 있습니다.`);
  if (name.length > 60) throw new Error(`${label}이(가) 너무 깁니다(최대 60자).`);
  if (NAME_INVALID.test(name)) throw new Error(`${label}에 경로 구분자나 제어문자를 쓸 수 없습니다.`);
  if (name.startsWith('.') || name.startsWith('_')) {
    throw new Error(`${label}은(는) '.' 또는 '_'로 시작할 수 없습니다.`);
  }
  if (name === '.' || name === '..') throw new Error(`사용할 수 없는 ${label}입니다.`);
  if (field && repo.ROOT_BLOCKLIST.includes(name)) {
    throw new Error(`'${name}'은(는) 예약된 디렉토리명이라 종류로 쓸 수 없습니다.`);
  }
  return name;
}

// 디렉토리 내 파일 개수(재귀).
function countFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return 0;
  }
  let count = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) count += countFiles(p);
    else count += 1;
  }
  return count;
}

// 닉네임 삭제/미리보기 대상 수집: 각 자격증의 개인 디렉토리 + 드래프트(존재하는 것만).
function collectParticipantTargets(repoRoot, nick) {
  const targets = [];
  for (const cert of repo.scanRepo(repoRoot)) {
    if (!cert.participants.includes(nick)) continue;
    const abs = repo.participantDir(repoRoot, cert.grade, cert.cert, nick);
    if (fs.existsSync(abs)) targets.push({ abs, rel: path.relative(repoRoot, abs) });
  }
  const draftsAbs = path.join(repoRoot, '.qnet-web', 'drafts', repo.nfc(nick));
  if (fs.existsSync(draftsAbs)) {
    targets.push({ abs: draftsAbs, rel: path.relative(repoRoot, draftsAbs) });
  }
  return targets;
}

// 삭제 미리보기(파일 수 포함, 실제 삭제 없음).
function participantUsage(repoRoot, nick) {
  const dirs = collectParticipantTargets(repoRoot, nick).map((t) => ({
    path: t.rel,
    files: countFiles(t.abs),
  }));
  return {
    nickname: nick,
    directories: dirs,
    totalFiles: dirs.reduce((s, d) => s + d.files, 0),
  };
}

// 실제 삭제: 각 경로를 assertWithinRoots로 경계 검증한 뒤 재귀 삭제.
function deleteParticipant(repoRoot, nick) {
  const deleted = [];
  for (const t of collectParticipantTargets(repoRoot, nick)) {
    security.assertWithinRoots(t.abs, [repoRoot]); // 경계 밖이면 EWRITEBOUNDARY
    const files = countFiles(t.abs);
    fs.rmSync(t.abs, { recursive: true, force: true });
    deleted.push({ path: t.rel, files });
  }
  return {
    nickname: nick,
    deleted,
    totalFiles: deleted.reduce((s, d) => s + d.files, 0),
  };
}

// 기출문제 INDEX.md 골격(9칼럼 헤더).
function indexSkeleton(cert) {
  return (
    `# 기출문제 인덱스 — ${cert}\n\n` +
    '| 파일명 | 연도 | 회차 | 구분 | 문항수 | 정답포함 | 숨김페이지수 | 등록자 | 비고 |\n' +
    '|--------|------|------|------|--------|----------|--------------|--------|------|\n'
  );
}

// info.md 최소 스켈레톤(종목명·종류 채움 + grading 블록 40/60).
function infoSkeleton(field, cert) {
  return (
    `# ${cert}\n\n` +
    '## 개요\n\n' +
    '| 항목 | 내용 |\n' +
    '|------|------|\n' +
    `| 종목명 | ${cert} |\n` +
    `| 종류(분야) | ${field} |\n` +
    '| 시행기관 | 한국산업인력공단 (Q-Net) |\n\n' +
    '## 합격 기준\n\n' +
    '<!-- grading: 과목과락: 40 / 평균합격: 60 -->\n' +
    '- 필기: 과목당 40점 이상 & 전 과목 평균 60점 이상\n' +
    '- 실기: 60점 이상\n\n' +
    '## 출제기준\n\n' +
    '- 적용 기간: {YYYY.MM ~ YYYY.MM}\n' +
    '- 과목별 상세: `출제기준/{과목명}.md` 참조\n'
  );
}

// {종류}/{자격증}/_공통 골격 생성. 이미 존재하면 EEXIST_CERT.
function scaffoldCert(repoRoot, field, cert) {
  const certDir = path.join(repoRoot, field, cert);
  security.assertWithinRoots(certDir, [repoRoot]); // 경계 강제
  if (fs.existsSync(certDir)) {
    const err = new Error('이미 존재하는 자격증입니다.');
    err.code = 'EEXIST_CERT';
    throw err;
  }
  const common = path.join(certDir, '_공통');
  fs.mkdirSync(path.join(common, '기출문제'), { recursive: true });
  fs.mkdirSync(path.join(common, '출제기준'), { recursive: true });
  fs.writeFileSync(path.join(common, '기출문제', 'INDEX.md'), indexSkeleton(cert), 'utf8');
  fs.writeFileSync(path.join(common, '출제기준', '.gitkeep'), '', 'utf8');
  fs.writeFileSync(path.join(common, 'info.md'), infoSkeleton(field, cert), 'utf8');
  return { relPath: path.join(field, cert) };
}

// 가드된 require: 대상 모듈이 아직 없으면 스킵, 있으면 마운트.
// 단, 모듈 "내부"의 다른 의존성 누락(MODULE_NOT_FOUND)은 삼키지 않고 그대로 던진다
// (워커의 실수로 라우트가 조용히 사라지는 사고 방지).
function mountFeatureRoutes(app, deps) {
  for (const name of FEATURE_MODULES) {
    let mod;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      mod = require(name);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND' && err.message.includes(name)) {
        continue; // 대상 모듈 자체가 아직 없음 → 스킵
      }
      throw err; // 내부 의존성 오류 등은 표면화
    }
    if (mod && typeof mod.router === 'function') {
      app.use(mod.router(deps));
    } else {
      process.stderr.write(`[routes] ${name}: router(deps) export 누락 — 무시됨\n`);
    }
  }
}

// deps: { token, cli:{chat,record}, repoRoot, hub, config }
function createApp(deps) {
  const { token, cli, repoRoot, hub, config: cfg } = deps;
  const app = express();
  app.disable('x-powered-by');

  // 보안 가드: Host → Origin → Token(비-GET). 허용적 CORS 헤더는 절대 내보내지 않음.
  security.applySecurity(app, token);

  app.use(express.json({ limit: '4mb' }));

  // --- 핵심 API -------------------------------------------------------------

  // 클라이언트 부트스트랩: 닉네임·토큰·CLI 상태·포트.
  app.get('/api/state', (req, res) => {
    const zai = config.resolveZai();
    const chatAvailable = zai.enabled || cli.chat;
    res.json({
      nickname: nickname.getNickname(),
      token,
      cli: {
        chat: {
          command: cfg.cliChat,
          available: chatAvailable,
          provider: zai.enabled ? 'zai' : 'agy',
          ...(zai.enabled ? { model: zai.model, effort: zai.effort, keySource: zai.source } : {}),
        },
        record: { command: cfg.cliRecord, available: cli.record },
      },
      port: req.socket.localPort,
    });
  });

  // Z.AI API Key 웹 등록(설계 A-7). 저장소: .qnet-web/secrets.json(감사 제외·0600·원자 쓰기).
  // 비-GET 이므로 전역 토큰 가드(security.applySecurity)가 자동 적용된다.
  // 키 값은 어떤 응답에도 담지 않는다.
  app.post('/api/zai/key', (req, res) => {
    try {
      const current = config.resolveZai();
      if (current.source === 'env') {
        return res
          .status(400)
          .json({ error: '환경변수 키가 우선 적용 중입니다 — 환경변수를 비우고 등록하세요.' });
      }
      const raw = req.body && req.body.apiKey;
      const key = typeof raw === 'string' ? raw.trim() : '';
      if (!key) return res.status(400).json({ error: 'API Key 를 입력하세요.' });
      if (/[\x00-\x1f\x7f]/.test(key)) {
        return res.status(400).json({ error: 'API Key 에 제어문자·개행을 쓸 수 없습니다.' });
      }
      config.saveZaiKey(key);
      hub.broadcast('cli-change', { chat: true, record: cli.record, provider: 'zai' });
      return res.json({ ok: true, provider: 'zai', keySource: 'file' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // Z.AI API Key 삭제: env 키 사용 중이면 UI 로 관리 불가(400). 삭제 후 agy 폴백 가용성 반영.
  app.delete('/api/zai/key', (req, res) => {
    try {
      const current = config.resolveZai();
      if (current.source === 'env') {
        return res
          .status(400)
          .json({ error: '환경변수 키 사용 중에는 삭제할 수 없습니다 — 환경변수를 직접 관리하세요.' });
      }
      config.deleteZaiKey();
      const after = config.resolveZai();
      const chatAvailable = after.enabled || cli.chat;
      hub.broadcast('cli-change', {
        chat: chatAvailable,
        record: cli.record,
        provider: after.enabled ? 'zai' : 'agy',
      });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // 저장소 스캔: 종류(분야)/자격증/참여자 목록 + 전체 참여자 합집합.
  app.get('/api/repo', (_req, res) => {
    res.json({
      certs: repo.scanRepo(repoRoot),
      participants: participants.listAll(repoRoot), // 레지스트리 ∪ 디렉토리 스캔
    });
  });

  // 닉네임 설정(검증 + config 저장 + 참여자.md upsert). 비-GET → 토큰 필수.
  app.post('/api/nickname', async (req, res) => {
    try {
      const saved = nickname.setNickname(req.body && req.body.nickname);
      // 참여자.md(저장소 영역) 쓰기는 CLI 잡 큐와 직렬화(감사 오인 원복 방지).
      await serialize(async () => participants.upsert(repoRoot, saved));
      hub.broadcast('participants-change', { nickname: saved, action: 'upsert' });
      res.json({ nickname: saved, participants: participants.listAll(repoRoot) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 닉네임 삭제 미리보기: 삭제될 디렉토리 목록 + 파일 수.
  app.get('/api/nickname/:name/usage', (req, res) => {
    const nick = repo.nfc(req.params.name);
    res.json(participantUsage(repoRoot, nick));
  });

  // 닉네임 삭제: confirm 이 닉네임과 정확히 일치해야 실행.
  // 참여자.md 제거 + 모든 자격증의 개인 디렉토리 + 드래프트 재귀 삭제(경계 검증).
  app.delete('/api/nickname', async (req, res) => {
    const body = req.body || {};
    const nick = repo.nfc(body.nickname == null ? '' : body.nickname);
    if (!nick) return res.status(400).json({ error: '삭제할 닉네임이 필요합니다.' });
    if (body.confirm !== nick) {
      return res.status(400).json({ error: '확인 문자열이 닉네임과 일치하지 않습니다.' });
    }
    try {
      // 개인 디렉토리 삭제 + 참여자.md 갱신은 CLI 잡 큐와 직렬화(감사 오인 원복 방지).
      let result;
      await serialize(async () => {
        result = deleteParticipant(repoRoot, nick);
        participants.remove(repoRoot, nick);
      });
      // 현재 config 닉네임을 삭제하면 해제.
      const current = config.loadConfig();
      if (current.nickname === nick) config.saveConfig({ ...current, nickname: null });
      hub.broadcast('participants-change', { nickname: nick, action: 'remove' });
      return res.json(result);
    } catch (err) {
      const status = err.code === 'EWRITEBOUNDARY' ? 403 : 400;
      return res.status(status).json({ error: err.message });
    }
  });

  // 자격증 생성: {종류}/{자격증}/_공통 골격 생성. 이미 존재하면 409.
  app.post('/api/certs', async (req, res) => {
    const body = req.body || {};
    let field;
    let cert;
    try {
      field = validateName(body['종류'], { field: true, label: '종류' });
      cert = validateName(body['자격증'], { label: '자격증' });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      // _공통 골격 생성(저장소 쓰기)도 CLI 잡 큐와 직렬화(감사 오인 원복 방지).
      let created;
      await serialize(async () => {
        created = scaffoldCert(repoRoot, field, cert);
      });
      hub.broadcast('fs-change', {
        changes: [{ path: created.relPath, type: 'addDir' }],
        at: Date.now(),
      });
      return res.status(201).json({ created: created.relPath });
    } catch (err) {
      if (err.code === 'EEXIST_CERT') return res.status(409).json({ error: err.message });
      const status = err.code === 'EWRITEBOUNDARY' ? 403 : 400;
      return res.status(status).json({ error: err.message });
    }
  });

  // SSE: 파일 변경 실시간 반영(재연결 시 Last-Event-ID 재동기화).
  app.get('/api/events', (req, res) => {
    hub.handleConnection(req, res);
  });

  // --- 워커 기능 라우트(가드된 require, deps 전달) ---------------------------
  mountFeatureRoutes(app, deps);

  // --- 정적 파일(무빌드 바닐라 프론트) --------------------------------------
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  // SPA 셸 폴백: 알 수 없는 GET은 index.html 반환(API 제외).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}

module.exports = {
  createApp,
  mountFeatureRoutes,
  validateName,
  participantUsage,
  deleteParticipant,
  scaffoldCert,
  PUBLIC_DIR,
  FEATURE_MODULES,
};
