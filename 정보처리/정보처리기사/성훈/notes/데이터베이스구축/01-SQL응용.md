---
자격증: 정보처리기사
과목: 데이터베이스구축
주요항목: SQL응용
작성자: 성훈
갱신일: 2026-07-22
진행도: 정리중
---

# 01. SQL응용

> 출처: `_공통/출제기준/데이터베이스구축.md`의 주요항목 순번을 따른다.
> 세부항목: 절차형 SQL 작성(트리거 등) · 응용 SQL 작성(DML·DCL·그룹함수·오류처리)

## 절차형 SQL 작성

### 핵심 개념
- **절차형 SQL**: SQL의 절차적 확장으로, **트리거(Trigger)**, **사용자 정의 함수**, **이벤트** 등이 해당.
- **트리거**: 데이터의 삽입·갱신·삭제 등의 **이벤트가 발생할 때마다 관련 작업이 자동으로 수행**되는 절차형 SQL. `CREATE TRIGGER`로 생성.
- 데이터 변경 및 **무결성 유지**, 로그 메시지 출력 등이 목적. **RETURN 명령어가 필요 없다**(사용자 정의 함수와의 차이).

### 암기 포인트
- ⭐ 트리거 = **이벤트(INSERT/UPDATE/DELETE) → 자동 실행** / RETURN 없음 / CREATE TRIGGER.
- ⭐ 사용자 정의 함수는 RETURN 있음, 트리거는 RETURN 없음.

### 기출 연계
- 🔁 기출 2024-2회-필기 #57: 트리거 설명 — RETURN 명령어 필수 여부(필요 없음이 정답)
- 🔁 기출 2025-2회-필기 #43: 이벤트 발생 시 자동 수행되는 절차형 SQL 식별(트리거)

## 응용 SQL 작성 — DML

### 핵심 개념
- **DML(Data Manipulation Language)**: 데이터 조작어. `SELECT`, `INSERT`, `DELETE`, `UPDATE`.
- `SELECT`: `SELECT 컬럼 FROM 테이블 [WHERE 조건] [ORDER BY 컬럼 DESC|ASC]`.
- `IS NULL` / `IS NOT NULL`: 널 값 비교는 `=`, `<>`가 아닌 `IS` 사용.
- `DISTINCT`: 중복 제거. `BETWEEN A AND B`: 범위 조건(OR가 아닌 AND).
- `DELETE FROM 테이블 [WHERE 조건]`: WHERE 없으면 모든 행 삭제하지만 **테이블 자체는 유지**(DROP TABLE과 다름).

### 암기 포인트
- ⭐ DML = **SIDU**(Select, Insert, Delete, Update). GRANT·CREATE·ALTER는 아님.
- ⭐ NULL 비교는 반드시 **IS NULL / IS NOT NULL**.
- ⭐ DELETE(데이터만 삭제) ≠ DROP TABLE(테이블 자체 삭제).

### 기출 연계
- 🔁 기출 2023-1회-필기 #44: SELECT 결과 튜플 수(모든 행 반환)
- 🔁 기출 2023-1회-필기 #52: DELETE — WHERE 없을 때 DROP TABLE과의 차이
- 🔁 기출 2023-1회-필기 #58: IS NOT NULL 올바른 SQL 구문
- 🔁 기출 2023-2회-필기 #43: DML에 해당하는 명령 식별(SELECT·UPDATE·INSERT)
- 🔁 기출 2023-2회-필기 #48: IS NOT NULL 올바른 SQL 구문
- 🔁 기출 2023-2회-필기 #50: INSERT INTO ... SELECT 문장의 의미
- 🔁 기출 2023-2회-필기 #52: ORDER BY DESC를 포함한 SELECT 구문 선택
- 🔁 기출 2023-2회-필기 #57: SELECT ... WHERE PNO IN(1,2,3) 구문
- 🔁 기출 2023-3회-필기 #43: SELECT DISTINCT 결과 튜플 수
- 🔁 기출 2023-3회-필기 #55: IS NOT NULL 올바른 SQL 구문
- 🔁 기출 2024-1회-필기 #43: DML 명령 식별(SELECT·INSERT·DELETE·UPDATE)
- 🔁 기출 2024-1회-필기 #48: UPDATE SET 구문 빈칸
- 🔁 기출 2024-2회-필기 #44: DML에 해당하는 명령 식별
- 🔁 기출 2024-2회-필기 #51: UPDATE SET 구문 빈칸
- 🔁 기출 2024-2회-필기 #54: UPDATE SET WHERE AND 구문
- 🔁 기출 2024-3회-필기 #43: DML 명령 식별
- 🔁 기출 2025-1회-필기 #53: UPDATE SET 구문 빈칸
- 🔁 기출 2025-2회-필기 #44: SELECT DISTINCT 결과 튜플 수
- 🔁 기출 2025-2회-필기 #58: DELETE — WHERE 없을 때 DROP TABLE과의 차이

## 응용 SQL 작성 — DCL

### 핵심 개념
- **DCL(Data Control Language)**: 데이터 제어어. `GRANT`(권한 부여), `REVOKE`(권한 회수).
- DCL의 기능: **데이터 보안, 무결성 유지, 병행수행 제어**. (논리·물리적 데이터 구조 정의는 DDL의 기능)
- `GRANT 권한 ON 객체 TO 사용자;` / `REVOKE 권한 ON 객체 FROM 사용자;`.
- `COMMIT`·`ROLLBACK`도 트랜잭션 제어(TCL/DCL)에 해당.

### 암기 포인트
- ⭐ DCL = **GRANT(부여) / REVOKE(회수)**. GRANT...**ON**...**TO**, REVOKE...**ON**...**FROM**.
- ⭐ DCL 기능 = 보안·무결성·병행제어 (구조 정의는 아님).
- ⭐ `REVOKE`는 권한 회수지 열 이름 변경이 아님.

### 기출 연계
- 🔁 기출 2023-3회-필기 #48: GRANT UPDATE ON STUDENT TO PARK 빈칸
- 🔁 기출 2024-3회-필기 #47: GRANT UPDATE ON STUDENT TO PARK 빈칸
- 🔁 기출 2024-3회-필기 #58: REVOKE 키워드의 올바른 기능(권한 회수)
- 🔁 기출 2025-1회-필기 #41: DCL 기능이 아닌 것(논리·물리적 구조 정의)
- 🔁 기출 2025-1회-필기 #48: REVOKE SELECT ON department FROM X1 구문
- 🔁 기출 2025-2회-필기 #60: SQL 분류에서 GRANT의 성격(DCL, 나머지는 DML)
- 🔁 기출 2025-3회-필기 #46: DCL 명령어가 아닌 것(SELECT)

## 응용 SQL 작성 — 그룹 함수

### 핵심 개념
- **그룹 함수**: `COUNT`, `SUM`, `AVG`, `MAX`, `MIN` 등. `GROUP BY`로 그룹화.
- `HAVING`: 그룹에 대한 조건. **GROUP BY 절과 함께 사용**.

### 암기 포인트
- ⭐ HAVING은 **GROUP BY 절**에서 사용. WHERE는 그룹화 전 개별 행 조건.

### 기출 연계
- 🔁 기출 2025-1회-필기 #57: HAVING을 사용할 수 있는 절(GROUP BY)

## 응용 SQL 작성 — 오류 처리(SQL 문법)

### 핵심 개념
- SQL 논리 연산자: `AND`, `OR`, `NOT`. (OTHER는 아님)
- `BETWEEN A AND B`: A 이상 B 이하. `BETWEEN ... OR`는 문법 오류.

### 암기 포인트
- ⭐ 논리 연산자 = **AND / OR / NOT**. OTHER는 존재하지 않음.
- ⭐ BETWEEN은 **AND**로 연결, OR가 아님.

### 기출 연계
- 🔁 기출 2025-1회-필기 #55: SQL 논리 연산자가 아닌 것(OTHER)
- 🔁 기출 2025-3회-필기 #45: BETWEEN ... OR 문법 오류(AND 사용이 맞음)

## 셀프 체크
- [ ] DML에 해당하는 명령 4가지를 말할 수 있는가(SELECT·INSERT·DELETE·UPDATE)
- [ ] GRANT와 REVOKE의 올바른 구문을 각각 쓸 수 있는가
- [ ] 트리거와 사용자 정의 함수의 차이(RETURN 유무)를 설명할 수 있는가
- [ ] IS NOT NULL, BETWEEN AND, HAVING의 올바른 문법을 압니다
