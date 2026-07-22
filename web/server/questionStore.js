'use strict';

// 문항 md 저장소 (순수 모듈 — express·외부 의존 없음)
//
// 대상 포맷: _공통/기출문제/문항/{examId}/{문번}.md — 챗 컨텍스트 경량화용 문항 원문.
// ---
// 시험: 2025-3회-필기
// 문번: 1
// 과목: 소프트웨어 설계
// 정답: ②
// 추출도구: claude
// 추출일: 2026-07-22
// ---
// <문제 본문 — 코드/표/다이어그램은 마크다운으로 전사>
//
// ① <선택지1>
// ② <선택지2>
// ③ <선택지3>
// ④ <선택지4>
//
// 원칙:
// - 정답 값은 비전 판독이 아니라 정답 md(_공통/기출문제/정답/)의 복사본이다(validate로 대조).
// - 판독 불가 문항도 파일은 생성하되 본문 첫 줄에 `> ⚠️ 판독 불가:` 를 남긴다(완비 검사 막다른 길 방지).
// - 챗 solve 모드 주입 시 정답 줄은 서버가 제거한다(stripAnswer — 클라이언트 신뢰 금지).

const fs = require('fs');
const path = require('path');

const repo = require('./repo');
const security = require('./security');
const { 정답정규화 } = require('./answerKey');

const 문항디렉토리명 = '문항';
const 판독불가_RE = /^>\s*⚠️\s*판독 불가/u;
const 선택지_RE = /^([①②③④])\s*(.*)$/u;

// 자격증의 문항 저장 루트: _공통/기출문제/문항/{examId}
function 문항Dir(repoRoot, grade, cert, examId) {
  return path.join(
    repo.commonDir(repoRoot, repo.nfc(grade), repo.nfc(cert)),
    '기출문제',
    문항디렉토리명,
    repo.nfc(examId)
  );
}

// frontmatter(--- ~ ---) 파싱. answerKey와 동일한 무의존 단순 파서.
function frontmatter파싱(content) {
  const 결과 = {};
  const m = String(content).match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!m) return { 값: 결과, 본문: String(content) };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (kv) 결과[kv[1].trim()] = kv[2].trim();
  }
  return { 값: 결과, 본문: String(content).slice(m[0].length) };
}

// 문항 md 문자열 파싱 → { 시험, 문번, 과목, 정답(1~4|null), 추출도구, 추출일,
//                        본문md, 선택지:[{기호,내용}], 판독불가, 원문md }
function parse(content) {
  const 원문md = typeof content === 'string' ? content : '';
  const { 값: fm, 본문 } = frontmatter파싱(원문md);
  const 본문md = 본문.replace(/^\s*\n/, '').replace(/\s+$/, '');

  const 선택지 = [];
  let 판독불가 = false;
  for (const line of 본문md.split(/\r?\n/)) {
    const t = line.trim();
    if (판독불가_RE.test(t)) 판독불가 = true;
    const m = t.match(선택지_RE);
    if (m) 선택지.push({ 기호: m[1], 내용: m[2].trim() });
  }

  return {
    시험: fm.시험 || '',
    문번: /^\d+$/.test(fm.문번 || '') ? Number(fm.문번) : null,
    과목: fm.과목 || '',
    정답: 정답정규화(fm.정답),
    추출도구: fm.추출도구 || '',
    추출일: fm.추출일 || '',
    본문md,
    선택지,
    판독불가,
    원문md,
  };
}

// frontmatter의 `정답:` 줄만 제거한 md 반환(챗 solve 모드 주입용 — 서버 소유 스트립).
function stripAnswer(content) {
  const src = String(content);
  const m = src.match(/^(﻿?---\s*\r?\n)([\s\S]*?)(\r?\n---\s*(?:\r?\n|$))/);
  if (!m) return src;
  const 블록 = m[2]
    .split(/\r?\n/)
    .filter((line) => !/^\s*정답\s*:/.test(line))
    .join('\n');
  return m[1] + 블록 + m[3] + src.slice(m[0].length);
}

// 파일 읽기(경계 검증 포함). 부재·경계 밖·읽기 실패 시 null.
function read(repoRoot, grade, cert, examId, qno) {
  const dir = 문항Dir(repoRoot, grade, cert, examId);
  const abs = path.join(dir, `${Number(qno)}.md`);
  if (!fs.existsSync(abs)) return null;
  try {
    const certRoot = fs.realpathSync.native(
      path.join(repoRoot, repo.nfc(grade), repo.nfc(cert))
    );
    if (!security.isWithin(security.resolveRealPath(abs), certRoot)) return null;
  } catch (_e) {
    return null;
  }
  let content;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch (_e) {
    return null;
  }
  const parsed = parse(content);
  parsed.파일 = path.relative(repoRoot, abs);
  return parsed;
}

// 과목 범위 완비: [시작..끝] 문번 파일이 전부 존재하는가(이어하기 skip 판정용).
// 부분만 있는 과목(예: 21~23만)은 false → 그 과목만 재추출한다.
function rangeComplete(repoRoot, grade, cert, examId, 시작, 끝) {
  const s = Number(시작);
  const e = Number(끝);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s > e) return false;
  const dir = 문항Dir(repoRoot, grade, cert, examId);
  for (let q = s; q <= e; q += 1) {
    if (!fs.existsSync(path.join(dir, `${q}.md`))) return false;
  }
  return true;
}

// 완비 검사: 1..문항수 파일이 전부 존재하는가(내용 검증은 validate가 담당).
function completeness(repoRoot, grade, cert, examId, 문항수) {
  const n = Number(문항수);
  if (!Number.isInteger(n) || n <= 0) {
    return { 완비: false, 존재수: 0, 누락문번: [] };
  }
  const dir = 문항Dir(repoRoot, grade, cert, examId);
  const 누락문번 = [];
  let 존재수 = 0;
  for (let q = 1; q <= n; q += 1) {
    if (fs.existsSync(path.join(dir, `${q}.md`))) 존재수 += 1;
    else 누락문번.push(q);
  }
  return { 완비: 누락문번.length === 0, 존재수, 누락문번 };
}

// 문항 1개 검증: 정답 md(answerKey.parse 결과)와 대조. 반환: 오류 문자열 배열.
function validate(parsedQuestion, answerKeyParsed, qno) {
  const 오류 = [];
  const q = Number(qno);
  if (!parsedQuestion) {
    오류.push(`문번 ${q}: 문항 파일이 없거나 읽지 못했습니다`);
    return 오류;
  }
  if (parsedQuestion.문번 !== q) {
    오류.push(`문번 ${q}: frontmatter 문번(${parsedQuestion.문번})이 파일명과 다릅니다`);
  }
  // 정답 대조 — 정답 md가 진실 원천.
  let 기준정답 = null;
  let 기준과목 = null;
  for (const s of (answerKeyParsed && answerKeyParsed.과목들) || []) {
    if (q >= s.시작 && q <= s.끝) {
      기준정답 = s.정답 ? s.정답[q] : null;
      기준과목 = s.과목명;
      break;
    }
  }
  if (기준정답 != null && parsedQuestion.정답 !== 기준정답) {
    오류.push(
      `문번 ${q}: 정답(${parsedQuestion.정답})이 정답 md(${기준정답})와 다릅니다`
    );
  }
  if (기준과목 && parsedQuestion.과목 && parsedQuestion.과목 !== 기준과목) {
    오류.push(`문번 ${q}: 과목(${parsedQuestion.과목})이 정답 md(${기준과목})와 다릅니다`);
  }
  if (!parsedQuestion.판독불가) {
    if (!parsedQuestion.본문md.trim()) 오류.push(`문번 ${q}: 본문이 비어 있습니다`);
    if (parsedQuestion.선택지.length < 4) {
      오류.push(`문번 ${q}: 선택지가 ${parsedQuestion.선택지.length}개(4개 미만)입니다`);
    }
  }
  return 오류;
}

// 챗 컨텍스트 조립(순수): 문항 원문 + 클라이언트 부가 컨텍스트(노트/해설 목록).
// mode==='solve' 면 정답 줄을 제거해 주입한다(시험 중 정답 누출 차단 — 서버 소유).
function buildChatContext({ 원문md, mode, clientContext }) {
  const parts = [];
  if (원문md) {
    parts.push('[문항 원문]');
    parts.push(mode === 'view' ? String(원문md).trim() : stripAnswer(String(원문md)).trim());
    parts.push('');
  }
  if (clientContext) parts.push(String(clientContext));
  return parts.join('\n').trim();
}

module.exports = {
  문항디렉토리명,
  문항Dir,
  parse,
  stripAnswer,
  read,
  rangeComplete,
  completeness,
  validate,
  buildChatContext,
};
