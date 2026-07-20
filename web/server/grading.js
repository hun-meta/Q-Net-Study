// grading.js — 과목별 채점·과락·합격 판정·확신정답률 (순수 로직, express 비의존)
//
// 팀 확정 데이터 계약:
//   answerKey    = { 문항수, 숨김페이지수, 추출도구, 추출일, 시험ID,
//                    검증오류: string[], 과목들: [{ 과목명, 시작, 끝, 정답: { [문번]: 1|2|3|4 } }] }
//   passCriteria = { 과목과락(기본40), 평균합격(기본60), 출처: 'info.md'|'기본값' }
//   답안         = { [문번]: { 답: 1|2|3|4|null, 찍음: boolean } }   ← OMR 제출 결과
//
// 확신도 매핑(웹): 찍음 체크 → '찍음', 미체크 → '확신'. ('애매'는 CLI 수동 기록 전용)

/** 소수 첫째자리 반올림 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 제출 답안을 채점한다.
 * @returns 채점 결과 객체
 * @throws 정답 검증오류가 있으면 채점 불가 → Error (호출부에서 "열람만" 처리)
 */
function grade({ 답안, answerKey, passCriteria }) {
  if (!answerKey || !Array.isArray(answerKey.과목들) || answerKey.과목들.length === 0) {
    throw new Error('채점 불가: 정답 데이터가 없습니다');
  }
  if (Array.isArray(answerKey.검증오류) && answerKey.검증오류.length > 0) {
    throw new Error('채점 불가: 정답 검증 실패 — ' + answerKey.검증오류.join('; '));
  }

  const 과락 = passCriteria?.과목과락 ?? 40;
  const 평균합격 = passCriteria?.평균합격 ?? 60;
  const 응답 = 답안 || {};

  const 과목결과 = [];
  const 문항결과 = [];
  let 확신분모 = 0;
  let 확신정답 = 0;
  let X수 = 0;
  let O찍음수 = 0;
  let 원점수합 = 0; // 반올림 전 과목 백분율의 합 (평균 산출용)

  for (const 과목 of answerKey.과목들) {
    let 정답수 = 0;
    let 문항수 = 0;
    for (let q = 과목.시작; q <= 과목.끝; q++) {
      문항수++;
      const 정답 = 과목.정답?.[q];
      const resp = 응답[q] || {};
      const 내답 = resp.답 ?? null;
      const 찍음 = !!resp.찍음;
      const 맞음 = 내답 != null && 내답 === 정답;
      if (맞음) 정답수++;
      const 결과 = 맞음 ? 'O' : 'X';
      const 확신도 = 찍음 ? '찍음' : '확신';
      if (결과 === 'X') X수++;
      if (결과 === 'O' && 찍음) O찍음수++;
      if (확신도 === '확신') {
        확신분모++;
        if (맞음) 확신정답++;
      }
      문항결과.push({ 문번: q, 과목명: 과목.과목명, 내답, 정답: 정답 ?? null, 결과, 찍음, 확신도, 맞음 });
    }
    const 원백분율 = 문항수 > 0 ? (정답수 / 문항수) * 100 : 0;
    원점수합 += 원백분율;
    // 과락 판정과 표시 점수를 동일 반올림 기준(round1)으로 통일한다.
    // (raw 39.97처럼 표시상 40.0인 점수가 과락 처리되는 표시-판정 불일치 방지)
    const 점수 = round1(원백분율);
    과목결과.push({
      과목명: 과목.과목명,
      시작: 과목.시작,
      끝: 과목.끝,
      문항수,
      정답수,
      점수,
      과락: 점수 < 과락,
    });
  }

  // 총점 = 전 과목 평균 (반올림 전 백분율의 산술 평균을 한 번만 반올림)
  const 총점 = round1(원점수합 / 과목결과.length);
  const 과락발생 = 과목결과.some((s) => s.과락);
  let 합격여부;
  if (과락발생) 합격여부 = '과락';
  else if (총점 >= 평균합격) 합격여부 = '합격';
  else 합격여부 = '불합격';

  const 확신정답률 = 확신분모 > 0 ? Math.round((확신정답 / 확신분모) * 100) : null;

  // 최저 점수 과목 (동점이면 먼저 나온 과목)
  let 최저과목 = 과목결과[0];
  for (const s of 과목결과) {
    if (s.점수 < 최저과목.점수) 최저과목 = s;
  }

  return {
    시험ID: answerKey.시험ID ?? null,
    총점,
    합격여부,
    과락발생,
    기준: { 과목과락: 과락, 평균합격, 출처: passCriteria?.출처 ?? '기본값' },
    과목결과,
    문항결과,
    X수,
    O찍음수,
    확신문항수: 확신분모,
    확신정답수: 확신정답,
    확신정답률, // 정수 % 또는 null(확신 문항 없음)
    최저과목: { 과목명: 최저과목.과목명, 점수: 최저과목.점수 },
  };
}

module.exports = { grade };
