// PDF 뷰어: pdfjs-dist 로컬 서빙. 페이지 단위 렌더 + 줌(60~200%) 컨트롤러.
// solve 모드는 답지 제거 서브셋(/pdf), view(답 포함 열람) 모드는 원본(/pdf-full, 제출 있을 때만; 없으면 서브셋).

const enc = encodeURIComponent;
let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdfjs/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

// createViewer(container, ctx, opts) → controller.
// ctx: { grade, cert, id }. opts: { mode:'solve'|'view' }.
// controller: { numPages, usedFull, page(get), zoom(get), setPage, next, prev, zoomIn, zoomOut, zoomReset, onChange, destroy }
export async function createViewer(container, ctx, opts) {
  const { grade, cert, id } = ctx;
  const mode = (opts && opts.mode) || 'solve';
  const q = `grade=${enc(grade)}&cert=${enc(cert)}`;

  container.innerHTML = '<p class="loading" style="padding:24px">PDF 불러오는 중…</p>';

  // 바이트 로드. view 모드는 원본 우선(제출 없으면 403 → 서브셋 폴백).
  // cache:'no-store' — 서브셋은 정답 재등록·생성 로직 변경으로 내용이 바뀔 수 있는데,
  // 브라우저 HTTP 캐시가 구 버전을 재검증 없이 재사용하면 "백지/옛 PDF" 사고가 난다(로컬 앱이라 비용 무시 가능).
  let bytes = null;
  let usedFull = false;
  if (mode === 'view') {
    try {
      const rf = await fetch(`/api/exams/${enc(id)}/pdf-full?${q}`, { cache: 'no-store' });
      if (rf.ok) {
        bytes = await rf.arrayBuffer();
        usedFull = true;
      }
    } catch (_e) {
      /* 폴백 진행 */
    }
  }
  if (!bytes) {
    const r = await fetch(`/api/exams/${enc(id)}/pdf?${q}`, { cache: 'no-store' });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `PDF 요청 실패 (${r.status})`);
    }
    bytes = await r.arrayBuffer();
  }

  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const numPages = pdf.numPages;

  container.innerHTML = '';
  const zoomWrap = document.createElement('div');
  zoomWrap.className = 'pdf-zoom';
  const pageWrap = document.createElement('div');
  pageWrap.className = 'pdf-page';
  zoomWrap.append(pageWrap);
  container.append(zoomWrap);

  let current = 1;
  let zoom = 1;
  let cb = null;
  let renderToken = 0;

  async function renderPage(n) {
    const token = ++renderToken;
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const avail = Math.max(360, container.clientWidth - 52);
    const scale = Math.min(2.2, avail / base.width);
    const viewport = page.getViewport({ scale });
    if (token !== renderToken) return;

    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const cxt = canvas.getContext('2d');
    cxt.scale(dpr, dpr);
    await page.render({ canvasContext: cxt, viewport }).promise;
    if (token !== renderToken) return;
    pageWrap.innerHTML = '';
    pageWrap.append(canvas);
    container.scrollTop = 0;
  }

  function notify() {
    if (cb) cb({ page: current, numPages, zoom, usedFull });
  }
  function applyZoom() {
    zoomWrap.style.zoom = String(zoom);
    notify();
  }

  await renderPage(current);

  // 견고화: 최초 렌더가 레이아웃 확정 전에 일어났거나 창/패널 폭이 바뀌면
  // 현재 페이지를 pane 폭에 맞게 다시 그린다(폭이 유의미하게 바뀔 때만 — 루프 방지).
  let lastWidth = container.clientWidth;
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (w && Math.abs(w - lastWidth) > 4) {
        lastWidth = w;
        renderPage(current);
      }
    });
    ro.observe(container);
  }

  const controller = {
    numPages,
    usedFull,
    get page() {
      return current;
    },
    get zoom() {
      return zoom;
    },
    setPage(x) {
      const t = Math.max(1, Math.min(numPages, x));
      if (t !== current) {
        current = t;
        renderPage(current);
        notify();
      }
    },
    next() {
      controller.setPage(current + 1);
    },
    prev() {
      controller.setPage(current - 1);
    },
    zoomIn() {
      zoom = Math.min(2, Math.round((zoom + 0.1) * 10) / 10);
      applyZoom();
    },
    zoomOut() {
      zoom = Math.max(0.6, Math.round((zoom - 0.1) * 10) / 10);
      applyZoom();
    },
    zoomReset() {
      zoom = 1;
      applyZoom();
    },
    onChange(fn) {
      cb = fn;
      notify();
    },
    destroy() {
      renderToken += 1;
      if (ro) {
        try {
          ro.disconnect();
        } catch (_e) {
          /* 무시 */
        }
        ro = null;
      }
      try {
        pdf.destroy();
      } catch (_e) {
        /* 무시 */
      }
    },
  };
  return controller;
}
