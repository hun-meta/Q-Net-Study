'use strict';

// SSE 허브: 파일 변경 등 서버 이벤트를 브라우저에 푸시한다.
// 각 이벤트에 단조 증가 id를 부여하고 최근 이벤트를 링 버퍼에 보관 →
// 재연결 시 Last-Event-ID 이후 이벤트를 재전송해 누락을 복구한다(재동기화).

const MAX_BUFFER = 200;
const HEARTBEAT_MS = 25000;

function createSseHub() {
  const clients = new Set();
  const buffer = []; // { id, event, data(string) }
  let lastId = 0;

  function record(event, payload) {
    lastId += 1;
    const entry = { id: lastId, event, data: JSON.stringify(payload) };
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    return entry;
  }

  function writeEntry(res, entry) {
    res.write(`id: ${entry.id}\n`);
    res.write(`event: ${entry.event}\n`);
    res.write(`data: ${entry.data}\n\n`);
  }

  // 모든 이벤트를 기록하고 연결된 모든 클라이언트에 브로드캐스트.
  function broadcast(event, payload) {
    const entry = record(event, payload);
    for (const res of clients) {
      try {
        writeEntry(res, entry);
      } catch (_err) {
        // 끊긴 연결은 close 핸들러에서 정리된다.
      }
    }
    return entry;
  }

  // 새 SSE 연결을 등록한다. Last-Event-ID 이후 버퍼 이벤트를 먼저 재전송.
  function handleConnection(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 즉시 플러시(초기 코멘트).
    res.write('retry: 3000\n');
    res.write(': connected\n\n');

    // 재동기화: 헤더 또는 쿼리로 마지막 수신 id를 받아 이후 이벤트 재전송.
    const rawLast =
      req.headers['last-event-id'] ||
      (req.query && req.query.lastEventId) ||
      '0';
    const since = Number.parseInt(rawLast, 10);
    if (Number.isFinite(since) && since > 0) {
      for (const entry of buffer) {
        if (entry.id > since) writeEntry(res, entry);
      }
    }

    clients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_err) {
        /* noop */
      }
    }, HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  }

  function clientCount() {
    return clients.size;
  }

  function currentId() {
    return lastId;
  }

  return { broadcast, handleConnection, clientCount, currentId };
}

module.exports = { createSseHub, MAX_BUFFER };
