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
function collectSolutions(repoRoot, examId, qno) {
  const out = [];
  for (const { grade, cert } of repo.scanRepo(repoRoot)) {
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
    const refs = tagIndex.query(index, examId, qno);
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

    const 해설 = collectSolutions(deps.repoRoot, examId, qno).map((s) => ({
      ...s,
      본문html: render(s.본문),
    }));

    return res.json({ 시험: examId, 문번: Number(qno), 노트, 해설 });
  });

  return r;
}

module.exports = {
  router,
  extractSection,
  parseSignatureSections,
  collectSolutions,
};
