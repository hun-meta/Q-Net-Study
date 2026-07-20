// PDF 뷰어: pdfjs-dist 로컬 서빙(외부 CDN 금지)로 숨김 페이지 제거 서브셋을 렌더.
// 답지는 서버 서브셋 단계에서 이미 제외되어 브라우저에 도달하지 않는다.

let pdfjsPromise = null;

// pdf.js를 1회만 지연 로드하고 워커 경로를 로컬 vendor 라우트로 지정.
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdfjs/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function renderViewer(container, ctx) {
  const { grade, cert, id } = ctx;
  container.innerHTML = '<p class="loading">PDF 불러오는 중…</p>';

  const q = `grade=${encodeURIComponent(grade)}&cert=${encodeURIComponent(cert)}`;
  const res = await fetch(`/api/exams/${encodeURIComponent(id)}/pdf?${q}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `PDF 요청 실패 (${res.status})`);
  }
  const data = await res.arrayBuffer();

  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  container.innerHTML = '';
  // 컨테이너 폭에 맞춰 배율 계산(과확대 방지 상한 2.0).
  const avail = Math.max(320, container.clientWidth - 16);

  for (let n = 1; n <= pdf.numPages; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.0, avail / base.width);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);
    container.append(canvas);

    // eslint-disable-next-line no-await-in-loop
    await page.render({ canvasContext: context, viewport }).promise;
  }
}
