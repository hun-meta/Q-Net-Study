'use strict';

// 테스트용 가짜 claude(느림): 1.2초 뒤 정답 md를 쓴다.
// 동시 업로드 레이스 재현용 — 잡 A 가 실행 중인 시간창을 만들어,
// 그 사이 서버가 다른 파일을 쓰면 감사가 오인하는지(레이스 수정 전) 검증한다.

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const idx = argv.indexOf('-p');
const prompt = idx >= 0 ? argv[idx + 1] || '' : '';

setTimeout(() => {
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
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n');
  process.stdout.write(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '작성 완료' }) + '\n'
  );
  process.exit(0);
}, 1200);
