// attemptReader.js — 기존 attempt/INDEX 기록 파싱 + 시도 추이 + 키워드 멱등 패치
//
// CLI(스킬)가 쓴 기록과 웹이 쓴 기록을 동일하게 읽어 다회 풀이 추이를 계산한다.
// 키워드 패치: 제출 직후 키워드 폼 입력을 기존 attempt md에 멱등하게 반영한다.

const fs = require('fs');
const path = require('path');
const writer = require('./attemptWriter');

const 원문자맵 = { '①': 1, '②': 2, '③': 3, '④': 4 };

/** ①~④/1~4/'-'/'' → 1|2|3|4|null */
function uncircle(s) {
  const t = String(s ?? '').trim();
  if (t === '' || t === '-') return null;
  if (Object.prototype.hasOwnProperty.call(원문자맵, t)) return 원문자맵[t];
  if (/^[1-4]$/.test(t)) return Number(t);
  return null;
}

/** frontmatter(--- ~ ---) 단순 파싱: 스칼라 + `과목별점수:` 중첩 블록 */
function parseFrontmatter(content) {
  const m = content.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const 값 = {};
  const 과목별점수 = {};
  if (!m) return { 값, 과목별점수, 본문: content };
  const lines = m[1].split(/\r?\n/);
  let 중첩키 = null;
  for (const line of lines) {
    const indented = /^\s+/.test(line);
    const kv = line.match(/^(\s*)([^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[2].trim();
    const val = kv[3].trim();
    if (indented && 중첩키 === '과목별점수') {
      과목별점수[key] = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val;
      continue;
    }
    중첩키 = null;
    if (val === '') { 중첩키 = key; 값[key] = ''; continue; }
    값[key] = val;
  }
  return { 값, 과목별점수, 본문: content.slice(m[0].length) };
}

/**
 * attempt md 전체를 파싱한다.
 * @returns { 자격증, 시험, 시도, 풀이일, 소요시간, 총점, 합격여부, 과목별점수,
 *            문항들: [{ 과목, 문번, 내답, 정답, 결과, 확신도, 메모 }] }
 */
function parseAttempt(content) {
  const src = typeof content === 'string' ? content : '';
  const { 값: fm, 과목별점수, 본문 } = parseFrontmatter(src);
  const 문항들 = [];
  let 현재과목 = null;
  let 문항기록구간 = false;

  for (const line of 본문.split(/\r?\n/)) {
    if (/^##\s+문항\s*기록/.test(line)) { 문항기록구간 = true; continue; }
    if (/^##\s+오답/.test(line)) { 문항기록구간 = false; continue; }
    if (!문항기록구간) continue;

    const h = line.match(/^###\s+(.+?)\s*\(\s*(\d+)\s*[-~]\s*(\d+)\s*\)\s*$/);
    if (h) { 현재과목 = h[1].trim(); continue; }

    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 6) continue;
      if (/^#$/.test(cells[0]) || /내\s*답/.test(cells[1])) continue; // 헤더
      if (/^[-:\s]+$/.test(cells[0])) continue; // 구분선
      if (!/^\d+$/.test(cells[0])) continue;
      문항들.push({
        과목: 현재과목,
        문번: Number(cells[0]),
        내답: uncircle(cells[1]),
        정답: uncircle(cells[2]),
        결과: cells[3],
        확신도: cells[4],
        메모: cells[5],
      });
    }
  }

  return {
    자격증: fm.자격증 || '',
    시험: fm.시험 || '',
    시도: fm.시도 != null && /^\d+$/.test(fm.시도) ? Number(fm.시도) : null,
    풀이일: fm.풀이일 || '',
    소요시간: fm.소요시간 || '',
    총점: fm.총점 != null && fm.총점 !== '' ? Number(fm.총점) : null,
    합격여부: fm.합격여부 || '',
    과목별점수,
    문항들,
  };
}

/** INDEX.md 파싱 (writer의 파서 재사용) */
function parseIndex(content) {
  return writer.parseIndexRows(content);
}

/**
 * attempt 문항들에서 추이용 지표 계산: X수(오답)·찍음수·O찍음수·확신정답률·찍음비율.
 * (파싱된 문항 표에서 결정적으로 산출 — 웹 UI 추이 화면이 시도별로 소비)
 */
function attemptMetrics(문항들) {
  let X = 0;
  let 찍음 = 0;
  let O찍음 = 0;
  let 확신 = 0;
  let 확신정답 = 0;
  const items = 문항들 || [];
  for (const q of items) {
    const wrong = q.결과 === 'X';
    const guess = q.확신도 === '찍음';
    const sure = q.확신도 === '확신';
    if (wrong) X += 1;
    if (guess) 찍음 += 1;
    if (guess && q.결과 === 'O') O찍음 += 1;
    if (sure) {
      확신 += 1;
      if (q.결과 === 'O') 확신정답 += 1;
    }
  }
  const 문항수 = items.length;
  return {
    X수: X,
    찍음수: 찍음,
    O찍음수: O찍음,
    확신정답률: 확신 > 0 ? Math.round((확신정답 / 확신) * 100) : null,
    찍음비율: 문항수 > 0 ? Math.round((찍음 / 문항수) * 100) : 0,
  };
}

/**
 * 시도 추이 계산: 시험별로 시도 순 총점 배열.
 * @param rows INDEX 파싱 결과 또는 [{시험,시도,총점,결과}]
 * @returns { [시험]: [{ 시도, 총점, 결과 }] }
 */
function computeTrend(rows) {
  const byExam = {};
  for (const r of rows) {
    const 시험 = r.시험;
    if (!byExam[시험]) byExam[시험] = [];
    byExam[시험].push({ 시도: Number(r.시도), 총점: r.총점, 결과: r.결과 });
  }
  for (const 시험 of Object.keys(byExam)) {
    byExam[시험].sort((a, b) => a.시도 - b.시도);
  }
  return byExam;
}

/**
 * attempts/ 디렉토리를 스캔해 attempt 파일 요약 목록을 만든다 (CLI+웹 기록 포함).
 * @param attemptsDir 절대경로
 * @returns [{ 파일, 시험, 시도, 풀이일, 총점, 합격여부 }]
 */
function listAttempts(attemptsDir) {
  if (!fs.existsSync(attemptsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(attemptsDir)) {
    if (!name.endsWith('.md')) continue;
    if (name === 'INDEX.md' || name === 'WRONG.md') continue;
    const p = path.join(attemptsDir, name);
    let parsed;
    try {
      parsed = parseAttempt(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    out.push({
      파일: name,
      시험: parsed.시험,
      시도: parsed.시도,
      풀이일: parsed.풀이일,
      총점: parsed.총점,
      합격여부: parsed.합격여부,
      ...attemptMetrics(parsed.문항들),
    });
  }
  out.sort((a, b) => (a.시험 < b.시험 ? -1 : a.시험 > b.시험 ? 1 : (a.시도 || 0) - (b.시도 || 0)));
  return out;
}

/**
 * 개념 키워드/메모를 attempt md에 멱등하게 반영한다 (순수 함수).
 * - 문항 기록 표의 마지막 칸(개념 키워드/메모)을 해당 문번에 대해 교체
 * - 오답·불확신 정리의 `### #{문번} {키워드}` 헤딩 키워드를 교체
 * 같은 맵을 두 번 적용해도 결과가 동일하다(멱등).
 * @param content attempt md
 * @param 키워드맵 { [문번]: '키워드 텍스트' }
 */
function patchAttemptKeywords(content, 키워드맵) {
  const map = 키워드맵 || {};
  const lines = String(content).split('\n');
  let 문항기록구간 = false;
  let 오답구간 = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^##\s+문항\s*기록/.test(line)) { 문항기록구간 = true; 오답구간 = false; continue; }
    if (/^##\s+오답/.test(line)) { 문항기록구간 = false; 오답구간 = true; continue; }
    if (/^##\s/.test(line)) { 문항기록구간 = false; 오답구간 = false; continue; }

    // 문항 기록 표 행: | {문번} | 내답 | 정답 | 결과 | 확신도 | 메모 |
    if (문항기록구간 && /^\s*\|/.test(line)) {
      const cells = line.split('|');
      // cells[0]='' (앞), cells[1]=문번 … cells[6]=메모, cells[7]='' (뒤)
      if (cells.length >= 8) {
        const 문번raw = cells[1].trim();
        if (/^\d+$/.test(문번raw) && Object.prototype.hasOwnProperty.call(map, 문번raw)) {
          cells[6] = ` ${map[문번raw]} `;
          lines[i] = cells.join('|');
        }
      }
      continue;
    }

    // 오답 정리 헤딩: ### #{문번} {키워드}
    if (오답구간) {
      const h = line.match(/^(###\s+#)(\d+)(\s+.*)?$/);
      if (h && Object.prototype.hasOwnProperty.call(map, h[2])) {
        const kw = map[h[2]];
        lines[i] = `${h[1]}${h[2]}${kw ? ' ' + kw : ''}`;
      }
    }
  }
  return lines.join('\n');
}

/**
 * 키워드 패치를 파일에 적용 (mtime 확인 + tmp→rename 원자 커밋).
 * 외부 편집으로 mtime이 바뀌었으면 최신 내용을 재파싱해 적용하고 mtimeChanged=true를 보고한다
 * (패치는 멱등이므로 최신본에 적용해도 안전).
 * @returns { path, mtimeChanged }
 */
function patchKeywordsFile(attemptPath, 키워드맵, options) {
  const opts = options || {};
  const stat = fs.statSync(attemptPath);
  const mtimeChanged = opts.expectedMtimeMs != null && stat.mtimeMs !== opts.expectedMtimeMs;
  const content = fs.readFileSync(attemptPath, 'utf8');
  const patched = patchAttemptKeywords(content, 키워드맵);
  writer.atomicWrite(attemptPath, patched);
  return { path: attemptPath, mtimeChanged };
}

module.exports = {
  parseAttempt,
  parseIndex,
  computeTrend,
  listAttempts,
  patchAttemptKeywords,
  patchKeywordsFile,
  uncircle,
};
