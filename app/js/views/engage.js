/* Thumbs up/down and comments — small widgets mounted into the watch and show pages. They need the ADDABAAZ API and hide themselves without it. */
import { app } from '../app.js';
import { html, $, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { toast } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
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

/** The comment section under a video. */
export async function mountComments(box, { video }) {
  const u = app.user; if (!u.supportsAuth || !box) return;
  box.innerHTML = html`<section class="comments" aria-labelledby="cmH"><div class="section-bar"><h2 id="cmH">${icon('chat', { size: 20 })} Comments <span class="count" id="cmCount"></span></h2></div><div id="cmForm"></div><ul class="cm-list" id="cmList" aria-live="polite"></ul><div id="cmMore"></div></section>`.s;
  const list = $('#cmList', box), more = $('#cmMore', box);
  let total = 0, cursor = null;

  const item = (c) => html`<li class="cm" data-id="${c.id}"><div class="cm-av" aria-hidden="true">${(c.author || '?').slice(0, 1).toUpperCase()}</div><div class="cm-main"><div class="cm-head"><b>${c.author}</b><time datetime="${c.createdAt}">${timeAgo(c.createdAt)}</time></div><p>${c.body}</p>
    <div class="cm-actions">${c.mine ? html`<button type="button" class="linklike" data-del="${c.id}">Delete</button>` : u.account ? html`<button type="button" class="linklike" data-report="${c.id}">${icon('flag', { size: 13 })} Report</button>` : ''}</div></div></li>`;
  const load = async (append) => {
    try {
      const r = await u.remote.comments(video.id, { before: append ? cursor : undefined });
      total = append ? total : r.total;
      list.insertAdjacentHTML('beforeend', r.comments.map((c) => item(c).s).join(''));
      cursor = r.comments.at(-1)?.createdAt || cursor;
      $('#cmCount', box).textContent = total ? `(${total})` : '';
      more.innerHTML = r.comments.length >= 30 && list.children.length < total ? '<button type="button" class="btn btn-ghost" id="cmLoad">Show more comments</button>' : '';
      if (!list.children.length) list.innerHTML = '<li class="muted cm-empty">No comments yet — be the first.</li>';
    } catch (e) { list.innerHTML = `<li class="muted">${friendly(e)}</li>`; }
  };
  const form = $('#cmForm', box);
  if (u.isKids) form.innerHTML = '<p class="muted">Comments are turned off on Kids profiles.</p>';
  else if (!u.account) form.innerHTML = html`<p class="muted"><a href="#/signin?next=${encodeURIComponent('/watch/' + video.id)}">Sign in</a> to join the conversation.</p>`.s;
  else {
    form.innerHTML = html`<form class="cm-form form" novalidate><label class="sr-only" for="cmBody">Add a comment</label><textarea id="cmBody" name="body" rows="2" maxlength="1000" placeholder="Add a comment…"></textarea><div class="cm-row"><small class="muted">Be kind. No links or spam. ${icon('info', { size: 12 })}</small><button class="btn btn-primary btn-sm" type="submit">Post</button></div><div class="form-status" role="alert"></div></form>`.s;
    $('form', form).addEventListener('submit', async (e) => {
      e.preventDefault(); const ta = $('textarea', form), st = $('.form-status', form), body = ta.value.trim(); if (!body) return;
      const btn = $('button[type=submit]', form); btn.disabled = true; st.textContent = '';
      try {
        const r = await u.remote.addComment(video.id, body, u.activeId);
        ta.value = ''; total += 1; $('#cmCount', box).textContent = `(${total})`; $('.cm-empty', list)?.remove();
        list.insertAdjacentHTML('afterbegin', item(r.comment).s);
      } catch (err) { st.textContent = err.code === 'email_unverified' ? 'Please confirm your email first — check your inbox (or resend from Account).' : friendly(err); }
      btn.disabled = false;
    });
  }
  box.addEventListener('click', async (e) => {
    if (e.target.closest('#cmLoad')) { e.target.closest('#cmLoad').disabled = true; return load(true); }
    const d = e.target.closest('[data-del]'), r = e.target.closest('[data-report]');
    try {
      if (d && await confirmDialog({ title: 'Delete your comment?', confirm: 'Delete', danger: true })) { await u.remote.deleteComment(d.dataset.del); d.closest('.cm').remove(); total = Math.max(0, total - 1); $('#cmCount', box).textContent = total ? `(${total})` : ''; }
      if (r && await confirmDialog({ title: 'Report this comment?', text: 'Comments reported by several people are hidden until a moderator reviews them.', confirm: 'Report' })) { const res = await u.remote.reportComment(r.dataset.report); r.closest('.cm-actions').innerHTML = '<span class="muted">Thanks — reported.</span>'; if (res.hidden) r.closest('.cm')?.remove(); }
    } catch (err) { toast(friendly(err)); }
  });
  load(false);
}
