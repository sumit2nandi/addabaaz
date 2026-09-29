// Reusable UI pieces (cards, rails, buttons, toasts) returned as safe HTML strings. Pages compose these instead of repeating markup.
import { app } from '../app.js';
import { html, raw, esc, fmtDuration, fmtViews, timeAgo, fmtRuntime } from '../util.js';
import { icon } from '../icons.js';
import { avatarColor } from '../data/user.js';

// If an image fails to load, mark it so CSS can show a placeholder.
const IMG_FALLBACK = "this.onerror=null;this.classList.add('img-failed')";

// <img> markup with lazy loading and the failure fallback above.
export function img(src, alt = '', { cls = '', lazy = true, fallback } = {}) {
  const fb = fallback ? `this.onerror=null;this.src='${esc(fallback)}'` : IMG_FALLBACK;
  return html`<img class="${cls}" src="${src}" alt="${alt}" ${lazy ? raw('loading="lazy" decoding="async"') : ''} onerror="${raw(esc(fb))}">`;
}
/** Card thumbnail. hqdefault (480x360, letterboxed) + object-fit:cover gives a clean 16:9 *and* 9:16 crop. */
export function ytImg(v, alt = '', { cls = '' } = {}) {
  return img(app.catalog.thumb(v, 'hqdefault'), alt, { cls });
}

/* ---------- state-aware buttons (kept in sync globally by main.js) ---------- */
// "My List" and "Remind me" buttons render their current state; syncButtons() refreshes every one on the page when the state changes.
export function listBtn(type, id, { label = 'My List', cls = 'btn btn-ghost', iconOnly = false } = {}) {
  const on = app.user?.inList(type, id);
  return html`<button type="button" class="${cls} list-btn ${on ? 'on' : ''}" data-list="${type}:${id}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${iconOnly ? (on ? 'Remove from My List' : 'Add to My List') : ''}" title="${on ? 'Remove from My List' : 'Add to My List'}">
    <span class="ic-off">${icon('plus', { size: 18 })}</span><span class="ic-on">${icon('check', { size: 18 })}</span>${iconOnly ? '' : html`<span class="lbl">${label}</span>`}</button>`;
}
export function remindBtn(id, { cls = 'btn btn-ghost' } = {}) {
  const on = app.user?.hasReminder(id);
  return html`<button type="button" class="${cls} remind-btn ${on ? 'on' : ''}" data-remind="${id}" aria-pressed="${on ? 'true' : 'false'}">
    ${icon('bell', { size: 18 })}<span class="lbl">${on ? 'Reminder set' : 'Remind me'}</span></button>`;
}
// Update all list/reminder buttons under `root` to match the user's current library.
export function syncButtons(root = document) {
  const u = app.user; if (!u) return;
  root.querySelectorAll('[data-list]').forEach((b) => {
    const [type, ...rest] = b.dataset.list.split(':'); const on = u.inList(type, rest.join(':'));
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.title = on ? 'Remove from My List' : 'Add to My List';
    if (b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.title);
  });
  root.querySelectorAll('[data-remind]').forEach((b) => {
    const on = u.hasReminder(b.dataset.remind); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    const l = b.querySelector('.lbl'); if (l) l.textContent = on ? 'Reminder set' : 'Remind me';
  });
}

/* ---------- cards ---------- */
// Poster card for a show.
export function showCard(s, { cls = '' } = {}) {
  return html`<a class="card card-poster ${cls}" href="#/show/${s.id}" aria-label="${s.titleEn || s.title}">
    <div class="poster">${img(s.poster, s.title)}</div>
    <div class="card-quick">${listBtn('show', s.id, { cls: 'icon-btn', iconOnly: true })}</div>
  </a>`;
}
// Thumbnail card for an episode/clip: shows duration, a resume progress bar, lock badge for premium and an optional rank number.
export function videoCard(v, { progress = true, rank = 0, showName = true, cls = '' } = {}) {
  const cat = app.catalog; const show = cat.show(v.showId);
  const frac = progress ? app.user?.fraction(v.id, v.duration) || 0 : 0;
  const rankEl = rank ? html`<span class="rank" aria-hidden="true">${rank}</span>` : '';
  return html`<a class="card card-video ${rank ? 'ranked' : ''} ${cls}" href="#/watch/${v.id}" aria-label="${cat.displayTitle(v)}">
    ${rankEl}
    <div class="thumb">
      ${ytImg(v, cat.displayTitle(v))}
      <span class="chip chip-label">${cat.label(v)}</span>
      ${v.access === 'premium' ? html`<span class="chip chip-premium">${icon('lock', { size: 11 })} Premium</span>` : ''}
      <span class="chip chip-dur">${fmtDuration(v.duration)}</span>
      <span class="play-overlay">${icon('play', { size: 22 })}</span>
      ${frac > 0.01 ? html`<span class="progress"><i style="width:${Math.round(frac * 100)}%"></i></span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${cat.displayTitle(v)}</div>
      <div class="card-meta">${showName && show ? html`<span>${show.titleEn || show.title}</span>` : ''}<span>${fmtViews(v.views)} views</span><span>${timeAgo(v.publishedAt)}</span></div>
    </div>
  </a>`;
}
// Small vertical card for a reel.
export function reelCard(v) {
  const cat = app.catalog; const show = cat.show(v.showId);
  return html`<a class="card card-reel" href="#/reels/${v.id}" aria-label="${cat.displayTitle(v)}">
    <div class="thumb">${ytImg(v, cat.displayTitle(v))}<span class="play-overlay">${icon('play', { size: 20 })}</span>
    <span class="chip chip-dur">${fmtDuration(v.duration)}</span></div>
    <div class="card-body"><div class="card-title">${cat.displayTitle(v)}</div>${show ? html`<div class="card-meta"><span>${show.titleEn || show.title}</span></div>` : ''}</div>
  </a>`;
}
// Card for an upcoming title.
export function soonCard(u) {
  return html`<a class="card card-poster card-soon" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title} — coming soon">
    <div class="poster">${img(u.poster, u.title)}<span class="chip chip-soon">Coming soon</span></div>
  </a>`;
}
// Photo tile that opens the lightbox.
export function galleryCard(g, i) {
  return html`<button type="button" class="card card-gallery" data-lightbox="${g.id}" aria-label="Open photo ${i + 1}"><div class="poster">${img(g.image, g.caption || g.group + ' behind the scenes')}</div></button>`;
}

/* ---------- rails ---------- */
// A horizontal scrolling row with a heading and a "See all" link.
export function rail({ title, subtitle = '', items = [], href = '', linkLabel = 'See all', cls = '', id = '' }) {
  if (!items.length) return html``;
  return html`<section class="rail ${cls}" ${id ? raw(`id="${esc(id)}"`) : ''} aria-label="${title}">
    <div class="rail-head"><div><h2>${title}</h2>${subtitle ? html`<p class="rail-sub">${subtitle}</p>` : ''}</div>
      ${href ? html`<a class="see-all" href="${href}">${linkLabel} ${icon('right', { size: 16 })}</a>` : ''}</div>
    <div class="rail-wrap">
      <button type="button" class="rail-arrow left" data-rail-dir="-1" aria-label="Scroll left" disabled>${icon('left', { size: 22 })}</button>
      <div class="rail-track" role="list">${items.map((x) => html`<div class="rail-item" role="listitem">${x}</div>`)}</div>
      <button type="button" class="rail-arrow right" data-rail-dir="1" aria-label="Scroll right">${icon('right', { size: 22 })}</button>
    </div>
  </section>`;
}
// Wire up the left/right scroll buttons of every rail under `root` (enable/disable at the ends).
export function enhanceRails(root) {
  root.querySelectorAll('.rail-track').forEach((track) => {
    const wrap = track.parentElement; const l = wrap.querySelector('.left'); const r = wrap.querySelector('.right');
    const upd = () => { l.disabled = track.scrollLeft < 4; r.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; wrap.classList.toggle('no-scroll', track.scrollWidth <= track.clientWidth + 4); };
    track.addEventListener('scroll', upd, { passive: true }); new ResizeObserver(upd).observe(track); upd();
  });
}
export function scrollRail(btn) {
  const track = btn.parentElement.querySelector('.rail-track');
  track.scrollBy({ left: Number(btn.dataset.railDir) * track.clientWidth * 0.85, behavior: 'smooth' });
}

/* ---------- misc ---------- */
// Round profile avatar: the first letter of the name on the profile's colour.
export function avatar(profile, { size = 36, cls = '' } = {}) {
  const c = avatarColor(profile?.color); const ch = (profile?.name || '?').trim().charAt(0).toUpperCase();
  return html`<span class="avatar ${cls}" style="--av:${c};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px" aria-hidden="true">${ch}</span>`;
}
// Small "a · b · c" line; empty parts are dropped.
export function metaLine(parts) {
  return html`<div class="meta-line">${parts.filter(Boolean).map((p, i) => html`${i ? html`<span class="dot" aria-hidden="true"></span>` : ''}<span>${p}</span>`)}</div>`;
}
export function showMeta(s) {
  const n = app.catalog.episodes(s.id).length;
  return metaLine([s.year, (s.genres || []).join(' · '), n ? `${n} episode${n > 1 ? 's' : ''}` : '', s.language]);
}
// Friendly placeholder for empty lists and errors.
export function emptyState({ iconName = 'film', title, text = '', action = '' }) {
  return html`<div class="empty">${icon(iconName, { size: 44 })}<h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
// Page/section heading with optional tag and subtitle.
export function sectionHeader({ tag = '', title, subtitle = '' }) {
  return html`<header class="page-head">${tag ? html`<div class="eyebrow">${tag}</div>` : ''}<h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</header>`;
}
export function runtimeOf(v) { return fmtRuntime(v.duration); }

/* ---------- toast ---------- */
// A toast is the small message bar at the bottom of the screen; showing a new one replaces the old one.
let toastTimer;
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const host = document.getElementById('toasts'); if (!host) return;
  host.innerHTML = '';
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.textContent = msg;
  if (action) { const b = document.createElement('button'); b.textContent = action; b.onclick = () => { onAction?.(); t.remove(); }; t.appendChild(b); }
  host.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, ms);
}
