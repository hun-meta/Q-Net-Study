'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { PDFDocument } = require('pdf-lib');
const examList = require('../server/examList');

let repoRoot;
let server;
let baseUrl;

async function makePdf(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

before(async () => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-routes-'));
  const 기출 = path.join(repoRoot, '기사', '정보처리기사', '_공통', '기출문제');
  fs.mkdirSync(path.join(기출, '정답'), { recursive: true });

  const index = [
    '| 파일명 | 연도 | 회차 | 구분 | 문항수 | 정답포함 | 숨김페이지수 | 등록자 | 비고 |',
    '|---|---|---|---|---|---|---|---|---|',
    '| [2023-1-필기.pdf](2023-1-필기.pdf) | 2023 | 1 | 필기 | 2 | O | 2 | hun | |',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(기출, 'INDEX.md'), index);
  fs.writeFileSync(path.join(기출, '2023-1-필기.pdf'), await makePdf(6));
  fs.writeFileSync(path.join(기출, '2024-0415상시-필기.pdf'), await makePdf(3));

  const 정답md = ['---', '문항수: 2', '숨김페이지수: 2', '추출도구: claude', '추출일: 2026-07-21', '---', '', '## 과목 (1-2)', '', '| 문번 | 정답 |', '|---|---|', '| 1 | ③ |', '| 2 | ① |', ''].join('\n');
  fs.writeFileSync(path.join(기출, '정답', '2023-1-필기.md'), 정답md);

  const app = express();
  app.use(express.json());
  app.use(examList.router({ token: 't', cli: {}, repoRoot, hub: null, config: {} }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

const q = 'grade=' + encodeURIComponent('기사') + '&cert=' + encodeURIComponent('정보처리기사');

test('GET /api/exams — 목록 반환', async () => {
  const res = await fetch(`${baseUrl}/api/exams?${q}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const ids = body.exams.map((e) => e.id);
  assert.ok(ids.includes('2023-1-필기'));
});

test('GET /api/exams — grade·cert 없으면 400', async () => {
  const res = await fetch(`${baseUrl}/api/exams`);
  assert.strictEqual(res.status, 400);
});

test('GET /api/exams/:id/omr — 구조 반환 + 정답 절대 미포함(보안 핵심)', async () => {
  const res = await fetch(`${baseUrl}/api/exams/2023-1-필기/omr?${q}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.등록, true);
  assert.strictEqual(body.문항수, 2);
  assert.strictEqual(body.과목들.length, 1);
  assert.deepStrictEqual(body.과목들[0], { 과목명: '과목', 시작: 1, 끝: 2 });
  // 과목 객체에 정답 키가 없어야 한다.
  assert.ok(!('정답' in body.과목들[0]));
  // 응답 어디에도 정답 값(③/①)이 노출되지 않아야 한다.
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('정답'));
});

test('GET /api/exams/:id/omr — 정답 미등록 시 등록=false(열람만)', async () => {
  const res = await fetch(`${baseUrl}/api/exams/2024-0415상시-필기/omr?${q}`);
  const body = await res.json();
  assert.strictEqual(body.등록, false);
});

test('GET /api/exams/:id/pdf — 서브셋(숨김 2페이지 제거) application/pdf', async () => {
  const res = await fetch(`${baseUrl}/api/exams/2023-1-필기/pdf?${q}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/pdf/);
  const buf = Buffer.from(await res.arrayBuffer());
  const doc = await PDFDocument.load(buf);
  assert.strictEqual(doc.getPageCount(), 4); // 6 - 2
});

test('GET /api/exams/:id/pdf-full — 제출 기록 없으면 403', async () => {
  const res = await fetch(`${baseUrl}/api/exams/2023-1-필기/pdf-full?${q}`);
  assert.strictEqual(res.status, 403);
});

test('GET /api/exams/:id/pdf — 숨김 미확정(INDEX·정답 없음)이면 409(fail-closed, 답지 차단)', async () => {
  // 2024-0415상시-필기: PDF만 있고 INDEX·정답 미등록 → 숨김페이지수 미확정.
  const res = await fetch(`${baseUrl}/api/exams/2024-0415상시-필기/pdf?${q}`);
  assert.strictEqual(res.status, 409);
});

test('GET /vendor/pdfjs/pdf.mjs — 로컬 서빙 200', async () => {
  const res = await fetch(`${baseUrl}/vendor/pdfjs/pdf.mjs`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
});

test('GET /vendor/pdfjs/:file — 허용 목록 밖 404', async () => {
  const res = await fetch(`${baseUrl}/vendor/pdfjs/evil.js`);
  assert.strictEqual(res.status, 404);
});

test('GET /api/exams/:id/pdf — 잘못된 id 형식 400', async () => {
  const res = await fetch(`${baseUrl}/api/exams/2023-1-객관식/pdf?${q}`);
  assert.strictEqual(res.status, 400);
});

test('POST /api/exams/:id/answer-key — 수동 정답 저장 → 정답 md·INDEX 생성 후 pdf 서빙(막다른 길 없음)', async () => {
  const body = { 숨김페이지수: 1, 과목들: [{ 과목명: '과목', 시작: 1, 끝: 2, 정답: { 1: 2, 2: 4 } }] };
  const res = await fetch(`${baseUrl}/api/exams/2024-0415상시-필기/answer-key?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.strictEqual(data.문항수, 2);

  // 이제 OMR 등록됨 + 정답 미포함
  const omr = await (await fetch(`${baseUrl}/api/exams/2024-0415상시-필기/omr?${q}`)).json();
  assert.strictEqual(omr.등록, true);
  assert.ok(!JSON.stringify(omr).includes('정답'));

  // 숨김 확정되어 pdf 서빙(3페이지 - 숨김1 = 2페이지)
  const pdf = await fetch(`${baseUrl}/api/exams/2024-0415상시-필기/pdf?${q}`);
  assert.strictEqual(pdf.status, 200);
  const doc = await PDFDocument.load(Buffer.from(await pdf.arrayBuffer()));
  assert.strictEqual(doc.getPageCount(), 2);
});

test('POST /api/exams/:id/answer-key — 정답 누락 등 검증 실패 시 400 + 검증오류', async () => {
  const body = { 숨김페이지수: 0, 과목들: [{ 과목명: '과목', 시작: 1, 끝: 2, 정답: { 1: 2 } }] };
  const res = await fetch(`${baseUrl}/api/exams/2020-1-필기/answer-key?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.ok(Array.isArray(data.검증오류) && data.검증오류.length > 0);
});
