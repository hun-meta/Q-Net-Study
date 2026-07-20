'use strict';

// 테스트용 가짜 claude: 프롬프트에서 출력 경로를 읽어 유효한 정답 md를 작성한다.
// claude --output-format stream-json --verbose 를 흉내내 마지막에 result 이벤트 1줄 출력.
// 호출 형태: node fake-claude.js [--flags...] -p "<prompt>" ...

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const idx = argv.indexOf('-p');
const prompt = idx >= 0 ? argv[idx + 1] || '' : '';

// 추출 잡: "출력 파일(반드시 이 경로에만 작성): <path>" 라인에서 경로 추출.
const m = prompt.match(/출력 파일\(반드시 이 경로에만 작성\):\s*(.+)/);
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
