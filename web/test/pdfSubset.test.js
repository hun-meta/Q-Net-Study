'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const pdfSubset = require('../server/pdfSubset');

// N페이지 PDF 바이트 생성.
async function makePdf(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

let 작업디렉토리;
let 캐시디렉토리;
let src5;

before(async () => {
  작업디렉토리 = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-pdf-'));
  캐시디렉토리 = path.join(작업디렉토리, 'cache');
  src5 = path.join(작업디렉토리, 'sample.pdf');
  fs.writeFileSync(src5, await makePdf(5));
});

after(() => {
  fs.rmSync(작업디렉토리, { recursive: true, force: true });
});

test('buildSubset — 마지막 N페이지 제거', async () => {
  const bytes = await makePdf(5);
  const 서브셋 = await pdfSubset.buildSubset(bytes, 2);
  assert.strictEqual(await pdfSubset.pageCount(서브셋), 3);
});

test('buildSubset — 숨김 0이면 전체 유지', async () => {
  const 서브셋 = await pdfSubset.buildSubset(await makePdf(4), 0);
  assert.strictEqual(await pdfSubset.pageCount(서브셋), 4);
});

test('buildSubset — 숨김수가 총페이지 이상이면 원본 페이지 전부 제거(방어)', async () => {
  // pdf-lib은 빈 문서를 재로드하면 빈 페이지 1개를 붙이는 특성이 있음(답지 아님).
  // 안전 속성: 원본 3페이지가 하나도 남지 않는다(<=1). 이 경우는 검증(숨김<총)으로 실제로는 차단됨.
  const 서브셋 = await pdfSubset.buildSubset(await makePdf(3), 10);
  assert.ok((await pdfSubset.pageCount(서브셋)) <= 1);
});

test('pageCount — 원본 페이지 수', async () => {
  assert.strictEqual(await pdfSubset.pageCount(src5), 5);
});

test('getSubsetPath — 숨김>0 시 캐시 파일 생성 후 서브셋 반환', async () => {
  const r = await pdfSubset.getSubsetPath(src5, 1, 캐시디렉토리);
  assert.strictEqual(r.original, false);
  assert.ok(fs.existsSync(r.path));
  assert.strictEqual(await pdfSubset.pageCount(r.path), 4);
});

test('getSubsetPath — 두 번째 호출은 캐시 히트', async () => {
  const first = await pdfSubset.getSubsetPath(src5, 1, 캐시디렉토리);
  const second = await pdfSubset.getSubsetPath(src5, 1, 캐시디렉토리);
  assert.strictEqual(second.cached, true);
  assert.strictEqual(first.path, second.path);
});

test('getSubsetPath — 숨김 0이면 원본 경로 그대로', async () => {
  const r = await pdfSubset.getSubsetPath(src5, 0, 캐시디렉토리);
  assert.strictEqual(r.original, true);
  assert.strictEqual(r.path, src5);
});

test('getSubsetPath — 원본 변경(mtime) 시 캐시 무효화', async () => {
  const before1 = await pdfSubset.getSubsetPath(src5, 1, 캐시디렉토리);
  // 원본을 3페이지로 교체(mtime 변경).
  const future = Date.now() / 1000 + 10;
  fs.writeFileSync(src5, await makePdf(3));
  fs.utimesSync(src5, future, future);
  const after1 = await pdfSubset.getSubsetPath(src5, 1, 캐시디렉토리);
  assert.notStrictEqual(before1.path, after1.path); // 다른 캐시 키
  assert.strictEqual(await pdfSubset.pageCount(after1.path), 2);
});
