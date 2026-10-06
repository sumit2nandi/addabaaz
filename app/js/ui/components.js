// Reusable UI pieces (cards, rails, buttons, toasts) returned as safe HTML strings. Pages compose these instead of repeating markup.
import { app } from '../app.js';
import { html, raw, esc, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { avatarColor } from '../data/user.js';
import { confirmDialog } from './dialog.js';

// If an image fails to load, main.js's delegated handler reads data-fb to pick a fallback (inline
// onerror= scripts would be blocked by the site's Content-Security-Policy).

// <img> markup with lazy loading and the failure fallback above.
export function img(src, alt = '', { cls = '', lazy = true, fallback, priority = false } = {}) {
  return html`<img class="${cls}" src="${src}" alt="${alt}" data-fb="${fallback || ''}" ${lazy ? raw('loading="lazy" decoding="async"') : ''} ${priority ? raw('fetchpriority="high"') : ''}>`;
}
/** The breakpoint at which a banner swaps the poster in for the wide still. Kept here, beside the markup that
 *  acts on it, so the artwork popup can resolve exactly the picture the banner is showing at this moment. */
export const HERO_POSTER_MQ = '(max-width: 759px)';
/** Hero background. Wide screens get the landscape episode thumbnail; phones (portrait, < 760px) get the portrait show poster instead,
 *  because a 16:9 picture cropped into a tall phone screen shows only a thin slice of the middle (faces cut in half). */
export function heroBg(thumb, poster, { lazy = false, fallback } = {}) {
  const img = html`<img src="${thumb || poster}" alt="" data-fb="${fallback || ''}" ${lazy ? raw('loading="lazy" decoding="async"') : ''}>`;
  return poster ? html`<picture><source media="${HERO_POSTER_MQ}" srcset="${poster}">${img}</picture>` : img;
}
/**
 * Which artwork a `heroBg()` banner is showing right now: 'poster' on phones (the <picture> above swaps it in),
 * 'backdrop' on wider screens. The details page resolves this on every tap — never once at render time — so the
 * expand button and a tap on the banner open the picture actually on screen even after a rotation or a resize.
 * With a single picture (no still yet, or the same file serving as both) either id resolves to that picture.
 */
export function bannerArtMode({ poster = '', backdrop = '' } = {}) {
  if (!backdrop || backdrop === poster) return 'backdrop';
  return typeof window !== 'undefined' && window.matchMedia?.(HERO_POSTER_MQ)?.matches ? 'poster' : 'backdrop';
}
/** Card thumbnail. YouTube's default hqdefault is only 480x360 — upscaled into a card on a 2x phone that
 *  is visibly soft, which reads as "less vibrant" than the same frame on Facebook. So cards ask for
 *  sddefault (640x480, 78% more pixels) and data-fb drops them back to hqdefault when a video has no
 *  sddefault (YouTube omits it for some uploads). `object-fit: cover` turns either 4:3 rendition into a
 *  clean 16:9 or 9:16 crop. Falls back to video/show artwork for R2 videos without a separate thumbnail. */
export function ytImg(v, alt = '', { cls = '' } = {}) {
  const show = v?.showId ? app.catalog.show(v.showId) || app.catalog.soon(v.showId) : null;
  const hq = app.catalog.thumb(v, 'hqdefault');
  const src = app.catalog.thumb(v, 'sddefault') || hq || v?.poster || show?.backdrop || show?.posterLg || show?.poster || 'media/logo.webp';
  return img(src, alt, { cls, fallback: hq && hq !== src ? hq : '' });
}
// Subtle crown medallion used as the Premium mark on artwork, instead of a text pill over the image. The outline crown matches the crown line icon in menus and on Plans.
export function premiumMark({ cls = '' } = {}) {
  return html`<span class="premium-mark ${cls}" role="img" aria-label="Premium content" title="Premium content">
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M5.4 23.4 4 11.8l6.2 4.9L16 7.6l5.8 9.1 6.2-4.9-1.4 11.6Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/><path d="M7 27.6h18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>
  </span>`;
}

/* ---------- state-aware buttons (kept in sync globally by main.js) ---------- */
// "My List" and "Remind me" buttons render their current state; syncButtons() refreshes every one on the page when the state changes.
// My List is icon-only everywhere: the + becomes a ✓ in place, and the wording lives in the tooltip and the
// accessible name. `label` is that wording for the "add" state - the watch page can tell its two buttons
// apart ("Add show to My List" / "Save video"); it is never drawn as text on the button.
export function listBtn(type, id, { label = 'Add to My List', cls = 'btn btn-ghost icon-only' } = {}) {
  const on = app.user?.inList(type, id);
  const name = on ? 'Remove from My List' : label;
  return html`<button type="button" class="${cls} list-btn ${on ? 'on' : ''}" data-list="${type}:${id}" data-list-add="${label}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${name}" title="${name}">
    <span class="ic-off">${icon('plus', { size: 18 })}</span><span class="ic-on">${icon('check', { size: 18 })}</span></button>`;
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
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    // The wording is the button's only label, so keep it (per button) in step with the state.
    b.title = on ? 'Remove from My List' : (b.dataset.listAdd || 'Add to My List');
    b.setAttribute('aria-label', b.title);
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
    <div class="poster">${img(s.poster, s.title)}${s.access === 'premium' ? premiumMark() : ''}</div>
    <div class="card-quick">${listBtn('show', s.id, { cls: 'icon-btn' })}</div>
  </a>`;
}
// Thumbnail card for an episode/clip: a resume progress bar, Premium mark and optional rank number.
export function videoCard(v, { progress = true, rank = 0, showName = true, cls = '' } = {}) {
  const cat = app.catalog; const show = cat.show(v.showId);
  const frac = progress ? app.user?.fraction(v.id, v.duration) || 0 : 0;
  const rankEl = rank ? html`<span class="rank" aria-hidden="true">${rank}</span>` : '';
  const premium = cat.isPremium(v);   // the crown takes the top-left corner; the label chip moves beside it
  return html`<a class="card card-video ${rank ? 'ranked' : ''} ${cls}" href="#/watch/${v.id}" aria-label="${cat.displayTitle(v)}">
    ${rankEl}
    <div class="thumb">
      ${ytImg(v, cat.displayTitle(v))}
      <span class="chip chip-label ${premium ? 'chip-after-mark' : ''}">${cat.label(v)}</span>
      ${premium ? premiumMark() : ''}
      <span class="play-overlay">${icon('play', { size: 22 })}</span>
      ${frac > 0.01 ? html`<span class="progress"><i style="width:${Math.round(frac * 100)}%"></i></span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">${cat.displayTitle(v)}</div>
      <div class="card-meta">${showName && show ? html`<span>${show.titleEn || show.title}</span>` : ''}<span>${timeAgo(v.publishedAt)}</span></div>
    </div>
  </a>`;
}
// Small vertical card for a reel; public content cards never expose a runtime label.
export function reelCard(v) {
  const cat = app.catalog; const show = cat.show(v.showId);
  return html`<a class="card card-reel" href="#/reels/${v.id}" aria-label="${cat.displayTitle(v)}">
    <div class="thumb">${ytImg(v, cat.displayTitle(v))}${cat.isPremium(v) ? premiumMark() : ''}<span class="play-overlay">${icon('play', { size: 20 })}</span></div>
    <div class="card-body"><div class="card-title">${cat.displayTitle(v)}</div>${show ? html`<div class="card-meta"><span>${show.titleEn || show.title}</span></div>` : ''}</div>
  </a>`;
}
// Fixed portrait card for upcoming rails. The dedicated upcoming page uses adaptive portrait frames and preserves full artwork.
export function soonCard(u) {
  return html`<a class="card card-poster card-soon" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title} — coming soon">
    <div class="poster poster-soon">${img(u.poster, 'Coming soon poster', { cls: 'poster-soon-image' })}<span class="chip chip-soon">Coming soon</span></div>
  </a>`;
}
// Photo tile that opens the lightbox.
export function galleryCard(g, i) {
  return html`<button type="button" class="card card-gallery" data-lightbox="${g.id}" aria-label="Open photo ${i + 1}"><div class="poster">${img(g.image, g.caption || g.group + ' behind the scenes')}</div></button>`;
}

/**
 * Let a details-page poster keep its own shape instead of being forced into a fixed portrait box.
 *
 * The artwork admins upload is not all 2:3 — coming-soon posters are often 4:5 and some are 16:9 banners.
 * Filling a 2:3 box with those (`object-fit: cover`) threw away up to half the picture. Here the box takes
 * the image's own aspect ratio, clamped to a poster-like range: at most a little is cropped, and a wide
 * image is trimmed at the sides instead of losing most of its height. The whole picture is one tap away in
 * the lightbox (see `openPoster` in ui/lightbox.js).
 */
export function fitPoster(root) {
  for (const img of root.querySelectorAll('.detail-poster img')) {
    const set = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return;
      const box = img.closest('.detail-poster');
      if (box) box.style.setProperty('--poster-ar', String(Math.min(1.55, Math.max(0.68, w / h)).toFixed(4)));
    };
    if (img.complete && img.naturalWidth) set(); else img.addEventListener('load', set, { once: true });
  }
}

/* ---------- rails ---------- */
// A horizontal scrolling row with a heading and a "See all" link.
export function rail({ title, subtitle = '', items = [], href = '', linkLabel = 'See all', cls = '', id = '', hideHeading = false }) {
  if (!items.length) return html``;
  return html`<section class="rail ${cls}" ${id ? raw(`id="${esc(id)}"`) : ''} aria-label="${title}">
    ${hideHeading ? (href ? html`<div class="rail-head rail-head-minimal"><a class="see-all" href="${href}">${linkLabel} ${icon('right', { size: 16 })}</a></div>` : '') : html`<div class="rail-head"><div><h2>${title}</h2>${subtitle ? html`<p class="rail-sub">${subtitle}</p>` : ''}</div>
      ${href ? html`<a class="see-all" href="${href}">${linkLabel} ${icon('right', { size: 16 })}</a>` : ''}</div>`}
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
  // main-style row rise (its setupRowAnimations): home rails animate from translateY(40px) to place
  // the first time they scroll into view — the same motion main shows while the site loads.
  const rows = [...root.querySelectorAll('.rails-lean .rail')].filter((r) => !r.classList.contains('in-view'));
  if (!rows.length) return;
  if (typeof IntersectionObserver !== 'function') { rows.forEach((r) => r.classList.add('in-view')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
  }, { threshold: 0.06, rootMargin: '0px 0px -60px 0px' });
  rows.forEach((r) => io.observe(r));
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
export function showMeta(s, { maxGenres = Infinity } = {}) {
  const n = app.catalog.episodes(s.id).length;
  const genres = (s.genres || []).slice(0, maxGenres).join(' · ');
  return metaLine([s.year, genres, n ? `${n} episode${n > 1 ? 's' : ''}` : '', s.language]);
}
// Friendly placeholder for empty lists and errors.
export function emptyState({ iconName = 'film', title, text = '', action = '' }) {
  return html`<div class="empty">${icon(iconName, { size: 44 })}<h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
// Page/section heading with optional tag and subtitle.
export function sectionHeader({ tag = '', title, subtitle = '' }) {
  return html`<header class="page-head">${tag ? html`<div class="eyebrow">${tag}</div>` : ''}<h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</header>`;
}
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

/* ---------- confirmations ---------- */
/** The sign-out confirmation popup, shared by the profile menu and the Account page so the two
 *  "Sign out" buttons look and say exactly the same thing. Resolves true when the viewer confirms. */
export function confirmSignOut() {
  return confirmDialog({
    icon: 'logout',
    danger: true,
    title: 'Sign out of ADDABAAZ?',
    text: 'You can sign back in anytime — your My List and Continue Watching stay with your account.',
    confirm: 'Sign out',
  });
}
