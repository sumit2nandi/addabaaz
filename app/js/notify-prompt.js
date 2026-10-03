/* First-run notification onboarding.
 *
 * Browsers and (especially) phones bury the permission dialog behind a user gesture, so asking on load
 * is pointless — but never asking means most viewers never get episode reminders. So: one friendly
 * prompt, once per installation, a few seconds after the app has opened and settled.
 *
 * Rules:
 *  - asked exactly once: the answer (allowed / not now) is remembered in `ab.notifyAsked`, so nobody is nagged;
 *  - nothing is shown when notifications can't work anyway (unsupported browser, no VAPID keys, native
 *    build without Firebase) or when the decision was already made at the OS level;
 *  - "Not now" is a real answer — we never ask again from this prompt (the Account page still offers the switch);
 *  - it never runs in the middle of a video or on the sign-in screen.
 */
import { openDialog } from './ui/dialog.js';
import { icon } from './icons.js';
import { html, $ } from './util.js';
import { enablePush, pushState, pushSupported } from './push.js';
import { nativePushSupported } from './push-native.js';
import { friendly } from './errors.js';
import { app } from './app.js';

const KEY = 'ab.notifyAsked';          // '1' once the viewer has answered (either way)
const DELAY = 6000;                     // let the first screen settle before interrupting
// Pages where a prompt would be in the way.
const BLOCKED = ['/signin', '/signup', '/forgot', '/reset', '/profiles', '/watch', '/reel'];

const answered = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };   // private mode: don't nag
const remember = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

let pending = false;        // a check or a countdown is already scheduled for this session

/** Shows the prompt when it is appropriate. Safe to call on every boot and every navigation;
 *  it decides whether to act, and never schedules more than one prompt. */
export async function initNotifyPrompt({ path = location.pathname || '/' } = {}) {
  if (pending || answered()) return false;
  if (!pushSupported() && !nativePushSupported()) { remember(); return false; }
  if (BLOCKED.some((p) => path.startsWith(p))) return false;

  // Ask the server whether push is actually configured, and the OS whether it is still undecided.
  let state;
  try { state = await pushState(); } catch { return false; }
  if (!state || !state.supported) {
    // Signed-out browser: there is nothing to subscribe yet. Don't record an answer — ask after sign-in.
    if (!nativePushSupported() && !app.user?.account) return false;
    remember(); return false;
  }
  if (state.enabled === false) return false;                       // push isn't configured on the server yet — try again next launch
  if (!nativePushSupported() && Notification.permission !== 'default') { remember(); return false; }

  // Wait for the screen to settle, then only show it if the viewer is still browsing the same page.
  pending = true;
  await new Promise((r) => setTimeout(r, DELAY));
  pending = false;
  if (answered() || document.hidden) return false;
  if (BLOCKED.some((p) => (location.pathname || '/').startsWith(p))) return false;   // navigated to a video meanwhile

  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openDialog(html`
      <div class="dlg-icon">${icon('bell', { size: 26 })}</div>
      <h2>Never miss a new episode</h2>
      <p class="muted">Turn on notifications and we’ll tell you when a new episode of a show you follow is out, when a launch you set a reminder for goes live, and — if you want — when something big arrives on ADDABAAZ. No spam, and you can switch each type off any time.</p>
      <div class="form-status" id="npStatus" role="alert"></div>
      <div class="row end"><button type="button" class="btn btn-ghost" data-close id="npLater">Not now</button><button type="button" class="btn btn-primary" id="npOn">Turn on notifications</button></div>`,
      { title: 'Notifications', cls: 'dialog-sm dlg-centered', onClose: () => { if (!done) { done = true; remember(); resolve(false); } } });
    const finish = (v) => { done = true; remember(); close(); resolve(v); };
    $('#npLater', el).addEventListener('click', () => finish(false));
    $('#npOn', el).addEventListener('click', async () => {
      const btn = $('#npOn', el);
      btn.disabled = true;
      try { await enablePush({ episodes: true, launches: true, news: false }); finish(true); }
      catch (err) {
        const status = $('#npStatus', el);
        if (status) status.textContent = friendly(err);
        btn.disabled = false;
      }
    });
  });
}
