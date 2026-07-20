'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const examList = require('../server/examList');

// 임시 저장소 구조: {tmp}/기사/정보처리기사/_공통/기출문제/{...}
let repoRoot;
let 기출dir;

async function makePdf(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

before(async () => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-repo-'));
  기출dir = path.join(repoRoot, '기사', '정보처리기사', '_공통', '기출문제');
  fs.mkdirSync(path.join(기출dir, '정답'), { recursive: true });

  // INDEX.md (9칼럼, 숨김페이지수 2)
  const index = [
    '# 기출문제 인덱스',
    '',
    '| 파일명 | 연도 | 회차 | 구분 | 문항수 | 정답포함 | 숨김페이지수 | 등록자 | 비고 |',
    '|--------|------|------|------|--------|----------|--------------|--------|------|',
    '| [2023-1-필기.pdf](2023-1-필기.pdf) | 2023 | 1 | 필기 | 100 | O | 2 | hun | 해설 포함 |',
    '| [2022-3-필기.pdf](2022-3-필기.pdf) | 2022 | 3 | 필기 | 100 | X | 1 | mina | |',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(기출dir, 'INDEX.md'), index);

  // PDF 파일 2종 + 명명 규칙 밖 파일 1종(무시되어야 함)
  fs.writeFileSync(path.join(기출dir, '2023-1-필기.pdf'), await makePdf(6));
  fs.writeFileSync(path.join(기출dir, '2024-0415상시-필기.pdf'), await makePdf(3));
  fs.writeFileSync(path.join(기출dir, '엉뚱한파일.pdf'), await makePdf(1));

  // 정답 md: 2023-1-필기만 등록
  const 정답md = ['---', '문항수: 2', '숨김페이지수: 2', '추출도구: claude', '추출일: 2026-07-21', '---', '', '## 과목 (1-2)', '', '| 문번 | 정답 |', '|---|---|', '| 1 | ① |', '| 2 | ③ |', ''].join('\n');
  fs.writeFileSync(path.join(기출dir, '정답', '2023-1-필기.md'), 정답md);
});

after(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test('parseExamId — 정상/비정상', () => {
  assert.deepStrictEqual(examList.parseExamId('2023-1-필기'), { 연도: 2023, 식별자: '1', 구분: '필기' });
  assert.deepStrictEqual(examList.parseExamId('2024-0415상시-필기'), {
    연도: 2024,
    식별자: '0415상시',
    구분: '필기',
  });
  assert.strictEqual(examList.parseExamId('2023-1-객관식'), null);
  assert.strictEqual(examList.parseExamId('../etc/passwd'), null);
  assert.strictEqual(examList.parseExamId('2023/1/필기'), null);
  assert.strictEqual(examList.parseExamId('2023-1-필기.pdf'), null);
});

test('validateGradeCert — 블록리스트·존재 검증(라운드2 종류=분야)', () => {
  assert.deepStrictEqual(examList.validateGradeCert(repoRoot, '기사', '정보처리기사'), {
    grade: '기사',
    cert: '정보처리기사',
  });
  // 블록리스트 종류(web/docs/node_modules)·'_' 시작 → 400
  assert.strictEqual(examList.validateGradeCert(repoRoot, 'web', '정보처리기사').status, 400);
  assert.strictEqual(examList.validateGradeCert(repoRoot, '_공통', '정보처리기사').status, 400);
  // 유효한 종류(분야)지만 디렉토리 없음 → 404
  assert.strictEqual(examList.validateGradeCert(repoRoot, '박사', '정보처리기사').status, 404);
  assert.strictEqual(examList.validateGradeCert(repoRoot, '기사', '없는자격증').status, 404);
  // 빈 값·경로 탈출 → 400
  assert.strictEqual(examList.validateGradeCert(repoRoot, '', '정보처리기사').status, 400);
  assert.strictEqual(examList.validateGradeCert(repoRoot, '기사', '../탈출').status, 400);
});

test('hiddenCountFor — INDEX 우선, 없으면 정답 md, 둘 다 없으면 null(fail-closed)', () => {
  assert.strictEqual(examList.hiddenCountFor(repoRoot, '기사', '정보처리기사', '2023-1-필기'), 2);
  // INDEX에 있으나 정답 md 없는 항목 → INDEX 값 1
  assert.strictEqual(examList.hiddenCountFor(repoRoot, '기사', '정보처리기사', '2022-3-필기'), 1);
  // INDEX·정답 둘 다 없는 항목 → null(미확정: /pdf가 409로 답지 유출 차단)
  assert.strictEqual(
    examList.hiddenCountFor(repoRoot, '기사', '정보처리기사', '2024-0415상시-필기'),
    null
  );
});

test('listExams — PDF·INDEX·정답 병합 + 채점가능 플래그 + 정렬', () => {
  const exams = examList.listExams(repoRoot, '기사', '정보처리기사');
  const ids = exams.map((e) => e.id);
  // 명명 규칙 밖(엉뚱한파일.pdf)은 제외
  assert.ok(!ids.includes('엉뚱한파일'));
  // 연도 내림차순
  assert.deepStrictEqual(ids, ['2024-0415상시-필기', '2023-1-필기', '2022-3-필기']);

  const e2023 = exams.find((e) => e.id === '2023-1-필기');
  assert.strictEqual(e2023.정답등록, true);
  assert.strictEqual(e2023.pdf존재, true);
  assert.strictEqual(e2023.채점가능, true);
  assert.strictEqual(e2023.숨김페이지수, 2);
  assert.strictEqual(e2023.열람가능, true); // 숨김 확정
  assert.strictEqual(e2023.등록자, 'hun');

  // 2022-3-필기: INDEX에는 있으나 PDF 파일 없음 → pdf존재 false, 열람가능 false
  const e2022 = exams.find((e) => e.id === '2022-3-필기');
  assert.strictEqual(e2022.pdf존재, false);
  assert.strictEqual(e2022.채점가능, false);
  assert.strictEqual(e2022.열람가능, false);

  // 2024 상시: PDF 있으나 INDEX·정답 없음 → 숨김 미확정 → 열람가능 false(409로 답지 차단)
  const cbt = exams.find((e) => e.id === '2024-0415상시-필기');
  assert.strictEqual(cbt.pdf존재, true);
  assert.strictEqual(cbt.정답등록, false);
  assert.strictEqual(cbt.채점가능, false);
  assert.strictEqual(cbt.열람가능, false);
});

test('safePdfPath — 존재하면 실경로, 없으면 null', () => {
  const p = examList.safePdfPath(repoRoot, '기사', '정보처리기사', '2023-1-필기');
  assert.ok(p && fs.existsSync(p));
  assert.strictEqual(
    examList.safePdfPath(repoRoot, '기사', '정보처리기사', '2099-9-필기'),
    null
  );
});

test('hasSubmittedAttempt — 제출 기록 있으면 true, 없으면 false, 닉네임 없으면 false', () => {
  // 닉네임 tester의 attempts에 2023-1-필기 제출 기록 생성
  const attemptsDir = path.join(repoRoot, '기사', '정보처리기사', 'tester', 'attempts');
  fs.mkdirSync(attemptsDir, { recursive: true });
  const attemptMd = [
    '---',
    '자격증: 정보처리기사',
    '시험: 2023-1-필기',
    '시도: 1',
    '풀이일: 2026-07-21',
    '총점: 62',
    '합격여부: 합격',
    '---',
    '',
    '# 2023년 1회 필기 — 1차 시도',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(attemptsDir, '2023-1-필기-1.md'), attemptMd);

  assert.strictEqual(
    examList.hasSubmittedAttempt(repoRoot, '기사', '정보처리기사', 'tester', '2023-1-필기'),
    true
  );
  // 다른 시험은 제출 기록 없음
  assert.strictEqual(
    examList.hasSubmittedAttempt(repoRoot, '기사', '정보처리기사', 'tester', '2022-3-필기'),
    false
  );
  // 닉네임 없으면 잠금
  assert.strictEqual(
    examList.hasSubmittedAttempt(repoRoot, '기사', '정보처리기사', null, '2023-1-필기'),
    false
  );
  // 제출 기록 없는 닉네임도 잠금
  assert.strictEqual(
    examList.hasSubmittedAttempt(repoRoot, '기사', '정보처리기사', '유령', '2023-1-필기'),
    false
  );
});
