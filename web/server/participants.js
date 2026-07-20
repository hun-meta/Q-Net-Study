'use strict';

// 참여자 레지스트리: 루트 `참여자.md`(표: | 닉네임 | 등록일 |)를 파싱·upsert·remove.
// 목록 조회는 레지스트리 ∪ 디렉토리 스캔 참여자의 합집합이다(어느 경로로 만든 공간이든 노출).

const fs = require('fs');
const path = require('path');

const repo = require('./repo');

const FILE_NAME = '참여자.md';
const HEADER = '# 참여자\n\n| 닉네임 | 등록일 |\n|--------|--------|\n';

function filePath(repoRoot) {
  return path.join(repoRoot, FILE_NAME);
}

function nfc(s) {
  return String(s).normalize('NFC');
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// 표의 셀 배열을 추출(| a | b | → ['a','b']). 표 행이 아니면 null.
function parseRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
  return cells;
}

// 참여자.md를 파싱해 [{ nickname, registeredAt }] 반환(없으면 빈 배열).
function parseRegistry(repoRoot) {
  let raw;
  try {
    raw = fs.readFileSync(filePath(repoRoot), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const cells = parseRow(line);
    if (!cells || cells.length < 1) continue;
    const nickname = nfc(cells[0]);
    // 헤더/구분선 제외
    if (!nickname || nickname === '닉네임') continue;
    if (/^-+$/.test(nickname)) continue;
    rows.push({ nickname, registeredAt: cells[1] || '' });
  }
  return rows;
}

// 레지스트리에 등록된 닉네임 목록.
function registryNicknames(repoRoot) {
  return parseRegistry(repoRoot).map((r) => r.nickname);
}

// 표를 원자적으로(tmp→rename) 기록.
function writeRegistry(repoRoot, rows) {
  const body = rows
    .map((r) => `| ${r.nickname} | ${r.registeredAt || ''} |`)
    .join('\n');
  const content = HEADER + (body ? body + '\n' : '');
  const dir = repoRoot;
  const tmp = path.join(dir, `.${FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath(repoRoot));
}

// 닉네임 upsert: 있으면 등록일 유지, 없으면 추가(등록일=date 또는 오늘). 정렬 저장.
function upsert(repoRoot, nickname, date) {
  const nick = nfc(nickname);
  const rows = parseRegistry(repoRoot);
  const existing = rows.find((r) => r.nickname === nick);
  if (existing) {
    if (date) existing.registeredAt = date;
  } else {
    rows.push({ nickname: nick, registeredAt: date || today() });
  }
  rows.sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
  writeRegistry(repoRoot, rows);
  return rows;
}

// 닉네임 제거(있으면). 정렬 저장. 제거 여부 반환.
function remove(repoRoot, nickname) {
  const nick = nfc(nickname);
  const rows = parseRegistry(repoRoot);
  const next = rows.filter((r) => r.nickname !== nick);
  const removed = next.length !== rows.length;
  writeRegistry(repoRoot, next);
  return removed;
}

// 전체 참여자 목록 = 레지스트리 ∪ 디렉토리 스캔(중복 제거, 한글 정렬).
function listAll(repoRoot) {
  const set = new Set(registryNicknames(repoRoot));
  for (const nick of repo.scanParticipants(repoRoot)) set.add(nick);
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

module.exports = {
  FILE_NAME,
  filePath,
  parseRegistry,
  registryNicknames,
  upsert,
  remove,
  listAll,
  today,
};
