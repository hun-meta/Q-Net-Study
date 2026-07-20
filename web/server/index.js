'use strict';

// 서버 진입점: 설정 로드 → CLI 감지 → 토큰 생성 → 앱 구성 → 워처 시작 →
// 127.0.0.1 바인딩(포트 폴백) → 기동 배너 출력.

const crypto = require('crypto');
const { execFile } = require('child_process');

const config = require('./config');
const { createApp } = require('./app');
const { createSseHub } = require('./sse');
const { startWatcher } = require('./watcher');

// CLI 명령 문자열에서 실행 파일명(첫 토큰)만 추출.
function binaryOf(command) {
  return String(command || '').trim().split(/\s+/)[0] || '';
}

// execFile(bin, ["--version"]) 로 CLI 설치 여부 감지. macOS에 `timeout` 명령이
// 없으므로 execFile의 timeout 옵션(Node 내장 타이머)로 무한 대기를 방지한다.
function detectCli(command) {
  return new Promise((resolve) => {
    const bin = binaryOf(command);
    if (!bin) return resolve(false);
    execFile(bin, ['--version'], { timeout: 3000 }, (err) => {
      resolve(!err);
    });
  });
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const bar = '─'.repeat(width);
  process.stdout.write(`┌${bar}┐\n`);
  for (const l of lines) {
    process.stdout.write(`│ ${l.padEnd(width - 1)}│\n`);
  }
  process.stdout.write(`└${bar}┘\n`);
}

async function start() {
  const cfg = config.loadConfig();
  const token = makeToken();

  // CLI 감지(병렬).
  const [chatAvailable, recordAvailable] = await Promise.all([
    detectCli(cfg.cliChat),
    detectCli(cfg.cliRecord),
  ]);
  const cli = { chat: chatAvailable, record: recordAvailable };

  const hub = createSseHub();

  const app = createApp({
    token,
    cli,
    repoRoot: config.REPO_ROOT,
    hub,
    config: cfg,
  });

  // 포트 폴백: 4525 기본, 점유 시 4526~4535, 상한 초과 시 실패.
  const port = await config.findAvailablePort(cfg.port || config.DEFAULT_PORT, config.MAX_PORT);

  const server = app.listen(port, '127.0.0.1', () => {
    // 파일 워처 시작(로컬 상태·git·node_modules 무시).
    const watcher = startWatcher(config.REPO_ROOT, hub);
    server.on('close', () => {
      watcher.close();
    });

    banner([
      'Q-Net 기출 풀이 로컬 웹 앱',
      `주소:   http://127.0.0.1:${port}`,
      `닉네임: ${cfg.nickname || '(미설정 — 접속 후 선택)'}`,
      `agy(챗):    ${cli.chat ? '감지됨 ✅' : '미설치 ⚠️ (핵심 루프는 정상 동작)'}`,
      `claude(기록): ${cli.record ? '감지됨 ✅' : '미설치 ⚠️ (핵심 루프는 정상 동작)'}`,
      '종료: Ctrl+C',
    ]);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    process.stderr.write(`기동 실패: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { start, detectCli, binaryOf };
