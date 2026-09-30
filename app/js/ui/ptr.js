/* Pull-to-refresh: dragging the page down while already at the top reloads the current screen.
 * The service worker serves navigations and catalog data network-first, so a reload always shows
 * the latest content (and refreshes the offline copies). Wired up from main.js at start-up. */
const THRESHOLD = 88;   // px of pull required to trigger a refresh
const MAX = 96;         // px the indicator may travel
let startY = null, pulled = 0, el = null;

// Leave the gesture alone where it would mean something else: the reels feed swipes vertically,
// dialogs freeze the scroll at the top, and a reload mid-video would be hostile.
const blocked = () => document.body.classList.contains('reels-mode')
  || document.body.classList.contains('no-scroll')
  || !!document.querySelector('dialog[open], .lightbox');

const ensure = () => {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ptr';
  el.className = 'ptr';
  el.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(el);
  return el;
};
// dy is how far the finger has travelled; the indicator follows with a little resistance.
const move = (dy) => { const e = ensure(); e.style.transform = `translateY(${-80 + Math.min(dy, MAX)}px)`; e.classList.add('on'); };
const rest = () => { if (el) { el.classList.remove('on'); el.style.transform = ''; } };

export function initPullToRefresh() {
  if (typeof document === 'undefined' || document.__ptrInit) return;
  document.__ptrInit = true;

  document.addEventListener('touchstart', (e) => {
    startY = null; pulled = 0;
    if (e.touches.length !== 1 || blocked() || window.scrollY > 0) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    if (e.touches.length !== 1 || blocked()) { startY = null; pulled = 0; rest(); return; }
    if (window.scrollY > 0) { startY = null; pulled = 0; rest(); return; }   // scrolled down mid-gesture
    const dy = e.touches[0].clientY - startY;
    if (dy <= 4) return;                       // not a pull yet — let the page behave normally
    pulled = dy;
    e.preventDefault();                        // non-passive listener: hold back native overscroll
    move(dy * 0.55);
  }, { passive: false });

  const end = () => {
    if (startY == null) return;
    const fire = pulled >= THRESHOLD;
    startY = null; pulled = 0;
    if (fire) { const e = ensure(); e.classList.add('on'); e.style.transform = 'translateY(0px)'; setTimeout(() => location.reload(), 220); }
    else rest();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}
