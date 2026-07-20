'use strict';

// 사후 감사 모듈 (계획 v5 "보안 모델" 절 + 보안 검토 round-1 반영).
//
// claude/agy 잡은 --dangerously-skip-permissions 로 실행되므로 파일 쓰기 경계를
// 사전에 강제할 수 없다. 이 모듈은 잡 종료 후 파일 무결성을 탐지·복원한다
// — 봉쇄가 아닌 "파일 무결성 탐지·복원 통제"이며, 데이터 유출·명령 실행 자체는
// 사후에 막지 못한다(사용자 수용 리스크).
//
// 핵심 규칙:
// - 감시 스코프(monitorRoots)는 쓰기 권한과 동일한 넓이여야 한다.
//   record/extract 는 --add-dir repoRoot 로 전 저장소 쓰기가 가능하므로 monitorRoots=[repoRoot]
//   전역 감시가 필요하다(F1). 승인 목적지(destinations) 밖 변경은 경계 위반이다.
// - pre-job 스냅샷으로 복원 — git checkout 단독 사용 금지(미커밋 사용자 편집 파괴 회피).
//   대용량 파일(PDF 등)은 메모리 절약을 위해 지문(sha/size/mtime)만 보관하고,
//   복원이 필요하면 추적 파일은 git 폴백, 미추적 신규는 삭제로 처리한다(F5).
// - 미추적 신규 파일 삭제는 "승인된 목적지 밖" 파일에만 적용.
// - 경계 위반(목적지 밖 변경) 또는 챗 잡 변경 시 = 잡 전체 원자 원복.
// - 공유 해설 섹션 불변식: 기존 타인 서명 섹션 바이트 동일 + 현재 사용자 섹션만 추가/갱신(F4).
// - config.json / .git/hooks / .git/config / .git/info/exclude 는 walk 제외 → 해시 별도 감시
//   (감시 대상 목록은 라우트의 무결성대상()에서 구성 — F2).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// walk에서 항상 제외하는 디렉토리(재생성 가능 상태·VCS 내부·의존성).
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.qnet-web']);

// 이 크기 이하 파일만 복원용 Buffer를 보관한다(그 이상은 지문만 — F5).
const MAX_RESTORE_BYTES = 1024 * 1024; // 1MB — md 노트·정답은 수 KB, PDF는 초과.

function nfc(s) {
  return String(s).normalize('NFC');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// child 가 parent 내부(또는 동일)인지 — realpath 미사용(삭제된 경로도 판정 가능).
function isWithin(child, parent) {
  const rel = path.relative(nfc(parent), nfc(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// 디렉토리를 재귀 walk하여 파일 절대경로 목록 반환(제외 디렉토리 스킵).
function walkFiles(root, acc) {
  const out = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_err) {
    return out; // 존재하지 않는 루트 → 빈 결과
  }
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// 파일 지문. size ≤ maxBytes 면 콘텐츠 해시 + 복원용 Buffer 동봉, 초과면 size:mtime 지문만.
function fingerprint(p, maxBytes) {
  const st = fs.statSync(p);
  if (st.size <= maxBytes) {
    const buf = fs.readFileSync(p);
    return { hash: sha256(buf), size: st.size, mtimeMs: st.mtimeMs, buf };
  }
  return { hash: `big:${st.size}:${st.mtimeMs}`, size: st.size, mtimeMs: st.mtimeMs, buf: null };
}

// monitorRoots 하위 파일 지문 맵을 만든다. 반환: Map<absPath, fingerprint>
function fingerprintRoots(monitorRoots, maxBytes) {
  const map = new Map();
  for (const root of monitorRoots) {
    for (const f of walkFiles(root)) {
      try {
        map.set(nfc(f), fingerprint(f, maxBytes));
      } catch (_e) {
        /* 읽기 실패 스킵 */
      }
    }
  }
  return map;
}

// 무결성 대상(파일/디렉토리) 콘텐츠 맵(항상 전체 Buffer — 대상이 작고 복원이 필수).
function readTargetFiles(target) {
  const map = new Map();
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (_err) {
    return map;
  }
  const files = stat.isDirectory() ? walkFiles(target) : [target];
  for (const f of files) {
    try {
      map.set(nfc(f), fs.readFileSync(f));
    } catch (_err) {
      /* 스킵 */
    }
  }
  return map;
}

// pre-job 스냅샷. opts: { monitorRoots, integrityTargets, repoRoot?, maxRestoreBytes? }
function snapshot(opts) {
  const monitorRoots = (opts.monitorRoots || []).map(nfc);
  const integrityTargets = opts.integrityTargets || [];
  const maxRestoreBytes = opts.maxRestoreBytes || MAX_RESTORE_BYTES;

  const files = fingerprintRoots(monitorRoots, maxRestoreBytes);

  const integrity = new Map();
  for (const t of integrityTargets) {
    integrity.set(t.label, { path: nfc(t.path), files: readTargetFiles(t.path) });
  }

  return {
    monitorRoots,
    integrityTargets,
    files,
    integrity,
    repoRoot: opts.repoRoot || null,
    maxRestoreBytes,
  };
}

// 공유 해설 md를 서명 섹션(`## {닉네임} (YYYY-MM-DD)`) 단위로 분해(F4).
// 소유자 = 날짜 괄호 앞 전체 텍스트(공백 닉네임 보존). 서명 아닌 `##`는 헤더 전체를 소유자로.
// 동일 소유자 다중 섹션은 배열로 보존(바이트 보존 검사·Map 충돌 방지).
// 반환: { preamble: string, sections: Map<owner, string[]> }
function splitSections(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const preamble = [];
  const order = [];
  let owner = null;
  let buf = [];
  const flush = () => {
    if (owner !== null) order.push({ owner, block: buf.join('\n') });
  };
  for (const line of lines) {
    const sig = line.match(/^##\s+(.+?)\s*\(\s*\d{4}-\d{2}-\d{2}\s*\)\s*$/);
    const gen = sig ? null : line.match(/^##\s+(.+?)\s*$/);
    if (sig || gen) {
      flush();
      owner = (sig ? sig[1] : gen[1]).trim();
      buf = [line];
    } else if (owner !== null) {
      buf.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();
  const sections = new Map();
  for (const { owner: o, block } of order) {
    if (!sections.has(o)) sections.set(o, []);
    sections.get(o).push(block);
  }
  return { preamble: preamble.join('\n'), sections };
}

// 공유 해설 섹션 불변식(F4: 동일 소유자 다중 섹션 배열 비교).
// beforeBuf 가 null 이면 최초 생성으로 간주.
function sharedExplanationOk(beforeBuf, afterBuf, nickname) {
  const before = beforeBuf == null ? null : beforeBuf.toString('utf8');
  const after = afterBuf == null ? '' : afterBuf.toString('utf8');
  const a = splitSections(after);
  const b = before == null ? { preamble: '', sections: new Map() } : splitSections(before);
  const eqArr = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

  // 1) 기존 타인 섹션 바이트 동일 보존(개수·내용 모두).
  for (const [own, blocks] of b.sections) {
    if (own === nickname) continue;
    const ab = a.sections.get(own);
    if (!ab || !eqArr(blocks, ab)) return false;
  }
  // 2) 새 타인 섹션 유입 금지.
  for (const own of a.sections.keys()) {
    if (own === nickname) continue;
    if (!b.sections.has(own)) return false;
  }
  // 3) 기존 파일이면 preamble 불변.
  if (before != null && a.preamble !== b.preamble) return false;
  return true;
}

// git 폴백 복원(추적 파일 한정). 성공 시 true.
function gitRestore(repoRoot, p) {
  if (!repoRoot) return false;
  try {
    execFileSync('git', ['-C', repoRoot, 'checkout', 'HEAD', '--', p], { stdio: 'ignore' });
    return true;
  } catch (_e) {
    return false;
  }
}

function writeBuf(p, buf) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

function removeFile(p) {
  try {
    fs.unlinkSync(p);
  } catch (_err) {
    /* 이미 없음 */
  }
}

// 스냅샷 대비 현재 상태 차이. destinations 내부 여부로 경계 위반 분류.
function diffState(snap, destinations) {
  const dests = (destinations || []).map(nfc);
  const inDest = (p) => dests.some((d) => isWithin(p, d));
  const current = fingerprintRoots(snap.monitorRoots, snap.maxRestoreBytes || MAX_RESTORE_BYTES);

  const modified = [];
  const created = [];
  const deleted = [];

  for (const [p, curFp] of current) {
    const prev = snap.files.get(p);
    if (prev == null) {
      created.push({ path: p, after: curFp.buf, inDest: inDest(p) });
    } else if (prev.hash !== curFp.hash) {
      modified.push({ path: p, before: prev.buf, after: curFp.buf, inDest: inDest(p) });
    }
  }
  for (const [p, prev] of snap.files) {
    if (!current.has(p)) deleted.push({ path: p, before: prev.buf, inDest: inDest(p) });
  }
  return { modified, created, deleted };
}

// 잡이 만든 변경 하나를 pre-job 상태로 되돌린다(복원 실패 시 unrestorable 누적).
function revertOne(change, kind, repoRoot, restored, unrestorable) {
  if (kind === 'created') {
    removeFile(change.path);
    restored.push(change.path);
    return;
  }
  // modified/deleted → 콘텐츠 복원 필요.
  if (change.before != null) {
    writeBuf(change.path, change.before);
    restored.push(change.path);
  } else if (gitRestore(repoRoot, change.path)) {
    restored.push(change.path);
  } else {
    unrestorable.push(change.path); // 대용량·미추적 → 자동 복원 불가(수동 필요)
  }
}

// 무결성 대상(config/.git*) 변경 감지·복원. 반환: 변경된 label 배열.
function auditIntegrity(snap) {
  const changed = [];
  for (const [label, before] of snap.integrity) {
    const after = readTargetFiles(before.path);
    let diff = false;
    for (const [p, buf] of after) {
      const prev = before.files.get(p);
      if (prev == null) {
        diff = true;
        removeFile(p); // 신규 침투 파일(훅/설정 심기) 제거
      } else if (!prev.equals(buf)) {
        diff = true;
        writeBuf(p, prev); // 변조 복원
      }
    }
    for (const [p, buf] of before.files) {
      if (!after.has(p)) {
        diff = true;
        writeBuf(p, buf); // 삭제된 무결성 파일 복원
      }
    }
    if (diff) changed.push(label);
  }
  return changed;
}

// 잡 종료 후 감사·복원.
// opts: { destinations, jobKind, nickname, sharedRoots, repoRoot }
// 반환: { clean, jobReverted, violations:[], warnings:[], restored:[], unrestorable:[] }
function audit(snap, opts) {
  const o = opts || {};
  const destinations = (o.destinations || []).map(nfc);
  const sharedRoots = (o.sharedRoots || []).map(nfc);
  const nickname = o.nickname || null;
  const jobKind = o.jobKind || 'record';
  const repoRoot = o.repoRoot || snap.repoRoot || null;

  const violations = [];
  const warnings = [];
  const restored = [];
  const unrestorable = [];

  const { modified, created, deleted } = diffState(snap, destinations);

  const boundaryHits = [
    ...modified.filter((c) => !c.inDest).map((c) => ({ c, k: 'modified' })),
    ...created.filter((c) => !c.inDest).map((c) => ({ c, k: 'created' })),
    ...deleted.filter((c) => !c.inDest).map((c) => ({ c, k: 'deleted' })),
  ];
  const chatDirty = jobKind === 'chat' && modified.length + created.length + deleted.length > 0;
  const revertWholeJob = boundaryHits.length > 0 || chatDirty;

  if (revertWholeJob) {
    // 잡 전체 원자 원복(목적지 안팎 모두 pre-job 상태로).
    for (const c of modified) revertOne(c, 'modified', repoRoot, restored, unrestorable);
    for (const c of created) revertOne(c, 'created', repoRoot, restored, unrestorable);
    for (const c of deleted) revertOne(c, 'deleted', repoRoot, restored, unrestorable);
    for (const { c } of boundaryHits) {
      violations.push(`경계 위반: 승인 목적지 밖 변경 — ${c.path}`);
    }
    if (chatDirty) violations.push('챗(agy) 잡이 파일을 변경했습니다(표시만 원칙 위반) — 전체 원복.');
  } else {
    // 목적지 내부 변경만 존재 → 공유 해설 섹션 불변식 + 개인 노트 정보성 경고(F6).
    const sharedIn = (p) => sharedRoots.some((r) => isWithin(p, r)) && p.endsWith('.md');
    for (const c of [...modified, ...created]) {
      if (sharedIn(c.path)) {
        const before = c.before == null ? null : c.before;
        if (!sharedExplanationOk(before, c.after, nickname)) {
          if (c.before == null) removeFile(c.path);
          else writeBuf(c.path, c.before);
          restored.push(c.path);
          violations.push(`공유 해설 섹션 불변식 위반 — ${c.path} (타인 섹션 변경/유입)`);
        }
      } else if (c.before != null) {
        // F6: 목적지 내 기존 개인 노트 수정 — 지시하지 않은 섹션이 바뀌었을 수 있음(원복 아닌 경고).
        warnings.push(`개인 노트 수정됨(지시 외 섹션 변경 여부 확인 권장) — ${c.path}`);
      }
    }
  }

  const integrityChanged = auditIntegrity(snap);
  for (const label of integrityChanged) {
    violations.push(`무결성 대상 변경 감지·복원 — ${label}`);
  }
  for (const p of unrestorable) {
    violations.push(`자동 복원 불가(대용량/미추적) — 수동 확인 필요: ${p}`);
  }

  return {
    clean: violations.length === 0,
    jobReverted: revertWholeJob,
    violations,
    warnings,
    restored,
    unrestorable,
  };
}

module.exports = {
  snapshot,
  audit,
  diffState,
  splitSections,
  sharedExplanationOk,
  isWithin,
  walkFiles,
  fingerprint,
  EXCLUDED_DIRS,
  MAX_RESTORE_BYTES,
};
