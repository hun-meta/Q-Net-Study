'use strict';

// 기출 INDEX.md 파서·갱신 (순수 모듈 — express·외부 의존 없음)
//
// 대상: _공통/기출문제/INDEX.md
// 9칼럼(팀 확정): 파일명 | 연도 | 회차 | 구분 | 문항수 | 정답포함 | 숨김페이지수 | 등록자 | 비고
// 기존 exam-pdf 스킬의 8칼럼(숨김페이지수 없음) 하위호환 — 부재 시 숨김페이지수 기본 1.
//
// 행 객체 계약(팀 공식):
// { 파일명, 연도:number, 식별자:string(회차/상시일자), 구분, 문항수:number,
//   정답포함:boolean, 숨김페이지수:number(기본1), 등록자, 비고 }

const 칼럼순서 = [
  '파일명',
  '연도',
  '회차',
  '구분',
  '문항수',
  '정답포함',
  '숨김페이지수',
  '등록자',
  '비고',
];

// 헤더 이름 → 표준 필드명(회차 칼럼은 식별자 필드로 매핑)
const 헤더별칭 = {
  파일명: '파일명',
  연도: '연도',
  회차: '식별자',
  식별자: '식별자',
  구분: '구분',
  문항수: '문항수',
  정답포함: '정답포함',
  숨김페이지수: '숨김페이지수',
  등록자: '등록자',
  비고: '비고',
};

function 파이프행분해(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

function 구분선인가(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c) || c === '');
}

// 파일명 셀에서 마크다운 링크 텍스트 추출: [2023-1-필기.pdf](...) → 2023-1-필기.pdf
function 파일명추출(cell) {
  const m = cell.match(/^\[([^\]]+)\]\([^)]*\)\s*$/);
  return m ? m[1].trim() : cell.trim();
}

function 정답포함파싱(cell) {
  const s = (cell || '').trim();
  return /^(O|o|포함|Y|y|true|참)$/.test(s);
}

// content: INDEX.md 문자열 (없거나 표가 없으면 빈 배열)
// 반환: 행 객체 배열
function parse(content) {
  const src = typeof content === 'string' ? content : '';
  const lines = src.split(/\r?\n/);

  // 표 블록 탐지: 헤더행 → 구분행 → 데이터행
  let 헤더칼럼 = null;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) {
      // 표가 끝나면 헤더 리셋 (여러 표 방지)
      if (헤더칼럼 && line.trim() === '') 헤더칼럼 = null;
      continue;
    }
    const cells = 파이프행분해(line);
    if (!헤더칼럼) {
      // 헤더 후보인지: 다음 줄이 구분선이어야 함
      const next = lines[i + 1];
      if (next && /^\s*\|/.test(next) && 구분선인가(파이프행분해(next))) {
        헤더칼럼 = cells.map((c) => 헤더별칭[c] || c);
        i++; // 구분선 스킵
      }
      continue;
    }
    if (구분선인가(cells)) continue;
    rows.push(행객체화(cells, 헤더칼럼));
  }
  return rows;
}

function 행객체화(cells, 헤더칼럼) {
  const raw = {};
  헤더칼럼.forEach((key, idx) => {
    raw[key] = cells[idx] != null ? cells[idx] : '';
  });
  const 숨김원문 = raw.숨김페이지수;
  return {
    파일명: 파일명추출(raw.파일명 || ''),
    연도: /^\d+$/.test(raw.연도 || '') ? Number(raw.연도) : raw.연도 || '',
    식별자: raw.식별자 || '',
    구분: raw.구분 || '',
    문항수: /^\d+$/.test(raw.문항수 || '') ? Number(raw.문항수) : raw.문항수 || '',
    정답포함: 정답포함파싱(raw.정답포함),
    // 하위호환: 칼럼 부재/빈칸이면 기본 1
    숨김페이지수: 숨김원문 != null && /^\d+$/.test(숨김원문) ? Number(숨김원문) : 1,
    등록자: raw.등록자 || '',
    비고: raw.비고 || '',
  };
}

function 시험ID(row) {
  return `${row.연도}-${row.식별자}-${row.구분}`;
}

// 행 배열 → INDEX.md 표 문자열(연도 내림차순, 동률 시 식별자·구분 오름차순)
function format(rows) {
  const 정렬 = [...rows].sort((a, b) => {
    if (Number(b.연도) !== Number(a.연도)) return Number(b.연도) - Number(a.연도);
    if (String(a.식별자) !== String(b.식별자)) return String(a.식별자) < String(b.식별자) ? -1 : 1;
    return String(a.구분) < String(b.구분) ? -1 : String(a.구분) > String(b.구분) ? 1 : 0;
  });
  const 헤더 = `| ${칼럼순서.join(' | ')} |`;
  const 구분 = `| ${칼럼순서.map(() => '---').join(' | ')} |`;
  const 본문 = 정렬.map((r) => {
    const 파일셀 = r.파일명 ? `[${r.파일명}](${r.파일명})` : '';
    return `| ${[
      파일셀,
      r.연도,
      r.식별자,
      r.구분,
      r.문항수,
      r.정답포함 ? 'O' : 'X',
      r.숨김페이지수 != null ? r.숨김페이지수 : 1,
      r.등록자 || '',
      r.비고 || '',
    ].join(' | ')} |`;
  });
  return [헤더, 구분, ...본문].join('\n');
}

// content에 row를 추가/갱신(시험ID 기준)한 새 INDEX.md 문자열 반환.
// 기존 표 블록이 있으면 그 자리만 교체하고 주변 텍스트(제목·설명)는 보존.
function upsert(content, row) {
  const src = typeof content === 'string' ? content : '';
  const rows = parse(src);
  const 신규 = 행객체화정규화(row);
  const idx = rows.findIndex((r) => 시험ID(r) === 시험ID(신규));
  if (idx >= 0) rows[idx] = 신규;
  else rows.push(신규);

  const 표MD = format(rows);
  const 위치 = 표블록위치(src);
  if (위치) {
    const lines = src.split(/\r?\n/);
    const before = lines.slice(0, 위치.start);
    const after = lines.slice(위치.end + 1);
    return [...before, ...표MD.split('\n'), ...after].join('\n');
  }
  if (src.trim() === '') {
    return `# 기출문제 인덱스\n\n${표MD}\n`;
  }
  return `${src.replace(/\s*$/, '')}\n\n${표MD}\n`;
}

// upsert 입력 row를 표준 필드로 정규화(회차/식별자 혼용 허용)
function 행객체화정규화(row) {
  const r = row || {};
  const 식별 = r.식별자 != null ? r.식별자 : r.회차 != null ? r.회차 : '';
  return {
    파일명: r.파일명 || '',
    연도: /^\d+$/.test(String(r.연도)) ? Number(r.연도) : r.연도,
    식별자: String(식별),
    구분: r.구분 || '',
    문항수: /^\d+$/.test(String(r.문항수)) ? Number(r.문항수) : r.문항수,
    정답포함: !!r.정답포함,
    숨김페이지수:
      r.숨김페이지수 != null && /^\d+$/.test(String(r.숨김페이지수))
        ? Number(r.숨김페이지수)
        : 1,
    등록자: r.등록자 || '',
    비고: r.비고 || '',
  };
}

// 연속된 파이프 표 블록의 시작/끝 라인 인덱스 반환(첫 표만)
function 표블록위치(src) {
  const lines = src.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const isPipe = /^\s*\|/.test(lines[i]);
    if (isPipe && start < 0) {
      const next = lines[i + 1];
      if (next && /^\s*\|/.test(next) && 구분선인가(파이프행분해(next))) start = i;
    } else if (!isPipe && start >= 0) {
      return { start, end: i - 1 };
    }
  }
  if (start >= 0) return { start, end: lines.length - 1 };
  return null;
}

module.exports = { parse, format, upsert, 시험ID };
