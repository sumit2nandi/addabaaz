/* Small UI toolkit for the admin console: templating, icons, formatting, toasts, modals and a schema-driven form builder. */
import { html, raw, esc, $, $$, debounce } from '../../app/js/util.js';
import { api, prepareImage, putFile, ApiError } from './api.js';
export { html, raw, esc, $, $$, debounce, ApiError };

/* ---------- formatting ---------- */
export const inr = (paise) => { const n = (Number(paise) || 0) / 100; return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }); };
// Dates are always displayed in Indian Standard Time.
const IST = { timeZone: 'Asia/Kolkata' };
export const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtD = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000; if (!isFinite(s)) return '';
  for (const [n, u] of [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
};
export const fmtDur = (sec) => { sec = Math.max(0, Math.round(Number(sec) || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
// Duration text <-> seconds ("1:05:30" or plain seconds); slug and YouTube-id helpers for the content forms.
export const parseDur = (t) => { t = String(t ?? '').trim(); if (!t) return 0; if (/^\d+$/.test(t)) return Number(t); const p = t.split(':').map(Number); return p.length > 1 && p.length <= 3 && p.every((x) => Number.isInteger(x) && x >= 0) ? p.reduce((a, x) => a * 60 + x, 0) : NaN; };
/** Reads the duration (in whole seconds) of a local video File/Blob or URL using an off-screen <video> element. Resolves to 0 if unreadable. */
export function probeVideoDuration(source, { timeoutMs = 10000 } = {}) {
  if (!source || typeof document === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    const vid = document.createElement('video');
    const objectUrl = typeof source === 'string' ? '' : (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(source) : '');
    const src = typeof source === 'string' ? source : objectUrl;
    if (!src) return resolve(0);
    let settled = false, seekedForDuration = false;
    const finish = (secs) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { vid.removeAttribute('src'); vid.load?.(); } catch { /* ignore */ }
      if (objectUrl) try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
      resolve(secs > 0 && Number.isFinite(secs) ? Math.max(1, Math.round(secs)) : 0);
    };
    const check = () => {
      const d = Number(vid.duration);
      if (Number.isFinite(d) && d > 0) return finish(d);
      if (d === Infinity && !seekedForDuration) {
        seekedForDuration = true;
        try { vid.currentTime = 1e101; } catch { finish(0); }
      }
    };
    const timer = setTimeout(() => finish(0), timeoutMs);
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute?.('playsinline', '');
    vid.setAttribute?.('webkit-playsinline', '');
    vid.addEventListener('loadedmetadata', check);
    vid.addEventListener('durationchange', check);
    vid.addEventListener('timeupdate', () => { if (Number.isFinite(vid.duration) && vid.duration > 0) finish(vid.duration); });
    vid.addEventListener('error', () => finish(0), { once: true });
    vid.src = src;
    try { vid.load?.(); } catch { /* ignore */ }
  });
}
export const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50);
export const plural = (n, w) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;
export const imgSrc = (p) => (!p ? '' : /^https?:/.test(p) ? p : '/' + p);
export const ytId = (t) => { const m = String(t || '').trim().match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})|^([\w-]{11})$/); return m ? m[1] || m[2] : ''; };

/* ---------- icons ---------- */
// Icon set (SVG paths).
const I = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
  log: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chart: '<path d="M3 3v18h18M7 15v3M12 9v9M17 5v13"/>', bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M6 13H2M22 13h-4M6 17l-3 2M18 17l3 2M6 9l-3-2M18 9l3-2"/><rect x="6" y="7" width="12" height="14" rx="6"/>',
  refund: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/>',
  crown: '<path d="M4.1 17.6 3 8.9l4.7 3.7L12 5.7l4.3 6.9 4.7-3.7-1.1 8.7Z"/><path d="M5.3 20.7h13.4"/>',
  play: '<path d="M5 3.5v17l15-8.5z"/>', send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>', mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>', star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
};
export const icon = (n, size = 18) => raw(`<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`);

/* ---------- toasts ---------- */
// Small pop-up message; type 'ok' or 'err'. When a <dialog> modal is open in the top layer, also show the toast inside the modal so it isn't hidden behind the dialog backdrop.
export function toast(message, type = 'ok') {
  const openDlg = document.querySelector('dialog.modal[open]');
  let host = $('#toasts');
  if (openDlg) {
    if (type === 'err') {
      const formErr = $('.form-err', openDlg);
      if (formErr) { formErr.textContent = message; formErr.hidden = false; formErr.scrollIntoView?.({ block: 'nearest' }); }
    }
    let modalHost = $('.modal-toasts', openDlg);
    if (!modalHost) { modalHost = document.createElement('div'); modalHost.className = 'modal-toasts'; openDlg.append(modalHost); }
    host = modalHost;
  }
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = message;
  host?.append(t);
  setTimeout(() => t.classList.add('out'), type === 'err' ? 6000 : 3200)?.unref?.();
  setTimeout(() => t.remove(), type === 'err' ? 6400 : 3600)?.unref?.();
}
export const errMsg = (e) => (e instanceof Error ? e.message : String(e));

/* ---------- modal ---------- */
// Modal dialog helper; returns { el, close }.
export function openModal(content, { title = '', wide = false, dismissable = true, onClose } = {}) {
  const d = document.createElement('dialog'); d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = html`<header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button></header><div class="modal-body">${content}</div>`.s;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || (dismissable && e.target === d)) d.close(); });
  d.addEventListener('close', () => { d.remove(); onClose?.(); });
  d.showModal();
  return { el: d, body: $('.modal-body', d), close: () => d.close() };
}
export const confirmBox = ({ title, text = '', confirm = 'Confirm', danger = false }) => new Promise((resolve) => {
  let ok = false;
  const m = openModal(html`<p class="muted">${text}</p><div class="row end"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${confirm}</button></div>`, { title, onClose: () => resolve(ok) });
  $('[data-ok]', m.el).onclick = () => { ok = true; m.close(); };
});
/** Runs an async action with a busy button + error toast. */
export async function guard(btn, fn) {
  const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { return await fn(); } catch (e) { toast(errMsg(e), 'err'); } finally { if (btn?.isConnected) { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = label; } }
}

/* ---------- small components ---------- */
export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export const pager = ({ total, offset, limit }) => total <= limit ? '' : html`<div class="pager"><button class="btn sm" data-page="${Math.max(0, offset - limit)}" ${offset <= 0 ? 'disabled' : ''}>${icon('left', 16)} Prev</button><span class="muted">${offset + 1}–${Math.min(total, offset + limit)} of ${total.toLocaleString('en-IN')}</span><button class="btn sm" data-page="${offset + limit}" ${offset + limit >= total ? 'disabled' : ''}>Next ${icon('right', 16)}</button></div>`;
export const pageHead = (title, sub = '', actions = '') => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;

/* ---------- schema-driven forms ----------
 * field: { k, label, type: text|number|textarea|lines|tags|select|bool|datetime|image|custom, req, help, options:[{v,l}], max, placeholder, readonly,
 *          maxWidth (image), render(values)/read(form)/wire(form) (custom) }                                                                */
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function fieldHtml(f, v) {
  const id = `f_${f.k}`, val = v[f.k];
  const lab = html`<label for="${id}">${f.label}${f.req ? html` <em title="required">*</em>` : ''}</label>`;
  const help = f.help ? html`<small class="muted">${f.help}</small>` : '';
  const ro = f.readonly ? 'readonly' : '';
  let ctl;
  switch (f.type) {
    case 'textarea': ctl = html`<textarea id="${id}" name="${f.k}" rows="${f.rows || 4}" maxlength="${f.max || 3000}" ${ro}>${val ?? ''}</textarea>`; break;
    case 'lines': ctl = html`<textarea id="${id}" name="${f.k}" rows="${f.rows || 3}" placeholder="${f.placeholder || 'One per line'}">${(val || []).join('\n')}</textarea>`; break;
    case 'tags': ctl = html`<input id="${id}" name="${f.k}" value="${(val || []).join(', ')}" placeholder="${f.placeholder || 'Comma separated'}">`; break;
    case 'number': ctl = html`<input id="${id}" name="${f.k}" type="number" min="${f.min ?? 0}" ${f.max != null ? html`max="${f.max}"` : ''} value="${val ?? ''}" ${ro}>`; break;
    case 'select': ctl = html`<select id="${id}" name="${f.k}">${f.options.map((o) => html`<option value="${o.v}" ${String(o.v) === String(val ?? f.dflt ?? '') ? 'selected' : ''}>${o.l}</option>`)}</select>`; break;
    case 'bool': return html`<div class="field check"><label><input type="checkbox" name="${f.k}" ${val ? 'checked' : ''}> <span>${f.label}</span></label>${help}</div>`;
    case 'datetime': ctl = html`<input id="${id}" name="${f.k}" type="datetime-local" value="${toLocalInput(val)}">`; break;
    case 'image': ctl = html`<div class="imgf" data-image="${f.k}" data-maxw="${f.maxWidth || 1600}"><div class="imgf-prev">${val ? html`<img src="${imgSrc(val)}" alt="">` : html`<span class="muted small">No image</span>`}</div><div class="imgf-in"><input id="${id}" name="${f.k}" value="${val ?? ''}" placeholder="Upload, or paste media/… or https://…"><label class="btn sm">${icon('upload', 16)} Upload<input type="file" accept="image/*" hidden></label><span class="imgf-st small muted"></span></div></div>`; break;
    case 'custom': return f.render(v);
    default: ctl = html`<input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${val ?? ''}" maxlength="${f.max || 300}" placeholder="${f.placeholder || ''}" ${ro} ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
  }
  return html`<div class="field ${f.wide ? 'wide' : ''}">${lab}${ctl}${help}</div>`;
}
export const formHtml = (fields, values = {}) => html`<div class="fields">${fields.map((f) => fieldHtml(f, values))}</div>`;
export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'custom') { Object.assign(out, f.read(form)); continue; }
    const el = form.elements[f.k]; if (!el) continue;
    const v = f.type === 'bool' ? el.checked : el.value;
    out[f.k] = f.type === 'lines' ? v.split('\n').map((s) => s.trim()).filter(Boolean)
      : f.type === 'tags' ? v.split(',').map((s) => s.trim()).filter(Boolean)
      : f.type === 'datetime' ? (v ? new Date(v).toISOString() : '')
      : f.type === 'number' ? (v === '' ? '' : Number(v)) : typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
/** Uploading behaviour for every `.imgf` control inside `root`. */
export function wireImages(root) {
  for (const box of $$('[data-image]', root)) {
    const input = $('input[type=text], input:not([type])', box), file = $('input[type=file]', box), st = $('.imgf-st', box), prev = $('.imgf-prev', box);
    const show = () => { prev.innerHTML = input.value.trim() ? `<img alt="" src="${esc(imgSrc(input.value.trim()))}">` : '<span class="muted small">No image</span>'; };
    input.addEventListener('change', show);
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return; st.classList.remove('err', 'ok'); st.textContent = 'Uploading…';
      try { const blob = await prepareImage(f, { maxWidth: Number(box.dataset.maxw) || 1600 }); const r = await api.uploadImage(blob); input.value = r.path; st.classList.add('ok'); st.textContent = `Uploaded ✓ (${Math.round(r.bytes / 1024)} KB)`; show(); }
      catch (e) { st.classList.add('err'); st.textContent = `✖ ${errMsg(e)}`; toast(errMsg(e), 'err'); } finally { file.value = ''; }
    });
  }
}
/**
 * Modal form: onSubmit(values) may throw — the message is shown in the form. `extra(form, modal)` lets a view wire custom controls.
 */
export function formModal({ title, fields, values = {}, submit = 'Save', wide = false, onSubmit, extra, note = '' }) {
  const m = openModal(html`<form class="form" novalidate>${note ? html`<p class="muted">${note}</p>` : ''}<div class="form-err" hidden></div>${formHtml(fields, values)}<div class="row end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${submit}</button></div></form>`, { title, wide, dismissable: false });
  const form = $('form', m.el), err = $('.form-err', m.el), btn = $('button[type=submit]', m.el);
  wireImages(m.el); extra?.(form, m);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true; btn.classList.add('busy');
    try { await onSubmit(readForm(form, fields), m); m.close(); }
    catch (x) { err.textContent = errMsg(x); err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
    finally { btn.disabled = false; btn.classList.remove('busy'); }
  });
  setTimeout(() => $('input:not([type=hidden]):not([readonly]), textarea', form)?.focus(), 30);
  return m;
}

/* ---------- tiny SVG charts ---------- */
export function barChart(values, { height = 120, label = (v) => v, labels = [] } = {}) {
  const max = Math.max(1, ...values), w = 100 / values.length;
  return html`<svg class="chart" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img">${values.map((v, i) => {
    const h = Math.round((v / max) * (height - 8)); return html`<g><title>${labels[i] ?? ''}: ${label(v)}</title><rect x="${i * w + w * 0.12}" y="${height - h}" width="${w * 0.76}" height="${Math.max(h, v ? 1.5 : 0.8)}" rx="0.6" class="${v ? 'on' : 'off'}"/></g>`;
  })}</svg>`;
}
