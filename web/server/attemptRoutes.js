'use strict';

// attemptRoutes.js — #6 채점·제출·키워드 보강 라우트
//
// 계약: module.exports = { router(deps) }, deps = { token, cli, repoRoot, hub, config }.
// 채점은 전부 서버(결정적 코드)에서 수행하고 attempt/INDEX/WRONG 3종을 기존 양식대로 기록한다.
// 쓰기는 반드시 security.assertWithinRoots 로 "내 닉네임 디렉토리" 경계를 강제한 뒤 tmp→rename.
//
// POST /api/attempts/:examId/submit    — 답안 제출 → 채점 → 3종 기록
// POST /api/attempts/:examId/keywords  — 제출 직후 키워드/메모 보강(선택·멱등)

const fs = require('fs');
const path = require('path');

const repo = require('./repo');
const security = require('./security');
const nickname = require('./nickname');
const answerKey = require('./answerKey');
const passCriteria = require('./passCriteria');
const grading = require('./grading');
const writer = require('./attemptWriter');
const reader = require('./attemptReader');
const draftStore = require('./draftStore');
const { serialize } = require('./cliBridge'); // 저장소 쓰기를 CLI 잡과 직렬화(감사 오인 방지)

const EXAM_ID_RE = /^\d{4}-[^\s/\\]+-(필기|실기)$/u;
// 경로 구분자·상위참조·제어문자 차단(자격증명 검증).
const CERT_INVALID = /[\\/\0\r\n\t]/;

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 디렉토리명(종류=분야 / 자격증) 안전성 검사. 경로 탈출·공용명 차단.
// 종류는 화이트리스트(등급)에서 개방형 분야(예: 정보처리)로 바뀌어, 존재하지 않는 분야는
// 정답 md 부재로 자연히 채점 불가 처리된다(별도 화이트리스트 불필요).
function validateName(value, label) {
  const s = repo.nfc(value == null ? '' : value).trim();
  if (!s) return `${label}이(가) 비어 있습니다.`;
  if (CERT_INVALID.test(s)) return `${label}에 경로 구분자를 쓸 수 없습니다.`;
  if (s.startsWith('.') || s === '_공통') return `유효하지 않은 ${label}입니다.`;
  return null;
}

// grade(종류=분야)/cert(자격증) 유효성 검사. 문제 있으면 메시지 반환(정상이면 null).
function validateScope(grade, cert) {
  return validateName(grade, '종류(분야)') || validateName(cert, '자격증명');
}

function 정답Path(repoRoot, grade, cert, examId) {
  return path.join(repo.commonDir(repoRoot, grade, cert), '기출문제', '정답', `${examId}.md`);
}
function infoPath(repoRoot, grade, cert) {
  return path.join(repo.commonDir(repoRoot, grade, cert), 'info.md');
}
function attemptsDirOf(repoRoot, grade, cert, nick) {
  return path.join(repo.participantDir(repoRoot, grade, cert, nick), 'attempts');
}

// 정답 md 로드·파싱. 없으면 null(→ 채점 불가 응답).
function loadAnswerKey(repoRoot, grade, cert, examId) {
  const p = 정답Path(repoRoot, grade, cert, examId);
  if (!fs.existsSync(p)) return null;
  return answerKey.parse(fs.readFileSync(p, 'utf8'), { 시험ID: examId });
}
function loadPassCriteria(repoRoot, grade, cert) {
  try {
    return passCriteria.parse(fs.readFileSync(infoPath(repoRoot, grade, cert), 'utf8'));
  } catch (_e) {
    return passCriteria.parse(''); // info.md 부재 → 기본 40/60
  }
}

// 해당 시험의 다음 시도 번호(기존 최대 시도 + 1, CLI 기록 포함).
function nextAttemptNo(attemptsDir, examId) {
  const 기존 = reader.listAttempts(attemptsDir).filter((a) => a.시험 === examId);
  let max = 0;
  for (const a of 기존) if (Number(a.시도) > max) max = Number(a.시도);
  return max + 1;
}

// 쓰기 경계 강제: 대상이 내 닉네임 디렉토리 내부인지 검증(아니면 EWRITEBOUNDARY throw).
function guardWithinOwnDir(repoRoot, grade, cert, nick, target) {
  const 내디렉토리 = repo.participantDir(repoRoot, grade, cert, nick);
  return security.assertWithinRoots(target, [내디렉토리]);
}

function router(deps) {
  const express = require('express');
  const r = express.Router();
  const { repoRoot, hub } = deps;

  // ── 시도 이력·추이(읽기 전용) ───────────────────────────────────
  // GET /api/attempts?grade=&cert=&user=&examId=
  //   user 생략 시 현재 닉네임. 타인 이력은 읽기 전용으로 허용.
  r.get('/api/attempts', (req, res) => {
    const { grade, cert } = req.query;
    // examId는 NFC 정규화 후 비교(NFD 기록과 섞여도 일관되게 매칭).
    const examId = req.query.examId ? repo.nfc(req.query.examId) : undefined;
    const scopeErr = validateScope(grade, cert);
    if (scopeErr) return res.status(400).json({ error: scopeErr });
    const userRaw = req.query.user || nickname.getNickname();
    if (!userRaw) return res.status(400).json({ error: '사용자(닉네임)가 필요합니다.' });
    let nick;
    try {
      nick = nickname.validateNickname(userRaw);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (examId && !EXAM_ID_RE.test(examId)) return res.status(400).json({ error: '잘못된 시험ID입니다.' });

    const attemptsDir = attemptsDirOf(repoRoot, grade, cert, nick);
    let attempts = reader.listAttempts(attemptsDir);
    if (examId) attempts = attempts.filter((a) => a.시험 === examId);
    const trend = reader.computeTrend(
      attempts.map((a) => ({ 시험: a.시험, 시도: a.시도, 총점: a.총점, 결과: a.합격여부 }))
    );
    return res.json({ user: nick, attempts, trend });
  });

  // ── 제출·채점·기록 ──────────────────────────────────────────────
  r.post('/api/attempts/:examId/submit', async (req, res) => {
    // NFC 정규화: 경로·파일명·기존 시도 비교를 NFD 기록과 일관되게 맞춘다
    // (정규식 검증도 정규화 후 수행 — NFD 입력이 필기/실기 리터럴과 어긋나는 것 방지).
    const examId = repo.nfc(req.params.examId);
    const body = req.body || {};
    const { grade, cert } = body;

    if (!EXAM_ID_RE.test(examId)) return res.status(400).json({ error: '잘못된 시험ID입니다.' });
    const scopeErr = validateScope(grade, cert);
    if (scopeErr) return res.status(400).json({ error: scopeErr });

    const nick = nickname.getNickname();
    if (!nick) return res.status(400).json({ error: '닉네임이 설정되지 않았습니다 — 먼저 닉네임을 선택하세요.' });

    const key = loadAnswerKey(repoRoot, grade, cert, examId);
    if (!key) {
      return res
        .status(400)
        .json({ error: '정답이 등록되지 않은 기출입니다 — 채점 불가(열람만 가능).', 채점불가: true });
    }
    const pc = loadPassCriteria(repoRoot, grade, cert);

    // 답안 조립: answers(숫자|null) + 찍음(boolean). 확신도 매핑은 grading 내부(찍음→'찍음', 아니면 '확신').
    const answers = body.answers || {};
    const 찍음 = body.찍음 || {};
    const 답안 = {};
    for (const s of key.과목들) {
      for (let q = s.시작; q <= s.끝; q++) {
        const raw = answers[q];
        const 답 = raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : null;
        답안[q] = { 답, 찍음: !!찍음[q] };
      }
    }

    let g;
    try {
      g = grading.grade({ 답안, answerKey: key, passCriteria: pc });
    } catch (err) {
      // 정답 검증오류 → 채점 불가(막다른 길 없음: 정답 md 수정 후 재시도 경로 안내).
      return res.status(400).json({ error: err.message, 채점불가: true, 검증오류: key.검증오류 });
    }

    const attemptsDir = attemptsDirOf(repoRoot, grade, cert, nick);
    const 시도 = nextAttemptNo(attemptsDir, examId);
    const model = {
      자격증: cert,
      시험ID: examId,
      시도,
      풀이일: todayISO(),
      소요시간: body.소요시간 == null ? '' : body.소요시간,
      gradingResult: g,
      키워드맵: {},
    };

    let paths;
    try {
      // 풀이 기록 3종(attempt·INDEX·WRONG) 쓰기를 CLI 잡 큐와 직렬화한다 —
      // 추출·정리 잡(몇 분)이 도는 중에 제출하면, 잡의 사후 감사가 이 기록을
      // "경계 밖 변경"으로 오인해 잡 원복과 함께 삭제하는 사고를 막는다.
      await serialize(async () => {
        // 내 닉네임 디렉토리(신규일 수 있음)를 먼저 생성해야 경계 realpath 검증이 성립.
        fs.mkdirSync(attemptsDir, { recursive: true });
        guardWithinOwnDir(repoRoot, grade, cert, nick, attemptsDir); // 경계 강제
        paths = writer.writeAttemptBundle(attemptsDir, model);
      });
    } catch (err) {
      const code = err.code === 'EWRITEBOUNDARY' ? 403 : 500;
      return res.status(code).json({ error: err.message });
    }

    // 제출 성공 → 드래프트 삭제(재진입 시 낡은 답 재로드 방지). 실패해도 제출 성공에는 영향 없음.
    try {
      draftStore.deleteDraft(nick, examId);
    } catch (_e) {
      /* noop — 드래프트 정리는 부가작업 */
    }

    const rel = (p) => path.relative(repoRoot, p);
    if (hub && typeof hub.broadcast === 'function') {
      hub.broadcast('fs-change', { paths: [rel(paths.attempt), rel(paths.index), rel(paths.wrong)] });
    }

    const wrongTargets = g.문항결과
      .filter((q) => writer.isWrongTarget(q))
      .map((q) => ({ 문번: q.문번, 과목명: q.과목명, 결과: q.결과, 확신도: q.확신도 }));

    return res.json({
      ok: true,
      시험: examId,
      grade,
      cert,
      시도,
      총점: g.총점,
      합격여부: g.합격여부,
      과락발생: g.과락발생,
      과목결과: g.과목결과.map((s) => ({ 과목명: s.과목명, 점수: s.점수, 과락: s.과락 })),
      X수: g.X수,
      O찍음수: g.O찍음수,
      확신정답률: g.확신정답률,
      최저과목: g.최저과목,
      파일: { attempt: rel(paths.attempt), index: rel(paths.index), wrong: rel(paths.wrong) },
      wrongTargets,
    });
  });

  // ── 키워드/메모 보강(선택·멱등) ─────────────────────────────────
  r.post('/api/attempts/:examId/keywords', async (req, res) => {
    const examId = repo.nfc(req.params.examId); // NFC 정규화(파일명·시험ID 일관)
    const body = req.body || {};
    const { grade, cert } = body;
    const 시도 = Number(body.시도);
    const 키워드맵 = body.키워드맵 || {};

    if (!EXAM_ID_RE.test(examId)) return res.status(400).json({ error: '잘못된 시험ID입니다.' });
    const scopeErr = validateScope(grade, cert);
    if (scopeErr) return res.status(400).json({ error: scopeErr });
    if (!Number.isInteger(시도) || 시도 < 1) return res.status(400).json({ error: '유효한 시도 번호가 필요합니다.' });

    const nick = nickname.getNickname();
    if (!nick) return res.status(400).json({ error: '닉네임이 설정되지 않았습니다.' });

    const attemptsDir = attemptsDirOf(repoRoot, grade, cert, nick);
    const attemptPath = path.join(attemptsDir, writer.attemptFileName(examId, 시도));
    const wrongPath = path.join(attemptsDir, 'WRONG.md');

    if (!fs.existsSync(attemptPath)) return res.status(404).json({ error: '해당 시도 기록을 찾을 수 없습니다.' });

    try {
      // 키워드 패치도 CLI 잡 큐와 직렬화(감사 오인 원복 방지 — submit 과 동일 이유).
      await serialize(async () => {
        guardWithinOwnDir(repoRoot, grade, cert, nick, attemptPath);
        guardWithinOwnDir(repoRoot, grade, cert, nick, wrongPath);
        // attempt md: 표 칸 + 오답 헤딩 멱등 패치
        reader.patchKeywordsFile(attemptPath, 키워드맵);
        // WRONG.md: 활성 항목 키워드 갱신
        if (fs.existsSync(wrongPath)) {
          const patched = writer.patchWrongKeywords(fs.readFileSync(wrongPath, 'utf8'), examId, 키워드맵);
          writer.atomicWrite(wrongPath, patched);
        }
      });
    } catch (err) {
      const code = err.code === 'EWRITEBOUNDARY' ? 403 : 500;
      return res.status(code).json({ error: err.message });
    }

    const rel = (p) => path.relative(repoRoot, p);
    if (hub && typeof hub.broadcast === 'function') {
      hub.broadcast('fs-change', { paths: [rel(attemptPath), rel(wrongPath)] });
    }
    return res.json({ ok: true, 파일: { attempt: rel(attemptPath), wrong: rel(wrongPath) } });
  });

  return r;
}

module.exports = { router, validateScope, nextAttemptNo };
