'use strict';

// 테스트용 가짜 claude: 정답 추출 잡에서 "파일을 만들지 않고 사유만 출력"하는 시나리오.
// (예: 저작권 자료 거부·판독 불가) — 서버가 claude 사유를 응답/로그에 노출하는지 검증용.
// stream-json result 이벤트에 사유 텍스트를 담아 출력하고 파일은 쓰지 않는다.

const idx = process.argv.indexOf('-p');
const prompt = idx >= 0 ? process.argv[idx + 1] || '' : '';
const msg = /정답 md 파일 작성/.test(prompt)
  ? '저작권 안내가 포함된 자료로 판단되어 정답을 추출하지 않았습니다.'
  : '작업을 수행하지 않았습니다.';

process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: msg }) + '\n');
process.exit(0);
