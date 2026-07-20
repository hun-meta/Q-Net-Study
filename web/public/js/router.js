// 해시 라우터: 경로 매칭 · 뷰 lazy import · 마운트/언마운트 · 사이드바 렌더/하이라이트 · 풀이 자동 접힘.
//   #/                              → 온보딩(닉네임 미설정) 또는 대시보드
//   #/cert/{분야}/{자격증}           → 자격증 상세
//   #/solve/{분야}/{자격증}/{시험ID}  → 풀이(몰입 모드; 사이드바 자동 접힘)
// 세그먼트는 encodeURIComponent 로 인코딩한다. 뷰 계약: mount(container, params) / unmount().

import { getState } from './store.js';

const OPEN_REGISTER_KEY = 'qnet-open-register';

// 뷰 모듈 lazy 로더(코드 스플리팅 + 순환참조 회피).
const VIEWS = {
  onboarding: () => import('./views/onboarding.js'),
  dashboard: () => import('./views/dashboard.js'),
  certDetail: () => import('./views/certDetail.js'),
  solve: () => import('./views/solve.js'), // 에이전트 E 제공(같은 mount/unmount 계약)
};

let currentView = null; // 마운트된 뷰 모듈(unmount 보유)
let currentRoute = null;
let routing = false;
let pending = false;
let sidebarCerts = null; // /api/repo certs 캐시

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const appEl = () => document.getElementById('app');
const sidebarEl = () => document.getElementById('sidebar');

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

export function solveHash(grade, cert, examId) {
  return `#/solve/${encodeURIComponent(grade)}/${encodeURIComponent(cert)}/${encodeURIComponent(examId)}`;
}

function resolveRoute(segs) {
  if (segs[0] === 'cert' && segs[1] && segs[2]) {
    return { name: 'certDetail', params: { grade: segs[1], cert: segs[2] }, cert: { grade: segs[1], cert: segs[2] }, solve: false };
  }
  if (segs[0] === 'solve' && segs[1] && segs[2] && segs[3]) {
    return {
      name: 'solve',
      params: { grade: segs[1], cert: segs[2], examId: segs[3] },
      cert: { grade: segs[1], cert: segs[2] },
      solve: true,
    };
  }
  const { nickname } = getState();
  return { name: nickname ? 'dashboard' : 'onboarding', params: {}, cert: null, solve: false };
}

// ── 사이드바 상태(풀이 자동 접힘) ────────────────────────────────────────────
function applySidebarState(route) {
  const body = document.body;
  body.classList.toggle('route-solve', !!route.solve);
  body.classList.remove('sidebar-open'); // 라우트 전환 시 열림 상태 초기화(풀이는 접힘 시작)
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

  // 이전 뷰 언마운트.
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

  applySidebarState(route);
  renderSidebar(route); // 비동기(대기하지 않음 — 본문 마운트를 막지 않음)

  try {
    const mod = await VIEWS[route.name]();
    // 라우트가 그새 바뀌었으면 이 마운트는 폐기.
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
      const home = el('button', 'btn sm', '대시보드로');
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

// ── 사이드바 ─────────────────────────────────────────────────────────────────
async function fetchCerts() {
  if (sidebarCerts) return sidebarCerts;
  try {
    const res = await fetch('/api/repo');
    const data = res.ok ? await res.json() : { certs: [] };
    sidebarCerts = data.certs || [];
  } catch (_e) {
    sidebarCerts = [];
  }
  return sidebarCerts;
}

async function renderSidebar(route) {
  const host = sidebarEl();
  if (!host) return;
  const certs = await fetchCerts();
  // 렌더 중 라우트가 바뀌었으면 최신 라우트 기준으로.
  const active = (currentRoute && currentRoute.cert) || (route && route.cert) || null;

  host.innerHTML = '';
  const nav = el('nav', 'sidebar-nav');
  nav.setAttribute('aria-label', '자격증');

  const home = el('a', 'sidebar-home', '홈');
  home.href = '#/';
  nav.append(home);

  // 분야(grade)로 그룹핑.
  const groups = new Map();
  for (const c of certs) {
    if (!groups.has(c.grade)) groups.set(c.grade, []);
    groups.get(c.grade).push(c);
  }
  const sortedGrades = [...groups.keys()].sort((a, b) => String(a).localeCompare(String(b), 'ko'));

  for (const grade of sortedGrades) {
    const group = el('div', 'sidebar-group');
    group.append(el('div', 'sidebar-group-title', grade));
    const list = el('ul', 'sidebar-list');
    const items = groups.get(grade).slice().sort((a, b) => String(a.cert).localeCompare(String(b.cert), 'ko'));
    for (const c of items) {
      const li = el('li');
      const link = el('a', 'sidebar-link', c.cert);
      link.href = certHash(c.grade, c.cert);
      if (active && active.grade === c.grade && active.cert === c.cert) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      li.append(link);
      list.append(li);
    }
    group.append(list);
    nav.append(group);
  }

  if (certs.length === 0) {
    nav.append(el('p', 'muted sidebar-empty', '등록된 자격증이 없습니다.'));
  }

  // ＋ 자격증 등록: 대시보드 등록 폼을 자동 오픈하며 이동.
  const addBtn = el('button', 'sidebar-add', '＋ 자격증 등록');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    try {
      sessionStorage.setItem(OPEN_REGISTER_KEY, '1');
    } catch (_e) {
      /* 무시 — 미러 플래그 없이도 대시보드는 열린다 */
    }
    location.hash = '#/';
  });
  nav.append(addBtn);

  host.append(nav);
}

function refreshSidebar() {
  sidebarCerts = null; // 캐시 무효화
  renderSidebar(currentRoute || resolveRoute(parseHash()));
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
export function startRouter() {
  window.addEventListener('hashchange', render);
  // 새 자격증 등록·정답 등록 등으로 목록이 바뀌면 사이드바 갱신.
  window.addEventListener('qnet:fs-change', refreshSidebar);
  // 닉네임 변경 시 홈 라우트 의미(온보딩↔대시보드)가 바뀔 수 있어 재렌더.
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
