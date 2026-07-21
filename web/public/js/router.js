// 해시 라우터: 경로 매칭 · 뷰 lazy import · 마운트/언마운트 · 브레드크럼 · 헤더 노출.
//   #/                                  → 온보딩(닉네임 미설정) 또는 홈(대시보드)
//   #/cert/{분야}/{자격증}               → 기출 목록(examlist)
//   #/cert/{분야}/{자격증}/trend         → 자격증 성적 추이(certTrend)
//   #/solve/{분야}/{자격증}/{시험ID}      → 풀이(시험치기)
//   #/view/{분야}/{자격증}/{시험ID}       → 풀이(답 포함 열람)
//   #/result/{분야}/{자격증}/{시험ID}     → 채점 결과
//   #/trend/{분야}/{자격증}/{시험ID}      → 시도 추이
// 세그먼트는 encodeURIComponent. 뷰 계약: mount(container, params) / unmount().

import { getState } from './store.js';

// 뷰 모듈 lazy 로더(코드 스플리팅 + 순환참조 회피). 파일명은 기존 유지(내용은 디자인으로 개편).
const VIEWS = {
  onboarding: () => import('./views/onboarding.js'),
  home: () => import('./views/dashboard.js'),
  examlist: () => import('./views/certDetail.js'),
  solve: () => import('./views/solve.js'),
  result: () => import('./views/result.js'),
  trend: () => import('./views/trend.js'),
  certTrend: () => import('./views/certTrend.js'),
  certNotes: () => import('./views/certNotes.js'),
};

let currentView = null;
let currentRoute = null;
let routing = false;
let pending = false;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const appEl = () => document.getElementById('app');

// ── 해시 파싱/조립 ───────────────────────────────────────────────────────────
function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const path = raw.startsWith('/') ? raw.slice(1) : raw;
  return path
    .split('/')
    .filter((s) => s.length)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch (_e) {
        return s;
      }
    });
}

export function navigate(hash) {
  location.hash = hash;
}

export function certHash(grade, cert) {
  return `#/cert/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}`;
}
export function certTrendHash(grade, cert) {
  return `#/cert/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/trend`;
}
export function certNotesHash(grade, cert) {
  return `#/cert/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/notes`;
}
export function solveHash(grade, cert, examId) {
  return `#/solve/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/${encodeURIComponent(examId)}`;
}
export function viewHash(grade, cert, examId) {
  return `#/view/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/${encodeURIComponent(examId)}`;
}
export function resultHash(grade, cert, examId) {
  return `#/result/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/${encodeURIComponent(examId)}`;
}
export function trendHash(grade, cert, examId) {
  return `#/trend/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/${encodeURIComponent(examId)}`;
}

function resolveRoute(segs) {
  const cert = (g, c) => ({ grade: g, cert: c });
  if (segs[0] === 'cert' && segs[1] && segs[2] && segs[3] === 'trend') {
    return { name: 'certTrend', params: { grade: segs[1], cert: segs[2] }, cert: cert(segs[1], segs[2]) };
  }
  if (segs[0] === 'cert' && segs[1] && segs[2] && segs[3] === 'notes') {
    return { name: 'certNotes', params: { grade: segs[1], cert: segs[2] }, cert: cert(segs[1], segs[2]) };
  }
  if (segs[0] === 'cert' && segs[1] && segs[2]) {
    return { name: 'examlist', params: { grade: segs[1], cert: segs[2] }, cert: cert(segs[1], segs[2]) };
  }
  if ((segs[0] === 'solve' || segs[0] === 'view') && segs[1] && segs[2] && segs[3]) {
    return {
      name: 'solve',
      params: { grade: segs[1], cert: segs[2], examId: segs[3], mode: segs[0] === 'view' ? 'view' : 'solve' },
      cert: cert(segs[1], segs[2]),
    };
  }
  if (segs[0] === 'result' && segs[1] && segs[2] && segs[3]) {
    return { name: 'result', params: { grade: segs[1], cert: segs[2], examId: segs[3] }, cert: cert(segs[1], segs[2]) };
  }
  if (segs[0] === 'trend' && segs[1] && segs[2] && segs[3]) {
    return { name: 'trend', params: { grade: segs[1], cert: segs[2], examId: segs[3] }, cert: cert(segs[1], segs[2]) };
  }
  const { nickname } = getState();
  return { name: nickname ? 'home' : 'onboarding', params: {}, cert: null };
}

// ── 브레드크럼 · 헤더 노출 ───────────────────────────────────────────────────
function crumbSep() {
  const s = el('span', 'crumb-sep');
  s.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 3l5 5-5 5"></path></svg>';
  return s;
}

function buildCrumbs(route) {
  const root = { label: 'Q-Net 기출', hash: '#/' };
  const c = route.cert;
  const certLink = c ? { label: c.cert, hash: certHash(c.grade, c.cert) } : null;
  switch (route.name) {
    case 'home':
      return [{ label: 'Q-Net 기출', current: true }];
    case 'examlist':
      return [root, { label: c ? c.cert : '자격증', current: true }];
    case 'certTrend':
      return [root, certLink, { label: '성적 추이', current: true }];
    case 'certNotes':
      return [root, certLink, { label: '정리 모음', current: true }];
    case 'solve':
      return [root, certLink, { label: route.params.mode === 'view' ? '답 포함 열람' : '풀이', current: true }];
    case 'result':
      return [root, certLink, { label: '채점 결과', current: true }];
    case 'trend':
      return [root, certLink, { label: '시도 추이', current: true }];
    default:
      return [{ label: 'Q-Net 기출', current: true }];
  }
}

function renderBreadcrumb(route) {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;
  nav.innerHTML = '';
  const crumbs = buildCrumbs(route).filter(Boolean);
  crumbs.forEach((cr, i) => {
    if (i > 0) nav.append(crumbSep());
    if (cr.current || !cr.hash) {
      nav.append(el('span', 'crumb-current', cr.label));
    } else {
      const a = el('a', 'crumb-link', cr.label);
      a.href = cr.hash;
      nav.append(a);
    }
  });
}

function updateHeader(route) {
  const header = document.getElementById('app-header');
  const showHeader = route.name !== 'onboarding';
  if (header) header.hidden = !showHeader;
  document.body.classList.toggle('route-onboarding', route.name === 'onboarding');
  document.body.classList.toggle('route-solve', route.name === 'solve');
  if (showHeader) renderBreadcrumb(route);
}

// ── 렌더 파이프라인 ──────────────────────────────────────────────────────────
async function render() {
  if (routing) {
    pending = true;
    return;
  }
  routing = true;

  const route = resolveRoute(parseHash());
  currentRoute = route;

  if (currentView && typeof currentView.unmount === 'function') {
    try {
      currentView.unmount();
    } catch (_e) {
      /* 언마운트 실패는 다음 마운트를 막지 않는다 */
    }
  }
  currentView = null;

  const container = appEl();
  container.innerHTML = '';
  updateHeader(route);

  try {
    const mod = await VIEWS[route.name]();
    if (currentRoute !== route) {
      routing = false;
      if (pending) {
        pending = false;
        render();
      }
      return;
    }
    if (mod && typeof mod.mount === 'function') {
      await mod.mount(container, route.params);
      currentView = mod;
    }
  } catch (err) {
    if (currentRoute === route) {
      container.innerHTML = '';
      const box = el('div', 'route-error');
      box.append(el('p', 'error-text', `화면을 불러오지 못했습니다: ${err && err.message ? err.message : err}`));
      const home = el('button', 'btn sm', '홈으로');
      home.type = 'button';
      home.addEventListener('click', () => {
        location.hash = '#/';
      });
      box.append(home);
      container.append(box);
    }
  }

  routing = false;
  if (pending) {
    pending = false;
    render();
  }
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
export function startRouter() {
  window.addEventListener('hashchange', render);
  // 닉네임 변경 시 홈 라우트 의미(온보딩↔홈)·헤더가 바뀔 수 있어 홈에 있으면 재렌더.
  window.addEventListener('qnet:nickname-changed', () => {
    const hash = location.hash;
    if (hash === '' || hash === '#' || hash === '#/') render();
  });

  if (location.hash === '' || location.hash === '#') {
    location.hash = '#/'; // hashchange 발생 → render 1회
  } else {
    render();
  }
}
