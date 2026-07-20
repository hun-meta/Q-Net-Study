'use strict';

// 정답 md 파서 (순수 모듈 — express·외부 의존 없음)
//
// 대상 포맷: _공통/기출문제/정답/{연도}-{회차/식별자}-{구분}.md
// ---
// 문항수: 100
// 숨김페이지수: 1
// 추출도구: claude
// 추출일: 2026-07-21
// ---
//
// ## 소프트웨어 설계 (1-20)
//
// | 문번 | 정답 |
// |------|------|
// | 1 | ③ |
// | 2 | ④ |
//
// 팀 공식 출력 계약(worker-3 채점 로직이 소비):
// {
//   시험ID, 문항수, 숨김페이지수, 추출도구, 추출일,
//   과목들: [{ 과목명, 시작, 끝, 정답: { [문번]: 1|2|3|4 } }],
//   검증오류: string[]   // 파싱 가능하면 throw하지 않고 오류 목록으로 보고
// }

// 정답 토큰(①②③④ 또는 1~4)을 숫자 1~4로 정규화. 실패 시 null.
function 정답정규화(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const 원문자 = { '①': 1, '②': 2, '③': 3, '④': 4 };
  if (Object.prototype.hasOwnProperty.call(원문자, s)) return 원문자[s];
  if (/^[1-4]$/.test(s)) return Number(s);
  return null;
}

// frontmatter(--- ~ ---) 블록에서 key: value 추출. 외부 YAML 의존 없이 단순 파싱.
function frontmatter파싱(content) {
  const 결과 = {};
  const m = content.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!m) return { 값: 결과, 본문: content };
  const 블록 = m[1];
  for (const line of 블록.split(/\r?\n/)) {
    const kv = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (kv) 결과[kv[1].trim()] = kv[2].trim();
  }
  return { 값: 결과, 본문: content.slice(m[0].length) };
}

// content: 정답 md 문자열
// options: { 시험ID, 총페이지 }
//   시험ID — 파일명에서 유도한 "{연도}-{식별자}-{구분}". 생략 시 frontmatter의 `시험` 필드 사용.
//   총페이지 — 주어지면 숨김페이지수 < 총페이지 검증 수행.
function parse(content, options) {
  const opts = options || {};
  const 검증오류 = [];
  const src = typeof content === 'string' ? content : '';

  const { 값: fm, 본문 } = frontmatter파싱(src);

  const 문항수 = fm.문항수 != null && /^\d+$/.test(fm.문항수) ? Number(fm.문항수) : null;
  const 숨김페이지수 =
    fm.숨김페이지수 != null && /^\d+$/.test(fm.숨김페이지수) ? Number(fm.숨김페이지수) : 0;

  const 시험ID = opts.시험ID != null ? String(opts.시험ID) : fm.시험 != null ? String(fm.시험) : '';

  // 과목 섹션 + 정답 표 파싱
  const 과목들 = [];
  let 현재과목 = null;
  const 문번모음 = []; // 중복 검사용

  const lines = 본문.split(/\r?\n/);
  for (const line of lines) {
    const 헤더 = line.match(/^##\s+(.+?)\s*\(\s*(\d+)\s*[-~]\s*(\d+)\s*\)\s*$/);
    if (헤더) {
      현재과목 = {
        과목명: 헤더[1].trim(),
        시작: Number(헤더[2]),
        끝: Number(헤더[3]),
        정답: {},
      };
      과목들.push(현재과목);
      continue;
    }
    // 표 데이터 행: | 1 | ③ |
    if (/^\s*\|/.test(line)) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length < 2) continue;
      // 헤더행/구분행 건너뛰기
      if (/문번/.test(cells[0]) || /정답/.test(cells[1])) continue;
      if (/^[-:\s]+$/.test(cells[0])) continue;
      if (!/^\d+$/.test(cells[0])) continue;

      const 문번 = Number(cells[0]);
      const 정답값 = 정답정규화(cells[1]);
      문번모음.push(문번);

      if (!현재과목) {
        검증오류.push(`문번 ${문번}이 과목 섹션(## …) 밖에 있습니다`);
        continue;
      }
      if (정답값 == null) {
        검증오류.push(`문번 ${문번}의 정답 "${cells[1]}"이 도메인(①~④/1~4) 밖입니다`);
        현재과목.정답[문번] = null;
      } else {
        현재과목.정답[문번] = 정답값;
      }
      // 과목 범위 소속 검사
      if (문번 < 현재과목.시작 || 문번 > 현재과목.끝) {
        검증오류.push(
          `문번 ${문번}이 과목 "${현재과목.과목명}" 범위(${현재과목.시작}-${현재과목.끝}) 밖입니다`
        );
      }
    }
  }

  // ── 구조 검증 ──
  if (문항수 == null) {
    검증오류.push('frontmatter 문항수가 없거나 숫자가 아닙니다');
  }
  if (과목들.length === 0) {
    검증오류.push('과목 섹션(## 과목명 (시작-끝))을 찾지 못했습니다');
  }

  const 범위합 = 과목들.reduce((acc, s) => acc + (s.끝 - s.시작 + 1), 0);
  const 정답행수 = 문번모음.length;

  if (문항수 != null && 과목들.length > 0 && 범위합 !== 문항수) {
    검증오류.push(`과목 범위 합(${범위합}) ≠ frontmatter 문항수(${문항수})`);
  }
  if (문항수 != null && 정답행수 !== 문항수) {
    검증오류.push(`정답 행 수(${정답행수}) ≠ frontmatter 문항수(${문항수})`);
  }

  // 문번 중복 검사
  const 중복 = 문번중복찾기(문번모음);
  if (중복.length > 0) {
    검증오류.push(`문번 중복: ${중복.join(', ')}`);
  }

  // 숨김페이지수 도메인(총페이지가 주어진 경우만)
  if (opts.총페이지 != null) {
    const 총 = Number(opts.총페이지);
    if (!(숨김페이지수 >= 0 && 숨김페이지수 < 총)) {
      검증오류.push(`숨김페이지수(${숨김페이지수})가 0 이상 총페이지(${총}) 미만이어야 합니다`);
    }
  }

  return {
    시험ID,
    문항수: 문항수 != null ? 문항수 : 정답행수,
    숨김페이지수,
    추출도구: fm.추출도구 != null ? fm.추출도구 : '',
    추출일: fm.추출일 != null ? fm.추출일 : '',
    과목들,
    검증오류,
  };
}

function 문번중복찾기(문번모음) {
  const seen = new Set();
  const dup = new Set();
  for (const n of 문번모음) {
    if (seen.has(n)) dup.add(n);
    seen.add(n);
  }
  return [...dup].sort((a, b) => a - b);
}

module.exports = { parse, 정답정규화 };
