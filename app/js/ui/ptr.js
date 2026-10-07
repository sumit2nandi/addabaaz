/* Pull-to-refresh: dragging down while at the top reloads the current page. That boot fetch gets
 * the latest catalog edited in Admin. The browser's built-in pull-to-refresh is disabled in
 * styles.css so this custom gesture is the only refresh path. The reload is flagged as an
 * in-app refresh (sessionStorage `ab:refresh`, read by app/refresh-flag.js) so it never replays
 * the launch splash — that belongs to the first launch only. */
const THRESHOLD = 88;   // px of pull required to trigger a refresh
const MAX = 96;         // px the indicator may travel
let startY = null, pulled = 0, engaged = false, el = null;

// Leave the gesture alone where it would mean something else: the reels feed swipes vertically,
// dialogs freeze the scroll at the top, and a page reload mid-video would tear down the player
// and restart the episode/reel from the top - hostile, so it is refused while media is playing.
const blocked = () => document.body.classList.contains('reels-mode')
  || document.body.classList.contains('no-scroll')
  || !!document.querySelector('dialog[open], .lightbox')
  || !!document.querySelector('.player-box.is-playing');

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
    startY = null; pulled = 0; engaged = false;
    if (e.touches.length !== 1 || blocked() || window.scrollY > 0) return;
    startY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    if (e.touches.length !== 1 || blocked()) { startY = null; pulled = 0; engaged = false; rest(); return; }
    if (window.scrollY > 0) { startY = null; pulled = 0; engaged = false; rest(); return; }   // scrolled down mid-gesture
    const dy = e.touches[0].clientY - startY;
    if (!engaged) {
      if (dy <= 4) return;                   // not a pull yet — let the page behave normally
      engaged = true;                        // from here on this IS our gesture: keep holding the
    }                                        // native overscroll back even if the finger wobbles up
    pulled = dy;
    e.preventDefault();                      // non-passive listener: hold back native overscroll
    move(dy * 0.55);
  }, { passive: false });

  const abandon = () => { startY = null; pulled = 0; engaged = false; rest(); };
  const end = () => {
    if (startY == null) return;
    const fire = pulled >= THRESHOLD;
    abandon();
    if (fire) {
      const e = ensure(); e.classList.add('on'); e.style.transform = 'translateY(0px)';
      // The reload is an in-app refresh, not an app launch: app/refresh-flag.js (run from <head>)
      // reads this flag and shows the compact loader instead of replaying the full launch splash.
      try { sessionStorage.setItem('ab:refresh', '1'); } catch { /* storage blocked: the splash will show once */ }
      setTimeout(() => location.reload(), 220);   // allow the indicator to appear before a full page reload
    }
    else rest();
  };
  document.addEventListener('touchend', end, { passive: true });
  // The system took the gesture over (scroll, incoming call, notification shade…): the viewer did
  // not complete a pull, so this must never fire a refresh — just put the indicator back.
  document.addEventListener('touchcancel', abandon, { passive: true });
}
