// attemptWriter.js — attempt / INDEX / WRONG 생성·갱신 (순수 렌더 + tmp→rename 원자 커밋)
//
// templates/attempt.md 양식과 정확히 일치. INDEX.md·WRONG.md는 CLAUDE.md +
// .claude/skills/attempt-log/SKILL.md 형식을 따른다.
// 확신도: 찍음→'찍음', 미체크→'확신' (파서는 '애매' 포함 3값 인식).

const fs = require('fs');
const path = require('path');
const os = require('os');

const 동그라미 = ['①', '②', '③', '④'];

/** 1~4 → ①~④, null → '-' */
function circle(n) {
  if (n == null) return '-';
  return 동그라미[n - 1] ?? '-';
}

/** 총점/평균: 항상 소수 1자리 ("62.0") */
function fmtAvg(n) {
  return Number(n).toFixed(1);
}

/** 과목 점수: 정수면 정수로, 아니면 소수 1자리 ("45", "62.5") */
function fmtSubj(n) {
  const r = Math.round(Number(n) * 10) / 10;
  return String(r);
}

/** 확신정답률: null → '-', 아니면 "84%" */
function fmtPct(v) {
  return v == null ? '-' : `${Math.round(v)}%`;
}

/** 시험ID "{연도}-{식별자}-{구분}" → { 연도, 회차, 구분 } (CBT 상시 식별자 포함) */
function parse시험ID(id) {
  const parts = String(id).split('-');
  if (parts.length < 3) return { 연도: parts[0] || '', 회차: '', 구분: parts[1] || '' };
  return { 연도: parts[0], 구분: parts[parts.length - 1], 회차: parts.slice(1, -1).join('-') };
}

/** WRONG 우선순위 마커: (결과, 확신도) → 이모지 */
function wrongMarker(결과, 확신도) {
  if (결과 === 'X' && 확신도 === '찍음') return '🔴';
  if (결과 === 'X' && 확신도 === '애매') return '🟠';
  if (결과 === 'X') return '⛔'; // X + 확신 (오개념)
  if (결과 === 'O' && 확신도 === '찍음') return '🟡';
  return '⚪'; // O + 애매
}
const 마커순위 = { '🔴': 0, '🟠': 1, '⛔': 2, '🟡': 3, '⚪': 4 };

/** WRONG 대상 문항인가: X 전부 + O+찍음 + O+애매 */
function isWrongTarget(문항) {
  return 문항.결과 === 'X' || 문항.확신도 === '찍음' || 문항.확신도 === '애매';
}

// ── attempt 본문 렌더 ──────────────────────────────────────────────

/**
 * attempt md 전체 문자열을 만든다 (templates/attempt.md 양식).
 * @param model {
 *   자격증, 시험ID, 시도, 풀이일, 소요시간,
 *   gradingResult,           // grading.grade() 반환
 *   키워드맵?,               // { [문번]: '키워드 텍스트' }
 *   한줄회고?, 체감난이도?    // 미지정 시 빈칸/기본 유지
 * }
 */
function renderAttempt(model) {
  const { 자격증, 시험ID, 시도, 풀이일, 소요시간, gradingResult: g } = model;
  const 키워드맵 = model.키워드맵 || {};
  const { 연도, 회차, 구분 } = parse시험ID(시험ID);
  const 기준 = g.기준 || { 과목과락: 40, 평균합격: 60 };

  const L = [];
  // frontmatter
  L.push('---');
  L.push(`자격증: ${자격증}`);
  L.push(`시험: ${시험ID}`);
  L.push(`시도: ${시도}`);
  L.push(`풀이일: ${풀이일}`);
  L.push(`소요시간: ${소요시간 ?? ''}`);
  L.push(`총점: ${fmtAvg(g.총점)}`);
  L.push('과목별점수:');
  for (const s of g.과목결과) L.push(`  ${s.과목명}: ${fmtSubj(s.점수)}`);
  L.push(`합격여부: ${g.합격여부}`);
  L.push('---');
  L.push('');
  // 제목
  L.push(`# ${연도}년 ${회차}회 ${구분} — ${시도}차 시도`);
  L.push('');
  // 요약
  L.push('## 요약');
  L.push('');
  L.push('| 지표 | 값 |');
  L.push('|------|-----|');
  L.push(`| 총점 / 합격 기준 | ${fmtAvg(g.총점)} / 평균 ${기준.평균합격} (과목당 ${기준.과목과락}) |`);
  L.push(`| 틀린 문항 (X) | ${g.X수}개 |`);
  L.push(`| 찍어서 맞은 문항 (O+찍음) | ${g.O찍음수}개 |`);
  L.push(`| 확신 정답률 (확신 문항 중 정답 비율) | ${fmtPct(g.확신정답률)} ← 실력 지표 |`);
  L.push('| 체감 난이도 | 상 / 중 / 하 |');
  L.push('');
  L.push(`한 줄 회고: ${model.한줄회고 || ''}`);
  L.push('');
  // 문항 기록
  L.push('## 문항 기록');
  L.push('');
  L.push('> 확신도: `확신`(근거를 알고 골랐다) / `애매`(후보 중 고민했다) / `찍음`(모르고 골랐다)');
  L.push('> 결과가 X이거나 확신도가 `찍음`·`애매`면 **메모에 반드시 개념 키워드**를 남긴다 → WRONG.md 인덱싱에 사용됨.');
  L.push('');
  for (const s of g.과목결과) {
    L.push(`### ${s.과목명} (${s.시작}~${s.끝})`);
    L.push('');
    L.push('| # | 내 답 | 정답 | 결과 | 확신도 | 개념 키워드 / 메모 |');
    L.push('|---|------|------|------|--------|--------------------|');
    for (const 문항 of g.문항결과) {
      if (문항.과목명 !== s.과목명) continue;
      const 메모 = 키워드맵[문항.문번] || '';
      L.push(`| ${문항.문번} | ${circle(문항.내답)} | ${circle(문항.정답)} | ${문항.결과} | ${문항.확신도} | ${메모} |`);
    }
    L.push('');
  }
  // 오답·불확신 정리
  L.push('## 오답·불확신 정리');
  L.push('');
  L.push('> X 또는 찍음/애매 문항만. 여기 적은 내용이 복습(`/review`)의 재료가 된다.');
  L.push('');
  for (const 문항 of g.문항결과) {
    if (!isWrongTarget(문항)) continue;
    const kw = 키워드맵[문항.문번] || '';
    L.push(`### #${문항.문번} ${kw}`.trimEnd());
    L.push('- 문제 요지:');
    L.push('- 내가 고른 이유(오개념):');
    L.push('- 올바른 근거:');
    L.push(`- 연결 노트: \`notes/${문항.과목명}/{NN}-{주요항목}.md\``);
    L.push('');
  }
  // 파일 끝 개행 1개
  return L.join('\n').replace(/\n+$/, '\n');
}

/** attempt 파일 경로 */
function attemptFileName(시험ID, 시도) {
  return `${시험ID}-${시도}.md`;
}

// ── INDEX.md ──────────────────────────────────────────────────────

const INDEX_TITLE = '# 풀이 이력';
const INDEX_HEADER = '| 시험 | 시도 | 날짜 | 총점 | 과목별 최저 | 결과 | X | O+찍음 | 확신정답률 | 기록 |';
const INDEX_SEP = '|------|------|------|------|------------|------|---|--------|-----------|------|';

/** model → INDEX 행에 필요한 데이터 */
function buildIndexRow(model) {
  const g = model.gradingResult;
  return {
    시험: model.시험ID,
    시도: Number(model.시도),
    날짜: model.풀이일,
    총점: g.총점,
    최저점수: g.최저과목.점수,
    최저과목: g.최저과목.과목명,
    결과: g.합격여부,
    X: g.X수,
    O찍음: g.O찍음수,
    확신정답률: g.확신정답률,
    파일: attemptFileName(model.시험ID, model.시도),
  };
}

function renderIndexRow(r) {
  return `| ${r.시험} | ${r.시도} | ${r.날짜} | ${fmtAvg(r.총점)} | ${fmtSubj(r.최저점수)} (${r.최저과목}) | ${r.결과} | ${r.X} | ${r.O찍음} | ${fmtPct(r.확신정답률)} | [링크](${r.파일}) |`;
}

/** 기존 INDEX 표에서 행 파싱 (헤더/구분선 제외) */
function parseIndexRows(content) {
  const rows = [];
  if (!content) return rows;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (t.includes('시험') && t.includes('시도')) continue; // 헤더
    if (/^\|[-\s|]+\|$/.test(t)) continue; // 구분선
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 10) continue;
    rows.push({
      시험: cells[0],
      시도: Number(cells[1]),
      날짜: cells[2],
      총점: parseFloat(cells[3]),
      과목별최저: cells[4],
      결과: cells[5],
      X: Number(cells[6]),
      O찍음: Number(cells[7]),
      확신정답률: cells[8],
      기록: cells[9],
      _raw: t,
    });
  }
  return rows;
}

/** 추이 섹션 문자열 생성 (시험별 시도 순 총점 나열) */
function renderTrend(rows) {
  const byExam = new Map();
  for (const r of rows) {
    if (!byExam.has(r.시험)) byExam.set(r.시험, []);
    byExam.get(r.시험).push(r);
  }
  const out = ['## 추이', ''];
  for (const [시험, list] of byExam) {
    const sorted = [...list].sort((a, b) => a.시도 - b.시도);
    if (sorted.length < 1) continue;
    const seq = sorted.map((r) => fmtAvg(r.총점)).join(' → ');
    out.push(`- ${시험}: ${seq}`);
  }
  return out.join('\n');
}

/**
 * 기존 INDEX 내용에 새 행을 upsert (같은 시험+시도면 교체).
 * @returns 새 INDEX.md 전체 문자열
 */
function upsertIndex(existingContent, rowModel) {
  const rows = parseIndexRows(existingContent);
  const idx = rows.findIndex((r) => r.시험 === rowModel.시험 && r.시도 === rowModel.시도);
  const newRow = {
    시험: rowModel.시험,
    시도: rowModel.시도,
    날짜: rowModel.날짜,
    총점: rowModel.총점,
    결과: rowModel.결과,
    X: rowModel.X,
    O찍음: rowModel.O찍음,
    확신정답률: rowModel.확신정답률 == null ? '-' : `${rowModel.확신정답률}%`,
    _rowStr: renderIndexRow(rowModel),
  };
  if (idx >= 0) rows[idx] = { ...rows[idx], ...newRow, _rowStr: newRow._rowStr };
  else rows.push({ ...newRow, _rowStr: newRow._rowStr });
  // 정렬: 시험 asc, 시도 asc
  rows.sort((a, b) => (a.시험 < b.시험 ? -1 : a.시험 > b.시험 ? 1 : a.시도 - b.시도));

  const body = [INDEX_TITLE, '', INDEX_HEADER, INDEX_SEP];
  // 갱신/신규 행은 _rowStr, 기존 유지 행은 원본 라인(_raw)으로 렌더
  for (const r of rows) body.push(r._rowStr || r._raw);
  body.push('');
  body.push(renderTrend(rows));
  return body.join('\n').replace(/\n+$/, '\n');
}

// ── WRONG.md ──────────────────────────────────────────────────────

const WRONG_TITLE = '# 오답·불확신 인덱스';
const WRONG_GUIDE1 = '> 우선순위: 🔴 X+찍음 > 🟠 X+애매 > ⛔ X+확신(오개념!) > 🟡 O+찍음 > ⚪ O+애매';
const WRONG_GUIDE2 = '> 복습(재풀이)에서 확신+정답 2회 연속이면 취소선 처리로 졸업.';

/** model → WRONG 항목 배열 (과목별) */
function buildWrongEntries(model) {
  const g = model.gradingResult;
  const 키워드맵 = model.키워드맵 || {};
  const entries = [];
  for (const 문항 of g.문항결과) {
    if (!isWrongTarget(문항)) continue;
    entries.push({
      과목: 문항.과목명,
      시험: model.시험ID,
      문번: 문항.문번,
      마커: wrongMarker(문항.결과, 문항.확신도),
      키워드: 키워드맵[문항.문번] || '',
      파일: attemptFileName(model.시험ID, model.시도),
    });
  }
  return entries;
}

/** WRONG 항목 한 줄 렌더 (복습 0회 신규) */
function renderWrongLine(e) {
  const suffix = e.마커 === '⛔' ? ' — 확신하고 틀림, 개념 재점검 필요' : '';
  const 노트 = `../notes/${e.과목}/{NN}-{항목}.md`;
  return `- [ ] ${e.마커} ${e.시험} #${e.문번} ${e.키워드}`.replace(/\s+$/, '') +
    ` → [기록](${e.파일}) / [노트](${노트}) (복습 0회)${suffix}`;
}

/** 활성(미졸업) 라인에서 시험#문번 키 추출 */
function wrongLineKey(line) {
  const m = line.match(/([0-9]{4}-[^\s#]+)\s+#(\d+)/);
  return m ? `${m[1]}#${m[2]}` : null;
}
/** 라인 우선순위 마커 추출 */
function wrongLineMarker(line) {
  const m = line.match(/[🔴🟠⛔🟡⚪]/u);
  return m ? m[0] : '⚪';
}

/**
 * 기존 WRONG 내용에 새 항목들을 병합.
 * - 기존 항목(졸업 취소선 포함) 보존
 * - 같은 시험#문번이 이미 있으면 재추가 안 함 (졸업 부활 방지)
 * - 과목 내 활성 라인은 우선순위→문번 정렬, 졸업(~~) 라인은 뒤에 원문 보존
 * @returns 새 WRONG.md 전체 문자열
 */
function upsertWrong(existingContent, newEntries) {
  // 기존 파싱: 과목 섹션별 라인 수집
  const sections = new Map(); // 과목 → { active:[], graduated:[] }
  const order = []; // 과목 등장 순서
  let cur = null;
  if (existingContent) {
    for (const line of existingContent.split('\n')) {
      const h = line.match(/^##\s+(.+?)\s*$/);
      if (h) {
        cur = h[1];
        if (!sections.has(cur)) { sections.set(cur, { active: [], graduated: [] }); order.push(cur); }
        continue;
      }
      if (cur && line.trim().startsWith('-')) {
        if (line.includes('~~')) sections.get(cur).graduated.push(line);
        else sections.get(cur).active.push(line);
      }
    }
  }
  // 기존 활성 키 집합 (과목별)
  const existingKeys = new Map();
  for (const [과목, s] of sections) {
    const set = new Set();
    for (const ln of s.active) { const k = wrongLineKey(ln); if (k) set.add(k); }
    for (const ln of s.graduated) { const k = wrongLineKey(ln); if (k) set.add(k); }
    existingKeys.set(과목, set);
  }
  // 신규 항목 추가
  for (const e of newEntries) {
    if (!sections.has(e.과목)) { sections.set(e.과목, { active: [], graduated: [] }); order.push(e.과목); }
    if (!existingKeys.has(e.과목)) existingKeys.set(e.과목, new Set());
    const key = `${e.시험}#${e.문번}`;
    if (existingKeys.get(e.과목).has(key)) continue; // 중복/졸업 부활 방지
    sections.get(e.과목).active.push(renderWrongLine(e));
    existingKeys.get(e.과목).add(key);
  }
  // 렌더
  const out = [WRONG_TITLE, '', WRONG_GUIDE1, WRONG_GUIDE2, ''];
  for (const 과목 of order) {
    const s = sections.get(과목);
    if (s.active.length === 0 && s.graduated.length === 0) continue;
    out.push(`## ${과목}`);
    out.push('');
    const active = [...s.active].sort((a, b) => {
      const ma = 마커순위[wrongLineMarker(a)] ?? 9;
      const mb = 마커순위[wrongLineMarker(b)] ?? 9;
      if (ma !== mb) return ma - mb;
      const na = Number((wrongLineKey(a) || '#0').split('#')[1]);
      const nb = Number((wrongLineKey(b) || '#0').split('#')[1]);
      return na - nb;
    });
    for (const ln of active) out.push(ln);
    for (const ln of s.graduated) out.push(ln);
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

/**
 * WRONG.md 활성 항목의 개념 키워드를 갱신한다(제출 직후 키워드 폼 반영, 멱등).
 * - 졸업(취소선 ~~) 라인은 건드리지 않는다.
 * - `{시험ID} #{문번}`이 일치하고 키워드맵에 있는 활성 라인의 키워드 토큰만 교체.
 * @param content WRONG.md
 * @param 시험ID 대상 시험
 * @param 키워드맵 { [문번]: '키워드' }
 */
function patchWrongKeywords(content, 시험ID, 키워드맵) {
  const map = 키워드맵 || {};
  return String(content)
    .split('\n')
    .map((line) => {
      if (line.includes('~~')) return line; // 졸업 보존
      const m = line.match(
        /^(-\s*\[[ x]\]\s*[🔴🟠⛔🟡⚪]\s*)(\S+)\s+#(\d+)\s+(.*?)(\s*→\s*\[기록\].*)$/u
      );
      if (!m) return line;
      if (m[2] !== 시험ID) return line;
      if (!Object.prototype.hasOwnProperty.call(map, m[3])) return line;
      const kw = map[m[3]];
      const 꼬리 = m[5].replace(/^\s*/, ' '); // ' → [기록]...'
      return `${m[1]}${m[2]} #${m[3]}${kw ? ' ' + kw : ''}${꼬리}`;
    })
    .join('\n');
}

// ── 파일 쓰기 (tmp→rename 원자 커밋) ──────────────────────────────

/** 같은 파일시스템에 임시파일 작성 후 rename (원자 커밋). NFC 정규화 경로. */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
  return filePath;
}

/**
 * attempt 3종을 한 번에 기록: attempt md 작성 + INDEX/WRONG upsert.
 * @param attemptsDir 대상 닉네임의 attempts/ 절대경로
 * @returns { attempt, index, wrong } 각 파일 경로
 */
function writeAttemptBundle(attemptsDir, model) {
  const attemptPath = path.join(attemptsDir, attemptFileName(model.시험ID, model.시도));
  atomicWrite(attemptPath, renderAttempt(model));

  const indexPath = path.join(attemptsDir, 'INDEX.md');
  const idxExisting = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
  atomicWrite(indexPath, upsertIndex(idxExisting, buildIndexRow(model)));

  const wrongPath = path.join(attemptsDir, 'WRONG.md');
  const wrongExisting = fs.existsSync(wrongPath) ? fs.readFileSync(wrongPath, 'utf8') : '';
  atomicWrite(wrongPath, upsertWrong(wrongExisting, buildWrongEntries(model)));

  return { attempt: attemptPath, index: indexPath, wrong: wrongPath };
}

module.exports = {
  renderAttempt,
  attemptFileName,
  parse시험ID,
  buildIndexRow,
  renderIndexRow,
  parseIndexRows,
  renderTrend,
  upsertIndex,
  buildWrongEntries,
  renderWrongLine,
  upsertWrong,
  patchWrongKeywords,
  wrongMarker,
  isWrongTarget,
  atomicWrite,
  writeAttemptBundle,
  _internal: { circle, fmtAvg, fmtSubj, fmtPct },
};
