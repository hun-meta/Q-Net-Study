'use strict';

// microworldRoutes.js — 마이크로월드(개념 인터랙티브 시뮬레이션) 기능 라우트.
//
// 학습용 마이크로월드를 "웹 → claude code 호출 → 산출물 생성 → 웹에서 체험"으로 잇는다.
//   GET  /api/microworld?grade&cert            → _공통/마이크로월드/ 목록 + 생성 가능한 과목 목록
//   GET  /api/microworld/content?grade&cert&과목&file → 단일 HTML 원문(샌드박스 iframe 임베드용)
//   POST /api/microworld/generate              → claude 잡으로 개념 HTML 생성(사후 감사로 목적지 경계)
//
// 계약: module.exports = { router(deps) }, deps = { token, cli, repoRoot, hub, config }.
// 읽기(GET)는 경로 파라미터 엄격 검증 + realpath 경계로 탈출 차단. 생성(POST)은 토큰 필수(전역 가드).

const fs = require('fs');
const path = require('path');
const express = require('express');

const repo = require('./repo');
const security = require('./security');
const nickname = require('./nickname');
const configMod = require('./config');
const { createBridge } = require('./cliBridge');

const MW_DIR = '마이크로월드';
const UNSAFE = /[\\/\0\r\n\t]/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// 경로 세그먼트 안전성(탈출·제어문자·'.'시작 차단). cliRoutes 와 동일 규약.
function 안전세그먼트(v, 이름) {
  const s = repo.nfc(v == null ? '' : v).trim();
  if (!s) throw httpError(400, `${이름}이(가) 비어 있습니다.`);
  if (UNSAFE.test(s) || s === '.' || s === '..' || s.startsWith('.')) {
    throw httpError(400, `${이름}에 허용되지 않는 문자가 있습니다.`);
  }
  return s;
}

// 개념명 → 파일명 슬러그(한글 보존, 공백→하이픈, 경로문자 제거).
function 개념슬러그(v) {
  const s = repo
    .nfc(v == null ? '' : v)
    .trim()
    .replace(/[\\/\0\r\n\t]+/g, ' ')
    .replace(/\s+/g, '-');
  if (!s) throw httpError(400, '개념(주제)이 비어 있습니다.');
  if (s === '.' || s === '..' || s.startsWith('.')) throw httpError(400, '개념명이 올바르지 않습니다.');
  if (s.length > 80) throw httpError(400, '개념명이 너무 깁니다(최대 80자).');
  return s;
}

// 무결성 감시 대상(cliRoutes 와 동일 — config·git 내부 심기 차단).
function 무결성대상(repoRoot) {
  return [
    { label: 'config.json', path: configMod.CONFIG_PATH },
    { label: '.git/hooks', path: path.join(repoRoot, '.git', 'hooks') },
    { label: '.git/config', path: path.join(repoRoot, '.git', 'config') },
    { label: '.git/info/exclude', path: path.join(repoRoot, '.git', 'info', 'exclude') },
  ];
}

function extractTitle(html) {
  const m = String(html).match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

// 생성 가능한 과목 목록: _공통/출제기준/*.md 파일명(확장자 제거).
function listSubjects(common) {
  const dir = path.join(common, '출제기준');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
    .map((e) => e.name.replace(/\.md$/, ''))
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

// _공통/마이크로월드/{과목}/*.html 목록.
function listMicroworlds(repoRoot, common) {
  const root = path.join(common, MW_DIR);
  const out = [];
  let 과목들;
  try {
    과목들 = fs.readdirSync(root, { withFileTypes: true });
  } catch (_e) {
    return out; // 디렉토리 없음 → 빈 목록
  }
  for (const s of 과목들) {
    if (!s.isDirectory() || s.name.startsWith('.')) continue;
    const 과목Dir = path.join(root, s.name);
    let files;
    try {
      files = fs.readdirSync(과목Dir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.html') || f.name.startsWith('.')) continue;
      const abs = path.join(과목Dir, f.name);
      let title = '';
      let mtimeMs = 0;
      try {
        title = extractTitle(fs.readFileSync(abs, 'utf8'));
        mtimeMs = fs.statSync(abs).mtimeMs;
      } catch (_e) {
        /* 읽기 실패 스킵 */
      }
      out.push({
        과목: s.name,
        file: f.name,
        title: title || f.name.replace(/\.html$/, ''),
        rel: path.relative(repoRoot, abs),
        mtimeMs,
      });
    }
  }
  out.sort((a, b) => a.과목.localeCompare(b.과목, 'ko') || a.file.localeCompare(b.file, 'ko'));
  return out;
}

function router(deps) {
  const { cli, repoRoot, hub, config } = deps;
  const r = express.Router();
  const bridge = createBridge({ config, repoRoot, cli });
  const broadcast = hub && typeof hub.broadcast === 'function' ? hub.broadcast : () => {};

  // ── 목록 + 과목 ────────────────────────────────────────────────────────
  r.get('/api/microworld', (req, res) => {
    try {
      const grade = 안전세그먼트(req.query.grade, '종류');
      const cert = 안전세그먼트(req.query.cert, '자격증');
      const common = repo.commonDir(repoRoot, grade, cert);
      return res.json({
        items: listMicroworlds(repoRoot, common),
        subjects: listSubjects(common),
        canGenerate: !!cli.record,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── 단일 HTML 원문(임베드용) ────────────────────────────────────────────
  r.get('/api/microworld/content', (req, res) => {
    try {
      const grade = 안전세그먼트(req.query.grade, '종류');
      const cert = 안전세그먼트(req.query.cert, '자격증');
      const 과목 = 안전세그먼트(req.query['과목'], '과목');
      const file = 안전세그먼트(req.query.file, '파일명');
      if (!/\.html$/i.test(file)) throw httpError(400, 'HTML 파일만 열람할 수 있습니다.');

      const mwRoot = path.join(repo.commonDir(repoRoot, grade, cert), MW_DIR);
      const target = path.join(mwRoot, 과목, file);
      // realpath 경계 검증(심링크·상위참조 우회 차단).
      let real;
      let realRoot;
      try {
        real = security.resolveRealPath(target);
        realRoot = fs.realpathSync.native(mwRoot);
      } catch (_e) {
        throw httpError(404, '마이크로월드를 찾을 수 없습니다.');
      }
      if (!security.isWithin(real, realRoot)) throw httpError(403, '경계 밖 경로입니다.');
      if (!fs.existsSync(real)) throw httpError(404, '마이크로월드를 찾을 수 없습니다.');

      const html = fs.readFileSync(real, 'utf8');
      return res.json({ 과목, file, html });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── 생성(claude 잡) ─────────────────────────────────────────────────────
  // body: { grade, cert, 과목, 개념, contextText? }
  r.post('/api/microworld/generate', async (req, res) => {
    try {
      const body = req.body || {};
      const grade = 안전세그먼트(body.grade, '종류');
      const cert = 안전세그먼트(body.cert, '자격증');
      const 과목 = 안전세그먼트(body['과목'], '과목');
      const 개념 = repo.nfc(body['개념'] == null ? '' : body['개념']).trim();
      if (!개념) throw httpError(400, '개념(주제)을 입력하세요.');
      const slug = 개념슬러그(개념);

      const common = repo.commonDir(repoRoot, grade, cert);
      // 과목은 출제기준에 존재하는 것만 허용(임의 디렉토리 생성 차단).
      const 출제기준Path = path.join(common, '출제기준', `${과목}.md`);
      if (!fs.existsSync(출제기준Path)) {
        throw httpError(400, `출제기준에 없는 과목입니다: ${과목}`);
      }

      if (!cli.record) {
        return res.status(503).json({
          error: 'claude(기록) CLI 가 감지되지 않았습니다. 마이크로월드 생성은 비활성이며 기존 마이크로월드 열람·풀이·채점은 정상 동작합니다.',
          cli: 'record',
        });
      }

      const destDir = path.join(common, MW_DIR, 과목);
      // assertWithinRoots 는 루트 존재를 요구 → 목적지 디렉토리를 먼저 만든다.
      fs.mkdirSync(destDir, { recursive: true });
      const htmlPath = security.assertWithinRoots(path.join(destDir, `${slug}.html`), [destDir]);

      const job = await bridge.microworld({
        htmlPath,
        과목,
        개념,
        출제기준Path,
        contextText: typeof body.contextText === 'string' ? body.contextText : null,
        nickname: nickname.getNickname(),
        monitorRoots: [repoRoot],
        auditDestinations: [destDir],
        integrityTargets: 무결성대상(repoRoot),
      });

      if (!job.audit.clean) {
        broadcast('audit-warning', { where: 'microworld', violations: job.audit.violations });
      }

      const 생성됨 = fs.existsSync(htmlPath);
      if (생성됨) broadcast('fs-change', { kind: 'microworld', 과목, file: `${slug}.html` });

      return res.json({
        ok: 생성됨 && job.audit.clean && !job.isError,
        생성됨,
        과목,
        file: `${slug}.html`,
        rel: path.relative(repoRoot, htmlPath),
        timedOut: job.timedOut,
        audit: job.audit,
      });
    } catch (err) {
      const status = err.status || (err.code === 'EWRITEBOUNDARY' ? 403 : 500);
      return res.status(status).json({ error: err.message });
    }
  });

  return r;
}

module.exports = {
  router,
  listSubjects,
  listMicroworlds,
  extractTitle,
  개념슬러그,
};
