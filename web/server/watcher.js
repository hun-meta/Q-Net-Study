'use strict';

// 파일 워처: 저장소 md/PDF 변경을 감지해 SSE 허브로 브로드캐스트한다.
// .qnet-web/**(캐시·드래프트·설정), .git/**, node_modules/** 는 무시한다.
// claude/서버 쓰기 후 UI가 즉시 반영되도록 하는 것이 목적.

const path = require('path');
const chokidar = require('chokidar');

const DEBOUNCE_MS = 150;

// repoRoot를 감시하고 변경 시 hub.broadcast('fs-change', ...)를 호출.
// 반환값은 { close() } — 서버 종료 시 정리에 사용.
function startWatcher(repoRoot, hub, options = {}) {
  const debounceMs = options.debounceMs != null ? options.debounceMs : DEBOUNCE_MS;

  const watcher = chokidar.watch(repoRoot, {
    ignored: [
      /(^|[\\/])\.qnet-web([\\/]|$)/, // 로컬 상태(캐시·드래프트·config)
      /(^|[\\/])\.git([\\/]|$)/, // git 내부
      /(^|[\\/])node_modules([\\/]|$)/, // 의존성
    ],
    ignoreInitial: true, // 시작 시 기존 파일 스캔은 이벤트로 내보내지 않음
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  // 짧은 시간에 몰리는 변경을 묶어 한 번만 알린다.
  const pending = new Map(); // relPath -> type
  let timer = null;

  function flush() {
    timer = null;
    if (pending.size === 0) return;
    const changes = [];
    for (const [relPath, type] of pending) {
      changes.push({ path: relPath, type });
    }
    pending.clear();
    hub.broadcast('fs-change', { changes, at: Date.now() });
  }

  function schedule(type, filePath) {
    const relPath = path.relative(repoRoot, filePath);
    // 루트 자체(빈 경로)나 경계 밖('..' 시작) 이벤트는 무시 — chokidar가 감시 루트에
    // 대해 내보내는 잡음성 addDir 등을 걸러 UI 오갱신을 막는다.
    if (!relPath || relPath.startsWith('..')) return;
    pending.set(relPath, type);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  watcher
    .on('add', (p) => schedule('add', p))
    .on('change', (p) => schedule('change', p))
    .on('unlink', (p) => schedule('unlink', p))
    .on('addDir', (p) => schedule('addDir', p))
    .on('unlinkDir', (p) => schedule('unlinkDir', p));

  return {
    watcher,
    async close() {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}

module.exports = { startWatcher, DEBOUNCE_MS };
