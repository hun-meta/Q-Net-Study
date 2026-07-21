// 제출 응답(채점 결과)을 solve → result 화면으로 전달하는 경량 전이 저장소.
// result 화면이 이 값을 우선 사용하고, 없으면(직접 진입) 서버 이력으로 폴백한다.
let last = null;

export function setLastResult(data) {
  last = data;
}
export function getLastResult() {
  return last;
}
export function clearLastResult() {
  last = null;
}
