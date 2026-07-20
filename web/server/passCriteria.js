'use strict';

// 합격 기준 파서 (순수 모듈 — express·외부 의존 없음)
//
// 대상: _공통/info.md 내 grading 주석 블록
//   <!-- grading: 과목과락: 40 / 평균합격: 60 -->
// 부재 시 기사 기본값 40/60을 반환하고 출처를 '기본값'으로 표기(UI 안내용).
//
// 반환 계약(팀 공식): { 과목과락:number(기본40), 평균합격:number(기본60), 출처:'info.md'|'기본값' }

const 기본과목과락 = 40;
const 기본평균합격 = 60;

// content: info.md 문자열
function parse(content) {
  const src = typeof content === 'string' ? content : '';
  const m = src.match(
    /<!--\s*grading\s*:\s*과목과락\s*:\s*(\d+)\s*\/\s*평균합격\s*:\s*(\d+)\s*-->/
  );
  if (m) {
    return {
      과목과락: Number(m[1]),
      평균합격: Number(m[2]),
      출처: 'info.md',
    };
  }
  return {
    과목과락: 기본과목과락,
    평균합격: 기본평균합격,
    출처: '기본값',
  };
}

module.exports = { parse, 기본과목과락, 기본평균합격 };
