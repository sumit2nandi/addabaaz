/* Privacy choices. Essential storage (sign-in, profile, settings, offline cache) needs no consent. The only optional thing is
 * Google Analytics 4, and only if the site owner configured a measurement id (server env GA4_MEASUREMENT_ID → <meta name="ab:ga4">,
 * or window.ADDABAAZ_ENV.GA4_ID). Nothing loads from Google until the visitor presses "Accept analytics". */
import { html, $ } from './util.js';
import { openDialog } from './ui/dialog.js';

// Where the visitor's choice is stored: 'all' (analytics allowed) or 'essential' (only what the site needs).
const KEY = 'ab.consent';
// The Google Analytics measurement id (only present if the site owner configured one).
export const gaId = () => document.querySelector('meta[name="ab:ga4"]')?.content || window.ADDABAAZ_ENV?.GA4_ID || '';
export const getConsent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };   // 'all' | 'essential' | null (not asked yet)
// Analytics is loaded at most once, and only after explicit consent.
let gaLoaded = false;

// Load Google Analytics 4 on demand. No request goes to Google before this runs.
function loadGa() {
  const id = gaId(); if (!id || gaLoaded || getConsent() !== 'all' || !/^G-[A-Z0-9]+$/.test(id)) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer || []; window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date()); window.gtag('config', id, { send_page_view: false, anonymize_ip: true });
  const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`; document.head.appendChild(s);
  trackPage();
}
/** Page views for single-page navigation (called on every route change). */
export function trackPage() { if (getConsent() === 'all' && gaLoaded && window.gtag) window.gtag('event', 'page_view', { page_path: location.pathname + location.search + location.hash, page_title: document.title }); }

// Save the choice. Choosing 'essential' also removes any analytics cookies already set.
export function setConsent(v) {
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  document.getElementById('consentBar')?.remove();
  if (v === 'all') { window[`ga-disable-${gaId()}`] = false; loadGa(); }
  else if (gaLoaded) { document.cookie.split(';').forEach((c) => { const n = c.split('=')[0].trim(); if (/^_ga/.test(n)) document.cookie = `${n}=; Max-Age=0; path=/; domain=${location.hostname}`; }); window[`ga-disable-${gaId()}`] = true; }
}

// Shared inline privacy controls, also available in the legacy consent dialog.
export function privacyChoices() {
  return html`<section class="card-panel" aria-labelledby="privacyChoicesTitle"><h2 id="privacyChoicesTitle">Privacy choices</h2>
    <p class="muted">Essential storage keeps you signed in and remembers your profile and settings. It cannot be switched off.</p>
    ${gaId() ? html`<label class="row-switch"><span><b>Analytics (Google Analytics)</b><small>Allow optional analytics. You can change your choice at any time.</small></span><span class="switch"><input type="checkbox" id="privacyAnalytics" ${getConsent() === 'all' ? 'checked' : ''}><span class="track"></span></span></label>` : html`<p class="muted">Optional analytics is not enabled on this site.</p>`}
    <p class="muted small" id="privacyChoiceStatus" role="status"></p>
  </section>`;
}
export function wirePrivacyChoices(root) {
  $('#privacyAnalytics', root)?.addEventListener('change', (e) => {
    setConsent(e.target.checked ? 'all' : 'essential');
    $('#privacyChoiceStatus', root).textContent = 'Privacy choice saved.';
  });
}

// The "Privacy choices" dialog (opened from the footer).
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
// Bar shown once at first visit, only if analytics is configured.
export function initConsent() {
  document.addEventListener('click', (e) => { if (e.target.closest('[data-consent-open]')) { e.preventDefault(); openConsentDialog(); } });
  if (getConsent() === 'all') loadGa();
  if (getConsent() !== null || !gaId()) return;
  const bar = document.createElement('div'); bar.id = 'consentBar'; bar.className = 'consent-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Privacy notice');
  bar.innerHTML = html`<p>We use essential storage to keep you signed in. May we also use Google Analytics to understand what people watch? <a href="#/privacy">Privacy Policy</a></p><div class="row"><button class="btn btn-ghost btn-sm" data-c="essential">Essential only</button><button class="btn btn-primary btn-sm" data-c="all">Accept analytics</button></div>`.s;
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setConsent(b.dataset.c); });
  document.body.appendChild(bar);
}
