/* Privacy choices. Essential storage (sign-in, profile, settings, offline cache) needs no consent. The only optional thing is
 * Google Analytics 4, and only if the site owner configured a measurement id (server env GA4_MEASUREMENT_ID → <meta name="ab:ga4">,
 * or window.ADDABAAZ_ENV.GA4_ID). Nothing loads from Google until the visitor presses "Accept analytics". */
import { html, $ } from './util.js';
import { openDialog } from './ui/dialog.js';

const KEY = 'ab.consent';
export const gaId = () => document.querySelector('meta[name="ab:ga4"]')?.content || window.ADDABAAZ_ENV?.GA4_ID || '';
export const getConsent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };   // 'all' | 'essential' | null (not asked yet)
let gaLoaded = false;

function loadGa() {
  const id = gaId(); if (!id || gaLoaded || getConsent() !== 'all' || !/^G-[A-Z0-9]+$/.test(id)) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || []; window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date()); window.gtag('config', id, { send_page_view: false, anonymize_ip: true });
  const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`; document.head.appendChild(s);
  trackPage();
}
/** Page views for single-page navigation (called on every route change). */
export function trackPage() { if (gaLoaded && window.gtag) window.gtag('event', 'page_view', { page_path: location.pathname + location.search + location.hash, page_title: document.title }); }

export function setConsent(v) {
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  document.getElementById('consentBar')?.remove();
  if (v === 'all') loadGa();
  else if (gaLoaded) { document.cookie.split(';').forEach((c) => { const n = c.split('=')[0].trim(); if (/^_ga/.test(n)) document.cookie = `${n}=; Max-Age=0; path=/; domain=${location.hostname}`; }); window[`ga-disable-${gaId()}`] = true; }
}

export function openConsentDialog() {
  const on = getConsent() === 'all', hasGa = !!gaId();
  const { el, close } = openDialog(html`<h2>Privacy choices</h2>
    <p class="muted">ADDABAAZ stores a few things on your device so the site works: your sign-in, your profile and settings, and a copy of the app for offline use. Those are essential and can’t be switched off.</p>
    ${hasGa ? html`<label class="row-switch"><span><b>Analytics (Google Analytics)</b><small>Anonymous page views that help us see what people watch. Off unless you say yes.</small></span><span class="switch"><input type="checkbox" id="gaOn" ${on ? 'checked' : ''}><span class="track"></span></span></label>`
      : html`<p class="muted"><b>Analytics:</b> this site doesn’t use optional analytics cookies. We only count plays and watch time on our own servers, without identifying you.</p>`}
    <p class="muted">Read the <a href="#/privacy" data-close>Privacy Policy</a>.</p>
    <div class="row end"><button class="btn btn-primary" data-close>Done</button></div>`, { title: 'Privacy choices', cls: 'dialog-sm' });
  $('#gaOn', el)?.addEventListener('change', (e) => setConsent(e.target.checked ? 'all' : 'essential'));
  if (hasGa && getConsent() === null) setConsent('essential');
  return close;
}

/** Shows the bar once, only when there is something optional to consent to. */
export function initConsent() {
  document.addEventListener('click', (e) => { if (e.target.closest('[data-consent-open]')) { e.preventDefault(); openConsentDialog(); } });
  if (getConsent() === 'all') loadGa();
  if (getConsent() !== null || !gaId()) return;
  const bar = document.createElement('div'); bar.id = 'consentBar'; bar.className = 'consent-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Privacy notice');
  bar.innerHTML = html`<p>We use essential storage to keep you signed in. May we also use Google Analytics to understand what people watch? <a href="#/privacy">Privacy Policy</a></p><div class="row"><button class="btn btn-ghost btn-sm" data-c="essential">Essential only</button><button class="btn btn-primary btn-sm" data-c="all">Accept analytics</button></div>`.s;
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setConsent(b.dataset.c); });
  document.body.appendChild(bar);
}
