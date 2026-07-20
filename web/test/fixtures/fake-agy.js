'use strict';

// 테스트용 가짜 agy: 프롬프트를 받아 청크 여러 개를 stdout으로 흘려보낸다(표시만).
// 파일은 절대 쓰지 않는다(챗 무변화 감사 검증용).
// 호출 형태: node fake-agy.js [--flags...] -p "<prompt>"

const idx = process.argv.indexOf('-p');
const prompt = idx >= 0 ? process.argv[idx + 1] || '' : '';

process.stdout.write('답변: ');
process.stdout.write('이 문항의 ');
process.stdout.write('핵심은 ');
process.stdout.write(`"${prompt.slice(0, 10)}" 입니다.`);
process.stdout.write('\n');
process.exit(0);
