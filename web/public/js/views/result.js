// 채점 결과 화면(#/result/...): 제출 직후 solve가 resultStore에 담은 채점 응답을 렌더.
// 결과 카드 + 확신 정답률 히어로 + 과목별 점수 + 기록 저장 배너 + 오답·찍음 키워드 폼 + 하단 액션.
// 직접 진입/새로고침으로 결과가 없으면 시도 추이로 안내. 뷰 계약: mount/unmount.

import { apiFetch } from '../store.js';
import { getLastResult } from '../resultStore.js';
import { trendHash, solveHash, certHash } from '../router.js';

const enc = encodeURIComponent;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function icon(html, cls) {
  const s = el('span', cls);
  s.style.display = 'inline-flex';
  s.innerHTML = html;
  return s;
}

function judgeClass(judge) {
  if (judge === '합격') return 'pass';
  if (judge === '과락') return 'flunk';
  return 'fail';
}

function priorityOf(w) {
  const x = w.결과 === 'X';
  if (x && w.확신도 === '찍음') return { e: '🔴', t: '오답·찍음', c: 'var(--danger)' };
  if (x && w.확신도 === '애매') return { e: '🟠', t: '오답·애매', c: 'var(--danger)' };
  if (x) return { e: '⛔', t: '오답·확신', c: 'var(--danger)' };
  if (w.확신도 === '찍음') return { e: '🟡', t: '정답·찍음', c: 'var(--warn)' };
  return { e: '⚪', t: '정답·애매', c: 'var(--fg-3)' };
}

export async function mount(container, { grade, cert, examId }) {
  container.innerHTML = '';
  const data = getLastResult();

  // 결과 없음(직접 진입/새로고침) → 안내.
  if (!data || data.시험 !== examId || !data.ok) {
    const wrap = el('div', 'res');
    const empty = el('div', 'res-empty');
    empty.append(
      el('p', null, '이 화면은 제출 직후의 채점 결과를 보여줘요. 결과를 다시 보려면 시도 추이에서 확인하세요.')
    );
    const b = el('button', 'res-act-trend', '시도 추이 보기');
    b.type = 'button';
    b.addEventListener('click', () => {
      location.hash = trendHash(grade, cert, examId);
    });
    empty.append(b);
    wrap.append(empty);
    container.append(wrap);
    return;
  }

  const wrap = el('div', 'res');

  const examLabelText = `${data.시험} · ${data.시도}차`;
  const guessCount = (data.wrongTargets || []).filter((w) => w.확신도 === '찍음').length;
  const totalRate = Math.round(Number(data.총점));
  const avg = Math.round(Number(data.총점));
  const conf = data.확신정답률 == null ? '—' : Number(data.확신정답률);

  // ── 상단 2열: 결과 카드 + 확신 정답률 히어로 ──
  const top = el('div', 'res-top');

  const card = el('div', 'res-card');
  card.append(el('div', 'res-card-caption', `채점 결과 · ${examLabelText}`));
  const main = el('div', 'res-card-main');
  main.append(el('span', `judge-pill ${judgeClass(data.합격여부)}`, data.합격여부));
  const avgBox = el('div');
  const avgLine = el('div', 'res-avg');
  avgLine.append(document.createTextNode(String(avg)), el('span', 'res-avg-unit', '점'));
  avgBox.append(avgLine, el('div', 'res-avg-label', '평균 · 합격선 60점'));
  main.append(avgBox);
  card.append(main);

  const metrics = el('div', 'res-metrics');
  metrics.append(
    metric(String(data.X수), '오답', 'danger'),
    metric(String(data.O찍음수), '찍었는데 맞음', 'warn'),
    metric(String(data.최저과목 ? data.최저과목.점수 : '—'), `최저 · ${data.최저과목 ? data.최저과목.과목명 : ''}`, '')
  );
  card.append(metrics);

  const conf차트 = el('div', 'res-conf');
  const confLabel = el('div', 'res-conf-label');
  confLabel.append(
    icon(
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9 4.3 13.9l.7-4.3-3.1-3 4.3-.6z"></path></svg>'
    ),
    document.createTextNode('확신 정답률')
  );
  const confVal = el('div', 'res-conf-val');
  confVal.append(document.createTextNode(String(conf)), el('span', 'res-conf-pct', '%'));
  const confDesc = el('div', 'res-conf-desc');
  confDesc.innerHTML = `찍은 문항 <b>${guessCount}개</b>를 뺀 실력 지표예요. 전체 정답률 ${totalRate}%보다 이 값이 진짜 실력에 가까워요.`;
  conf차트.append(confLabel, confVal, confDesc);

  top.append(card, conf차트);
  wrap.append(top);

  // ── 과목별 점수 ──
  const subjects = el('div', 'res-subjects');
  subjects.append(el('div', 'res-sub-title', '과목별 점수'));
  for (const s of data.과목결과 || []) {
    const 과락 = !!s.과락;
    const row = el('div', 'res-sub-row');
    row.append(el('span', 'res-sub-name', s.과목명));
    const track = el('div', 'res-sub-track');
    const fill = el('div', 'res-sub-fill' + (과락 ? ' flunk' : ''));
    fill.style.width = `${Math.max(0, Math.min(100, Number(s.점수)))}%`;
    track.append(fill);
    row.append(track);
    row.append(el('span', 'res-sub-score' + (과락 ? ' flunk' : ''), `${Number(s.점수)}점`));
    if (과락) row.append(el('span', 'res-sub-flunk', '과락'));
    subjects.append(row);
  }
  subjects.append(el('div', 'res-sub-note', '한 과목이라도 40점 미만이면 과락 — 평균과 무관하게 불합격이에요.'));
  wrap.append(subjects);

  // ── 기록 저장 배너 ──
  const saved = el('div', 'res-saved');
  saved.append(
    icon(
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--success)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-8"></path></svg>'
    )
  );
  const savedText = el('span', 'res-saved-text');
  savedText.innerHTML = '<b>풀이 기록 · INDEX · WRONG</b> 3개 파일이 저장소에 기록됐어요.';
  saved.append(savedText);
  const fullSlot = el('div', 'res-full-slot');
  const fullBtn = el('button', 'res-full-btn', '원본(답지 포함) 보기');
  fullBtn.type = 'button';
  fullBtn.addEventListener('click', () => {
    const qs = `grade=${enc(grade)}&cert=${enc(cert)}`;
    window.open(`/api/exams/${enc(examId)}/pdf-full?${qs}`, '_blank');
    fullSlot.innerHTML = '';
    const done = el('span', 'res-full-done');
    done.append(
      icon(
        '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 8.5l3 3 7-8"></path></svg>'
      ),
      document.createTextNode('원본 열람 가능')
    );
    fullSlot.append(done);
  });
  fullSlot.append(fullBtn);
  saved.append(fullSlot);
  wrap.append(saved);

  // ── 오답·찍음 키워드 폼(선택) ──
  const targets = data.wrongTargets || [];
  if (targets.length) {
    wrap.append(renderKeywordForm(container, data, grade, cert, examId));
  }

  // ── 하단 액션 ──
  const actions = el('div', 'res-actions');
  const trendBtn = el('button', 'res-act-trend');
  trendBtn.type = 'button';
  trendBtn.append(
    document.createTextNode('시도 추이 보기'),
    icon(
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l3.5-4 2.5 2.5L13 5"></path><path d="M9.5 5H13v3.5"></path></svg>'
    )
  );
  trendBtn.addEventListener('click', () => {
    location.hash = trendHash(grade, cert, examId);
  });
  const reBtn = el('button', 'res-act-sec', '재풀이');
  reBtn.type = 'button';
  reBtn.addEventListener('click', () => {
    location.hash = solveHash(grade, cert, examId);
  });
  const listBtn = el('button', 'res-act-sec', '목록으로');
  listBtn.type = 'button';
  listBtn.addEventListener('click', () => {
    location.hash = certHash(grade, cert);
  });
  actions.append(trendBtn, reBtn, listBtn);
  wrap.append(actions);

  container.append(wrap);
}

function metric(value, label, tone) {
  const box = el('div', 'res-metric');
  box.append(el('div', 'res-metric-val' + (tone ? ' ' + tone : ''), value), el('div', 'res-metric-label', label));
  return box;
}

function renderKeywordForm(container, data, grade, cert, examId) {
  const box = el('div', 'res-kw');
  const head = el('div', 'res-kw-head');
  const title = el('div', 'res-kw-title');
  title.append(document.createTextNode('오답·찍음 문항 정리 '), el('span', 'res-kw-optional', '(선택)'));
  const skip = el('button', 'res-kw-skip', '건너뛰기');
  skip.type = 'button';
  skip.addEventListener('click', () => box.remove());
  head.append(title, skip);
  box.append(head);
  box.append(el('p', 'res-kw-desc', '개념 키워드나 메모를 남기면 풀이 기록과 오답 인덱스에 함께 저장돼요. 제출은 이미 끝났어요.'));

  const list = el('div', 'res-kw-list');
  const inputs = new Map();
  for (const w of data.wrongTargets) {
    const pr = priorityOf(w);
    const row = el('div', 'res-kw-row');
    row.append(el('span', 'res-kw-emoji', pr.e));
    const info = el('div', 'res-kw-info');
    const qnoLine = el('div', 'res-kw-qno');
    const prTag = el('span', 'res-kw-priority', pr.t);
    prTag.style.color = pr.c;
    qnoLine.append(document.createTextNode(`${w.문번}번 `), prTag);
    info.append(qnoLine, el('div', 'res-kw-sub', w.과목명 || ''));
    row.append(info);
    const input = el('input', 'res-kw-input');
    input.type = 'text';
    input.placeholder = '개념 키워드 / 메모';
    inputs.set(w.문번, input);
    row.append(input);
    list.append(row);
  }
  box.append(list);

  const actions = el('div', 'res-kw-actions');
  const save = el('button', 'dlg-btn-primary', '저장');
  save.type = 'button';
  const later = el('button', 'dlg-btn-cancel', '나중에');
  later.type = 'button';
  later.addEventListener('click', () => box.remove());
  const msg = el('span', 'res-kw-msg');
  actions.append(save, later, msg);
  box.append(actions);

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
      const res = await apiFetch(`/api/attempts/${enc(examId)}/keywords`, {
        method: 'POST',
        body: { grade, cert, 시도: data.시도, 키워드맵 },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '키워드 저장 실패');
      box.innerHTML = '';
      box.className = 'res-kw-saved';
      box.append(
        icon(
          '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-8"></path></svg>'
        ),
        document.createTextNode('키워드가 풀이 기록·오답 인덱스에 저장됐어요.')
      );
    } catch (e) {
      save.disabled = false;
      msg.className = 'res-kw-msg err';
      msg.textContent = e.message;
    }
  });

  return box;
}

export function unmount() {}
