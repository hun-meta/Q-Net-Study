'use strict';

// 문항 단위 추출 러너: 시험 1건 = 과목 N개의 questions 잡(cliBridge.extractQuestions)을
// 순차 실행 → questionStore 검증(정답 md 대조) → SSE 통지.
//
// 요청/잡 분리(record 잡 전례): start()는 즉시 jobId를 반환하고, 잡은 공유 큐에서
// 계속 돌다가 완료 시 SSE 'questions-done' 으로 통지한다. 상태는 getJob()으로도 조회.
// 레지스트리는 모듈 전역(sharedEnqueue 전례) — 업로드 자동 트리거(cliRoutes)·수동 정답
// 등록 트리거(examList)·수동/백필(questionRoutes) 어디서 시작해도 한 곳에서 조회된다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repo = require('./repo');
const security = require('./security');
const answerKey = require('./answerKey');
const questionStore = require('./questionStore');
const configMod = require('./config');
const logger = require('./logger');

const 원문자 = ['①', '②', '③', '④'];

// ── 잡 레지스트리(모듈 전역, 인메모리) ──────────────────────────────────────
const jobs = new Map(); // jobId → { status:'running'|'done', at, grade, cert, examId, 단계, result? }
const JOB_KEEP = 50;

function pruneJobs() {
  if (jobs.size <= JOB_KEEP) return;
  const done = [...jobs.entries()].filter(([, v]) => v.status === 'done');
  done.sort((a, b) => a[1].at - b[1].at);
  while (jobs.size > JOB_KEEP && done.length) {
    jobs.delete(done.shift()[0]);
  }
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function findRunning(grade, cert, examId) {
  for (const [jobId, j] of jobs) {
    if (
      j.status === 'running' &&
      j.grade === grade &&
      j.cert === cert &&
      j.examId === examId
    ) {
      return jobId;
    }
  }
  return null;
}

// 무결성 감시 대상(cliRoutes.무결성대상과 동일 정책 — 순환 의존 회피용 자체 정의).
function 무결성대상(repoRoot) {
  return [
    { label: 'config.json', path: configMod.CONFIG_PATH },
    { label: '.git/hooks', path: path.join(repoRoot, '.git', 'hooks') },
    { label: '.git/config', path: path.join(repoRoot, '.git', 'config') },
    { label: '.git/info/exclude', path: path.join(repoRoot, '.git', 'info', 'exclude') },
  ];
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// PDF 경로 안전 해석(기출문제 디렉토리 경계). 부재·경계 밖이면 null.
function safePdfPath(repoRoot, grade, cert, examId) {
  const dir = path.join(repo.commonDir(repoRoot, grade, cert), '기출문제');
  const target = path.join(dir, `${examId}.pdf`);
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

// 정답 md 로드+파싱. 부재·구조 불충분이면 httpError를 던진다(문항추출의 전제조건).
function loadAnswerKey(repoRoot, grade, cert, examId) {
  const 정답Path = path.join(
    repo.commonDir(repoRoot, grade, cert),
    '기출문제',
    '정답',
    `${examId}.md`
  );
  if (!fs.existsSync(정답Path)) {
    throw httpError(400, '정답 md가 없습니다 — 정답 등록(자동 추출 또는 수동 입력) 후 문항 추출이 가능합니다.');
  }
  const parsed = answerKey.parse(fs.readFileSync(정답Path, 'utf8'), { 시험ID: examId });
  if (!Number.isInteger(parsed.문항수) || parsed.문항수 <= 0 || parsed.과목들.length === 0) {
    throw httpError(400, `정답 md 구조가 불충분합니다(문항수·과목 섹션 필요): ${parsed.검증오류.join('; ')}`);
  }
  return parsed;
}

// 문항추출 시작. deps = { repoRoot, bridge, broadcast }.
// opts = { grade, cert, examId, force }.
// 반환(동기): { jobId } | { jobId, dedup:true } | { skipped:true, 존재수, 문항수 }.
// 전제조건 위반(정답 md 부재·PDF 부재)은 status 있는 Error를 던진다.
// 시험 단위 순차 체인: 여러 시험(백필·업로드·수동)이 동시에 start() 돼도
// 한 시험을 5과목까지 끝낸 뒤 다음 시험으로 넘어가게 직렬화한다(과목1끼리 인터리브 방지).
// 공유 CLI 큐(cliBridge)는 잡 단위 직렬화만 하므로, 여기서 시험 단위 경계를 추가로 준다.
let examChain = Promise.resolve();

// 실제 실행(과목 순차 + 이어하기 skip + 검증). 자체적으로 job 상태·SSE를 마감하고 result를 반환한다.
// 절대 reject 하지 않는다(examChain 건강 유지) — 오류도 result.ok=false 로 흡수.
async function runExam({ repoRoot, bridge, broadcast, grade, cert, examId, jobId, ak, pdfPath, outDir }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const 과목결과 = [];
    for (let i = 0; i < ak.과목들.length; i += 1) {
      const s = ak.과목들[i];
      jobs.set(jobId, { ...jobs.get(jobId), 단계: `${s.과목명} (${i + 1}/${ak.과목들.length})` });
      // 이어하기: 이 과목 범위가 이미 완비면 재추출을 건너뛴다(부분만 있으면 재실행).
      const 이어감 = questionStore.rangeComplete(repoRoot, grade, cert, examId, s.시작, s.끝);
      broadcast('questions-progress', {
        jobId, examId, grade, cert, 과목명: s.과목명, 순번: i + 1, 전체: ak.과목들.length, skipped: 이어감,
      });
      if (이어감) {
        과목결과.push({ 과목명: s.과목명, skipped: true, timedOut: false, isError: false, auditClean: true });
        continue;
      }
      const 정답표 = [];
      for (let q = s.시작; q <= s.끝; q += 1) {
        const v = s.정답 ? s.정답[q] : null;
        정답표.push({ 문번: q, 정답표시: v >= 1 && v <= 4 ? 원문자[v - 1] : '' });
      }
      const job = await bridge.extractQuestions({
        pdfPath, examId, outDir,
        과목명: s.과목명, 시작: s.시작, 끝: s.끝, 정답표, today,
        monitorRoots: [repoRoot],
        auditDestinations: [outDir],
        integrityTargets: 무결성대상(repoRoot),
      });
      과목결과.push({
        과목명: s.과목명, timedOut: job.timedOut, isError: job.isError, auditClean: job.audit.clean,
      });
      if (!job.audit.clean) {
        broadcast('audit-warning', { where: 'questions', violations: job.audit.violations });
      }
    }

    // 검증: 존재(완비) + 내용(정답 md 대조). 오류는 상한을 두고 수집.
    const comp2 = questionStore.completeness(repoRoot, grade, cert, examId, ak.문항수);
    const 검증오류 = [];
    for (let q = 1; q <= ak.문항수 && 검증오류.length < 50; q += 1) {
      const parsed = questionStore.read(repoRoot, grade, cert, examId, q);
      if (!parsed) continue; // 부재는 comp2.누락문번이 담당
      검증오류.push(...questionStore.validate(parsed, ak, q));
    }
    const 잡문제 = 과목결과.some((r) => r.timedOut || r.isError || !r.auditClean);
    const result = {
      ok: comp2.완비 && 검증오류.length === 0 && !잡문제,
      문항수: ak.문항수,
      존재수: comp2.존재수,
      누락문번: comp2.누락문번,
      검증오류: 검증오류.slice(0, 50),
      과목결과,
    };
    jobs.set(jobId, { status: 'done', at: Date.now(), grade, cert, examId, 단계: '완료', result });
    logger.info('questions 러너 완료', {
      examId, grade, cert, ok: result.ok, 존재수: comp2.존재수,
      누락: comp2.누락문번.length, 검증오류: 검증오류.length,
      skip과목: 과목결과.filter((r) => r.skipped).length,
    });
    broadcast('fs-change', { kind: 'questions', examId });
    broadcast('questions-done', { jobId, examId, grade, cert, ...result });
    return result;
  } catch (err) {
    const result = { ok: false, error: err.message };
    jobs.set(jobId, { status: 'done', at: Date.now(), grade, cert, examId, 단계: '오류', result });
    logger.error('questions 러너 오류', { examId, grade, cert, error: err.message });
    broadcast('questions-done', { jobId, examId, grade, cert, ...result });
    return result;
  }
}

function start(deps, opts) {
  const { repoRoot, bridge } = deps;
  const broadcast =
    deps.broadcast && typeof deps.broadcast === 'function' ? deps.broadcast : () => {};
  const grade = repo.nfc(opts.grade);
  const cert = repo.nfc(opts.cert);
  const examId = repo.nfc(opts.examId);
  const force = !!opts.force;

  // 동일 시험의 실행 중/대기 중 잡이 있으면 그 jobId 재사용(중복 큐잉 방지).
  const running = findRunning(grade, cert, examId);
  if (running) return { jobId: running, dedup: true };

  const ak = loadAnswerKey(repoRoot, grade, cert, examId);
  const pdfPath = safePdfPath(repoRoot, grade, cert, examId);
  if (!pdfPath) throw httpError(400, '기출 PDF가 없습니다 — 문항 추출은 PDF가 있어야 합니다.');

  // 멱등: 이미 완비면 고비용 재추출을 건너뛴다(force로 재실행 가능).
  const comp = questionStore.completeness(repoRoot, grade, cert, examId, ak.문항수);
  if (comp.완비 && !force) {
    return { skipped: true, 존재수: comp.존재수, 문항수: ak.문항수 };
  }

  const jobId = crypto.randomUUID();
  // 'running'으로 즉시 등록 → 시험 단위 순차 대기 중에도 findRunning 이 중복 등록을 막는다.
  jobs.set(jobId, { status: 'running', at: Date.now(), grade, cert, examId, 단계: '대기(순차)' });
  pruneJobs();

  const outDir = questionStore.문항Dir(repoRoot, grade, cert, examId);

  // 시험 단위 체인에 매달아 순차 실행. done 은 완료 시 result 로 resolve(절대 reject 안 함).
  const done = examChain.then(() =>
    runExam({ repoRoot, bridge, broadcast, grade, cert, examId, jobId, ak, pdfPath, outDir })
  );
  examChain = done.then(() => undefined, () => undefined);

  return { jobId, done };
}

module.exports = { start, getJob, findRunning, safePdfPath, loadAnswerKey };
