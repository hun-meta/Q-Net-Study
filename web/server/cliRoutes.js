'use strict';

// CLI 브리지 라우트: 업로드→추출, 챗(agy 스트리밍), 승인 정리(claude 직접 쓰기).
//
// 계약(team-lead 확정): module.exports = { router(deps) } — 전체 경로를 직접 정의한다.
//   deps = { token, cli:{chat,record}, repoRoot, hub, config }.
//   app.js 가 app.use(router)로 마운트하며 전역 보안 가드(Host·Origin·X-QNet-Token)와
//   express.json 파서는 이미 적용되어 있다(비-GET → 토큰 필수).
//
// 파일 쓰기 주체:
//   - PDF 배치·INDEX 부기 = 서버 결정적 쓰기(security.assertWithinRoots 경계 강제).
//   - 정답 추출·정리 기록 = claude 직접 쓰기 → cliBridge 잡 종료 후 audit 사후 감사.

const fs = require('fs');
const path = require('path');
const express = require('express');

const security = require('./security');
const repo = require('./repo');
const nickname = require('./nickname');
const answerKey = require('./answerKey');
const examIndex = require('./examIndex');
const configMod = require('./config');
const { createBridge, serialize } = require('./cliBridge');

// 경로 세그먼트 안전성 검사(라우트 파라미터·파일명 탈출 차단).
const UNSAFE = /[\\/\0\r\n\t]/;
function 안전세그먼트(v, 이름) {
  const s = repo.nfc(v == null ? '' : v).trim();
  if (!s) throw httpError(400, `${이름}이(가) 비어 있습니다.`);
  if (UNSAFE.test(s) || s === '.' || s === '..' || s.startsWith('.')) {
    throw httpError(400, `${이름}에 허용되지 않는 문자가 있습니다.`);
  }
  return s;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// 루트 종류(분야) 디렉토리 예약어(blocklist) — worker-1 repo.js 새 계약과 정합.
// 화이트리스트 폐지: web·docs·templates·node_modules·'.'/'_' 시작만 배제한다.
const 종류_BLOCKLIST = new Set(['web', 'docs', 'templates', 'node_modules']);
function 종류검증(v) {
  const s = 안전세그먼트(v, '종류'); // 경로 구분자·제어문자·'.'시작 차단
  if (s.startsWith('_')) throw httpError(400, "종류는 '_'로 시작할 수 없습니다(공용 디렉토리 예약).");
  if (종류_BLOCKLIST.has(s)) throw httpError(400, '예약된 디렉토리명은 종류로 쓸 수 없습니다.');
  return s;
}

// 자격증 컨텍스트(종류(분야)/자격증) 검증·해석.
// API 파라미터명 grade 는 하위호환으로 유지하되 의미는 종류(분야, 예: 정보처리).
function 자격증컨텍스트(body) {
  const grade = 종류검증(body && body.grade);
  const cert = 안전세그먼트(body && body.cert, '자격증');
  return { grade, cert };
}

// 무결성 감시 대상(walk 제외 경로 → 해시 별도 감시).
// .git/config·info/exclude 추가(F2): git config로 임의 명령 심기(core.fsmonitor, alias 등) 사각지대 차단.
function 무결성대상(repoRoot) {
  return [
    { label: 'config.json', path: configMod.CONFIG_PATH },
    { label: '.git/hooks', path: path.join(repoRoot, '.git', 'hooks') },
    { label: '.git/config', path: path.join(repoRoot, '.git', 'config') },
    { label: '.git/info/exclude', path: path.join(repoRoot, '.git', 'info', 'exclude') },
  ];
}

// 시험ID "{연도}-{식별자}-{구분}" 견고 파싱(CR-3): 상시 식별자의 하이픈 보존.
// 마지막 조각=구분, 첫 조각=연도, 중간 join=식별자. 형식 위반 시 null.
const EXAM_ID_RE = /^(\d{4})-(.+)-(필기|실기)$/;
function parse시험ID(id) {
  const m = repo.nfc(id).match(EXAM_ID_RE);
  if (!m) return null;
  return { 연도: m[1], 식별자: m[2], 구분: m[3] };
}

// tmp→rename 원자 쓰기(서버 결정적 쓰기 공통).
function 원자쓰기(target, buf) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
}

function router(deps) {
  const { cli, repoRoot, hub, config } = deps;
  const r = express.Router();
  const bridge = createBridge({ config, repoRoot, cli });
  const broadcast = hub && typeof hub.broadcast === 'function' ? hub.broadcast : () => {};

  // CLI 가용성 게이트. 미설치/미로그인 → 503 + 폴백 안내(핵심 루프는 계속 동작).
  function requireCli(role, res) {
    if (role === 'chat' && !cli.chat) {
      res.status(503).json({
        error: 'agy(챗) CLI 가 감지되지 않았습니다. 챗 기능은 비활성 상태이며 풀이·채점·기록은 정상 동작합니다.',
        cli: 'chat',
      });
      return false;
    }
    if (role === 'record' && !cli.record) {
      res.status(503).json({
        error: 'claude(기록) CLI 가 감지되지 않았습니다. 정리·추출은 비활성이며 정답 수동 입력·풀이·채점은 정상 동작합니다.',
        cli: 'record',
      });
      return false;
    }
    return true;
  }

  // ── 업로드 → 정답 추출 ────────────────────────────────────────────────
  // body: { grade, cert, filename(.pdf), contentBase64, 시험ID, 총페이지 }
  // PDF 를 _공통/기출문제/ 에 서버가 원자 배치 → claude 추출 잡 → 구조 검증 →
  // 통과 시 INDEX 부기(서버), 실패 시 수동 입력 폼 신호 반환(막다른 길 없음).
  r.post('/api/exams/upload', async (req, res) => {
    try {
      const body = req.body || {};
      const { grade, cert } = 자격증컨텍스트(body);
      const filename = 안전세그먼트(body.filename, '파일명');
      if (!/\.pdf$/i.test(filename)) throw httpError(400, 'PDF 파일만 업로드할 수 있습니다.');
      const 시험ID = 안전세그먼트(body.시험ID, '시험ID');
      const 시험조각 = parse시험ID(시험ID);
      if (!시험조각) throw httpError(400, '시험ID 형식이 올바르지 않습니다({연도}-{식별자}-{필기|실기}).');
      const 총페이지 = Number(body.총페이지) || null;
      if (typeof body.contentBase64 !== 'string' || !body.contentBase64) {
        throw httpError(400, 'PDF 내용(contentBase64)이 없습니다.');
      }

      const common = repo.commonDir(repoRoot, grade, cert);
      const 기출Dir = path.join(common, '기출문제');
      const 정답Dir = path.join(기출Dir, '정답');
      // 경계 검증(assertWithinRoots)은 루트 realpath를 요구하므로 목적지 디렉토리를 먼저 만든다.
      fs.mkdirSync(정답Dir, { recursive: true });
      const pdfPath = security.assertWithinRoots(path.join(기출Dir, filename), [기출Dir]);
      const answerPath = security.assertWithinRoots(path.join(정답Dir, `${시험ID}.md`), [정답Dir]);

      // 서버 결정적 쓰기(PDF 배치)는 **잡 큐 안(스냅샷 직전)** 에서 수행한다.
      // 요청 시점에 바로 쓰면 실행 중인 다른 CLI 잡의 감사가 이 PDF 를 "경계 밖 변경"으로
      // 오인해 그 잡 전체 원복 + 이 PDF 삭제가 일어난다(동시 업로드 레이스 — 실측 재현됨).
      const placePdf = () => {
        원자쓰기(pdfPath, Buffer.from(body.contentBase64, 'base64'));
        broadcast('fs-change', { kind: 'exam-upload', 시험ID });
        process.stderr.write(`[exam-upload] ${시험ID}: PDF 배치 완료\n`);
      };

      if (!cli.record) {
        // 추출 비활성이어도 PDF 는 배치(수동 폼 경로 — 막다른 길 없음). 큐로 직렬화해 배치.
        await bridge.enqueue(async () => placePdf());
        requireCli('record', res); // 503 응답 전송
        return;
      }

      // claude 추출 잡(사후 감사: 정답 디렉토리만 목적지). PDF 배치는 잡 차례에 prepare 로.
      process.stderr.write(`[exam-upload] ${시험ID}: claude 정답 추출 잡 대기열 등록\n`);
      const job = await bridge.extract({
        prepare: placePdf,
        pdfPath,
        answerPath,
        examId: 시험ID,
        nickname: nickname.getNickname(),
        // F1: 쓰기 권한(--add-dir repoRoot)과 동일한 전역 감시. 목적지(정답Dir) 밖 변경은 경계 위반.
        monitorRoots: [repoRoot],
        auditDestinations: [정답Dir],
        integrityTargets: 무결성대상(repoRoot),
      });
      if (!job.audit.clean) {
        process.stderr.write(
          `[exam-upload] ${시험ID}: 감사 위반 — ${(job.audit.violations || []).join(' / ')}\n`
        );
        broadcast('audit-warning', { where: 'extract', violations: job.audit.violations });
      }

      // 구조 검증(사람 게이트 아님 — 자동 파싱·도메인·합계 검사).
      // claude 가 남긴 최종 메시지(job.result) = 실패 시 실제 사유. 폼·로그에 그대로 노출한다.
      const 추출메시지 = (job.result || '').trim().slice(0, 1000) || null;
      let 정답내용 = null;
      try {
        정답내용 = fs.readFileSync(answerPath, 'utf8');
      } catch (_e) {
        // 파일 미생성: 타임아웃·오류·감사원복·판독불가 등을 구분해 사유를 명시한다.
        const reason = job.timedOut
          ? '자동 추출이 제한 시간(5분)을 초과했습니다.'
          : job.isError
          ? '자동 추출 중 오류가 발생했습니다.'
          : job.audit && !job.audit.clean
          ? '추출 결과가 사후 감사로 원복되었습니다(잡 실행 중 승인 경계 밖 파일 변경 감지). 잠시 후 같은 PDF 로 다시 업로드해 보세요.'
          : '자동 추출이 정답 파일을 만들지 못했습니다(판독 불가·정답표 없음·저작권 자료 등). 아래 사유를 확인하세요.';
        process.stderr.write(
          `[exam-upload] ${시험ID}: 정답 파일 미생성 — timedOut=${job.timedOut} isError=${job.isError} ` +
            `auditClean=${job.audit && job.audit.clean} claude="${(job.result || '').replace(/\s+/g, ' ').trim().slice(0, 240)}"\n`
        );
        return res.json({
          ok: false,
          needsManualForm: true,
          reason,
          추출메시지, // claude 가 남긴 실제 사유(있으면)
          timedOut: job.timedOut,
          isError: job.isError,
          audit: job.audit,
        });
      }
      const parsed = answerKey.parse(정답내용, { 시험ID, 총페이지 });
      if (parsed.검증오류.length > 0) {
        process.stderr.write(`[exam-upload] ${시험ID}: 정답 구조 검증 실패 — ${parsed.검증오류.join('; ')}\n`);
        return res.json({
          ok: false,
          needsManualForm: true,
          reason: '추출된 정답의 구조 검증에 실패했습니다(문항수·정답 도메인·페이지 범위 등).',
          검증오류: parsed.검증오류,
          추출메시지,
          audit: job.audit,
        });
      }

      // 서버 부기: INDEX 행 upsert(원자 쓰기). 다음 잡이 이미 실행 중일 수 있으므로
      // 잡 큐와 직렬화해 감사 오인(경계 밖 변경)을 원천 차단한다.
      await serialize(async () => {
        const indexPath = path.join(기출Dir, 'INDEX.md');
        let indexSrc = '';
        try {
          indexSrc = fs.readFileSync(indexPath, 'utf8');
        } catch (_e) {
          /* 없으면 신규 생성 */
        }
        const updated = examIndex.upsert(indexSrc, {
          파일명: filename,
          연도: 시험조각.연도,
          식별자: 시험조각.식별자,
          구분: 시험조각.구분,
          문항수: parsed.문항수,
          정답포함: true,
          숨김페이지수: parsed.숨김페이지수,
          등록자: nickname.getNickname() || '',
          비고: `추출:${parsed.추출도구 || 'claude'}`,
        });
        원자쓰기(indexPath, Buffer.from(updated, 'utf8'));
      });
      broadcast('fs-change', { kind: 'exam-index', 시험ID });

      process.stderr.write(`[exam-upload] ${시험ID}: 정답 ${parsed.문항수}문항 추출·INDEX 부기 완료\n`);
      return res.json({
        ok: true,
        시험ID,
        문항수: parsed.문항수,
        숨김페이지수: parsed.숨김페이지수,
        audit: job.audit,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── 챗(agy 스트리밍, 표시만) ──────────────────────────────────────────
  // body: { grade, cert, message, history:[{role,text}], contextText }
  // 응답: NDJSON 스트림 — {"type":"chunk","text":..} 다수 + {"type":"done",audit} | {"type":"error"}.
  r.post('/api/chat/:examId/:qno', async (req, res) => {
    if (!requireCli('chat', res)) return;
    let examId;
    let qno;
    try {
      examId = 안전세그먼트(req.params.examId, '시험ID');
      qno = 안전세그먼트(req.params.qno, '문번');
      자격증컨텍스트(req.body || {}); // grade/cert 검증(스코프 확인용)
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    const 보냄 = (obj) => {
      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch (_e) {
        /* 끊긴 연결 */
      }
    };

    try {
      const body = req.body || {};
      const job = await bridge.chat({
        examId,
        qno,
        contextText: body.contextText,
        history: body.history,
        message: body.message,
        nickname: nickname.getNickname(),
        monitorRoots: [repoRoot],
        integrityTargets: 무결성대상(repoRoot),
        onData: (chunk) => 보냄({ type: 'chunk', text: chunk }),
      });
      if (!job.audit.clean) {
        broadcast('audit-warning', { where: 'chat', violations: job.audit.violations });
      }
      보냄({ type: 'done', timedOut: job.timedOut, audit: job.audit });
    } catch (err) {
      보냄({ type: 'error', error: err.message });
    }
    return res.end();
  });

  // ── 승인 정리(claude 직접 쓰기) ───────────────────────────────────────
  // body: { grade, cert, examId, qno, conversation, destinations:{note,shared} }
  r.post('/api/chat/approve', async (req, res) => {
    if (!requireCli('record', res)) return;
    try {
      const body = req.body || {};
      const { grade, cert } = 자격증컨텍스트(body);
      const examId = 안전세그먼트(body.examId, '시험ID');
      const qno = 안전세그먼트(body.qno, '문번');
      const nick = nickname.getNickname();
      if (!nick) throw httpError(400, '닉네임이 설정되지 않았습니다.');

      const wantNote = !body.destinations || body.destinations.note !== false;
      const wantShared = !body.destinations || body.destinations.shared !== false;
      if (!wantNote && !wantShared) throw httpError(400, '기록 목적지를 하나 이상 선택하세요.');

      const participant = repo.participantDir(repoRoot, grade, cert, nick);
      const common = repo.commonDir(repoRoot, grade, cert);
      const notesDir = path.join(participant, 'notes');
      const 풀이Dir = path.join(common, '풀이', examId);

      const destinations = [];
      const sharedRoots = [];
      const dest = {};
      if (wantNote) {
        destinations.push(notesDir);
        dest.note = notesDir;
      }
      if (wantShared) {
        destinations.push(풀이Dir);
        sharedRoots.push(풀이Dir);
        dest.shared = path.join(풀이Dir, `${qno}.md`);
      }

      const today = new Date().toISOString().slice(0, 10);
      const job = await bridge.record({
        examId,
        qno,
        conversation: body.conversation,
        destinations: dest, // 프롬프트용 {note,shared} 경로 객체
        nickname: nick,
        today,
        // F1: record 도 --add-dir repoRoot 로 전 저장소 쓰기가 가능하므로 전역 감시.
        // 승인 목적지(auditDestinations) 밖 변경 — 공유 정답 키·타 참여자 노트 변조 등 —은
        // 경계 위반으로 잡 전체 원자 원복된다.
        monitorRoots: [repoRoot],
        auditDestinations: destinations, // 감사용 목적지 디렉토리 배열(allowlist)
        sharedRoots,
        integrityTargets: 무결성대상(repoRoot),
      });

      if (!job.audit.clean) {
        broadcast('audit-warning', { where: 'record', violations: job.audit.violations });
      }
      broadcast('fs-change', { kind: 'record', examId, qno });
      return res.json({
        ok: job.audit.clean && !job.isError,
        timedOut: job.timedOut,
        audit: job.audit,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  return r;
}

module.exports = { router };
