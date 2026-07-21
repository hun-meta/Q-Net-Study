'use strict';

// 서버 진입점: 설정 로드 → CLI 감지 → 토큰 생성 → 앱 구성 → 워처 시작 →
// 127.0.0.1 바인딩(포트 폴백) → 기동 배너 출력.

const crypto = require('crypto');
const { execFile } = require('child_process');

const config = require('./config');
const { createApp } = require('./app');
const { createSseHub } = require('./sse');
const { startWatcher } = require('./watcher');
const logger = require('./logger');

// CLI 명령 문자열에서 실행 파일명(첫 토큰)만 추출.
function binaryOf(command) {
  return String(command || '').trim().split(/\s+/)[0] || '';
}

// execFile(bin, ["--version"]) 로 CLI 설치 여부 감지. macOS에 `timeout` 명령이
// 없으므로 execFile의 timeout 옵션(Node 내장 타이머)로 무한 대기를 방지한다.
// 타임아웃 10초: 기동 순간 시스템이 바쁘면 3초로는 설치된 CLI도 놓친다(오탐 → "미설치" 고착).
function detectCli(command) {
  return new Promise((resolve) => {
    const bin = binaryOf(command);
    if (!bin) return resolve(false);
    execFile(bin, ['--version'], { timeout: 10000 }, (err) => {
      resolve(!err);
    });
  });
}

// 기동 시 미감지된 CLI 를 주기 재검사한다. 감지되면 cli 객체를 제자리 갱신하고
// (라우트·브리지는 참조 공유라 즉시 반영) SSE 'cli-change' 로 프론트에 알린다.
// 둘 다 감지되면 폴링을 멈춘다. — 일시 부하로 인한 오탐이 재기동 없이 자가 회복되게.
const REDETECT_INTERVAL_MS = 30000;
function startCliRedetect(cli, cfg, hub) {
  if (cli.chat && cli.record) return null;
  const timer = setInterval(async () => {
    let changed = false;
    if (!cli.chat && (await detectCli(cfg.cliChat))) {
      cli.chat = true;
      changed = true;
    }
    if (!cli.record && (await detectCli(cfg.cliRecord))) {
      cli.record = true;
      changed = true;
    }
    if (changed) {
      process.stdout.write(
        `[cli] 재검사로 감지됨 — agy(챗): ${cli.chat ? '✅' : '⚠️'} / claude(기록): ${cli.record ? '✅' : '⚠️'}\n`
      );
      hub.broadcast('cli-change', { chat: cli.chat, record: cli.record });
    }
    if (cli.chat && cli.record) clearInterval(timer);
  }, REDETECT_INTERVAL_MS);
  timer.unref();
  return timer;
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
    logger.info('server 기동', { port, cli, nickname: cfg.nickname || null, logFile: logger.LOG_FILE });
    // 파일 워처 시작(로컬 상태·git·node_modules 무시).
    const watcher = startWatcher(config.REPO_ROOT, hub);
    // 미감지 CLI 자가 회복 폴링(감지 완료 시 자동 종료).
    const redetect = startCliRedetect(cli, cfg, hub);
    server.on('close', () => {
      watcher.close();
      if (redetect) clearInterval(redetect);
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

module.exports = { start, detectCli, binaryOf, startCliRedetect };
