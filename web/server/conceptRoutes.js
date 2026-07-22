'use strict';

// conceptRoutes.js — #7 문제 개념 및 풀이 보기 (읽기 전용 라우트)
//
// GET /api/concept/:examId/:qno
//   → 🔁 태그로 연결된 내/타인 노트 섹션 + _공통/풀이/{시험}/{문번}.md 공유 해설을 모아 반환.
// 계약: module.exports = { router(deps) }, deps = { token, cli, repoRoot, hub, config }.
// 쓰기가 없으므로 writeGuard 불필요. 경로 파라미터는 엄격 검증(경로 탈출 차단).

const fs = require('fs');
const path = require('path');

const repo = require('./repo');
const nickname = require('./nickname');
const security = require('./security');
const cfg = require('./config');
const tagIndex = require('./tagIndex');

let markedParse;
try {
  markedParse = require('marked').marked.parse;
} catch (_e) {
  // marked 부재 시에도 원본 md는 제공(html은 null).
  markedParse = null;
}

// 시험ID: {연도(4)}-{식별자}-{필기|실기}. 경로 구분자·상위참조 차단.
const EXAM_ID_RE = /^\d{4}-[^\s/\\]+-(필기|실기)$/u;
const QNO_RE = /^\d+$/;

// `## {섹션제목}` 부터 다음 레벨-2 헤딩 직전까지를 추출(헤딩 포함). 섹션제목이 없으면 전체 반환.
function extractSection(content, 섹션제목) {
  const lines = String(content).split(/\r?\n/);
  if (!섹션제목) return content.trim();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m && !/^###/.test(lines[i]) && m[1].trim() === 섹션제목) {
      start = i;
      break;
    }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

// 공유 해설 파일의 `## {닉네임} (YYYY-MM-DD)` 서명 섹션들을 파싱.
function parseSignatureSections(content) {
  const lines = String(content).split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*\(\s*(\d{4}-\d{2}-\d{2})\s*\)\s*$/);
    if (h) {
      if (cur) sections.push(cur);
      cur = { 닉네임: h[1].trim(), 날짜: h[2], 본문줄: [] };
      continue;
    }
    if (cur) cur.본문줄.push(line);
  }
  if (cur) sections.push(cur);
  return sections.map((s) => ({ 닉네임: s.닉네임, 날짜: s.날짜, 본문: s.본문줄.join('\n').trim() }));
}

// 모든 자격증의 _공통/풀이/{examId}/{qno}.md 를 모아 서명 섹션 목록을 만든다.
function collectSolutions(repoRoot, examId, qno, scope) {
  const out = [];
  const gradeFilter = scope && scope.grade;
  const certFilter = scope && scope.cert;
  for (const { grade, cert } of repo.scanRepo(repoRoot)) {
    if (gradeFilter && grade !== gradeFilter) continue;
    if (certFilter && cert !== certFilter) continue;
    const solPath = path.join(repo.commonDir(repoRoot, grade, cert), '풀이', examId, `${qno}.md`);
    // 방어적 경계 검증: 풀이 디렉토리 밖이면 건너뜀.
    let real;
    try {
      real = security.resolveRealPath(solPath);
      const root = fs.realpathSync.native(repo.commonDir(repoRoot, grade, cert));
      if (!security.isWithin(real, root)) continue;
    } catch (_e) {
      continue;
    }
    if (!fs.existsSync(solPath)) continue;
    let content;
    try {
      content = fs.readFileSync(solPath, 'utf8');
    } catch (_e) {
      continue;
    }
    for (const sec of parseSignatureSections(content)) {
      out.push({ ...sec, grade, cert, 파일: path.relative(repoRoot, solPath) });
    }
  }
  return out;
}

function render(md) {
  if (!md) return '';
  return markedParse ? markedParse(md) : null;
}

// 경로 세그먼트 안전성(분야/자격증 파라미터의 경로 탈출 차단).
const SEG_UNSAFE = /[\\/\0\r\n\t]/;
function safeSeg(v) {
  const s = repo.nfc(v == null ? '' : v).trim();
  if (!s || SEG_UNSAFE.test(s) || s === '.' || s === '..' || s.startsWith('.')) return null;
  return s;
}

// 개인 notes/ 아래의 *.md 를 재귀 수집. 반환: [{ 과목, 항목, abs }]
// notes/{과목}/{NN-주요항목}.md 계층 가정 — 과목 = notes 직하위 첫 디렉토리명.
function walkNoteFiles(notesDir) {
  const out = [];
  function walk(dir, 과목) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, 과목 || repo.nfc(e.name));
      else if (e.isFile() && e.name.endsWith('.md')) {
        out.push({ 과목: 과목 || '', 항목: repo.nfc(e.name).replace(/\.md$/u, ''), abs });
      }
    }
  }
  walk(notesDir, '');
  return out;
}

// 단순 프론트매터 파서(--- ... --- 사이 key: value; 인라인 주석 # 제거).
function parseFrontmatter(content) {
  const m = String(content).match(/^---\n([\s\S]*?)\n---/u);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([^:]+):\s*(.*)$/u);
    if (kv) fm[kv[1].trim()] = kv[2].replace(/\s+#.*$/u, '').trim();
  }
  return fm;
}

// notes/*.md 본문에서 🔁 역참조 태그가 가리키는 문항 라벨을 뽑는다(예: "2025-3회-필기 #1").
const TAG_RE = /🔁\s*기출\s*([0-9]{4}-[^\s#]+)\s*#\s*(\d+)/gu;
function extractRefLabels(content) {
  const set = new Set();
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content)) !== null) set.add(`${m[1]} #${m[2]}`);
  return [...set];
}

function router(deps) {
  const express = require('express');
  const r = express.Router();
  const cachePath = path.join(cfg.STATE_DIR, 'cache', 'tag-index.json');

  r.get('/api/concept/:examId/:qno', (req, res) => {
    const { examId, qno } = req.params;
    if (!EXAM_ID_RE.test(examId) || !QNO_RE.test(qno)) {
      return res.status(400).json({ error: '잘못된 시험ID 또는 문번입니다.' });
    }

    let index;
    try {
      // 요청 시마다 mtime 증분 스캔 → 파일 변경 즉시 반영.
      index = tagIndex.scan(deps.repoRoot, { cachePath });
    } catch (err) {
      return res.status(500).json({ error: `태그 인덱스 스캔 실패: ${err.message}` });
    }

    const me = nickname.getNickname();
    // 자격증 스코프(선택): grade/cert 쿼리가 주어지면 같은 시험ID를 공유하는
    // 타 자격증의 노트/해설이 섞여 들어가는 것을 차단한다(기사·산업기사 시험ID 중복).
    const grade = req.query.grade ? safeSeg(req.query.grade) : null;
    const cert = req.query.cert ? safeSeg(req.query.cert) : null;
    let refs = tagIndex.query(index, examId, qno);
    if (grade || cert) {
      refs = refs.filter((ref) => (!grade || ref.grade === grade) && (!cert || ref.cert === cert));
    }
    const 노트 = [];
    for (const ref of refs) {
      const abs = path.join(deps.repoRoot, ref.relPath);
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (_e) {
        continue;
      }
      const 본문 = extractSection(content, ref.섹션제목);
      if (!본문) continue;
      노트.push({
        닉네임: ref.닉네임,
        grade: ref.grade,
        cert: ref.cert,
        과목: ref.과목,
        파일: ref.relPath,
        섹션제목: ref.섹션제목,
        본문md: 본문,
        본문html: render(본문),
        본인여부: !!me && ref.닉네임 === me,
      });
    }

    const 해설 = collectSolutions(deps.repoRoot, examId, qno, { grade, cert }).map((s) => ({
      ...s,
      본문html: render(s.본문),
    }));

    return res.json({ 시험: examId, 문번: Number(qno), 노트, 해설 });
  });

  // GET /api/notes/:grade/:cert
  //   → 자격증 참여자 전원의 개념 노트(개인 notes/, 기존 비공유 포함) + 공유 풀이(_공통/풀이/) 열람.
  //   읽기 전용. 본인/타인 구분(본인여부)만 표시하고 타인 노트는 수정 경로가 없다.
  r.get('/api/notes/:grade/:cert', (req, res) => {
    const grade = safeSeg(req.params.grade);
    const cert = safeSeg(req.params.cert);
    if (!grade || !cert) return res.status(400).json({ error: '잘못된 분야/자격증입니다.' });

    const certDirAbs = path.join(deps.repoRoot, grade, cert);
    if (!repo.isDir(certDirAbs)) return res.status(404).json({ error: '자격증을 찾을 수 없습니다.' });
    let certReal;
    try {
      certReal = fs.realpathSync.native(certDirAbs);
    } catch (_e) {
      return res.status(404).json({ error: '자격증 경로 해석 실패.' });
    }

    const me = nickname.getNickname();
    const found = repo.scanRepo(deps.repoRoot).find((x) => x.grade === grade && x.cert === cert);
    const participants = found ? found.participants.slice() : [];

    // 개념 노트(참여자 전원의 개인 notes/).
    const 노트 = [];
    for (const nick of participants) {
      const notesDir = path.join(repo.participantDir(deps.repoRoot, grade, cert, nick), 'notes');
      if (!repo.isDir(notesDir)) continue;
      for (const f of walkNoteFiles(notesDir)) {
        // 경계 방어: 자격증 디렉토리 밖(심링크 등)이면 건너뜀.
        try {
          if (!security.isWithin(security.resolveRealPath(f.abs), certReal)) continue;
        } catch (_e) {
          continue;
        }
        let content;
        try {
          content = fs.readFileSync(f.abs, 'utf8');
        } catch (_e) {
          continue;
        }
        const fm = parseFrontmatter(content);
        노트.push({
          닉네임: nick,
          본인여부: !!me && nick === me,
          과목: f.과목 || fm.과목 || '',
          항목: f.항목,
          주요항목: fm.주요항목 || '',
          갱신일: fm.갱신일 || '',
          진행도: fm.진행도 || '',
          기출참조: extractRefLabels(content),
          파일: path.relative(deps.repoRoot, f.abs),
          본문md: content,
          본문html: render(content),
        });
      }
    }

    // 공유 풀이(_공통/풀이/{examId}/{qno}.md → 서명 섹션별로 분해).
    const 풀이 = [];
    const 풀이Root = path.join(repo.commonDir(deps.repoRoot, grade, cert), '풀이');
    if (repo.isDir(풀이Root)) {
      let examDirs;
      try {
        examDirs = fs.readdirSync(풀이Root, { withFileTypes: true });
      } catch (_e) {
        examDirs = [];
      }
      for (const ed of examDirs) {
        if (!ed.isDirectory() || ed.name.startsWith('.')) continue;
        const examId = repo.nfc(ed.name);
        const examDirAbs = path.join(풀이Root, examId);
        let files;
        try {
          files = fs.readdirSync(examDirAbs, { withFileTypes: true });
        } catch (_e) {
          continue;
        }
        for (const fe of files) {
          if (!fe.isFile() || !fe.name.endsWith('.md')) continue;
          const abs = path.join(examDirAbs, fe.name);
          try {
            if (!security.isWithin(security.resolveRealPath(abs), certReal)) continue;
          } catch (_e) {
            continue;
          }
          let content;
          try {
            content = fs.readFileSync(abs, 'utf8');
          } catch (_e) {
            continue;
          }
          const qno = repo.nfc(fe.name).replace(/\.md$/u, '');
          for (const sec of parseSignatureSections(content)) {
            풀이.push({
              examId,
              문번: qno,
              닉네임: sec.닉네임,
              날짜: sec.날짜,
              본인여부: !!me && sec.닉네임 === me,
              파일: path.relative(deps.repoRoot, abs),
              본문md: sec.본문,
              본문html: render(sec.본문),
            });
          }
        }
      }
    }

    return res.json({ grade, cert, me, participants, 노트, 풀이 });
  });

  return r;
}

module.exports = {
  router,
  extractSection,
  parseSignatureSections,
  collectSolutions,
};
