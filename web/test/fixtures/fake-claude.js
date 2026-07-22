'use strict';

// 테스트용 가짜 claude: 프롬프트에서 출력 경로를 읽어 유효한 정답 md를 작성한다.
// claude --output-format stream-json --verbose 를 흉내내 마지막에 result 이벤트 1줄 출력.
// 호출 형태: node fake-claude.js [--flags...] -p "<prompt>" ...

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const idx = argv.indexOf('-p');
const prompt = idx >= 0 ? argv[idx + 1] || '' : '';

// 테스트 훅: QNET_ARGV_OUT 가 있으면 이번 호출의 argv 를 JSON 한 줄로 덤프한다
// (--model 등 플래그 전달을 검증하기 위함). 운영에는 영향 없음(env 미설정).
if (process.env.QNET_ARGV_OUT) {
  try {
    fs.appendFileSync(process.env.QNET_ARGV_OUT, JSON.stringify(argv) + '\n');
  } catch (_e) {
    /* noop */
  }
}

// 추출 잡: "출력 파일(반드시 이 경로에만 작성): <path>" 라인에서 경로 추출.
const m = prompt.match(/출력 파일\(반드시 이 경로에만 작성\):\s*(.+)/);

// 마이크로월드 생성 잡: 같은 출력 경로 라인 + "마이크로월드로 작성" 게이트 → 최소 HTML 작성.
if (m && /마이크로월드로 작성/.test(prompt)) {
  const htmlPath = m[1].trim();
  const html = [
    '<!doctype html>',
    '<html lang="ko"><head><meta charset="utf-8">',
    '<title>테스트 마이크로월드</title></head>',
    '<body><h1>테스트 개념 시뮬레이션</h1>',
    '<p>fake-claude 가 생성한 최소 자체 완결 HTML.</p>',
    '<script>document.title = document.title;</script>',
    '</body></html>',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf8');
}

// 문항 단위 추출 잡: 출력 디렉토리·문번 범위·정답표를 프롬프트에서 읽어 문항별 md 작성.
if (/문항별 md 파일 작성/.test(prompt)) {
  const dirM = prompt.match(/출력 디렉토리\(반드시 이 안에만 작성\):\s*(.+)/);
  const subjM = prompt.match(/대상 과목:\s*(.+?)\s*\(문번\s*(\d+)~(\d+)\)/);
  const examM = prompt.match(/시험 ID:\s*(.+)/);
  const dateM = prompt.match(/오늘 날짜:\s*(.+)/);
  if (dirM && subjM) {
    const outDir = dirM[1].trim();
    const 과목명 = subjM[1].trim();
    const 시작 = Number(subjM[2]);
    const 끝 = Number(subjM[3]);
    const examId = examM ? examM[1].trim() : '';
    const today = dateM ? dateM[1].trim() : '2026-01-01';
    // 정답표 파싱: | 문번 | ① | 행들.
    const 정답 = {};
    for (const row of prompt.matchAll(/\|\s*(\d+)\s*\|\s*([①②③④])\s*\|/g)) {
      정답[Number(row[1])] = row[2];
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (let q = 시작; q <= 끝; q += 1) {
      const md = [
        '---',
        `시험: ${examId}`,
        `문번: ${q}`,
        `과목: ${과목명}`,
        `정답: ${정답[q] || ''}`,
        '추출도구: claude',
        `추출일: ${today}`,
        '---',
        `${q}번 테스트 문제 본문입니다.`,
        '',
        '① 선택지 하나',
        '② 선택지 둘',
        '③ 선택지 셋',
        '④ 선택지 넷',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(outDir, `${q}.md`), md, 'utf8');
    }
  }
}

if (m && /정답 md 파일 작성/.test(prompt)) {
  const answerPath = m[1].trim();
  const md = [
    '---',
    '문항수: 2',
    '숨김페이지수: 1',
    '추출도구: claude',
    '추출일: 2026-07-21',
    '---',
    '',
    '## 테스트과목 (1-2)',
    '',
    '| 문번 | 정답 |',
    '|------|------|',
    '| 1 | ① |',
    '| 2 | ② |',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(answerPath), { recursive: true });
  fs.writeFileSync(answerPath, md, 'utf8');
}

// 정리 잡 등: 목적지가 프롬프트에 있으면 서명 섹션을 append(선택적).
process.stdout.write(
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n'
);
process.stdout.write(
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '작성 완료' }) + '\n'
);
process.exit(0);
