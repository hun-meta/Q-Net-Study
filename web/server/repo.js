'use strict';

// 저장소 스캔: {종류}/{자격증}/{닉네임} 계층을 읽어 자격증·참여자 목록을 만든다.
// 구조 확정(라운드 2): 종류 = 분야(예: 정보처리). 등급 화이트리스트를 폐지하고,
// 루트 하위 디렉토리 중 블록리스트를 제외한 전부를 종류(분야)로 스캔한다.
// scanRepo 반환의 `grade` 필드명은 하위호환을 위해 유지하되 의미는 "분야"다.

const fs = require('fs');
const path = require('path');

// 종류(분야)로 취급하지 않을 루트 디렉토리(앱·문서·의존성 등).
const ROOT_BLOCKLIST = Object.freeze(['web', 'docs', 'templates', 'node_modules']);

// 공용 디렉토리명(참여자 닉네임이 아님).
const COMMON_DIR = '_공통';

function nfc(s) {
  return String(s).normalize('NFC');
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_err) {
    return false;
  }
}

// 숨김/시스템 디렉토리 제외한 하위 디렉토리명(NFC).
function listSubDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => nfc(e.name));
}

// 루트 디렉토리가 종류(분야)로 유효한지: '.'/'_' 시작 금지 + 블록리스트 제외.
function isFieldDir(name) {
  const n = nfc(name);
  if (!n || n.startsWith('.') || n.startsWith('_')) return false;
  return !ROOT_BLOCKLIST.includes(n);
}

// 저장소 전체를 스캔해 자격증 목록을 반환.
// 반환: [{ grade(=분야), cert, relPath, participants: [닉네임...], hasCommon }]
function scanRepo(repoRoot) {
  const results = [];
  for (const field of listSubDirs(repoRoot).filter(isFieldDir)) {
    const fieldDir = path.join(repoRoot, field);
    for (const cert of listSubDirs(fieldDir)) {
      const certDir = path.join(fieldDir, cert);
      const children = listSubDirs(certDir);
      // 참여자 = 자격증 하위 디렉토리 중 _공통 및 '_' 시작 제외.
      const participants = children.filter(
        (name) => name !== COMMON_DIR && !name.startsWith('_')
      );
      results.push({
        grade: field, // 하위호환: 필드명 유지(의미=분야)
        cert,
        relPath: path.join(field, cert),
        participants,
        hasCommon: children.includes(COMMON_DIR),
      });
    }
  }
  return results;
}

// 디렉토리 스캔으로 발견되는 모든 참여자 닉네임의 합집합(중복 제거, 정렬).
function scanParticipants(repoRoot) {
  const set = new Set();
  for (const cert of scanRepo(repoRoot)) {
    for (const nick of cert.participants) set.add(nick);
  }
  return [...set].sort();
}

// 특정 자격증 컨텍스트에서 닉네임의 개인 디렉토리 절대 경로.
function participantDir(repoRoot, grade, cert, nickname) {
  return path.join(repoRoot, nfc(grade), nfc(cert), nfc(nickname));
}

// 특정 자격증의 _공통 디렉토리 절대 경로.
function commonDir(repoRoot, grade, cert) {
  return path.join(repoRoot, nfc(grade), nfc(cert), COMMON_DIR);
}

module.exports = {
  ROOT_BLOCKLIST,
  COMMON_DIR,
  nfc,
  isDir,
  isFieldDir,
  scanRepo,
  scanParticipants,
  participantDir,
  commonDir,
};
