// Reels page (#/reels): a vertical, snap-scrolling feed where only the reel on screen plays (sound is muted until the viewer unmutes once).
import { app } from '../app.js';
import { html, $, $$, shareOrCopy } from '../util.js';
import { icon } from '../icons.js';
import { createPlayer } from '../players/index.js';
import { img, toast } from '../ui/components.js';
import { shareUrl } from '../platform.js';

let soundOn = false;   // sticky: once the viewer unmutes, later reels start with sound

export default async function reels(ctx) {
  const cat = app.catalog;
  let list = cat.reels();
  const start = ctx.params.id && cat.video(ctx.params.id);
  if (start && !list.some((v) => v.id === start.id)) list = [start, ...list];
  let startIdx = Math.max(0, list.findIndex((v) => v.id === ctx.params.id));
  ctx.setTitle('Reels');
  document.body.classList.add('reels-mode'); ctx.onCleanup(() => document.body.classList.remove('reels-mode'));

  ctx.root.innerHTML = html`<div class="reels-feed" id="feed" tabindex="0" aria-label="Reels feed. Use arrow keys to move between reels.">
    ${list.map((v, i) => { const show = cat.show(v.showId) || cat.soon(v.showId); return html`
      <section class="reel" data-i="${i}" aria-label="${cat.displayTitle(v)}">
        <div class="reel-frame">
          <div class="reel-slot">${img(cat.thumb(v), '', { lazy: i > 2 })}<div class="reel-loading"><div class="spinner"></div></div></div>
          <button type="button" class="reel-tap" data-reel-tap aria-label="Play or pause"><span class="reel-pp">${icon('play', { size: 34 })}</span></button>
          <div class="reel-caption"><strong>${cat.displayTitle(v)}</strong>${show ? html`<a href="#/${cat.show(v.showId) ? 'show' : 'soon'}/${show.id}">${show.titleEn || show.title}</a>` : html`<span>ADDABAAZ</span>`}</div>
        </div>
        <div class="reel-actions">
          <button type="button" class="icon-btn big" data-reel-sound aria-label="Toggle sound">${icon(soundOn ? 'volume' : 'mute', { size: 26 })}</button>
          <button type="button" class="icon-btn big" data-reel-share="${v.id}" aria-label="Share">${icon('share', { size: 26 })}</button>
          ${show && cat.show(v.showId) ? html`<a class="icon-btn big" href="#/show/${show.id}" aria-label="Open show">${icon('tv', { size: 26 })}</a>` : ''}
        </div>
      </section>`; })}
  </div>`.s;

  const feed = $('#feed', ctx.root), sections = $$('.reel', feed);
  let active = -1, ctl = null, host = null, token = 0;
  const setIcon = (sec) => { const b = $('[data-reel-sound]', sec); if (b) b.innerHTML = icon(soundOn ? 'volume' : 'mute', { size: 26 }).s; };
  async function activate(i) {
    if (i === active || i < 0 || i >= sections.length) return;
    active = i; const my = ++token;
    if (ctl) { ctl.destroy(); host?.remove(); ctl = null; sections.forEach((s) => s.classList.remove('playing', 'paused')); }
    const sec = sections[i], slot = $('.reel-slot', sec); const v = list[i];
    const h = document.createElement('div'); h.className = 'reel-player'; slot.appendChild(h);   // poster stays underneath
    try {
      let media = v;
      if (v.source.type === 'r2') {                    // premium reel: the API checks login + plan and signs a short-lived URL
        const st = await app.user.streamUrl(v);
        media = { ...v, source: { type: st.type, url: st.url }, poster: cat.thumb(v) };
      }
      if (my !== token) { h.remove(); return; }
      const c = await createPlayer(h, media, {
        autoplay: true, muted: !soundOn, controls: false,
        onEnded: () => sections[i + 1]?.scrollIntoView({ behavior: 'smooth' }),
        onState: (st) => { if (my !== token) return; if (st === 'playing') sec.classList.remove('paused'); else if (st === 'paused') sec.classList.add('paused'); },
        // Phones refuse autoplay with sound: the reel runs muted, and the sound button must say so.
        onAutoplayMuted: () => { if (my !== token) return; soundOn = false; sections.forEach(setIcon); },
        onAutoplayBlocked: () => { if (my === token) sec.classList.add('paused'); },   // shows the big play glyph: one tap starts it
      });
      if (my !== token) { c.destroy(); h.remove(); return; }
      ctl = c; host = h; sec.classList.add('playing');
    } catch (e) {
      h.remove(); console.warn(e);
      const locked = e?.status === 401 || e?.status === 402;
      toast(e?.status === 401 ? 'Sign in to watch this premium reel.' : e?.status === 402 ? 'This reel needs an active plan.' : 'Could not load this reel.');
      if (locked) sec.classList.add('paused');
    }
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting && en.intersectionRatio > 0.65) activate(+en.target.dataset.i); });
  }, { root: feed, threshold: [0.65] });
  sections.forEach((s) => io.observe(s));
  ctx.onCleanup(() => { io.disconnect(); token++; ctl?.destroy(); host?.remove(); });

  feed.addEventListener('click', async (e) => {
    if (e.target.closest('[data-reel-tap]')) {
      // Tap = play/pause (the tap layer also lets a swipe scroll the feed even when the finger starts on the video).
      const sec = e.target.closest('.reel'); if (!ctl || sections[active] !== sec) return;
      if (sec.classList.contains('paused')) { Promise.resolve(ctl.play()).catch(() => {}); sec.classList.remove('paused'); } else { ctl.pause(); sec.classList.add('paused'); }
      return;
    }
    if (e.target.closest('[data-reel-sound]')) {
      soundOn = !soundOn; if (ctl) (soundOn ? ctl.unmute() : ctl.mute()); sections.forEach(setIcon);
    }
    const sh = e.target.closest('[data-reel-share]');
    if (sh) { const r = await shareOrCopy({ title: cat.displayTitle(cat.video(sh.dataset.reelShare)), url: shareUrl('/reels/' + sh.dataset.reelShare) }); if (r === 'copied') toast('Link copied'); }
  });
  feed.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sections[Math.max(0, Math.min(sections.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))]?.scrollIntoView({ behavior: 'smooth' }); }
  });
  requestAnimationFrame(() => { sections[startIdx]?.scrollIntoView({ block: 'start' }); feed.focus({ preventScroll: true }); if (startIdx === 0) activate(0); });
}
