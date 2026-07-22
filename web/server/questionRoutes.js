'use strict';

// 문항 단위 추출·서빙 라우트.
// 마운트 계약: module.exports.router(deps) → express.Router (app.js FEATURE_MODULES).
//   deps = { token, cli, repoRoot, hub, config }.
//
// - POST /api/questions/extract        {grade, cert, examId, force?} → 202+jobId (러너 백그라운드)
// - POST /api/questions/backfill       {grade?, cert?} → 등록 기출 전체(미완비만) 순차 큐잉
// - GET  /api/questions/status/:jobId  → 잡 상태(SSE 'questions-done' 폴백)
// - GET  /api/question/:examId/:qno?grade=&cert=[&withAnswer=1]
//        → 파싱된 문항. 정답은 기본 제외, withAnswer=1 일 때만 포함(챗 solve 스트립은
//          cliRoutes가 서버측에서 별도 수행 — 이 API와 무관).

const express = require('express');

const repo = require('./repo');
const examList = require('./examList');
const questionStore = require('./questionStore');
const questionRunner = require('./questionRunner');
const { createBridge } = require('./cliBridge');

const QNO_RE = /^\d{1,3}$/;

function router(deps) {
  const { cli, repoRoot, hub, config } = deps;
  const r = express.Router();
  const bridge = createBridge({ config, repoRoot, cli });
  const broadcast = hub && typeof hub.broadcast === 'function' ? hub.broadcast : () => {};
  const runnerDeps = { repoRoot, bridge, broadcast };

  // claude(record) 가용성 게이트 — cliRoutes.requireCli와 동일 정책.
  function requireRecord(res) {
    if (!cli.record) {
      res.status(503).json({
        error:
          'claude(기록) CLI 가 감지되지 않았습니다. 문항 추출은 비활성이며 기존 문항 열람·풀이·채점은 정상 동작합니다.',
        cli: 'record',
      });
      return false;
    }
    return true;
  }

  // 요청 컨텍스트 검증(examList.validateGradeCert 재사용).
  function resolveScope(res, grade, cert) {
    const v = examList.validateGradeCert(repoRoot, grade, cert);
    if (v.error) {
      res.status(v.status).json({ error: v.error });
      return null;
    }
    return v;
  }

  // ── 문항 추출(단일 시험) ──────────────────────────────────────────────
  r.post('/api/questions/extract', (req, res) => {
    if (!requireRecord(res)) return undefined;
    const body = req.body || {};
    const scope = resolveScope(res, body.grade, body.cert);
    if (!scope) return undefined;
    const examId = repo.nfc(body.examId || '');
    if (!examList.EXAM_ID.test(examId)) {
      return res.status(400).json({ error: '잘못된 시험 id 형식입니다.' });
    }
    try {
      const out = questionRunner.start(runnerDeps, {
        grade: scope.grade,
        cert: scope.cert,
        examId,
        force: !!body.force,
      });
      if (out.skipped) {
        return res.json({ ok: true, skipped: true, 존재수: out.존재수, 문항수: out.문항수 });
      }
      return res.status(202).json({ jobId: out.jobId, queued: true, dedup: !!out.dedup });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── 백필(등록 기출 일괄) ─────────────────────────────────────────────
  // body: { grade?, cert? } — 지정 시 해당 자격증만, 미지정 시 저장소 전체.
  // 대상: PDF 존재 ∧ 정답등록 ∧ (force 아니면) 미완비. 잡은 공유 큐에서 순차 실행.
  r.post('/api/questions/backfill', (req, res) => {
    if (!requireRecord(res)) return undefined;
    const body = req.body || {};
    const wantGrade = body.grade ? repo.nfc(body.grade) : null;
    const wantCert = body.cert ? repo.nfc(body.cert) : null;

    const queued = [];
    const skipped = [];
    const errors = [];
    for (const c of repo.scanRepo(repoRoot)) {
      if (wantGrade && c.grade !== wantGrade) continue;
      if (wantCert && c.cert !== wantCert) continue;
      let exams;
      try {
        exams = examList.listExams(repoRoot, c.grade, c.cert);
      } catch (_e) {
        continue;
      }
      for (const exam of exams) {
        if (!exam.pdf존재 || !exam.정답등록) continue;
        try {
          const out = questionRunner.start(runnerDeps, {
            grade: c.grade,
            cert: c.cert,
            examId: exam.id,
            force: !!body.force,
          });
          if (out.skipped) skipped.push({ grade: c.grade, cert: c.cert, examId: exam.id });
          else queued.push({ grade: c.grade, cert: c.cert, examId: exam.id, jobId: out.jobId, dedup: !!out.dedup });
        } catch (err) {
          errors.push({ grade: c.grade, cert: c.cert, examId: exam.id, error: err.message });
        }
      }
    }
    return res.status(202).json({ queued, skipped, errors });
  });

  // ── 잡 상태(SSE 폴백, 읽기 전용·비민감 → GET 토큰 게이트 밖) ─────────
  r.get('/api/questions/status/:jobId', (req, res) => {
    const j = questionRunner.getJob(req.params.jobId);
    if (!j) return res.status(404).json({ error: '잡을 찾을 수 없습니다(만료되었거나 없음).' });
    return res.json({
      status: j.status,
      grade: j.grade,
      cert: j.cert,
      examId: j.examId,
      단계: j.단계,
      ...(j.result || {}),
    });
  });

  // ── 문항 서빙(읽기 전용) ─────────────────────────────────────────────
  r.get('/api/question/:examId/:qno', (req, res) => {
    const scope = resolveScope(res, req.query.grade, req.query.cert);
    if (!scope) return undefined;
    const examId = repo.nfc(req.params.examId);
    const qno = String(req.params.qno);
    if (!examList.EXAM_ID.test(examId) || !QNO_RE.test(qno)) {
      return res.status(400).json({ error: '잘못된 시험ID 또는 문번입니다.' });
    }
    const q = questionStore.read(repoRoot, scope.grade, scope.cert, examId, Number(qno));
    if (!q) return res.status(404).json({ error: '문항 데이터가 없습니다(미추출).' });
    const out = {
      시험: examId,
      문번: q.문번,
      과목: q.과목,
      본문md: q.본문md,
      선택지: q.선택지,
      판독불가: q.판독불가,
      추출일: q.추출일,
      파일: q.파일,
    };
    // 정답은 기본 제외(보수적 기본값). view 흐름 등 의도적 조회만 withAnswer=1 로 요청.
    if (String(req.query.withAnswer) === '1') out.정답 = q.정답;
    return res.json(out);
  });

  return r;
}

module.exports = { router };
