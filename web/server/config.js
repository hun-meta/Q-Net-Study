'use strict';

// 설정 로더: .qnet-web/config.json (닉네임, CLI 명령, 포트 기본값) 관리.
// md/git이 유일한 진실 원천이며 이 파일은 재생성 가능한 로컬 설정이다(gitignore 대상).

const fs = require('fs');
const path = require('path');
const net = require('net');

// web/server/config.js -> 저장소 루트는 두 단계 위(web/의 부모).
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.qnet-web');
const CONFIG_PATH = path.join(STATE_DIR, 'config.json');

// 포트 정책: 4525 기본, 점유 시 4526~4535 순차 탐색, 상한 초과 시 명시적 실패.
const DEFAULT_PORT = 4525;
const MAX_PORT = 4535;

// CLI 브리지 기본 명령(사용자 확정, config로 재정의 가능).
const DEFAULT_CONFIG = Object.freeze({
  nickname: null,
  cliChat: 'agy --dangerously-skip-permissions',
  cliRecord: 'claude --dangerously-skip-permissions',
  port: DEFAULT_PORT,
});

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

// config.json을 읽어 기본값과 병합한다. 파일이 없거나 손상 시 기본값 반환.
function loadConfig() {
  let stored = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    stored = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    // 없음/손상 → 기본값으로 진행(사용자가 닉네임 설정 시 재기록됨).
  }
  return { ...DEFAULT_CONFIG, ...stored };
}

// tmp→rename 원자 커밋으로 config.json을 기록한다.
function saveConfig(config) {
  ensureStateDir();
  const merged = { ...DEFAULT_CONFIG, ...config };
  const tmp = path.join(STATE_DIR, `.config.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return merged;
}

// 주어진 포트가 127.0.0.1에서 바인딩 가능한지 검사.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

// startPort부터 endPort까지 순차 탐색해 사용 가능한 첫 포트를 반환.
// 모두 점유 시 명시적으로 예외를 던진다(상한 초과 = 실패).
async function findAvailablePort(startPort = DEFAULT_PORT, endPort = MAX_PORT) {
  for (let port = startPort; port <= endPort; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `사용 가능한 포트를 찾지 못했습니다(${startPort}~${endPort} 모두 점유 중). 다른 프로세스를 종료 후 재시도하세요.`
  );
}

module.exports = {
  REPO_ROOT,
  STATE_DIR,
  CONFIG_PATH,
  DEFAULT_PORT,
  MAX_PORT,
  DEFAULT_CONFIG,
  ensureStateDir,
  loadConfig,
  saveConfig,
  isPortFree,
  findAvailablePort,
};
