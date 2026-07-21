---
description: 로컬 main을 origin/main과 동기화한다 — 미커밋 변경 자동 커밋 → fetch → (분기 시)리베이스로 충돌 조정 → push. 이 저장소는 main 브랜치 전용.
argument-hint: (인자 없음)
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git fetch:*), Bash(git rebase:*), Bash(git merge:*), Bash(git push:*), Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git merge-base:*), Bash(git branch:*), Bash(git remote:*), Bash(git checkout:*), Bash(git restore:*), Bash(npm test:*), Read, Edit, Write, Grep, Glob
---

# /sync-origin — origin/main 동기화 (main 전용)

이 저장소는 **main 브랜치만** 사용한다. 이 명령은 로컬 main을 origin/main과 안전하게 동기화하고 push한다.

**철칙**
- `--force` / `--force-with-lease` push를 **절대** 쓰지 않는다.
- 자동 해결이 불확실하거나 위험한 충돌은 **강행하지 말고 멈춰서 보고**한다(어느 한쪽을 임의로 버리지 않는다).
- 이 명령 밖에서는 여전히 사용자 지시 없이 커밋/푸시하지 않는다. 이 명령은 사용자가 직접 실행할 때만 커밋·push하는 예외다.

## 절차

### 0. 사전 점검
- `git rev-parse --abbrev-ref HEAD`로 현재 브랜치 확인.
  - `main`이면 계속.
  - `main`이 아니고 워킹트리가 깨끗하면 `git checkout main`.
  - `main`이 아닌데 미커밋 변경이 있으면 **멈추고 보고**한다(이 저장소는 main 전용이라 예외 상황 — 사용자 판단 필요).
- `git remote get-url origin` 확인. origin이 없으면 멈추고 보고.

### 1. 미커밋 변경 자동 커밋
- `git status --porcelain`로 변경(스테이지·비스테이지·미추적) 확인.
- 변경이 **있으면**:
  1. `git add -A`
  2. `git diff --cached --stat`와 파일 목록을 보고 **무엇이 바뀌었는지 한국어 한 줄 요약**을 만든다.
  3. 저장소 커밋 규칙대로 메시지를 쓴다: 기본 `[공통] {요약}`. 변경이 특정 자격증/닉네임에 한정되면 `[{자격증}/{닉네임}] {요약}`.
  4. 메시지 끝에 반드시 다음 줄을 넣는다:
     `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  5. `git commit -F <메시지파일>`(멀티라인 안전).
- 변경이 **없으면** 이 단계 건너뜀.

### 2. 원격 조회 + 관계 판정
- `git fetch origin main`
- `git rev-list --left-right --count main...origin/main` → `"<ahead>\t<behind>"` (ahead=로컬만의 커밋 수, behind=원격만의 커밋 수).
  - **ahead=0, behind=0** → 이미 동기화됨. push·리베이스 없이 5단계(보고)로.
  - **ahead>0, behind=0** → 로컬이 앞섬(원격 변경 없음). 3단계 건너뛰고 4단계(push)로.
  - **ahead=0, behind>0** → 원격이 앞섬(로컬 변경 없음). `git merge --ff-only origin/main`으로 fast-forward. push할 것 없음 → 5단계.
  - **ahead>0, behind>0** → 분기. 3단계(리베이스)로.

### 3. 통합 — 분기 시 리베이스
목적: 로컬 커밋을 origin/main 위로 재배치해 **선형 이력**을 만들고, 이후 push가 원격에서 fast-forward가 되게 한다("ff로 push 가능한 상태").

- `git rebase origin/main`
- **충돌이 나면** 각 충돌 파일을 열어 **양쪽 의도를 이해하고 올바르게 병합**한다. 어느 한쪽을 무조건 채택하지 않는다. 이 저장소의 충돌은 대개 **가산적(append)**이다:
  - `{닉네임}/attempts/INDEX.md`·`WRONG.md`: 양쪽 행을 모두 보존하고 규칙대로 정렬·중복 정리(우선순위/추이 유지).
  - `_공통/풀이/**/*.md`: `## {닉네임} ({날짜})` 서명 섹션은 **양쪽 모두 보존**(append-only, 타인 섹션 바이트 불가침).
  - `_공통/기출문제/INDEX.md`: 양쪽 등록 행을 병합(연도 내림차순 유지, 중복 파일명 정리).
  - 개념 노트(`notes/**`): 양쪽 보강 내용을 합친다(내용 삭제 금지).
  - `_공통/마이크로월드/**`·코드 파일: 양쪽 변경 의도를 파악해 통합. 판단이 애매하거나 로직 충돌이면 **멈추고 보고**.
  - 해결한 파일마다 `git add <파일>` → 모두 해결되면 `git rebase --continue`(리베이스가 여는 커밋 메시지는 그대로 둔다).
- 자동 해결이 곤란하거나 위험하면 `git rebase --abort` 후 멈추고, 충돌 파일·양쪽 요지를 사용자에게 보고한다.
- 리베이스 결과가 `web/` 코드에 닿았으면 `web`에서 `npm test`로 회귀를 확인한다(실패 시 push 전에 멈추고 보고).

### 4. push
- `git push origin main`
- **거부되면**(그 사이 원격이 갱신됨) 2단계부터 다시(fetch → 판정 → 필요 시 리베이스 → push). 최대 **3회** 재시도. 계속 실패하면 멈추고 보고.
- `--force` 계열 금지.

### 5. 보고
한 줄로 결과를 요약한다: 자동 커밋 여부·해시(있으면), 가져온 원격 커밋 수, 해결한 충돌 파일 목록(있으면), push 결과(또는 "이미 최신이라 변경 없음").
