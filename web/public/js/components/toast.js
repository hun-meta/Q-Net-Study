// 토스트 알림: window 'qnet:toast' CustomEvent(detail={message, type})를 수신해
// 우하단에 표시하고 자동 소멸한다. 스타일은 CSS(.toast-stack/.toast/.toast-<type>).
// type: 'info'(기본) | 'ok' | 'error'. 클릭하면 즉시 닫힌다.

let stack = null;
let mounted = false;

function ensureStack() {
  if (stack && document.body.contains(stack)) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('role', 'status');
  document.body.append(stack);
  return stack;
}

function show(detail) {
  const message = detail && detail.message;
  if (!message) return;
  const type = detail.type === 'ok' || detail.type === 'error' ? detail.type : 'info';
  const host = ensureStack();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  host.append(toast);
  // 등장 트랜지션(스타일은 CSS): 다음 프레임에 in 클래스 부여.
  requestAnimationFrame(() => toast.classList.add('toast-in'));

  const ttl = type === 'error' ? 6000 : 3500;
  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.classList.remove('toast-in');
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 250);
  };
  timer = setTimeout(dismiss, ttl);
  toast.addEventListener('click', dismiss);
}

// app.js 부트스트랩에서 1회 호출: 컨테이너 + 이벤트 리스너 장착(멱등).
export function mountToast() {
  if (mounted) return;
  mounted = true;
  ensureStack();
  window.addEventListener('qnet:toast', (evt) => show(evt.detail));
}

// 다른 모듈에서 간편 발행용 헬퍼(이벤트 디스패치).
export function toast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('qnet:toast', { detail: { message, type } }));
}
