'use strict';

// 경량 서버 로거: 타임스탬프 한 줄을 .qnet-web/logs/server.log 에 append 하고
// stdout 에도 echo 한다(터미널·파일 양쪽 관측). .qnet-web/·*.log 는 gitignore 됨.
// CLI 잡(특히 record 정리)의 결과(타임아웃/감사 원복 여부)를 사후에도 읽을 수 있게 남긴다.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./config');

const LOG_DIR = path.join(REPO_ROOT, '.qnet-web', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

function write(level, msg, extra) {
  let line = `${new Date().toISOString()} [${level}] ${msg}`;
  if (extra !== undefined) {
    try {
      line += ` ${JSON.stringify(extra)}`;
    } catch (_e) {
      line += ' {unserializable}';
    }
  }
  line += '\n';
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch (_e) {
    /* 로깅 실패는 본 흐름을 막지 않는다 */
  }
  try {
    process.stdout.write(line);
  } catch (_e) {
    /* noop */
  }
}

module.exports = {
  LOG_FILE,
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};
