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

// ── 암호화 PDF (회귀: 시중 기출 PDF 는 소유자-암호로 잠긴 경우가 많다) ────────
// 순정 pdf-lib 의 ignoreEncryption 복사는 내용 스트림을 암호문 그대로 남겨
// pdf.js 렌더가 "에러 없는 백지"가 됐다. 복호화 로드 후 서브셋은 실제로 그려져야 한다.

const { PDFDocument: CantooPDF } = require('@cantoo/pdf-lib');

// 내용(사각형)이 그려진 N페이지 PDF 를 만들고 소유자-암호로 잠근다(사용자 암호는 빈 값).
async function makeEncryptedPdf(n, opts) {
  const doc = await CantooPDF.create();
  for (let i = 0; i < n; i += 1) {
    const p = doc.addPage([200, 200]);
    p.drawRectangle({ x: 20, y: 20, width: 120, height: 80 });
  }
  await doc.encrypt({
    ownerPassword: 'owner-secret',
    userPassword: (opts && opts.userPassword) || undefined,
    permissions: { printing: 'highResolution' },
  });
  return Buffer.from(await doc.save());
}

// pdf.js(legacy)로 1페이지의 렌더 오퍼레이터 수를 센다(0 = 백지).
async function opCountOfPage1(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  await doc.destroy();
  return ops.fnArray.length;
}

test('buildSubset — 소유자-암호 PDF 를 복호화해 내용이 살아있는 서브셋 생성', async () => {
  const enc = await makeEncryptedPdf(3);
  const 서브셋 = await pdfSubset.buildSubset(enc, 1);
  assert.strictEqual(await pdfSubset.pageCount(서브셋), 2);
  // 핵심 회귀: pdf.js 가 실제로 그릴 내용이 있어야 한다(예전 버그: 0 = 백지).
  const ops = await opCountOfPage1(서브셋);
  assert.ok(ops > 0, `서브셋 1페이지 렌더 오퍼레이터가 비어 있음(백지) — ops=${ops}`);
});

test('buildSubset — 사용자-암호 PDF 는 EPDFPASSWORD 로 명확히 실패', async () => {
  const enc = await makeEncryptedPdf(2, { userPassword: 'user-pw' });
  await assert.rejects(
    () => pdfSubset.buildSubset(enc, 1),
    (e) => e.code === 'EPDFPASSWORD'
  );
});
