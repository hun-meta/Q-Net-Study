'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridgeMod = require('../server/cliBridge');

const FAKE_AGY = path.join(__dirname, 'fixtures', 'fake-agy.js');

test('parseCommand: 명령 문자열을 file/baseArgs로 분해', () => {
  assert.deepStrictEqual(bridgeMod.parseCommand('agy --dangerously-skip-permissions'), {
    file: 'agy',
    baseArgs: ['--dangerously-skip-permissions'],
  });
  assert.deepStrictEqual(bridgeMod.parseCommand('  claude  '), { file: 'claude', baseArgs: [] });
  assert.deepStrictEqual(bridgeMod.parseCommand(''), { file: '', baseArgs: [] });
});

test('parseClaudeStreamJson: 선두 훅 노이즈 무시하고 result만 추출', () => {
  const stdout = [
    '{"type":"system","subtype":"hook_started"}',
    '잡음 라인(비 JSON)',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"부분"}]}}',
    '{"type":"result","subtype":"success","is_error":false,"result":"최종 답"}',
  ].join('\n');
  const parsed = bridgeMod.parseClaudeStreamJson(stdout);
  assert.strictEqual(parsed.result, '최종 답');
  assert.strictEqual(parsed.isError, false);
});

test('createQueue: 동시 1로 순차 실행', async () => {
  const enqueue = bridgeMod.createQueue();
  const order = [];
  const p1 = enqueue(async () => {
    await new Promise((r) => setTimeout(r, 30));
    order.push('a');
  });
  const p2 = enqueue(async () => {
    order.push('b');
  });
  await Promise.all([p1, p2]);
  assert.deepStrictEqual(order, ['a', 'b']);
});

test('runProcess: fake-agy stdout 스트리밍 청크 수신', async () => {
  const chunks = [];
  const res = await bridgeMod.runProcess('node', [FAKE_AGY, '-p', '이 문항 질문'], {
    timeoutMs: 5000,
    onStdout: (c) => chunks.push(c),
  });
  assert.strictEqual(res.code, 0);
  assert.ok(res.stdout.includes('답변'));
  assert.ok(chunks.length > 0);
});

test('runProcess: 타임아웃 시 프로세스 kill + timedOut=true', async () => {
  const res = await bridgeMod.runProcess('node', ['-e', 'setTimeout(()=>{}, 10000)'], {
    timeoutMs: 200,
  });
  assert.strictEqual(res.timedOut, true);
});

test('buildChatPrompt: 챗봇 역할·파일읽기 금지 지시 + 컨텍스트·질문 포함', () => {
  const p = bridgeMod.buildChatPrompt({
    contextText: '[문항 원문]\n1번 문제 본문',
    history: [{ role: 'user', text: '이전 질문' }],
    message: '왜 2번이 답이야?',
  });
  // 역할 지시가 맨 앞에 온다.
  assert.ok(p.startsWith('# 역할'), p.slice(0, 40));
  // 파일/도구 사용 금지 지시(느린 PDF 읽기 방지의 핵심).
  assert.ok(/파일을 열거나 읽지 말고/.test(p), '파일읽기 금지 지시 없음');
  assert.ok(/도구도\s*\n?실행하지 말라|도구도.*실행하지 말라/.test(p) || /pdftotext/.test(p), '도구 실행 금지 지시 없음');
  // 컨텍스트·이전 대화·이번 질문이 모두 담긴다.
  assert.ok(p.includes('1번 문제 본문'));
  assert.ok(p.includes('이전 질문'));
  assert.ok(p.includes('왜 2번이 답이야?'));
});

test('buildRecordPrompt: 목적지·규칙·태그 지시 포함', () => {
  const p = bridgeMod.buildRecordPrompt({
    examId: '2023-1-필기',
    qno: '5',
    conversation: '대화 내용',
    destinations: { note: '/repo/hun/notes', shared: '/repo/_공통/풀이/2023-1-필기' },
    nickname: 'hun',
    today: '2026-07-21',
  });
  assert.ok(p.includes('내 개념 노트'));
  assert.ok(p.includes('공유 문항 해설'));
  assert.ok(p.includes('🔁'));
  assert.ok(p.includes('2023-1-필기'));
});

test('createBridge.chat: CLI 미감지 시 ECLIUNAVAILABLE', async () => {
  const bridge = bridgeMod.createBridge({
    config: { cliChat: 'agy', cliRecord: 'claude' },
    repoRoot: os.tmpdir(),
    cli: { chat: false, record: false },
  });
  await assert.rejects(() => bridge.chat({ message: '질문' }), /ECLIUNAVAILABLE|감지/);
});

test('createBridge.chat: fake-agy 스트리밍 + 무변화 감사 clean', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-chat-'));
  fs.writeFileSync(path.join(root, 'seed.md'), '원본', 'utf8');
  const bridge = bridgeMod.createBridge({
    config: { cliChat: `node ${FAKE_AGY}`, cliRecord: 'claude' },
    repoRoot: root,
    cli: { chat: true, record: false },
  });
  const chunks = [];
  const job = await bridge.chat({
    message: '핵심이 뭐야',
    contextText: '문항 컨텍스트',
    monitorRoots: [root],
    integrityTargets: [],
    onData: (c) => chunks.push(c),
    nickname: 'hun',
  });
  assert.ok(chunks.length > 0);
  assert.ok(job.text.includes('답변'));
  assert.strictEqual(job.audit.clean, true);
  // fake-agy 는 파일을 쓰지 않으므로 seed 그대로.
  assert.strictEqual(fs.readFileSync(path.join(root, 'seed.md'), 'utf8'), '원본');
});
