// 단일 스토어: 서버 상태(닉네임·토큰·CLI)와 API 래퍼를 보관한다.
// X-QNet-Token 을 모든 상태 변경 요청에 자동 주입한다.

const state = {
  nickname: null,
  token: null,
  cli: { chat: { available: false }, record: { available: false } },
  port: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

// 서버 부트스트랩 상태를 받아온다(토큰 포함).
export async function loadState() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('서버 상태를 불러오지 못했습니다.');
  const data = await res.json();
  Object.assign(state, data);
  notify();
  return state;
}

// 토큰을 주입한 fetch. 상태 변경(POST/PUT/…)에 사용.
export async function apiFetch(url, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(options.headers || {}) };
  if (state.token) opts.headers['X-QNet-Token'] = state.token;
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(url, opts);
}

export function setNickname(nickname) {
  state.nickname = nickname;
  notify();
}

// ── 드래프트 미러(localStorage) ──────────────────────────────────────────────
// 대시보드 "이어풀기" CTA용 경량 미러. 진실은 서버 드래프트(GET /api/draft/:examId)이며
// 이 미러는 자격증 컨텍스트(grade/cert)와 진행률을 홈에서 서버 왕복 없이 훑기 위한 캐시다.
const DRAFTS_KEY = 'qnet-drafts';

function readMirrors() {
  try {
    const arr = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_e) {
    return [];
  }
}

function writeMirrors(list) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(list));
  } catch (_e) {
    /* 스토리지 비활성/용량초과 — 미러는 부가기능이므로 무시 */
  }
}

// entry = { grade, cert, examId, done, total, ts }. 동일 (grade,cert,examId)는 upsert.
export function mirrorDraft(entry) {
  if (!entry || !entry.grade || !entry.cert || !entry.examId) return;
  const rest = readMirrors().filter(
    (d) => !(d.grade === entry.grade && d.cert === entry.cert && d.examId === entry.examId)
  );
  rest.push({
    grade: entry.grade,
    cert: entry.cert,
    examId: entry.examId,
    done: Number(entry.done) || 0,
    total: Number(entry.total) || 0,
    ts: entry.ts || Date.now(),
  });
  writeMirrors(rest);
}

export function removeDraftMirror(grade, cert, examId) {
  writeMirrors(
    readMirrors().filter((d) => !(d.grade === grade && d.cert === cert && d.examId === examId))
  );
}

// 최근 저장 순(ts 내림차순) 배열 반환.
export function listDraftMirrors() {
  return readMirrors()
    .slice()
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
}

// ── 테마(라이트/다크/자동) ───────────────────────────────────────────────────
// 'auto' 는 OS 설정(prefers-color-scheme)을 따르고 data-theme 를 제거한다.
const THEME_KEY = 'qnet-theme';

export function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch (_e) {
    return 'auto';
  }
}

// mode: 'auto'|'light'|'dark'. 저장 + document.documentElement.dataset.theme 반영.
export function setTheme(mode) {
  const m = mode === 'light' || mode === 'dark' ? mode : 'auto';
  try {
    localStorage.setItem(THEME_KEY, m);
  } catch (_e) {
    /* 무시 — 테마 반영 자체는 아래에서 계속 수행 */
  }
  const root = document.documentElement;
  if (m === 'auto') delete root.dataset.theme;
  else root.dataset.theme = m;
  return m;
}
