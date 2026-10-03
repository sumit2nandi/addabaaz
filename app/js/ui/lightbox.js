/* Full-screen viewer: the photo gallery's lightbox, and the "tap the poster to see it whole" popup.
 *
 * One item = a single image (the poster on a details page): the arrows are hidden and the caption is just
 * the label. Several items = the gallery viewer, with arrows, keyboard, swipe and a 1 / n counter.
 */
import { html, $ } from '../util.js';
import { icon } from '../icons.js';

/** Full-screen image viewer for a list of `{ id, image, imageLg, caption, group }` items. */
export function openLightbox(items, startId, { label = 'Image viewer' } = {}) {
  const many = items.length > 1;
  let i = Math.max(0, items.findIndex((g) => g.id === startId));
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'lightbox'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', label);
  root.innerHTML = html`<button class="lb-close icon-btn" aria-label="Close">${icon('x', { size: 26 })}</button>
    ${many ? html`<button class="lb-nav lb-prev icon-btn" aria-label="Previous image">${icon('left', { size: 30 })}</button>` : ''}
    <figure><img alt=""><figcaption></figcaption></figure>
    ${many ? html`<button class="lb-nav lb-next icon-btn" aria-label="Next image">${icon('right', { size: 30 })}</button>` : ''}`.s;
  document.body.appendChild(root); document.body.classList.add('no-scroll');
  const im = $('img', root), cap = $('figcaption', root);
  const show = (n) => {
    i = (n + items.length) % items.length; const g = items[i];
    im.classList.add('loading'); im.onload = () => im.classList.remove('loading');
    im.src = g.imageLg || g.image; im.alt = g.caption || g.group || '';
    // One image: just its label (a poster has no "1 / 1"). Several: the group and the position.
    cap.textContent = many ? `${g.group || ''}${g.group && g.caption ? ' · ' : ''}${g.caption || ''}${g.caption || g.group ? ' · ' : ''}${i + 1} / ${items.length}`.trim()
      : (g.caption || g.group || '');
    [items[(i + 1) % items.length], items[(i - 1 + items.length) % items.length]].forEach((x) => { if (x) new Image().src = x.imageLg || x.image; });
  };
  // The browser Back button closes the viewer (a history entry is pushed while open).
  let popped = false;
  const onPop = () => { popped = true; close(); };
  const close = () => { if (root.isConnected === false) return; window.removeEventListener('popstate', onPop); if (!popped) { popped = true; history.back(); } root.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', key); prevFocus?.focus?.(); };
  const key = (e) => {
    if (e.key === 'Escape') close(); else if (many && e.key === 'ArrowRight') show(i + 1); else if (many && e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === 'Tab') { const f = [...root.querySelectorAll('button')]; const a = document.activeElement; if (e.shiftKey && a === f[0]) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && a === f.at(-1)) { e.preventDefault(); f[0].focus(); } }
  };
  document.addEventListener('keydown', key);
  root.addEventListener('click', (e) => { if (e.target.closest('.lb-close') || e.target === root) close(); else if (e.target.closest('.lb-next')) show(i + 1); else if (e.target.closest('.lb-prev')) show(i - 1); });
  // Touch swipe: remember where the finger went down, compare on release.
  let x0 = null;
  root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => { if (many && x0 != null && Math.abs(e.clientX - x0) > 50) show(i + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  show(i); $('.lb-close', root).focus();
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', onPop, { once: true });
}

/**
 * The images a title's artwork popup shows, each once: the banner still the page displays ("Artwork") and
 * the poster ("Poster"). Used by the banner tap, the poster box and the expand button.
 */
export function artworkItems({ poster = '', backdrop = '' } = {}) {
  const items = [];
  if (backdrop) items.push({ id: 'backdrop', image: backdrop, imageLg: backdrop, caption: 'Artwork' });
  if (poster && poster !== backdrop) items.push({ id: 'poster', image: poster, imageLg: poster, caption: 'Poster' });
  return items;
}

/**
 * Show a title's artwork full-size on a dark backdrop — never cropped and never squeezed into the page's
 * own poster box. `start` is 'backdrop' (what the banner shows) or 'poster'; when there is only one image
 * the popup has no arrows. A title with no artwork at all opens nothing.
 */
export function openArtwork({ title = '', poster = '', backdrop = '' } = {}, start = 'backdrop') {
  const items = artworkItems({ poster, backdrop });
  if (!items.length) return;
  const at = items.some((x) => x.id === start) ? start : items[0].id;
  openLightbox(items, at, { label: title ? `${title} — artwork` : 'Artwork' });
}

/**
 * The details page's banner is a tap target for the same popup. On a phone the poster box is hidden, so the
 * still the page is showing IS the poster the viewer wants to see whole; on a desktop this simply adds a
 * second, larger way in. Clicks on buttons, links and form fields belong to those controls, and a click that
 * ends a text selection is ignored.
 */
export function tapArtwork(hero, art) {
  hero?.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, textarea, label')) return;
    if (String(window.getSelection?.() || '').trim()) return;
    openArtwork(art, 'backdrop');
  });
}
