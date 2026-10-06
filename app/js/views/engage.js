/* Small rating widget mounted into watch and show pages. It needs the ADDABAAZ API and hides itself without it. */
import { app } from '../app.js';
import { html } from '../util.js';
import { icon } from '../icons.js';
import { toast } from '../ui/components.js';
import { go } from '../router.js';
import { friendly } from '../errors.js';

// 1234 -> "1.2K".
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n));

/** 👍 12  👎 1 — anyone can see the counts; signing in (with a profile) lets you vote. */
export async function mountRating(box, { type, id, label = '' }) {
  const u = app.user; if (!u.supportsAuth || !box) return;
  let counts = { up: 0, down: 0 };
  try { counts = await u.remote.ratingCounts(type, id); } catch { return; }
  if (!box.isConnected) return;
  const draw = () => {
    const mine = u.ratingOf(type, id);
    box.innerHTML = html`<span class="rate" role="group" aria-label="${label ? `Rate ${label}` : 'Rate this'}">
      <button type="button" class="btn btn-ghost rate-btn ${mine === 1 ? 'on' : ''}" data-v="1" aria-pressed="${mine === 1}" aria-label="Like">${icon('up', { size: 18, fill: mine === 1 })}<span>${counts.up ? compact(counts.up) : 'Like'}</span></button>
      <button type="button" class="btn btn-ghost rate-btn ${mine === -1 ? 'on' : ''}" data-v="-1" aria-pressed="${mine === -1}" aria-label="Dislike">${icon('down', { size: 18, fill: mine === -1 })}${counts.down ? html`<span>${compact(counts.down)}</span>` : ''}</button></span>`.s;
  };
  draw();
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (!u.account) { toast('Sign in to rate.', { action: 'Sign in', onAction: () => go('/signin?next=' + encodeURIComponent(location.pathname)) }); return; }
    if (!u.profile) { toast('Choose a profile first.'); return; }
    const v = Number(b.dataset.v), next = u.ratingOf(type, id) === v ? 0 : v;
    try { counts = await u.rate(type, id, next); draw(); } catch (err) { toast(friendly(err)); }
  });
}
