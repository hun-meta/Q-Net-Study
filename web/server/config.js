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
// Z.AI API Key 등 비밀은 config.json과 분리 저장한다 — config.json은 감사 무결성
// 해시 대상이라 CLI 잡 실행 중 등록하면 무결성 위반→잡 전체 원복이 발생한다.
// secrets.json은 감사 walk 제외(.qnet-web) + 무결성 대상이 아니라 언제든 안전하게 쓸 수 있다.
const SECRETS_PATH = path.join(STATE_DIR, 'secrets.json');

// 포트 정책: 4525 기본, 점유 시 4526~4535 순차 탐색, 상한 초과 시 명시적 실패.
const DEFAULT_PORT = 4525;
const MAX_PORT = 4535;

// CLI 브리지 기본 명령(사용자 확정, config로 재정의 가능).
// questionsModel: 문항 단위 추출(비전 판독) 잡이 claude CLI에 넘길 --model 값.
//   추출 품질이 좌우되는 작업이라 대화용 기본 모델(Fable 등)에 휩쓸리지 않게 항상 고정한다.
//   기본 opus(=Opus 4.8). config.json 으로 재정의 가능(빈 값이면 --model 미지정=CLI 기본).
const DEFAULT_CONFIG = Object.freeze({
  nickname: null,
  cliChat: 'agy --dangerously-skip-permissions',
  cliRecord: 'claude --dangerously-skip-permissions',
  questionsModel: 'opus',
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

// Z.AI 챗 프로바이더 기본값(상수). 환경변수가 있으면 환경변수 우선(resolveZai 참고).
// model 은 glm-5.2 고정 기본. effort 'none' = deep think(thinking) 비활성
// — 챗은 빠른 답변이 목적이므로 기본으로 사고 모드를 끈다.
const ZAI_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.z.ai/api/coding/paas/v4', // coding plan 엔드포인트
  model: 'glm-5.2',
  effort: 'none',
});

// secrets.json({ zaiApiKey })에서 Z.AI 키를 읽는다. 파일이 없거나 손상 시 빈 문자열.
function readZaiKey() {
  try {
    const raw = fs.readFileSync(SECRETS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return typeof data.zaiApiKey === 'string' ? data.zaiApiKey : '';
  } catch (err) {
    return '';
  }
}

// tmp→rename 원자 쓰기 + mode 0o600(소유자 전용)으로 Z.AI 키를 저장한다.
// 형식 검증만 하고 저장한다(빈 값·제어문자·개행 불가) — 유효성은 첫 챗 호출의
// 401/403 오류가 자연히 드러내며, 등록 시점 원격 검증으로 지연·토큰을 쓰지 않는다.
function saveZaiKey(key) {
  const trimmed = String(key == null ? '' : key).trim();
  if (!trimmed) throw new Error('API Key가 비어 있습니다.');
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('API Key에 제어문자·개행을 포함할 수 없습니다.');
  }
  ensureStateDir();
  const tmp = path.join(STATE_DIR, `.secrets.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ zaiApiKey: trimmed }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // writeFileSync의 mode는 신규 생성 시에만 적용 — rename 전 명시적으로 재보장.
  fs.renameSync(tmp, SECRETS_PATH);
  return trimmed;
}

// secrets.json에서 Z.AI 키를 제거한다(파일이 없으면 no-op).
function deleteZaiKey() {
  try {
    fs.unlinkSync(SECRETS_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Z.AI 설정을 호출 시점에 파생한다(부팅 1회 고정 아님 — UI로 키를 등록·삭제해도
// 재기동 없이 다음 호출부터 즉시 반영된다). 키 우선순위: env ZAI_API_KEY >
// secrets.json > 없음(비활성). baseUrl·model·effort는 env > ZAI_DEFAULTS. 모든 값 트림.
function resolveZai(env = process.env) {
  const e = env || {};
  const envKey = String(e.ZAI_API_KEY || '').trim();
  const fileKey = envKey ? '' : readZaiKey();
  const apiKey = envKey || fileKey;
  return {
    enabled: !!apiKey,
    apiKey,
    source: envKey ? 'env' : fileKey ? 'file' : null,
    baseUrl: String(e.ZAI_BASE_URL || '').trim() || ZAI_DEFAULTS.baseUrl,
    model: String(e.ZAI_MODEL || '').trim() || ZAI_DEFAULTS.model,
    effort: String(e.ZAI_EFFORT || '').trim() || ZAI_DEFAULTS.effort,
  };
}

module.exports = {
  REPO_ROOT,
  STATE_DIR,
  CONFIG_PATH,
  SECRETS_PATH,
  DEFAULT_PORT,
  MAX_PORT,
  DEFAULT_CONFIG,
  ZAI_DEFAULTS,
  ensureStateDir,
  loadConfig,
  saveConfig,
  isPortFree,
  findAvailablePort,
  readZaiKey,
  saveZaiKey,
  deleteZaiKey,
  resolveZai,
};
