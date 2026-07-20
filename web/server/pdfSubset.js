'use strict';

// PDF 서브셋 생성·캐시 (pdf-lib) — 숨김(답지·해설) 페이지를 제거한 풀이용 PDF를 만든다.
// 답지는 브라우저에 도달하지 않는다(계획 v5 "PDF 서빙" 절).
//
// 숨김 페이지 규약: 답지/해설은 관례상 문서 **말미**에 붙으므로, 마지막 N(=숨김페이지수)
// 페이지를 제거한 [0 .. 총-N-1] 페이지만 남긴다. 숨김페이지수 == 0 이면 원본 그대로가 서브셋.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const config = require('./config');

// 서브셋 캐시 위치(.qnet-web/cache/pdf-subset) — 재생성 가능, gitignore 대상.
const CACHE_DIR = path.join(config.STATE_DIR, 'cache', 'pdf-subset');

// 원본 PDF 바이트에서 마지막 hiddenCount 페이지를 제거한 서브셋 바이트(Buffer)를 만든다.
async function buildSubset(srcBytesOrPath, hiddenCount) {
  const bytes = Buffer.isBuffer(srcBytesOrPath)
    ? srcBytesOrPath
    : fs.readFileSync(srcBytesOrPath);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const hidden = Math.max(0, Math.min(total, Number(hiddenCount) || 0));
  const keep = total - hidden;

  const out = await PDFDocument.create();
  if (keep > 0) {
    const indices = [];
    for (let i = 0; i < keep; i += 1) indices.push(i);
    const pages = await out.copyPages(src, indices);
    pages.forEach((p) => out.addPage(p));
  }
  const saved = await out.save();
  return Buffer.from(saved);
}

// 원본 PDF의 총 페이지 수를 반환(추출 검증·숨김페이지수 도메인 확인용).
async function pageCount(srcBytesOrPath) {
  const bytes = Buffer.isBuffer(srcBytesOrPath)
    ? srcBytesOrPath
    : fs.readFileSync(srcBytesOrPath);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return src.getPageCount();
}

// 서브셋 파일 경로를 반환(없으면 생성해 캐시). 캐시 키 = 원본경로 + mtime + 숨김수.
// 원본이 바뀌면(재추출 등) mtime이 달라져 자동으로 캐시가 무효화된다.
// hiddenCount <= 0 이면 감출 것이 없으므로 원본 경로를 그대로 반환(불필요한 재저장 회피).
async function getSubsetPath(srcPath, hiddenCount, cacheDir = CACHE_DIR) {
  const hidden = Math.max(0, Number(hiddenCount) || 0);
  const stat = fs.statSync(srcPath);
  if (hidden <= 0) {
    return { path: srcPath, cached: false, original: true };
  }
  const key = crypto
    .createHash('sha1')
    .update(`${path.resolve(srcPath)}|${stat.mtimeMs}|${hidden}`)
    .digest('hex');
  const cachePath = path.join(cacheDir, `${key}.pdf`);
  if (fs.existsSync(cachePath)) {
    return { path: cachePath, cached: true, original: false };
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const buf = await buildSubset(srcPath, hidden);
  // tmp→rename 원자 커밋으로 동시 요청 시 부분 파일 노출 방지.
  const tmp = path.join(cacheDir, `.${key}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, cachePath);
  return { path: cachePath, cached: false, original: false };
}

module.exports = { CACHE_DIR, buildSubset, pageCount, getSubsetPath };
