'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const questionStore = require('../server/questionStore');

const 샘플 = [
  '---',
  '시험: 2025-3회-필기',
  '문번: 1',
  '과목: 소프트웨어 설계',
  '정답: ②',
  '추출도구: claude',
  '추출일: 2026-07-22',
  '---',
  '프로토타이핑 모형에 대한 설명으로 옳지 않은 것은?',
  '',
  '```sql',
  "SELECT * FROM t WHERE id = 1;",
  '```',
  '',
  '① 첫 번째 선택지',
  '② 두 번째 선택지',
  '③ 세 번째 선택지',
  '④ 네 번째 선택지',
  '',
].join('\n');

test('parse: frontmatter·본문·선택지·정답 정규화', () => {
  const q = questionStore.parse(샘플);
  assert.strictEqual(q.시험, '2025-3회-필기');
  assert.strictEqual(q.문번, 1);
  assert.strictEqual(q.과목, '소프트웨어 설계');
  assert.strictEqual(q.정답, 2); // ② → 2
  assert.strictEqual(q.판독불가, false);
  assert.strictEqual(q.선택지.length, 4);
  assert.strictEqual(q.선택지[1].기호, '②');
  assert.strictEqual(q.선택지[1].내용, '두 번째 선택지');
  assert.ok(q.본문md.includes('```sql'));
  assert.ok(!q.본문md.includes('정답:')); // 본문에는 frontmatter가 없다
});

test('parse: 판독 불가 마커 감지', () => {
  const md = ['---', '문번: 7', '정답: ①', '---', '> ⚠️ 판독 불가: 스캔 화질 저하', ''].join('\n');
  const q = questionStore.parse(md);
  assert.strictEqual(q.판독불가, true);
});

test('stripAnswer: frontmatter의 정답 줄만 제거(본문·다른 키 보존)', () => {
  const out = questionStore.stripAnswer(샘플);
  assert.ok(!/^정답\s*:/m.test(out), '정답 줄이 제거되어야 함');
  assert.ok(out.includes('문번: 1'));
  assert.ok(out.includes('추출일: 2026-07-22'));
  assert.ok(out.includes('② 두 번째 선택지')); // 본문 선택지는 보존
  assert.ok(out.includes('```sql'));
  // frontmatter 없는 입력은 그대로.
  assert.strictEqual(questionStore.stripAnswer('본문뿐'), '본문뿐');
});

test('completeness: 존재/누락 집계', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-qstore-'));
  const dir = questionStore.문항Dir(root, '정보처리', '정보처리기사', '2025-3회-필기');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1.md'), 샘플, 'utf8');
  fs.writeFileSync(path.join(dir, '3.md'), 샘플, 'utf8');
  const c = questionStore.completeness(root, '정보처리', '정보처리기사', '2025-3회-필기', 3);
  assert.strictEqual(c.완비, false);
  assert.strictEqual(c.존재수, 2);
  assert.deepStrictEqual(c.누락문번, [2]);
  fs.writeFileSync(path.join(dir, '2.md'), 샘플, 'utf8');
  const c2 = questionStore.completeness(root, '정보처리', '정보처리기사', '2025-3회-필기', 3);
  assert.strictEqual(c2.완비, true);
  // 문항수 미상이면 완비 아님.
  assert.strictEqual(
    questionStore.completeness(root, '정보처리', '정보처리기사', '2025-3회-필기', null).완비,
    false
  );
});

test('read: 파일 읽기 + 경계 검증, 부재 시 null', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-qstore-'));
  const dir = questionStore.문항Dir(root, '정보처리', '정보처리기사', '2025-3회-필기');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '1.md'), 샘플, 'utf8');
  const q = questionStore.read(root, '정보처리', '정보처리기사', '2025-3회-필기', 1);
  assert.ok(q);
  assert.strictEqual(q.문번, 1);
  assert.ok(q.파일.includes('문항'));
  assert.strictEqual(questionStore.read(root, '정보처리', '정보처리기사', '2025-3회-필기', 9), null);
});

const 정답md파싱 = {
  문항수: 2,
  과목들: [{ 과목명: '소프트웨어 설계', 시작: 1, 끝: 2, 정답: { 1: 2, 2: 3 } }],
};

test('validate: 정답 md 대조(정답·과목·문번·선택지)', () => {
  const q = questionStore.parse(샘플);
  q.파일 = 'x';
  assert.deepStrictEqual(questionStore.validate(q, 정답md파싱, 1), []); // 일치 → 오류 없음

  // 정답 불일치.
  const 틀림 = questionStore.parse(샘플.replace('정답: ②', '정답: ①'));
  const errs = questionStore.validate(틀림, 정답md파싱, 1);
  assert.ok(errs.some((e) => e.includes('정답')), JSON.stringify(errs));

  // 문번 불일치.
  const 문번틀림 = questionStore.parse(샘플.replace('문번: 1', '문번: 2'));
  assert.ok(questionStore.validate(문번틀림, 정답md파싱, 1).some((e) => e.includes('문번')));

  // 선택지 부족(판독 가능 문항).
  const 부족 = questionStore.parse(샘플.replace('④ 네 번째 선택지', ''));
  assert.ok(questionStore.validate(부족, 정답md파싱, 1).some((e) => e.includes('선택지')));

  // 판독 불가 문항은 본문·선택지 검사 면제(정답 대조는 유지).
  const 불가 = questionStore.parse(
    ['---', '문번: 1', '과목: 소프트웨어 설계', '정답: ②', '---', '> ⚠️ 판독 불가: 흐림', ''].join('\n')
  );
  assert.deepStrictEqual(questionStore.validate(불가, 정답md파싱, 1), []);

  // 파일 부재.
  assert.ok(questionStore.validate(null, 정답md파싱, 1)[0].includes('없거나'));
});

test('buildChatContext: solve는 정답 스트립, view는 유지, 클라 컨텍스트 결합', () => {
  const solve = questionStore.buildChatContext({
    원문md: 샘플,
    mode: 'solve',
    clientContext: '[문항 컨텍스트]\n연결 노트: 1',
  });
  assert.ok(solve.startsWith('[문항 원문]'));
  assert.ok(!/^정답\s*:/m.test(solve), 'solve 모드에 정답이 없어야 함');
  assert.ok(solve.includes('연결 노트: 1'));

  const view = questionStore.buildChatContext({ 원문md: 샘플, mode: 'view', clientContext: '' });
  assert.ok(/정답\s*:\s*②/.test(view), 'view 모드는 정답 유지');

  // 문항 md 없음 → 클라 컨텍스트만.
  const 폴백 = questionStore.buildChatContext({ 원문md: null, mode: 'solve', clientContext: 'PDF 참조' });
  assert.strictEqual(폴백, 'PDF 참조');
});

test('buildChatContext: 추출도구·추출일은 모드와 무관하게 제거(프롬프트 접두사 노이즈 정리)', () => {
  for (const mode of ['solve', 'view']) {
    const out = questionStore.buildChatContext({ 원문md: 샘플, mode, clientContext: '' });
    assert.ok(!/추출도구/.test(out), `${mode}: 추출도구 줄이 제거되어야 함`);
    assert.ok(!/추출일/.test(out), `${mode}: 추출일 줄이 제거되어야 함`);
    // 학습에 유의미한 키·본문은 보존.
    assert.ok(out.includes('과목: 소프트웨어 설계'));
    assert.ok(out.includes('② 두 번째 선택지'));
  }
});
