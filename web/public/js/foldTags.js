// foldTags.js — 🔁 기출 연계 목록을 <details>로 접는 공통 유틸(디폴트 닫힘).
//
// 개념 노트 본문(marked 렌더 HTML)에서 🔁 라인만으로 이루어진 <ul>을 찾아
// <details><summary>📎 {그룹명} (N)</summary>...</details> 로 변환한다.
// - 개념 설명 li(🔁 없음)가 섞인 ul은 그대로 둔다(개념은 펼침 유지).
// - 직전 형제가 볼드 서브헤딩(<p><strong>그룹명</strong>)이면 그룹명으로 흡수·제거하여
//   각 기출연계 그룹이 의미있는 라벨의 독립 details가 된다(부분적 접기/펼치기).
// panel.js(개념 보기 패널)·certNotes.js(정리 모음) 양쪽에서 재사용.

export function foldExamTags(container) {
  for (const list of [...container.querySelectorAll('ul')]) {
    const lis = [...list.children].filter((c) => c.tagName === 'LI');
    if (!lis.length) continue;
    const tags = lis.filter((li) => li.textContent.includes('🔁'));
    if (!tags.length || tags.length !== lis.length) continue;

    // 직전 볼드 서브헤딩(<p><strong>)을 그룹명으로 사용 — 있으면 흡수(제거).
    const prev = list.previousElementSibling;
    let label = '기출 연계';
    if (prev && prev.tagName === 'P' && prev.querySelector('strong')) {
      const t = prev.textContent.trim();
      if (t) {
        label = t;
        prev.remove();
      }
    }

    const details = document.createElement('details');
    details.className = 'panel-tag-fold';
    list.replaceWith(details);
    const summary = document.createElement('summary');
    summary.className = 'panel-tag-fold-summary';
    summary.textContent = `📎 ${label} (${tags.length})`;
    details.append(summary, list);
  }
}
