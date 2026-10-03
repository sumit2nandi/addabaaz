/* Maintenance screen for tabs and apps that are already open.
 *
 * A cold page load never gets this far — the server answers with maintenance.html itself (see
 * server/src/maintenance.js). But a tab that is already running, or an installed app coming back to the
 * foreground, only finds out through the API: every viewer call comes back `503 maintenance`. The API client
 * turns that into an `ab:maintenance` event (app/js/data/api.js) and this file paints the screen, polls
 * /api/v1/status, and reloads the moment the site is back.
 *
 * It is deliberately small and dependency-free: if the app is mid-update, this still has to work.
 */
import { html } from './util.js';
import { icon } from './icons.js';

const POLL_MS = 20000;          // how often an open screen asks whether we are back

let el = null;                  // the overlay, once shown
let timer = null;               // the poll
let until = null;               // ISO end of the window, when the operator set one
let base = '';                  // API base ('' = same origin)

const statusUrl = () => `${base}/api/v1/status`;
const readStatus = () => fetch(statusUrl(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** "12 minutes" / "3 seconds" — a rough, friendly duration. */
function span(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} min` : ''}`;
}

function paintCountdown() {
  if (!el) return;
  const left = el.querySelector('#abmLeft');
  if (!left) return;
  if (!until) { left.textContent = ''; return; }
  const ms = Date.parse(until) - Date.now();
  left.textContent = ms > 0 ? `Back in about ${span(ms)}` : 'Back any moment now';
}

/** Show (or update) the screen. */
function show(state = {}) {
  until = state.until || null;
  if (el) {
    const msg = el.querySelector('#abmMsg');
    if (msg && state.message) msg.textContent = state.message;
    paintCountdown();
    return el;
  }
  el = document.createElement('div');
  el.className = 'maintenance-screen';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = html`<div class="abm-card">
    <div class="abm-brand"><span><b>ADDA</b><i>BAAZ</i></span></div>
    <div class="abm-glyph" aria-hidden="true">${icon('gear', { size: 26 })}</div>
    <h1>We’ll be right back</h1>
    <p class="abm-msg" id="abmMsg">${state.message || 'ADDABAAZ is getting a quick upgrade. We’ll be back shortly — thanks for your patience!'}</p>
    <p class="abm-left" id="abmLeft"></p>
    <div class="abm-bar" aria-hidden="true"><i></i></div>
    <button class="btn btn-primary" id="abmCheck" type="button">Check again</button>
    <p class="abm-note">Your plan, watchlist and downloads are safe. Payments already made are still settling.</p>
  </div>`.s;
  (document.getElementById('view')?.parentElement || document.body).appendChild(el);
  el.querySelector('#abmCheck').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Checking…';
    const s = await readStatus();
    if (isBack(s)) return location.reload();
    btn.disabled = false; btn.textContent = 'Still working — check again';
    if (s?.maintenance) show(s.maintenance);
  });
  paintCountdown();
  if (until) setInterval(paintCountdown, 1000);
  return el;
}

const isBack = (s) => !!s && (!s.maintenance || !s.maintenance.active);

async function check() {
  const s = await readStatus();
  if (isBack(s)) { location.reload(); return; }        // we are back: let the app boot normally again
  if (s?.maintenance) show(s.maintenance);
}

function hide() { el?.remove(); el = null; }

/**
 * Start watching. Safe on every boot and in local mode: without an API nothing ever fires, and a single
 * low-cost status probe runs only when a call actually failed with `503 maintenance`.
 */
export function initMaintenanceWatch({ apiBase = '' } = {}) {
  base = apiBase === 'off' ? '' : apiBase;
  window.addEventListener('ab:maintenance', (e) => {
    show(e.detail || {});
    if (!timer) timer = setInterval(check, POLL_MS);
  });
  // Coming back to an app that was left on this screen: ask once, in case we came back while it slept.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && el) check(); });
  window.addEventListener('ab:maintenance-over', hide);
}
