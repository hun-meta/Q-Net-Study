---
자격증: 정보처리산업기사
과목: 데이터베이스활용
주요항목: SQL활용
작성자: 성훈
갱신일: 2026-07-22
진행도: 정리중
---

# 02. SQL활용

> 출처: `_공통/출제기준/데이터베이스활용.md`의 주요항목 순번을 따른다.
> 세부항목: 기본 SQL 작성(DDL·DML·DCL·TCL) · 고급 SQL 작성(집합연산자·조인·서브쿼리·뷰·인덱스).

## DDL (Data Definition Language)

> 데이터 정의어: 스키마(테이블) 생성·변경·삭제.

### 핵심 개념
- **DDL 명령어**: CREATE(생성) · ALTER(변경) · DROP(삭제) · TRUNCATE(초기화).
- **DDL vs DML 구분**: SELECT/INSERT/UPDATE/DELETE는 DML. CREATE/ALTER/DROP만 DDL. (DELETE는 DML, DROP은 DDL — 헷갈림 주의)
- **DROP TABLE CASCADE**: 해당 테이블과 이를 참조하는 테이블까지 모두 제거.
- VIEW 삭제는 DROP 문 사용(DELETE 아님).

### 암기 포인트
- ⭐ DDL = **CREATE·ALTER·DROP**. DELETE는 DML, DROP은 DDL.
- ⭐ 뷰 제거 = DROP VIEW.

### 기출 연계
- 🔁 기출 2025-2회-필기 #43: DDL에 해당하는 것(ALTER)
- 🔁 기출 2025-2회-필기 #58: DROP TABLE CASCADE 의미(참조 테이블까지 제거)
- 🔁 기출 2024-3회-필기 #45: DDL 명령어가 아닌 것(DELETE)
- 🔁 기출 2024-1회-필기 #47: DDL에 해당하는 것(ALTER)
- 🔁 기출 2023-1회-필기 #47: DDL에 해당하는 것(ALTER)
- 🔁 기출 2023-1회-필기 #56: 테이블 생성에 사용되는 문장(CREATE)

## DML (Data Manipulation Language)

> 데이터 조작어: 검색·삽입·삭제·갱신.

### 핵심 개념
- **DML 기본 형태**:
  - `SELECT 열 FROM 테이블 WHERE 조건` (검색)
  - `INSERT INTO 테이블 VALUES ...` (삽입) — `INSERT ON~VALUES`는 틀린 형태(함정)
  - `DELETE FROM 테이블 WHERE 조건` (삭제)
  - `UPDATE 테이블 SET 열=값 WHERE 조건` (갱신) — `INSERT~FROM~SET`, `REPLACE~`는 틀린 형태
- **DISTINCT**: 검색 결과의 중복 레코드 제거. `SELECT DISTINCT DEPT FROM STUDENT` = 학과 종류만.
- **COUNT(DISTINCT 열)**: 중복 제거한 값의 개수.
- **GROUP BY / HAVING**: HAVING 절은 반드시 GROUP BY와 함께 사용(그룹 조건).
- **ORDER BY ... DESC**: 내림차순 정렬.
- **LIKE 패턴**: `'홍%'`=홍으로 시작(모든 길이), `'박__'`=박으로 시작하는 3글자(`_` 한 글자), `NOT LIKE`=제외.
- **BETWEEN a AND b**: `>= a AND <= b` (양끝 포함).
- **집계 함수**: SUM, COUNT, AVG 등. `GROUP BY` 시 SELECT 절에 그룹 열과 집계함수만.

### 암기 포인트
- ⭐ `INSERT ON`·`WHEN`·`REPLACE`는 모두 틀린 SQL 형태.
- ⭐ DISTINCT=중복제거, HAVING=GROUP BY 조건, BETWEEN은 양끝 포함.

### 기출 연계
- 🔁 기출 2025-3회-필기 #44: 3학년·컴퓨터공학과 이름 조회(SELECT WHERE AND)
- 🔁 기출 2025-3회-필기 #51: DISTINCT/SELECT/COUNT 튜플 수(3, 360, 1)
- 🔁 기출 2025-3회-필기 #58: 데이터 조작문 유형이 아닌 것(INSERT ON~VALUES)
- 🔁 기출 2025-2회-필기 #51: GROUP BY 지역별 SUM 결과
- 🔁 기출 2025-1회-필기 #43: 서울 판매액 내림차순 SQL(ORDER BY DESC)
- 🔁 기출 2025-1회-필기 #47: BETWEEN 연산의 동일 의미(>= AND <=)
- 🔁 기출 2025-1회-필기 #58: 중복 없는 학과 검색(SELECT DISTINCT DEPT)
- 🔁 기출 2024-3회-필기 #53: HAVING 절이 함께 쓰이는 구문(GROUP BY)
- 🔁 기출 2024-3회-필기 #55: DISTINCT/COUNT 튜플 수(200, 3, 1)
- 🔁 기출 2024-3회-필기 #59: 데이터 조작문 유형이 아닌 것(INSERT ON~VALUES)
- 🔁 기출 2024-2회-필기 #49: 조작문 유형이 아닌 것(INSERT~FROM~SET)
- 🔁 기출 2024-2회-필기 #58: DISTINCT의 의미(중복 제거)
- 🔁 기출 2024-2회-필기 #59: DISTINCT 실행 결과 값(3, 1)
- 🔁 기출 2024-1회-필기 #41: DML에 해당하는 것(INSERT)
- 🔁 기출 2024-1회-필기 #45: 3학년·컴퓨터공학과 이름 조회(SELECT WHERE AND)
- 🔁 기출 2024-1회-필기 #56: WHERE NOT LIKE '박__' 의미(박으로 시작 3글자 제외)
- 🔁 기출 2023-3회-필기 #43: 중복 없는 학과 검색(SELECT DISTINCT DEPT)
- 🔁 기출 2023-3회-필기 #46: LIKE '홍%' 의미(홍씨로 시작 튜플 검색)
- 🔁 기출 2023-3회-필기 #53: DISTINCT/SELECT/COUNT 튜플 수(3, 360, 1)
- 🔁 기출 2023-2회-필기 #52: 3학년·컴퓨터공학과 이름 조회(SELECT WHERE AND)
- 🔁 기출 2023-2회-필기 #59: 중복 없는 학과 검색(SELECT DISTINCT DEPT)
- 🔁 기출 2023-1회-필기 #60: 학년 수정 SQL(UPDATE SET WHERE)

## DCL (Data Control Language)

> 데이터 제어어: 접근 권한 부여·회수.

### 핵심 개념
- **DCL 명령어**: GRANT(권한 부여) · REVOKE(권한 회수). (COMMIT/ROLLBACK은 TCL로 분류, SELECT는 DML)
- **GRANT 형태**: `GRANT 권한 ON 객체 TO 사용자`. 모든 사용자 = `TO PUBLIC`.
  - 예: `GRANT SELECT ON STUDENT TO PUBLIC;`

### 암기 포인트
- ⭐ DCL = **GRANT·REVOKE**. `GRANT ... ON ... TO PUBLIC`.

### 기출 연계
- 🔁 기출 2023-3회-필기 #52: DCL 명령어가 아닌 것(SELECT)
- 🔁 기출 2023-2회-필기 #46: DCL 명령어가 아닌 것(SELECT)
- 🔁 기출 2023-1회-필기 #53: 모든 사용자에게 SELECT 권한 허가(GRANT ON TO PUBLIC)

## TCL (Transaction Control Language)

> 트랜잭션 제어어 + 트랜잭션 ACID 특성.

### 핵심 개념
- **TCL 명령어**: COMMIT(저장·확정) · ROLLBACK(취소·복구) · SAVEPOINT.
  - COMMIT: 수행 결과를 물리적 디스크에 저장, 정상 완료 알림.
- **ACID 특성**:
  - **A**tomicity(원자성): 전부 실행 아니면 전무(All or Nothing).
  - **C**onsistency(일관성): 일관성 있는 상태 유지.
  - **I**solation(독립성/격리성): 병행 실행 시 다른 트랜잭션 연산이 끼어들 수 없음.
  - **D**urability(영속성): 완료 결과는 영구적.
  - ('Integrity'·'Distribution'은 ACID가 아님 — 함정)

### 암기 포인트
- ⭐ **ACID = 원자·일관·독립·영속**. Atomicity=All-or-Nothing, Isolation=끼어들기 금지.
- ⭐ COMMIT=저장확정, ROLLBACK=취소.

### 기출 연계
- 🔁 기출 2025-3회-필기 #45: 전부·전무 실행 트랜잭션 특성(Atomicity)
- 🔁 기출 2025-2회-필기 #47: 전부·전무 실행 트랜잭션 특성(Atomicity)
- 🔁 기출 2025-2회-필기 #55: 결과를 디스크에 저장·완료 알림(COMMIT)
- 🔁 기출 2025-1회-필기 #53: ACID에 속하지 않는 것(Integrity)
- 🔁 기출 2024-3회-필기 #49: 병행 실행 중 끼어들 수 없는 특성(Isolation)
- 🔁 기출 2024-2회-필기 #52: 결과를 디스크에 저장·완료 알림(COMMIT)
- 🔁 기출 2024-1회-필기 #59: 병행 실행 중 끼어들 수 없는 특성(Isolation)
- 🔁 기출 2023-3회-필기 #54: 트랜잭션 특성이 아닌 것(Distribution)
- 🔁 기출 2023-2회-필기 #44: 전부·전무 실행 트랜잭션 특성(Atomicity)
- 🔁 기출 2023-1회-필기 #54: 트랜잭션 특성이 아닌 것(Distribution)

## 집합연산자

> 두 릴레이션(테이블)을 결합하는 연산.

### 핵심 개념
- **집합 연산자**: 두 릴레이션을 합병(병합)할 때 사용하는 연산자 범주. 관계형 모델에서 두 테이블을 하나로 합치는 연산.

### 기출 연계
- 🔁 기출 2024-1회-필기 #44: 두 릴레이션을 합병할 때 사용하는 연산자(집합 연산자)

## 조인 (JOIN)

> 두 개 이상 테이블을 결합해 데이터 검색.

### 핵심 개념
- **JOIN 종류**:
  - **EQUI JOIN**: '=' 조건 사용.
  - **NON-EQUI JOIN**: '=' 외의 비교 연산자(>, <, BETWEEN 등) 사용.
  - **SELF JOIN**: 같은 테이블 내 조인.
  - **CROSS JOIN**: 카티션 곱.

### 암기 포인트
- ⭐ '=' 아닌 비교연산자 조인 = **NON-EQUI JOIN**.

### 기출 연계
- 🔁 기출 2025-1회-필기 #45: '=' 아닌 비교 연산자 JOIN(NON-EQUI JOIN)
- 🔁 기출 2024-2회-필기 #47: '=' 아닌 비교 연산자 JOIN(NON-EQUI JOIN)

## 서브쿼리

> SQL 문 내에 중첩된 SELECT 문.

### 핵심 개념
- **서브쿼리**: 다른 SQL 문의 내부에 포함된 SELECT. 괄호로 묶음.
- 예: `SELECT 가격 FROM 도서가격 WHERE 책번호 = (SELECT 책번호 FROM 도서 WHERE 책명='운영체제')` → 도서 테이블에서 '운영체제' 책번호(1111)를 찾아 도서가격에서 해당 가격(15000) 검색.

### 기출 연계
- 🔁 기출 2025-3회-필기 #46: 서브쿼리 질의문 실행 결과(15000)
- 🔁 기출 2024-1회-필기 #58: 서브쿼리 질의문 실행 결과(15000)
- 🔁 기출 2023-2회-필기 #58: 서브쿼리 질의문 실행 결과(15000)

## 뷰 (View)

> 가상 테이블(virtual table).

### 핵심 개념
- **뷰**: 하나 이상의 기본 테이블로부터 유도되어 만들어지는 **가상의(논리적) 테이블**. 물리적 실제 테이블이 아님(함정).
- **특징**: 논리적 독립성 제공, 보안(접근 제어) 제공, 데이터 관리 간단. 뷰 위에 또 다른 뷰 정의 가능.
- **제약**: 뷰에 대한 삽입·삭제·갱신 연산에 제약이 있음("제약이 없다"는 틀림). 독자적 인덱스 불가.
- 기본 테이블 삭제 시 뷰는 **자동 삭제되지 않음**(무효화됨) — 단, 일부 문제는 '자동 삭제'를 옳지 않은 보기로 제시.
- **삭제**: DROP 문 사용(DELETE 아님).

### 암기 포인트
- ⭐ 뷰 = **가상 테이블**(물리적 실제 테이블 X). 삽입·삭제·갱신에 제약 O.
- ⭐ 뷰 제거 = DROP VIEW.

### 기출 연계
- 🔁 기출 2025-3회-필기 #48: 뷰 설명 중 옳지 않은 것(물리적 실제 테이블)
- 🔁 기출 2025-2회-필기 #52: 뷰 설명 중 옳지 않은 것(물리적 실제 테이블)
- 🔁 기출 2024-3회-필기 #54: 뷰 설명 중 옳지 않은 것(DELETE로 제거)
- 🔁 기출 2024-1회-필기 #51: VIEW 삭제 명령(DROP)
- 🔁 기출 2023-3회-필기 #47: 뷰 설명 중 틀린 것(삽입·갱신·삭제 제약 없다)
- 🔁 기출 2023-2회-필기 #41: 뷰 설명 중 옳지 않은 것(물리적 실제 테이블)
- 🔁 기출 2023-1회-필기 #45: 뷰 설명 중 옳지 않은 것(삽입·삭제·갱신 제약 없다)

## 인덱스 (Index)

> 검색 성능 향상을 위한 자료구조.

### 핵심 개념
- **인덱스**: 데이터베이스에 저장된 자료를 빠르게 조회하기 위해 사용. DDL로 생성·변경·제거 가능.
- **특징**: 논리적 구조와 밀접. 레코드 삽입·삭제가 수시인 경우 인덱스 개수를 최소화(갱신 비용 증가 방지).

### 기출 연계
- 🔁 기출 2025-2회-필기 #57: 인덱스 설명 중 옳지 않은 것(논리적 구조와 밀접하지 않다)

## 셀프 체크
- [ ] DDL·DML·DCL·TCL의 명령어를 각각 구분할 수 있는가 (DELETE vs DROP)
- [ ] DISTINCT·GROUP BY·HAVING·ORDER BY의 역할을 말할 수 있는가
- [ ] ACID 특성 4가지를 설명할 수 있는가 (Atomicity=All-or-Nothing)
- [ ] EQUI JOIN과 NON-EQUI JOIN을 구분할 수 있는가
- [ ] 뷰가 가상 테이블이며 갱신 제약이 있음을 설명할 수 있는가
