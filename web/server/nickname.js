'use strict';

// 닉네임 관리: 현재 사용자 닉네임을 config에서 읽고, 검증 후 저장한다.
// 닉네임은 개인 디렉토리명이므로 경로 분리자·공용명 등을 엄격히 금지한다.

const { loadConfig, saveConfig } = require('./config');

const COMMON_DIR = '_공통';
// 경로 탈출·구분자 차단: 슬래시/백슬래시/널/제어문자 금지, '.'로 시작 금지.
const INVALID = /[\\/\0\r\n\t]/;

function nfc(s) {
  return String(s).normalize('NFC');
}

// 닉네임 유효성 검사. 유효하지 않으면 사유 메시지와 함께 예외.
function validateNickname(raw) {
  const nickname = nfc(raw == null ? '' : raw).trim();
  if (!nickname) throw new Error('닉네임이 비어 있습니다.');
  if (nickname.length > 40) throw new Error('닉네임이 너무 깁니다(최대 40자).');
  if (INVALID.test(nickname)) throw new Error('닉네임에 경로 구분자나 제어문자를 쓸 수 없습니다.');
  if (nickname.startsWith('.')) throw new Error("닉네임은 '.'로 시작할 수 없습니다.");
  if (nickname === '.' || nickname === '..') throw new Error('사용할 수 없는 닉네임입니다.');
  if (nickname === COMMON_DIR) throw new Error(`'${COMMON_DIR}'은 공용 디렉토리명이라 닉네임으로 쓸 수 없습니다.`);
  return nickname;
}

// 현재 닉네임(없으면 null).
function getNickname() {
  const cfg = loadConfig();
  return cfg.nickname || null;
}

// 닉네임을 검증 후 config에 저장하고, 정규화된 값을 반환.
function setNickname(raw) {
  const nickname = validateNickname(raw);
  const cfg = loadConfig();
  saveConfig({ ...cfg, nickname });
  return nickname;
}

module.exports = {
  validateNickname,
  getNickname,
  setNickname,
};
