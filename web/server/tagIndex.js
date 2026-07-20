'use strict';

// tagIndex.js — 🔁 기출 태그 스캔·캐시 인덱스 (순수 모듈 — express 비의존)
//
// 저장소 전체 notes/ 의 md에서 다음 형태의 역참조 태그를 수집한다:
//     🔁 기출 {연도}-{회차}(-{구분})? #{문번}
// - 구분(필기/실기)은 선택적. 무구분 태그는 필기로 매핑(v1 필기 전용, 하위호환).
// - 문항↔개념 링크의 진실 원천은 태그이며, 이 인덱스는 재생성 가능한 캐시다
//   (.qnet-web/cache/tag-index.json — gitignore). mtime 증분으로 500파일<2s 목표.
//
// 인덱스 구조:
//   {
//     generatedAt,
//     files:   { [relPath]: { mtimeMs, grade, cert, 닉네임, 과목, tags:[{시험ID,문번,라인,섹션제목}] } },
//     byQuestion: { [시험ID]: { [문번]: [{닉네임, grade, cert, 과목, relPath, 섹션제목}] } }
//   }

const fs = require('fs');
const path = require('path');
const repo = require('./repo');

// 🔁 기출 {연도}-{회차}(-{구분})? #{문번}
// 그룹: 1=연도(4자리) 2=회차/식별자 3=구분(옵션) 4=문번
const TAG_RE = /🔁\s*기출\s+(\d{4})-([^\s#]+?)(?:-(필기|실기))?\s*#(\d+)/gu;

// 무구분 태그 → 필기 매핑.
function normalize시험ID(연도, 회차, 구분) {
  return `${연도}-${회차}-${구분 || '필기'}`;
}

// md 본문에서 태그를 추출한다(순수). 각 태그가 속한 가장 가까운 `##` 헤딩을 섹션제목으로 기록.
function parseTagsFromContent(content) {
  const tags = [];
  let 섹션제목 = '';
  const lines = String(content).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !/^###/.test(line)) {
      섹션제목 = h2[1].trim();
    }
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(line)) !== null) {
      tags.push({
        시험ID: normalize시험ID(m[1], m[2], m[3]),
        문번: Number(m[4]),
        라인: i + 1,
        섹션제목,
      });
    }
  }
  return tags;
}

// notes/ 디렉토리를 재귀 순회하며 .md 파일 절대경로를 수집.
function walkMd(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(abs, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(abs);
  }
  return acc;
}

// relPath = {grade}/{cert}/{닉네임}/notes/{과목}/... → 과목명 추출(없으면 '').
function 과목FromRel(relPath) {
  const parts = relPath.split(path.sep);
  const ni = parts.indexOf('notes');
  return ni >= 0 && parts.length > ni + 1 ? parts[ni + 1] : '';
}

function load(cachePath) {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (_e) {
    return { files: {}, byQuestion: {} };
  }
}

function save(cachePath, index) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = path.join(path.dirname(cachePath), `.tag-index.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(index), 'utf8');
  fs.renameSync(tmp, cachePath);
}

// files 맵으로부터 byQuestion 역인덱스를 구성.
function buildByQuestion(files) {
  const byQuestion = {};
  for (const [relPath, f] of Object.entries(files)) {
    for (const t of f.tags) {
      if (!byQuestion[t.시험ID]) byQuestion[t.시험ID] = {};
      const 문번키 = String(t.문번);
      if (!byQuestion[t.시험ID][문번키]) byQuestion[t.시험ID][문번키] = [];
      byQuestion[t.시험ID][문번키].push({
        닉네임: f.닉네임,
        grade: f.grade,
        cert: f.cert,
        과목: f.과목,
        relPath,
        섹션제목: t.섹션제목,
      });
    }
  }
  return byQuestion;
}

/**
 * 저장소를 스캔해 태그 인덱스를 만든다(mtime 증분).
 * @param repoRoot 저장소 루트 절대경로
 * @param opts { cachePath?, prev? } — cachePath 주면 로드/저장, prev 주면 그 캐시를 증분 기준으로 사용
 * @returns 인덱스 객체
 */
function scan(repoRoot, opts) {
  const options = opts || {};
  const prev = options.prev || (options.cachePath ? load(options.cachePath) : { files: {} });
  const prevFiles = prev.files || {};
  const files = {};

  for (const { grade, cert, participants } of repo.scanRepo(repoRoot)) {
    for (const 닉네임 of participants) {
      const notesDir = path.join(repoRoot, grade, cert, 닉네임, 'notes');
      for (const abs of walkMd(notesDir, [])) {
        const rel = path.relative(repoRoot, abs);
        let st;
        try {
          st = fs.statSync(abs);
        } catch (_e) {
          continue;
        }
        const cached = prevFiles[rel];
        const tags =
          cached && cached.mtimeMs === st.mtimeMs
            ? cached.tags
            : parseTagsFromContent(fs.readFileSync(abs, 'utf8'));
        files[rel] = { mtimeMs: st.mtimeMs, grade, cert, 닉네임, 과목: 과목FromRel(rel), tags };
      }
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    files,
    byQuestion: buildByQuestion(files),
  };
  if (options.cachePath) save(options.cachePath, index);
  return index;
}

// 특정 시험·문번에 연결된 노트 참조 목록.
function query(index, 시험ID, 문번) {
  const byQ = (index && index.byQuestion) || {};
  const exam = byQ[String(시험ID)];
  if (!exam) return [];
  return exam[String(문번)] || [];
}

module.exports = {
  TAG_RE,
  normalize시험ID,
  parseTagsFromContent,
  buildByQuestion,
  walkMd,
  load,
  save,
  scan,
  query,
};
