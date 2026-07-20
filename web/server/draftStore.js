'use strict';

// 임시저장(드래프트) 저장소 — 서버 소유 쓰기(계획 v5 Principle 2).
// 위치: .qnet-web/drafts/{닉네임}/{시험}.json (재생성 가능, gitignore 대상).
// 이어풀기: 저장된 드래프트를 그대로 돌려준다. tmp→rename 원자 커밋.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DRAFTS_DIR = path.join(config.STATE_DIR, 'drafts');

// 시험 id / 닉네임 자체 방어(경로 탈출 차단). 호출부(examList)도 선검증하지만 이중 방어.
const EXAM_ID = /^\d{4}-[0-9A-Za-z가-힣]+-(필기|실기)$/;
const NICK_INVALID = /[\\/\0\r\n\t]/;

function nfc(s) {
  return String(s == null ? '' : s).normalize('NFC');
}

function assertSafe(nickname, examId) {
  const nick = nfc(nickname).trim();
  const id = nfc(examId);
  if (!nick || NICK_INVALID.test(nick) || nick.startsWith('.')) {
    throw new Error('잘못된 닉네임입니다.');
  }
  if (!EXAM_ID.test(id)) {
    throw new Error('잘못된 시험 id 형식입니다.');
  }
  return { nick, id };
}

// baseDir는 테스트에서 격리용으로만 재정의한다(운영 기본 = DRAFTS_DIR).
function draftPath(nickname, examId, baseDir = DRAFTS_DIR) {
  const { nick, id } = assertSafe(nickname, examId);
  return path.join(baseDir, nick, `${id}.json`);
}

// 저장된 드래프트 반환(없거나 손상 시 null).
function readDraft(nickname, examId, baseDir = DRAFTS_DIR) {
  const p = draftPath(nickname, examId, baseDir);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

// 드래프트를 원자적으로 저장. data는 객체(클라이언트 소유 형태). updatedAt 스탬프 추가.
function writeDraft(nickname, examId, data, baseDir = DRAFTS_DIR) {
  const { nick, id } = assertSafe(nickname, examId);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('드래프트 본문은 객체여야 합니다.');
  }
  const dir = path.join(baseDir, nick);
  fs.mkdirSync(dir, { recursive: true });
  const saved = { ...data, examId: id, updatedAt: new Date().toISOString() };
  const target = path.join(dir, `${id}.json`);
  const tmp = path.join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(saved, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);
  return saved;
}

// 제출 완료 등으로 드래프트 삭제(없으면 무시).
function deleteDraft(nickname, examId, baseDir = DRAFTS_DIR) {
  const p = draftPath(nickname, examId, baseDir);
  try {
    fs.unlinkSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = { DRAFTS_DIR, draftPath, readDraft, writeDraft, deleteDraft };
