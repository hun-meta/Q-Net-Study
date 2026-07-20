'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tagIndex = require('../server/tagIndex');

test('parseTagsFromContent: 구분 있음/없음 매칭 + 섹션제목', () => {
  const md = [
    '# 01. 요구사항확인',
    '',
    '## 요구사항 분석',
    '### 기출 연계',
    '- 🔁 기출 2023-1-필기 #23: 정규화 개념',
    '- 🔁 기출 2023-1 #24: 무구분(→필기 매핑)',
    '',
    '## 정렬',
    '- 🔁 기출 2024-0415상시-실기 #5: CBT 실기',
  ].join('\n');
  const tags = tagIndex.parseTagsFromContent(md);
  assert.equal(tags.length, 3);
  assert.deepEqual(
    tags.map((t) => [t.시험ID, t.문번, t.섹션제목]),
    [
      ['2023-1-필기', 23, '요구사항 분석'],
      ['2023-1-필기', 24, '요구사항 분석'], // 무구분 → 필기
      ['2024-0415상시-실기', 5, '정렬'],
    ]
  );
});

test('normalize시험ID: 무구분은 필기', () => {
  assert.equal(tagIndex.normalize시험ID('2023', '1', undefined), '2023-1-필기');
  assert.equal(tagIndex.normalize시험ID('2023', '1', '실기'), '2023-1-실기');
});

// 임시 저장소에 노트 트리를 만든다.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-tag-'));
  const write = (rel, content) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return abs;
  };
  write(
    path.join('기사', '정보처리기사', 'hun', 'notes', '소프트웨어설계', '01-요구사항확인.md'),
    '## 요구사항 분석\n- 🔁 기출 2023-1-필기 #23: 개념A\n'
  );
  write(
    path.join('기사', '정보처리기사', 'sora', 'notes', '소프트웨어설계', '01-요구사항확인.md'),
    '## 유스케이스\n- 🔁 기출 2023-1 #23: 개념B(무구분)\n'
  );
  return { root, write };
}

test('scan + query: 내/타인 노트가 같은 문항에 매칭', () => {
  const { root } = makeRepo();
  try {
    const index = tagIndex.scan(root, {});
    const refs = tagIndex.query(index, '2023-1-필기', 23);
    assert.equal(refs.length, 2, '두 참여자 노트가 모두 매칭(무구분→필기 포함)');
    const 닉 = refs.map((r) => r.닉네임).sort();
    assert.deepEqual(닉, ['hun', 'sora']);
    assert.equal(refs.find((r) => r.닉네임 === 'hun').섹션제목, '요구사항 분석');
    assert.equal(refs.find((r) => r.닉네임 === 'hun').과목, '소프트웨어설계');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan: mtime 증분 — 미변경 파일은 캐시 재사용, 변경 파일만 재파싱', () => {
  const { root, write } = makeRepo();
  const cachePath = path.join(root, '.qnet-web', 'cache', 'tag-index.json');
  try {
    const first = tagIndex.scan(root, { cachePath });
    const hunRel = path.join('기사', '정보처리기사', 'hun', 'notes', '소프트웨어설계', '01-요구사항확인.md');
    const soraRel = path.join('기사', '정보처리기사', 'sora', 'notes', '소프트웨어설계', '01-요구사항확인.md');
    const hunMtime0 = first.files[hunRel].mtimeMs;

    // sora 파일만 갱신(태그 추가) — 미래 시각으로 mtime 강제.
    const soraAbs = path.join(root, soraRel);
    write(soraRel, '## 유스케이스\n- 🔁 기출 2023-1 #23: 개념B\n- 🔁 기출 2023-1-필기 #40: 추가\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(soraAbs, future, future);

    const second = tagIndex.scan(root, { cachePath, prev: first });
    // hun 파일은 mtime 동일 → 캐시 재사용(같은 tags 참조/값)
    assert.equal(second.files[hunRel].mtimeMs, hunMtime0);
    // sora 파일은 재파싱되어 새 태그(#40) 반영
    const q40 = tagIndex.query(second, '2023-1-필기', 40);
    assert.equal(q40.length, 1);
    assert.equal(q40[0].닉네임, 'sora');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('query: 없는 문항은 빈 배열', () => {
  const { root } = makeRepo();
  try {
    const index = tagIndex.scan(root, {});
    assert.deepEqual(tagIndex.query(index, '2099-9-필기', 1), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
