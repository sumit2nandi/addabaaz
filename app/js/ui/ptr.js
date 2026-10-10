/* Pull-to-refresh: dragging down while at the top refreshes the page IN PLACE.
 *
 * Why not location.reload(): a reload re-runs the whole app start-up, so the WebView painted the
 * launch screen again — a splash screen the viewer never asked for — and the page in front of them
 * disappeared while the catalog was re-fetched. A completed pull now asks the app for a soft
 * refresh (main.js `softRefresh`): the catalog is re-read (cache-busting, so anything edited in
 * Admin shows up) and the page on screen is redrawn from it. No reload, no splash, no blank frame;
 * the only thing the viewer sees is the spinner below, for as long as the data takes.
 *
 * The reload stays as the last-resort path, for a bundle whose in-place refresh is missing or fell
 * over. Even that reload is flagged (sessionStorage `ab:refresh`, read by app/refresh-flag.js), so
 * it cannot replay the launch artwork either.
 *
 * The browser's built-in pull-to-refresh is disabled in styles.css, so this custom gesture is the
 * only refresh path. */
import { app } from '../app.js';

const THRESHOLD = 88;   // px of pull required to trigger a refresh
const MAX = 96;         // px the indicator may travel
const MIN_SPIN = 400;   // ms the indicator stays up, so even an instant refresh feels acknowledged
let startY = null, pulled = 0, engaged = false, el = null;

// Leave the gesture alone where it would mean something else: the reels feed swipes vertically,
// dialogs freeze the scroll at the top, and a refresh mid-video would tear down the player
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
  el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="tr" cx="20" cy="20" r="15.9155"></circle><circle class="arc" cx="20" cy="20" r="15.9155"></circle></svg>';
  document.body.appendChild(el);
  return el;
};
// dy is how far the finger has travelled; the indicator follows with a little resistance.
const move = (dy) => { const e = ensure(); e.style.transform = `translateY(${-80 + Math.min(dy, MAX)}px)`; e.classList.add('on'); };
const rest = () => { if (el) { el.classList.remove('on'); el.style.transform = ''; } };

// The spinner is held at the top of the screen while the refresh runs, and for a beat longer so a
// refresh that lands instantly still reads as "something happened".
const spin = () => {
  const e = ensure();
  e.classList.add('on');
  e.style.transform = 'translateY(0px)';
  return Date.now();
};
const settleSpin = async (since) => {
  const wait = MIN_SPIN - (Date.now() - since);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  rest();
};

/** Last resort: a flagged reload. app/refresh-flag.js reads the flag from <head>, so even this path
 *  shows the compact in-app loader instead of the launch artwork. */
async function reloadForRefresh(since) {
  await settleSpin(since);
  try { sessionStorage.setItem('ab:refresh', '1'); } catch { /* storage blocked: the splash shows once */ }
  location.reload();
}

/** A completed pull: refresh the app where it stands. `softRefresh` redraws the page in place (no
 *  reload → no splash) and says what happened — see main.js:
 *    'refreshed' the page now shows the latest catalog;
 *    'stale'     nothing could be read (offline / server down): the page is kept, and it has already
 *                told the viewer why — reloading would throw that page away for nothing;
 *    'restart'   only a fresh start can help (the app is running off the catalog bundled with it, so
 *                restarting is how it gets back onto the live one).
 *  Without a soft refresh, or if it throws, the reload is the fallback. */
async function refresh(since) {
  const soft = app?.softRefresh;
  if (!soft) return reloadForRefresh(since);
  let result = 'stale';
  try { result = await soft(); }
  catch (err) { console.warn('[ptr] in-place refresh failed', err); return reloadForRefresh(since); }
  if (result === 'restart') return reloadForRefresh(since);
  await settleSpin(since);
  return result === 'refreshed' || result === true;   // lenient on `true`: a cached mixed-version bundle still refreshes
}

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
    if (fire) refresh(spin());   // the indicator stays up until the page behind it is redrawn
  };
  document.addEventListener('touchend', end, { passive: true });
  // The system took the gesture over (scroll, incoming call, notification shade…): the viewer did
  // not complete a pull, so this must never fire a refresh — just put the indicator back.
  document.addEventListener('touchcancel', abandon, { passive: true });
}
