// 채점 결과: 제출(qnet:attempt-submitted) 후 결과를 렌더한다.
// - 채점 히어로: 총점 + 판정 뱃지 + 확신 정답률 강조 + X수/O찍음수
// - 과목별 게이지: 40점 과락 기준선 마커 + 과락 위험색(서버 과락 판정 사용)
// - 시도 추이: 같은 기출 시도별 총점 인라인 SVG 라인 차트 (GET /api/attempts)
// - 키워드 폼: X·찍음 문항 개념 키워드/메모 입력(선택·건너뛰기 가능)
// - 다음 단계 퍼널: X·찍음 문항의 도구 패널(개념/챗) 바로가기 + 원본(답지 포함) 보기

import { apiFetch } from '../store.js';

const FLUNK_LINE = 40; // 과락 기준선(표시용 기본). 실제 과락 판정은 서버 s.과락 사용.
const PASS_LINE = 60; // 합격 기준선(추이 차트 가이드)

// 결과 퍼널 버튼이 도구 패널을 열 수 있도록 solve 뷰가 등록하는 핸들러.
// { openConcept(qno), openChat(qno) } | null
let toolHandlers = null;
export function configureResult(handlers) {
  toolHandlers = handlers || null;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// 합격여부 → 배지 클래스
function 판정클래스(합격여부) {
  if (합격여부 === '합격') return 'pass';
  if (합격여부 === '과락') return 'fail flunk';
  return 'fail';
}

function stat(label, value) {
  const s = el('div', 'result-stat');
  s.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return s;
}

// 채점 히어로: 총점·판정·확신 정답률 강조.
function renderHero(data) {
  const hero = el('section', 'result-hero');
  hero.append(el('div', 'result-hero-caption', `${data.시험} · ${data.시도}차 채점 결과`));

  const main = el('div', 'result-hero-main');
  const 총점 = el('div', 'result-hero-score');
  총점.append(
    el('span', 'result-hero-score-value', Number(data.총점).toFixed(1)),
    el('span', 'result-hero-score-label', '총점')
  );
  const verdict = el('span', `result-verdict ${판정클래스(data.합격여부)}`, data.합격여부);

  const conf = el('div', 'result-hero-conf');
  const pct = data.확신정답률 == null ? '-' : `${data.확신정답률}%`;
  conf.append(
    el('span', 'result-hero-conf-value', pct),
    el('span', 'result-hero-conf-label', '확신 정답률')
  );
  main.append(총점, verdict, conf);
  hero.append(main);

  const stats = el('div', 'result-summary');
  stats.append(
    stat('틀린 문항(X)', `${data.X수}개`),
    stat('찍어서 맞음(O+찍음)', `${data.O찍음수}개`)
  );
  hero.append(stats);
  return hero;
}

// 과목별 게이지 바: 점수 채움 + 40점 과락 기준선 마커 + 과락 위험색.
function renderGauges(data) {
  const box = el('section', 'result-gauges');
  box.append(el('h4', 'result-subtitle', '과목별 점수'));
  for (const s of data.과목결과 || []) {
    const 과락 = !!s.과락;
    const row = el('div', 'result-gauge-row' + (과락 ? ' flunk' : ''));
    row.append(el('span', 'result-gauge-label', s.과목명));

    const track = el('div', 'result-gauge-track');
    const fill = el('div', 'result-gauge-fill' + (과락 ? ' danger' : ''));
    const pct = Math.max(0, Math.min(100, Number(s.점수)));
    fill.style.width = `${pct}%`; // 데이터 기반 폭(정적 스타일 주입 아님)
    const marker = el('div', 'result-gauge-marker');
    marker.style.left = `${FLUNK_LINE}%`;
    marker.title = `과락 기준 ${FLUNK_LINE}점`;
    marker.setAttribute('aria-label', `과락 기준선 ${FLUNK_LINE}점`);
    track.append(fill, marker);
    row.append(track);

    const value = el('span', 'result-gauge-value', `${Number(s.점수).toFixed(0)}`);
    if (과락) value.append(el('span', 'result-gauge-flag', '과락'));
    row.append(value);
    box.append(row);
  }
  return box;
}

// 시도별 추이(총점 시퀀스) → 인라인 SVG 라인 차트. 슬롯 컨테이너에 채운다.
async function renderTrend(slot, data) {
  try {
    const params = new URLSearchParams({ grade: data.grade, cert: data.cert, examId: data.시험 });
    // 읽기(GET)는 다른 조회 경로와 일관되게 plain fetch 사용(토큰 불필요).
    const res = await fetch(`/api/attempts?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || '추이를 불러오지 못했습니다.');
    const seq = (payload.trend && payload.trend[data.시험]) || [];
    if (seq.length < 2) return; // 추이는 2회 이상일 때만 의미
    const box = el('section', 'result-trend');
    box.append(el('h4', 'result-subtitle', '시도별 총점 추이'));
    box.append(buildLineChart(seq));
    const caption = seq.map((t) => `${t.시도}차 ${Number(t.총점).toFixed(1)}`).join('  →  ');
    box.append(el('div', 'result-trend-caption', caption));
    slot.append(box);
  } catch (_e) {
    /* 추이는 부가정보 — 실패해도 채점 결과 표시엔 영향 없음 */
  }
}

// 인라인 SVG 라인 차트(외부 라이브러리 없음). 색/굵기는 CSS(class)에 위임.
function buildLineChart(seq) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 280;
  const H = 90;
  const padX = 10;
  const padY = 12;
  const n = seq.length;
  const xAt = (i) => (n > 1 ? padX + (i * (W - 2 * padX)) / (n - 1) : W / 2);
  const yAt = (v) => H - padY - (Math.max(0, Math.min(100, Number(v))) * (H - 2 * padY)) / 100;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'result-trend-chart');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '시도별 총점 추이 선형 차트');

  // 합격 기준선(60점) 가이드.
  const passY = yAt(PASS_LINE);
  const passLine = document.createElementNS(NS, 'line');
  passLine.setAttribute('x1', padX);
  passLine.setAttribute('x2', W - padX);
  passLine.setAttribute('y1', passY.toFixed(1));
  passLine.setAttribute('y2', passY.toFixed(1));
  passLine.setAttribute('class', 'result-trend-passline');
  svg.append(passLine);

  // 점수 선.
  const poly = document.createElementNS(NS, 'polyline');
  poly.setAttribute(
    'points',
    seq.map((t, i) => `${xAt(i).toFixed(1)},${yAt(t.총점).toFixed(1)}`).join(' ')
  );
  poly.setAttribute('fill', 'none'); // 폴리라인 채움 방지(기능적 속성)
  poly.setAttribute('class', 'result-trend-path');
  svg.append(poly);

  // 시도 점.
  seq.forEach((t, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', xAt(i).toFixed(1));
    c.setAttribute('cy', yAt(t.총점).toFixed(1));
    c.setAttribute('r', '3');
    c.setAttribute('class', 'result-trend-point');
    svg.append(c);
  });
  return svg;
}

// 키워드/메모 폼: X·찍음 문항 대상(선택·건너뛰기 가능).
function renderKeywordForm(container, data) {
  const targets = data.wrongTargets || [];
  if (targets.length === 0) return;

  const box = el('section', 'result-keywords');
  box.append(el('h4', 'result-subtitle', '개념 키워드 보강 (선택 — 건너뛸 수 있습니다)'));
  box.append(
    el('p', 'result-hint', 'X·찍음 문항의 개념 키워드를 남기면 attempt·WRONG(복습 재료)에 반영됩니다.')
  );

  const inputs = new Map();
  for (const t of targets) {
    const row = el('div', 'keyword-row');
    const label = el('label', 'keyword-label', `#${t.문번} (${t.과목명} · ${t.결과}/${t.확신도})`);
    const input = el('input', 'keyword-input');
    input.type = 'text';
    input.placeholder = '개념 키워드 / 메모';
    inputs.set(t.문번, input);
    row.append(label, input);
    box.append(row);
  }

  const actions = el('div', 'keyword-actions');
  const save = el('button', 'btn', '키워드 저장');
  const skip = el('button', 'btn secondary', '건너뛰기');
  const msg = el('span', 'keyword-msg');
  actions.append(save, skip, msg);
  box.append(actions);

  skip.addEventListener('click', () => box.remove());

  save.addEventListener('click', async () => {
    const 키워드맵 = {};
    for (const [문번, input] of inputs) {
      const v = input.value.trim();
      if (v) 키워드맵[문번] = v;
    }
    if (Object.keys(키워드맵).length === 0) {
      box.remove();
      return;
    }
    save.disabled = true;
    msg.textContent = '저장 중…';
    try {
      const res = await apiFetch(`/api/attempts/${encodeURIComponent(data.시험)}/keywords`, {
        method: 'POST',
        body: { grade: data.grade, cert: data.cert, 시도: data.시도, 키워드맵 },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '키워드 저장 실패');
      msg.className = 'keyword-msg ok';
      msg.textContent = '저장됨 — WRONG.md에 반영되었습니다.';
      save.disabled = true;
      skip.textContent = '닫기';
    } catch (e) {
      save.disabled = false;
      msg.className = 'keyword-msg error-text';
      msg.textContent = e.message;
    }
  });

  container.append(box);
}

// 다음 단계 퍼널: X·찍음 문항 복습 바로가기(도구 패널 개념/챗) + 원본(답지 포함) 보기.
function renderFunnel(container, data) {
  const targets = data.wrongTargets || [];
  const box = el('section', 'result-funnel');
  box.append(el('h4', 'result-subtitle', '다음 단계'));

  if (targets.length && toolHandlers) {
    box.append(
      el('p', 'result-hint', `오답·찍음 ${targets.length}문항 — 개념을 보거나 챗으로 질문해 복습하세요.`)
    );
    const list = el('div', 'result-funnel-list');
    for (const t of targets) {
      const item = el('div', 'result-funnel-item');
      item.append(
        el('span', 'result-funnel-qno', `#${t.문번}`),
        el('span', 'result-funnel-meta', `${t.과목명} · ${t.결과}/${t.확신도}`)
      );
      const cBtn = el('button', 'btn secondary result-funnel-concept', '오답 개념 보기');
      cBtn.setAttribute('aria-label', `${t.문번}번 개념 보기`);
      cBtn.addEventListener('click', () => {
        if (toolHandlers && typeof toolHandlers.openConcept === 'function') toolHandlers.openConcept(t.문번);
      });
      const chBtn = el('button', 'btn secondary result-funnel-chat', '챗으로 질문');
      chBtn.setAttribute('aria-label', `${t.문번}번 챗으로 질문`);
      chBtn.addEventListener('click', () => {
        if (toolHandlers && typeof toolHandlers.openChat === 'function') toolHandlers.openChat(t.문번);
      });
      item.append(cBtn, chBtn);
      list.append(item);
    }
    box.append(list);
  } else if (targets.length) {
    box.append(
      el('p', 'result-hint', `오답·찍음 ${targets.length}문항 — OMR 옆 개념·챗 버튼으로 복습하세요.`)
    );
  } else {
    box.append(el('p', 'result-hint', '오답·찍음 문항이 없습니다. 훌륭합니다!'));
  }

  // 원본(답지 포함) 보기 — 제출 후 게이트 통과.
  const full = el('button', 'btn secondary result-full-btn', '원본(답지 포함) 보기');
  full.addEventListener('click', () => {
    const qs = new URLSearchParams({ grade: data.grade, cert: data.cert });
    window.open(`/api/exams/${encodeURIComponent(data.시험)}/pdf-full?${qs.toString()}`, '_blank');
  });
  box.append(full);

  container.append(box);
}

// 제출 응답을 컨테이너에 렌더한다.
export function renderResult(container, data) {
  container.innerHTML = '';
  container.append(renderHero(data));
  container.append(renderGauges(data));
  // 추이는 비동기 로드 — 순서 보존을 위해 슬롯을 먼저 삽입하고 채운다.
  const trendSlot = el('div', 'result-trend-slot');
  container.append(trendSlot);
  renderKeywordForm(container, data);
  renderFunnel(container, data);
  renderTrend(trendSlot, data);
}

// 결과 전용 컨테이너(#result)에만 렌더한다. 없으면 no-op —
// 과거 #app 폴백은 기출 브라우저 전체(#app)를 innerHTML=''로 파괴하는 버그였다(제거).
function resultContainer() {
  return document.getElementById('result');
}

// 제출 성공 이벤트 수신 → 채점 결과 렌더(#result 존재 시에만).
window.addEventListener('qnet:attempt-submitted', (evt) => {
  const data = evt.detail;
  if (!data || !data.ok) return;
  const container = resultContainer();
  if (container) {
    renderResult(container, data);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
