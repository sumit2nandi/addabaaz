import { html, $, esc } from '../util.js';
import { icon } from '../icons.js';

/** Full-screen photo viewer: arrows, keyboard, swipe, focus trap. */
export function openLightbox(items, startId) {
  let i = Math.max(0, items.findIndex((g) => g.id === startId));
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'lightbox'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Photo viewer');
  root.innerHTML = html`<button class="lb-close icon-btn" aria-label="Close">${icon('x', { size: 26 })}</button>
    <button class="lb-nav lb-prev icon-btn" aria-label="Previous photo">${icon('left', { size: 30 })}</button>
    <figure><img alt=""><figcaption></figcaption></figure>
    <button class="lb-nav lb-next icon-btn" aria-label="Next photo">${icon('right', { size: 30 })}</button>`.s;
  document.body.appendChild(root); document.body.classList.add('no-scroll');
  const im = $('img', root), cap = $('figcaption', root);
  const show = (n) => {
    i = (n + items.length) % items.length; const g = items[i];
    im.classList.add('loading'); im.onload = () => im.classList.remove('loading');
    im.src = g.imageLg || g.image; im.alt = g.caption || `${g.group} behind the scenes`;
    cap.textContent = `${g.group} · ${i + 1} / ${items.length}`;
    [items[(i + 1) % items.length], items[(i - 1 + items.length) % items.length]].forEach((x) => { new Image().src = x.imageLg || x.image; });
  };
  let popped = false;
  const onPop = () => { popped = true; close(); };
  const close = () => { if (root.isConnected === false) return; window.removeEventListener('popstate', onPop); if (!popped) { popped = true; history.back(); } root.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', key); prevFocus?.focus?.(); };
  const key = (e) => {
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1);
    else if (e.key === 'Tab') { const f = [...root.querySelectorAll('button')]; const a = document.activeElement; if (e.shiftKey && a === f[0]) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && a === f.at(-1)) { e.preventDefault(); f[0].focus(); } }
  };
  document.addEventListener('keydown', key);
  root.addEventListener('click', (e) => { if (e.target.closest('.lb-close') || e.target === root) close(); else if (e.target.closest('.lb-next')) show(i + 1); else if (e.target.closest('.lb-prev')) show(i - 1); });
  let x0 = null;
  root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 50) show(i + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  show(i); $('.lb-close', root).focus();
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', onPop, { once: true });
}
