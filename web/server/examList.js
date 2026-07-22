'use strict';

// 기출 목록 + PDF 서빙 라우트.
// 마운트 계약(팀 확정): module.exports.router(deps) → express.Router.
//   라우터가 전체 경로(/api/...)를 직접 정의하고, app.js가 루트에 자동 마운트한다(app.js 수정 금지).
//   deps = { token, cli, repoRoot, hub, config } — SSE 푸시는 deps.hub.broadcast(event,payload).
//
// 저장소 다-자격증 구조상 시험 id({연도}-{식별자}-{구분})만으로는 유일하지 않으므로
// 모든 엔드포인트는 grade·cert 질의 파라미터로 자격증 컨텍스트를 받는다.

const fs = require('fs');
const path = require('path');
const express = require('express');

const repo = require('./repo');
const examIndex = require('./examIndex');
const answerKey = require('./answerKey');
const pdfSubset = require('./pdfSubset');
const draftStore = require('./draftStore');
const nickname = require('./nickname');
const security = require('./security');
const questionStore = require('./questionStore');
const questionRunner = require('./questionRunner');
const { serialize, createBridge } = require('./cliBridge'); // 저장소 쓰기를 CLI 잡과 직렬화(감사 오인 방지)

// 시험 id: {연도4자리}-{식별자(회차/상시일자)}-{필기|실기}. 경로 구분자·점 불허(탈출 차단).
const EXAM_ID = /^(\d{4})-([0-9A-Za-z가-힣]+)-(필기|실기)$/;
const 기출문제 = '기출문제';
const 정답 = '정답';

function nfc(s) {
  return String(s == null ? '' : s).normalize('NFC');
}

// 시험 id 파싱 → { 연도, 식별자, 구분 } | null
function parseExamId(id) {
  const m = nfc(id).match(EXAM_ID);
  if (!m) return null;
  return { 연도: Number(m[1]), 식별자: m[2], 구분: m[3] };
}

// 자격증의 기출문제 디렉토리 절대 경로.
function 기출Dir(repoRoot, grade, cert) {
  return path.join(repo.commonDir(repoRoot, nfc(grade), nfc(cert)), 기출문제);
}

// grade(=종류·분야)·cert 검증. 반환 { grade, cert } 또는 { error, status }.
// 라운드2: 등급 화이트리스트 폐지 → 블록리스트(repo.isFieldDir) 계약. 종류는 자유 분야.
function validateGradeCert(repoRoot, grade, cert) {
  const g = nfc(grade);
  const c = nfc(cert);
  if (!g || !c) return { error: 'grade·cert 질의 파라미터가 필요합니다.', status: 400 };
  // 블록리스트/경로 안전성: web·docs·'_'·'.' 시작 등은 종류(분야)로 인정하지 않음.
  if (!repo.isFieldDir(g) || g.includes('/') || g.includes('\\')) {
    return { error: '유효하지 않은 종류(분야)입니다.', status: 400 };
  }
  if (c.includes('/') || c.includes('\\') || c.startsWith('.')) {
    return { error: '잘못된 자격증명입니다.', status: 400 };
  }
  const certDir = path.join(repoRoot, g, c);
  try {
    if (!fs.statSync(certDir).isDirectory()) throw new Error('not dir');
  } catch (_e) {
    return { error: '해당 자격증 디렉토리를 찾을 수 없습니다.', status: 404 };
  }
  return { grade: g, cert: c };
}

// 특정 시험의 숨김페이지수 결정: INDEX 행 > 정답 md frontmatter > 0(감출 답지 없음).
function hiddenCountFor(repoRoot, grade, cert, id) {
  const dir = 기출Dir(repoRoot, grade, cert);
  const indexPath = path.join(dir, 'INDEX.md');
  if (fs.existsSync(indexPath)) {
    const rows = examIndex.parse(fs.readFileSync(indexPath, 'utf8'));
    const row = rows.find((r) => examIndex.시험ID(r) === nfc(id));
    if (row && Number.isFinite(Number(row.숨김페이지수))) return Number(row.숨김페이지수);
  }
  const 정답Path = path.join(dir, 정답, `${nfc(id)}.md`);
  if (fs.existsSync(정답Path)) {
    const parsed = answerKey.parse(fs.readFileSync(정답Path, 'utf8'), { 시험ID: id });
    if (Number.isFinite(Number(parsed.숨김페이지수))) return Number(parsed.숨김페이지수);
  }
  // 미확정: INDEX·정답 md 어디에도 숨김페이지수가 없으면 null.
  // (보안 F3) 0을 반환해 답지 포함 원본을 서빙하던 fail-open을 fail-closed로 전환 — /pdf에서 409.
  return null;
}

// OMR 구조: 정답 md에서 문항수·과목범위만 추출한다. **정답 값은 절대 포함하지 않는다**
// (풀이 중 답지 유출 방지 — 채점은 제출 시 서버측에서만 수행). 정답 md 부재 시 등록=false(열람만).
// 반환: { 등록, 문항수, 과목들:[{과목명,시작,끝}], 검증오류 }
function omrStructure(repoRoot, grade, cert, id) {
  const 정답Path = path.join(기출Dir(repoRoot, grade, cert), 정답, `${nfc(id)}.md`);
  if (!fs.existsSync(정답Path)) {
    return { 등록: false, 문항수: 0, 과목들: [], 검증오류: [] };
  }
  const parsed = answerKey.parse(fs.readFileSync(정답Path, 'utf8'), { 시험ID: id });
  return {
    등록: true,
    문항수: parsed.문항수,
    // 정답을 제거하고 범위 메타만 노출.
    과목들: parsed.과목들.map((s) => ({ 과목명: s.과목명, 시작: s.시작, 끝: s.끝 })),
    검증오류: parsed.검증오류,
  };
}

// 수동 정답 입력 → 정답 md 텍스트 생성(데이터 계약 포맷). 답 값은 원문자(①~④)로 기록.
// 과목들: [{ 과목명, 시작, 끝, 정답:{ [문번]: 1~4 } }], opts: { 숨김페이지수, 추출일 }
const 원문자 = ['①', '②', '③', '④'];
function buildAnswerKeyMd(과목들, opts) {
  const o = opts || {};
  const 문항수 = 과목들.reduce((acc, s) => acc + (Number(s.끝) - Number(s.시작) + 1), 0);
  const lines = [];
  lines.push('---');
  lines.push(`문항수: ${문항수}`);
  lines.push(`숨김페이지수: ${Number(o.숨김페이지수) || 0}`);
  lines.push('추출도구: 수동');
  lines.push(`추출일: ${o.추출일 || new Date().toISOString().slice(0, 10)}`);
  lines.push('---');
  lines.push('');
  for (const s of 과목들) {
    lines.push(`## ${s.과목명} (${s.시작}-${s.끝})`);
    lines.push('');
    lines.push('| 문번 | 정답 |');
    lines.push('|------|------|');
    for (let n = Number(s.시작); n <= Number(s.끝); n += 1) {
      const v = Number(s.정답 && s.정답[n]);
      const disp = v >= 1 && v <= 4 ? 원문자[v - 1] : '';
      lines.push(`| ${n} | ${disp} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// tmp→rename 원자 쓰기(서버 결정적 쓰기).
function atomicWrite(target, buf) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
}

// 자격증의 기출 목록 생성: INDEX 등록 행 + 실제 PDF 파일 + 정답 md 존재를 병합.
// 각 항목: { id, 파일명, 연도, 식별자, 구분, 문항수, 정답등록, 채점가능,
//           숨김페이지수, 정답포함, 등록자, 비고, pdf존재 }
function listExams(repoRoot, grade, cert) {
  const dir = 기출Dir(repoRoot, grade, cert);
  const indexPath = path.join(dir, 'INDEX.md');
  const 정답Dir = path.join(dir, 정답);

  const rows = fs.existsSync(indexPath)
    ? examIndex.parse(fs.readFileSync(indexPath, 'utf8'))
    : [];
  const byId = new Map(rows.map((r) => [examIndex.시험ID(r), r]));

  const pdfFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f))
    : [];

  const items = new Map();

  const build = (id, 파일명, row, pdf존재) => {
    const parsed = parseExamId(id) || {};
    const 정답등록 = fs.existsSync(path.join(정답Dir, `${id}.md`));
    // 숨김페이지수 확정 여부(INDEX 또는 정답 md). 미확정이면 null → 열람 불가(fail-closed).
    let hc = row && Number.isFinite(Number(row.숨김페이지수)) ? Number(row.숨김페이지수) : null;
    let 문항수값 =
      row && /^\d+$/.test(String(row.문항수)) && Number(row.문항수) > 0
        ? Number(row.문항수)
        : null;
    if ((hc == null || 문항수값 == null) && 정답등록) {
      const p = answerKey.parse(fs.readFileSync(path.join(정답Dir, `${id}.md`), 'utf8'), {
        시험ID: id,
      });
      if (hc == null) hc = Number.isFinite(Number(p.숨김페이지수)) ? Number(p.숨김페이지수) : 0;
      if (문항수값 == null && Number.isInteger(p.문항수) && p.문항수 > 0) 문항수값 = p.문항수;
    }
    // 문항 단위 추출 완비 여부(파일 시스템 파생 — INDEX 마커 없음). 문항수 미상 시 false.
    const 문항추출 =
      문항수값 != null &&
      questionStore.completeness(repoRoot, grade, cert, id, 문항수값).완비;
    return {
      id,
      파일명: 파일명 || `${id}.pdf`,
      연도: parsed.연도 != null ? parsed.연도 : (row ? row.연도 : ''),
      식별자: parsed.식별자 != null ? parsed.식별자 : (row ? row.식별자 : ''),
      구분: parsed.구분 != null ? parsed.구분 : (row ? row.구분 : ''),
      문항수: row ? row.문항수 : '',
      정답등록,
      채점가능: 정답등록 && pdf존재,
      숨김페이지수: hc != null ? hc : 0,
      숨김확정: hc != null,
      문항추출,
      // 열람 가능 = PDF 존재 && 숨김페이지수 확정(미확정이면 /pdf가 409로 답지 유출 차단).
      열람가능: pdf존재 && hc != null,
      정답포함: row ? row.정답포함 : false,
      등록자: row ? row.등록자 : '',
      비고: row ? row.비고 : '',
      pdf존재: pdf존재,
    };
  };

  // 실제 PDF 파일 우선(명명 규칙 통과분만).
  for (const f of pdfFiles) {
    const id = nfc(f.replace(/\.pdf$/i, ''));
    if (!EXAM_ID.test(id)) continue;
    items.set(id, build(id, nfc(f), byId.get(id), true));
  }
  // INDEX에만 있고 PDF 파일이 없는 등록 행도 포함(pdf존재=false).
  for (const [id, row] of byId) {
    if (!items.has(id)) items.set(id, build(id, row.파일명, row, false));
  }

  return [...items.values()].sort((a, b) => {
    if (Number(b.연도) !== Number(a.연도)) return Number(b.연도) - Number(a.연도);
    if (String(a.식별자) !== String(b.식별자)) return String(a.식별자) < String(b.식별자) ? -1 : 1;
    return String(a.구분) < String(b.구분) ? -1 : String(a.구분) > String(b.구분) ? 1 : 0;
  });
}

// 특정 닉네임이 해당 시험의 제출된 attempt를 가졌는지(순수 판정).
// attemptReader(#6)의 listAttempts(attemptsDir) API를 사용한다. 모듈 미착륙·닉네임 없음·
// 확인 실패 시 fail-closed(false) — 답지 포함 원본이 함부로 열리지 않게 한다.
function hasSubmittedAttempt(repoRoot, grade, cert, nick, examId) {
  if (!nick) return false;
  let reader;
  try {
    // eslint-disable-next-line global-require
    reader = require('./attemptReader');
  } catch (_e) {
    return false; // #6 미착륙 → 게이트 잠금
  }
  if (typeof reader.listAttempts !== 'function') return false;
  try {
    const attemptsDir = path.join(repo.participantDir(repoRoot, grade, cert, nick), 'attempts');
    const attempts = reader.listAttempts(attemptsDir);
    return attempts.some((a) => String(a.시험) === String(examId));
  } catch (_e) {
    return false;
  }
}

// pdf-full 제출 게이트: 현재 닉네임 기준으로 제출 기록 존재를 확인.
function attemptGateOpen(repoRoot, grade, cert, examId) {
  return hasSubmittedAttempt(repoRoot, grade, cert, nickname.getNickname(), examId);
}

// 대상 PDF의 실제 경로를 안전하게 해석(기출문제 디렉토리 경계 내부인지 확인). 없으면 null.
function safePdfPath(repoRoot, grade, cert, id) {
  const dir = 기출Dir(repoRoot, grade, cert);
  const target = path.join(dir, `${id}.pdf`);
  if (!fs.existsSync(target)) return null;
  try {
    const realDir = fs.realpathSync.native(dir);
    const realTarget = fs.realpathSync.native(target);
    if (!security.isWithin(realTarget, realDir)) return null;
    return realTarget;
  } catch (_e) {
    return null;
  }
}

// 라우터 factory. 마운트 예상 경로: app.use('/api/exams', examList.router(deps)).
function router(deps) {
  const repoRoot = deps.repoRoot;
  const r = express.Router();

  // 요청에서 grade·cert·id 컨텍스트를 검증해 반환. 실패 시 응답 전송 후 null.
  const resolveCtx = (req, res, needId) => {
    const v = validateGradeCert(repoRoot, req.query.grade, req.query.cert);
    if (v.error) {
      res.status(v.status).json({ error: v.error });
      return null;
    }
    const ctx = { grade: v.grade, cert: v.cert };
    if (needId) {
      const id = nfc(req.params.id);
      if (!EXAM_ID.test(id)) {
        res.status(400).json({ error: '잘못된 시험 id 형식입니다.' });
        return null;
      }
      ctx.id = id;
    }
    return ctx;
  };

  // GET /api/exams?grade=&cert= → 기출 목록
  // 라우터는 전체 경로(/api/...)를 직접 정의한다(app.js가 루트에 자동 마운트).
  r.get('/api/exams', (req, res) => {
    const ctx = resolveCtx(req, res, false);
    if (!ctx) return undefined;
    return res.json({
      grade: ctx.grade,
      cert: ctx.cert,
      exams: listExams(repoRoot, ctx.grade, ctx.cert),
    });
  });

  // GET /api/exams/:id/pdf?grade=&cert= → 숨김 페이지 제거 서브셋(답지 미전송)
  r.get('/api/exams/:id/pdf', async (req, res) => {
    // async 핸들러: 어떤 예외도 응답 미전송(요청 행)으로 새지 않도록 전체를 try로 감싼다.
    try {
      const ctx = resolveCtx(req, res, true);
      if (!ctx) return undefined;
      const src = safePdfPath(repoRoot, ctx.grade, ctx.cert, ctx.id);
      if (!src) return res.status(404).json({ error: '기출 PDF를 찾을 수 없습니다.' });
      // (보안 F3) 숨김페이지수 미확정 → 답지 유출 위험이므로 서빙 거부(fail-closed).
      const hidden = hiddenCountFor(repoRoot, ctx.grade, ctx.cert, ctx.id);
      if (hidden == null) {
        return res.status(409).json({ error: '숨김 페이지수 미확정 — 정답 등록 후 열람 가능합니다.' });
      }
      const out = await pdfSubset.getSubsetPath(src, hidden);
      res.type('application/pdf');
      res.setHeader('Cache-Control', 'private, no-cache');
      return res.sendFile(out.path);
    } catch (err) {
      if (res.headersSent) return undefined;
      return res.status(500).json({ error: `PDF 처리 실패: ${err.message}` });
    }
  });

  // GET /api/exams/:id/pdf-full?grade=&cert= → 원본(답지 포함). 제출 기록 있을 때만.
  r.get('/api/exams/:id/pdf-full', (req, res) => {
    const ctx = resolveCtx(req, res, true);
    if (!ctx) return undefined;
    if (!attemptGateOpen(repoRoot, ctx.grade, ctx.cert, ctx.id)) {
      return res
        .status(403)
        .json({ error: '제출한 풀이가 있어야 원본(답지 포함)을 열 수 있습니다.' });
    }
    const src = safePdfPath(repoRoot, ctx.grade, ctx.cert, ctx.id);
    if (!src) return res.status(404).json({ error: '기출 PDF를 찾을 수 없습니다.' });
    res.type('application/pdf');
    res.setHeader('Cache-Control', 'private, no-cache');
    return res.sendFile(src);
  });

  // GET /api/exams/:id/omr?grade=&cert= → OMR 시트 구조(문항수·과목범위). 정답 미포함.
  r.get('/api/exams/:id/omr', (req, res) => {
    const ctx = resolveCtx(req, res, true);
    if (!ctx) return undefined;
    return res.json({
      id: ctx.id,
      ...omrStructure(repoRoot, ctx.grade, ctx.cert, ctx.id),
    });
  });

  // GET /api/exams/:id/answers?grade=&cert= → 정답표(“답 포함 열람” 모드 전용, 읽기 전용).
  // /omr 과 달리 정답 값을 포함한다. 사용자가 의도적으로 답을 보는 열람 모드에서만 호출하며,
  // 정답 md가 있는(정답등록) 기출에 한해 노출한다. 답지 PDF 게이팅(pdf-full)과는 무관하다.
  r.get('/api/exams/:id/answers', (req, res) => {
    const ctx = resolveCtx(req, res, true);
    if (!ctx) return undefined;
    const 정답Path = path.join(기출Dir(repoRoot, ctx.grade, ctx.cert), 정답, `${nfc(ctx.id)}.md`);
    if (!fs.existsSync(정답Path)) {
      return res.status(404).json({ error: '정답이 등록되지 않은 기출입니다.' });
    }
    const parsed = answerKey.parse(fs.readFileSync(정답Path, 'utf8'), { 시험ID: ctx.id });
    return res.json({
      id: ctx.id,
      등록: true,
      문항수: parsed.문항수,
      과목들: parsed.과목들.map((s) => ({ 과목명: s.과목명, 시작: s.시작, 끝: s.끝, 정답: s.정답 })),
    });
  });

  // --- 임시저장(드래프트): 서버 소유 쓰기. 닉네임은 서버 config에서만 취득(클라 입력 아님) ---

  // GET /api/draft/:examId → 이어풀기용 저장 드래프트(없으면 null).
  r.get('/api/draft/:examId', (req, res) => {
    const nick = nickname.getNickname();
    if (!nick) return res.status(400).json({ error: '닉네임을 먼저 설정하세요.' });
    const id = nfc(req.params.examId);
    if (!EXAM_ID.test(id)) return res.status(400).json({ error: '잘못된 시험 id 형식입니다.' });
    try {
      return res.json({ examId: id, draft: draftStore.readDraft(nick, id) });
    } catch (err) {
      return res.status(500).json({ error: `드래프트 읽기 실패: ${err.message}` });
    }
  });

  // PUT /api/draft/:examId → 드래프트 원자 저장(디바운스는 클라이언트). 비-GET → 토큰 필수(전역).
  r.put('/api/draft/:examId', (req, res) => {
    const nick = nickname.getNickname();
    if (!nick) return res.status(400).json({ error: '닉네임을 먼저 설정하세요.' });
    const id = nfc(req.params.examId);
    if (!EXAM_ID.test(id)) return res.status(400).json({ error: '잘못된 시험 id 형식입니다.' });
    try {
      const saved = draftStore.writeDraft(nick, id, req.body);
      return res.json(saved);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // POST /api/exams/:id/answer-key?grade=&cert= → 수동 정답 입력 폼 저장(정답 md 생성기).
  // 추출 실패(needsManualForm) 시 막다른 길 방지 — 서버 결정적 쓰기 + INDEX 부기. 비-GET → 토큰 필수.
  // body: { 숨김페이지수, 과목들:[{ 과목명, 시작, 끝, 정답:{ [문번]:1~4 } }] }
  r.post('/api/exams/:id/answer-key', async (req, res) => {
    const ctx = resolveCtx(req, res, true);
    if (!ctx) return undefined;
    const body = req.body || {};
    const 과목들 = Array.isArray(body.과목들) ? body.과목들 : null;
    if (!과목들 || 과목들.length === 0) {
      return res.status(400).json({ error: '과목·정답 구성이 필요합니다.' });
    }
    // 생성 → 파싱 검증(자동 구조검증, 사람 게이트 아님). 오류 시 저장하지 않고 사유 반환.
    const md = buildAnswerKeyMd(과목들, { 숨김페이지수: body.숨김페이지수 });
    const parsed = answerKey.parse(md, { 시험ID: ctx.id });
    if (parsed.검증오류.length > 0) {
      return res.status(400).json({ error: '정답 구조 검증 실패', 검증오류: parsed.검증오류 });
    }
    try {
      // 저장소 쓰기(정답 md + INDEX)는 CLI 잡 큐와 직렬화 — 실행 중인 잡의 감사가
      // 이 쓰기를 "경계 밖 변경"으로 오인해 잡 원복·파일 삭제를 일으키지 않게 한다.
      await serialize(async () => {
        const dir = 기출Dir(repoRoot, ctx.grade, ctx.cert);
        const 정답Dir = path.join(dir, 정답);
        fs.mkdirSync(정답Dir, { recursive: true });
        // 쓰기 경계 강제(정답 디렉토리 내부인지 realpath 검증).
        const target = security.assertWithinRoots(path.join(정답Dir, `${ctx.id}.md`), [정답Dir]);
        atomicWrite(target, Buffer.from(md, 'utf8'));

        // INDEX 부기(원자 upsert). PDF 파일명 = {id}.pdf.
        const indexPath = path.join(dir, 'INDEX.md');
        let indexSrc = '';
        try {
          indexSrc = fs.readFileSync(indexPath, 'utf8');
        } catch (_e) {
          /* 없으면 신규 생성 */
        }
        const meta = parseExamId(ctx.id) || {};
        const updated = examIndex.upsert(indexSrc, {
          파일명: `${ctx.id}.pdf`,
          연도: meta.연도,
          식별자: meta.식별자,
          구분: meta.구분,
          문항수: parsed.문항수,
          정답포함: true,
          숨김페이지수: parsed.숨김페이지수,
          등록자: nickname.getNickname() || '',
          비고: '수동 정답 입력',
        });
        atomicWrite(indexPath, Buffer.from(updated, 'utf8'));
      });

      if (deps.hub && typeof deps.hub.broadcast === 'function') {
        deps.hub.broadcast('fs-change', { kind: 'answer-key', 시험ID: ctx.id });
      }

      // 문항 단위 추출 자동 시도(백그라운드): 수동 등록 기출도 PDF가 있으면 문항 md를
      // 만들어 챗 컨텍스트를 경량화한다. 스캔 PDF라 실패할 수 있음 — 사유는 SSE·로그로
      // 통지되고 실패해도 등록은 유효하다(막다른 길 없음).
      let questionsJobId = null;
      if (deps.cli && deps.cli.record) {
        try {
          const bridge = createBridge({ config: deps.config, repoRoot, cli: deps.cli });
          const hubBroadcast =
            deps.hub && typeof deps.hub.broadcast === 'function'
              ? deps.hub.broadcast
              : () => {};
          const qr = questionRunner.start(
            { repoRoot, bridge, broadcast: hubBroadcast },
            { grade: ctx.grade, cert: ctx.cert, examId: ctx.id }
          );
          questionsJobId = qr.jobId || null;
        } catch (qe) {
          process.stderr.write(`[answer-key] ${ctx.id}: 문항 추출 시작 실패 — ${qe.message}\n`);
        }
      }
      return res.json({
        ok: true,
        시험ID: ctx.id,
        문항수: parsed.문항수,
        숨김페이지수: parsed.숨김페이지수,
        questionsJobId,
      });
    } catch (err) {
      const code = err.code === 'EWRITEBOUNDARY' ? 403 : 500;
      return res.status(code).json({ error: err.message });
    }
  });

  // GET /vendor/pdfjs/:file → pdfjs-dist 로컬 서빙(외부 CDN 금지 — 로컬 전용 앱).
  r.get('/vendor/pdfjs/:file', (req, res) => {
    const 허용 = {
      'pdf.mjs': 'pdfjs-dist/build/pdf.mjs',
      'pdf.min.mjs': 'pdfjs-dist/build/pdf.min.mjs',
      'pdf.worker.mjs': 'pdfjs-dist/build/pdf.worker.mjs',
      'pdf.worker.min.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
    };
    const spec = 허용[req.params.file];
    if (!spec) return res.status(404).end();
    let p;
    try {
      // eslint-disable-next-line global-require
      p = require.resolve(spec);
    } catch (_e) {
      return res.status(404).end();
    }
    res.type('text/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(p);
  });

  // GET /vendor/marked.js → marked ESM 로컬 서빙(챗 응답 마크다운 렌더용, 외부 CDN 금지).
  r.get('/vendor/marked.js', (req, res) => {
    let p;
    try {
      // exports 제약 우회: 패키지 lib 디렉토리에서 ESM 빌드를 직접 가리킨다.
      // eslint-disable-next-line global-require
      p = path.join(path.dirname(require.resolve('marked')), 'marked.esm.js');
      if (!fs.existsSync(p)) return res.status(404).end();
    } catch (_e) {
      return res.status(404).end();
    }
    res.type('text/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(p);
  });

  return r;
}

module.exports = {
  router,
  EXAM_ID,
  parseExamId,
  validateGradeCert,
  hiddenCountFor,
  omrStructure,
  buildAnswerKeyMd,
  listExams,
  hasSubmittedAttempt,
  attemptGateOpen,
  safePdfPath,
};
