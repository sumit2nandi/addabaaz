// Reels page (#/reels): a vertical, snap-scrolling feed where only the reel on screen plays (built muted for an instant start; main's unmute lifts bring the volume on).
import { app } from '../app.js';
import { html, $, $$, shareOrCopy } from '../util.js';
import { icon } from '../icons.js';
import { createPlayer, loadYouTube } from '../players/index.js';
import { img, toast, premiumMark } from '../ui/components.js';
import { shareUrl } from '../platform.js';

let soundOn = true;   // sticky: once the viewer unmutes, later reels start with sound
let muteHinted = false; // one-time toast when a browser forces autoplay muted

/* A long feed of full-screen snap sections is far heavier than it looks on a phone: every section carries a
 * cover image, a gradient caption overlay, a full-viewport box-shadow and an infinitely animating spinner,
 * plus the playing reel's video player. ~180 of those running at once exceeds what a budget phone's GPU/RAM
 * rasterises — the renderer gets killed a few seconds after the page opens (Chrome: "Can't open this page";
 * every browser on the same phone dies, desktop survives). Only sections near the current reel keep their
 * content; the rest stay empty shells that preserve the scroll layout and snap points. */
const KEEP_BEFORE = 2;   // mounted sections above the current one (swipe back is instant)
const KEEP_AFTER = 3;    // mounted sections ahead (their cover images are decoded by the time a swipe lands)

/* The cover fills the whole screen, so it should not be the 480x360 default YouTube thumbnail stretched over
 * a 1080px-wide phone. Ask for the largest rendition YouTube publishes (maxresdefault, 1280x720) and keep the
 * default as the fallback for uploads that do not have it (main.js swaps in data-fb when a source 404s). */
function reelCover(cat, v) {
  const max = cat.thumb(v, 'maxresdefault'), hq = cat.thumb(v, 'hqdefault');
  const show = cat.show(v.showId) || cat.soon(v.showId);
  const src = max || hq || v.poster || show?.posterLg || show?.poster || 'media/logo.webp';
  const fb = [hq, v.poster, show?.posterLg || show?.poster].find((u) => u && u !== src) || '';
  return { src, fallback: fb, low: cat.thumb(v, 'mqdefault') };
}

export default async function reels(ctx) {
  const cat = app.catalog;
  let list = cat.reels();
  const start = ctx.params.id && cat.video(ctx.params.id);
  if (start && !list.some((v) => v.id === start.id)) list = [start, ...list];
  let startIdx = Math.max(0, list.findIndex((v) => v.id === ctx.params.id));
  // Fetch the YouTube IFrame API while the feed renders — on mobile networks the script + handshake is the
  // slowest part of the first reel starting, so begin it before the player ever asks for it.
  if (list.some((v) => v.source?.type === 'youtube' && app.user.gateFor(v, cat) === 'ok')) loadYouTube().catch(() => {});
  // A reel hosted in R2 needs a signed URL before its player can start; overlap that request with page render.
  const streamMedia = new Map();
  const prepareMedia = (v) => {
    if (v.source?.type !== 'r2') return Promise.resolve(v);
    if (!streamMedia.has(v.id)) {
      const pending = Promise.resolve().then(() => app.user.streamUrl(v)).then((st) => ({ ...v, source: { type: st.type, url: st.url }, poster: cat.thumb(v) })).catch((err) => { streamMedia.delete(v.id); throw err; });
      streamMedia.set(v.id, pending);
    }
    return streamMedia.get(v.id);
  };
  const firstReel = list[startIdx];
  if (firstReel?.source?.type === 'r2' && app.user.gateFor(firstReel, cat) === 'ok') prepareMedia(firstReel).catch(() => {});
  ctx.setTitle('Reels');
  document.body.classList.add('reels-mode'); ctx.onCleanup(() => document.body.classList.remove('reels-mode'));

  // The per-reel content (cover, tap layer, caption, action buttons) — injected only while the section is near
  // the current one, removed again when it scrolls out of the keep-window.
  const contentHtml = (v, i) => { const show = cat.show(v.showId) || cat.soon(v.showId); const cover = reelCover(cat, v); return html`
    <div class="reel-frame ${cat.isPremium(v) ? 'has-premium' : ''}">
      <div class="reel-slot">${img(cover.src, '', { fallback: cover.fallback, lowSrc: cover.low, lazy: i > 2 && i !== startIdx, priority: i === startIdx })}<div class="reel-loading"><div class="spinner"></div></div></div>
      ${cat.isPremium(v) ? premiumMark() : ''}
      <button type="button" class="reel-tap" data-reel-tap aria-label="Play or pause"><span class="reel-pp">${icon('play', { size: 34 })}</span></button>
      <div class="reel-caption"><strong>${cat.displayTitle(v)}</strong>${show ? html`<a href="#/${cat.show(v.showId) ? 'show' : 'soon'}/${show.id}">${show.titleEn || show.title}</a>` : html`<span>ADDABAAZ</span>`}</div>
    </div>
    <div class="reel-actions">
      <button type="button" class="icon-btn big" data-reel-sound aria-label="Toggle sound">${icon(soundOn ? 'volume' : 'mute', { size: 26 })}</button>
      <button type="button" class="icon-btn big" data-reel-share="${v.id}" aria-label="Share">${icon('share', { size: 26 })}</button>
      ${show && cat.show(v.showId) ? html`<a class="icon-btn big" href="#/show/${show.id}" aria-label="Open show">${icon('tv', { size: 26 })}</a>` : ''}
    </div>`.s; };
  const gateHtml = (v, state) => {
    const next = encodeURIComponent(`/reels/${v.id}`);
    if (state === 'login') return html`<div class="reel-gate" role="status" aria-live="polite"><div>
      ${icon('lock', { size: 38 })}<h2>Sign In to Watch</h2><p>This is ADDABAAZ Premium. Sign in or create a free account to watch this reel.</p>
      <div class="row"><a class="btn btn-primary" href="#/signin?next=${next}">Sign In</a><a class="btn btn-glass" href="#/signup?next=${next}">Create Account</a></div>
    </div></div>`;
    if (state === 'plan') return html`<div class="reel-gate" role="status" aria-live="polite"><div>
      ${icon('lock', { size: 38 })}<h2>ADDABAAZ <em class="premium-word">premium</em> exclusive</h2><p>This reel needs an active paid plan.</p>
      <a class="btn btn-primary" href="#/plans?next=${next}">${icon('crown', { size: 18 })} See plans</a>
    </div></div>`;
    return html`<div class="reel-gate" role="status" aria-live="polite"><div>
      ${icon('lock', { size: 38 })}<h2>Premium Reel Needs an Account</h2><p>Sign-in and plan checks need the ADDABAAZ API.</p>
      <a class="btn btn-glass" href="#/">Back to Home</a>
    </div></div>`;
  };

  ctx.root.innerHTML = html`<div class="reels-feed" id="feed" tabindex="0" aria-label="Reels feed. Use arrow keys to move between reels.">
    ${list.map((v, i) => html`<section class="reel" data-i="${i}" aria-label="${cat.displayTitle(v)}"></section>`)}
  </div>`.s;

  const feed = $('#feed', ctx.root), sections = $$('.reel', feed);
  const mounted = new Set();
  const mount = (i) => { if (i >= 0 && i < sections.length && !mounted.has(i)) { mounted.add(i); sections[i].innerHTML = contentHtml(list[i], i); } };
  const keepWindow = (center) => {
    for (let i = Math.max(0, center - KEEP_BEFORE); i <= Math.min(sections.length - 1, center + KEEP_AFTER); i++) mount(i);
    for (const i of [...mounted]) if (i < center - KEEP_BEFORE || i > center + KEEP_AFTER) { mounted.delete(i); sections[i].innerHTML = ''; }
  };
  keepWindow(startIdx);

  // While a reel plays, warm what the next ones will need so a swipe starts them without waiting: the cover image,
  // the signed stream address (R2), and the HLS engine. The next reel gets everything; the one after gets its cover.
  const warmed = new Set();
  const warmReel = (j, full) => {
    if (j < 0 || j >= list.length || warmed.has(j)) return;
    const v = list[j];
    const cover = reelCover(cat, v);
    if (cover.src) { const pic = new Image(); pic.decoding = 'async'; pic.src = cover.src; }
    if (!full) return;
    warmed.add(j);
    if (app.user.gateFor(v, cat) !== 'ok') return;
    if (v.source?.type === 'r2') prepareMedia(v).then((media) => import('../players/html5.js').then((m) => m.prepareHtml5Player(media.source))).catch(() => {});
    else if (v.source?.type === 'hls') import('../players/html5.js').then((m) => m.prepareHtml5Player(v.source)).catch(() => {});
  };
  // A reel that fails to start is retried while it is still on screen. The feed only re-activates a reel when it
  // scrolls back into view, so without this a single failed start left the reel stuck until a page refresh.
  const RETRY_MS = [1500, 4000, 9000];
  const tries = new Map();
  const retryLater = (i, my) => {
    const n = tries.get(i) || 0;
    if (n >= RETRY_MS.length) return false;
    tries.set(i, n + 1);
    setTimeout(() => { if (active === i && token === my) activate(i, true); }, RETRY_MS[n]);
    return true;
  };
  let active = -1, ctl = null, host = null, token = 0, hasPlayed = false, revealTimer = null;
  /* The player stays transparent until its first frame arrives (onState 'playing'), so the cover image
   * covers the otherwise black iframe. An embed that starts but never reports that state (a slow or
   * API-less YouTube frame) would look like a dead reel: reveal it anyway after a short grace period. */
  const armReveal = (i, my) => {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { if (active === i && token === my) sections[i]?.classList.add('video-on'); }, 2500);
  };
  const setIcon = (sec) => { const b = $('[data-reel-sound]', sec); if (b) b.innerHTML = icon(soundOn ? 'volume' : 'mute', { size: 26 }).s; };
  async function activate(i, force = false) {
    if (!force && i === active) return;
    if (i < 0 || i >= sections.length) return;
    keepWindow(i);
    warmReel(i + 1, true);
    warmReel(i + 2, false);
    active = i; hasPlayed = false; const my = ++token;
    if (ctl) { ctl.destroy(); host?.remove(); ctl = null; sections.forEach((s) => s.classList.remove('playing', 'paused', 'video-on')); }
    const sec = sections[i], slot = $('.reel-slot', sec), frame = $('.reel-frame', sec); const v = list[i];
    if (!slot || !frame) return;   // section shell lost its content (window pruned mid-scroll): ignore this activation
    sec.querySelector('.reel-gate')?.remove(); sec.classList.remove('locked');   // re-checked: clear an earlier lock
    const access = app.user.gateFor(v, cat);
    if (access !== 'ok') {
      sec.classList.add('locked');
      frame.insertAdjacentHTML('beforeend', gateHtml(v, access).s);
      return;
    }
    const h = document.createElement('div'); h.className = 'reel-player'; slot.appendChild(h);   // poster stays underneath
    let started = false;
    try {
      const media = v.source.type === 'r2' ? await prepareMedia(v) : v;
      if (my !== token) { h.remove(); return; }
      const c = await createPlayer(h, media, {
        autoplay: true, muted: !soundOn, controls: false,
        onEnded: () => sections[i + 1]?.scrollIntoView({ behavior: 'smooth' }),
        onState: (st) => {
          if (my !== token) return;
          if (st === 'playing') {
            hasPlayed = true;
            tries.delete(i);
            sec.classList.remove('paused');
            sec.classList.add('video-on');   // first frame: the video replaces the thumbnail
            if (!started) { started = true; app.user?.remote?.playEvent(v.id, 'start'); }
          } else if (st === 'paused' && hasPlayed) sec.classList.add('paused'); // Ignore an initial PAUSED event before autoplay starts.
        },
        // The player starts muted for instant motion and lifts the mute on main's 600/1500/3000ms
        // schedule; if it is STILL muted by then, the reel runs muted, the sound button must say so,
        // and a one-time pill tells the viewer exactly how to get sound back.
        onAutoplayMuted: () => {
          if (my !== token) return;
          soundOn = false; sections.forEach(setIcon);
          if (!muteHinted) {
            muteHinted = true;
            const b = document.createElement('button'); b.type = 'button'; b.className = 'unmute-pill reel-unmute';
            b.innerHTML = icon('mute', { size: 18 }).s + '<span>Tap for Sound</span>';
            b.onclick = () => { soundOn = true; if (ctl) ctl.unmute(); sections.forEach(setIcon); b.remove(); };
            sec.querySelector('.reel-frame')?.appendChild(b);
            setTimeout(() => b.remove(), 6000);
          }
        },
        // First gesture auto-unmuted this reel: sync the sound button and drop the tap-for-sound hint.
        onGestureUnmuted: () => { if (my !== token) return; soundOn = true; sections.forEach(setIcon); sec.querySelector('.unmute-pill')?.remove(); },
        onAutoplayBlocked: () => { if (my === token) sec.classList.add('paused'); },   // shows the big play glyph: one tap starts it
      });
      if (my !== token) { c.destroy(); h.remove(); return; }
      ctl = c; host = h; sec.classList.add('playing');
      armReveal(i, my);   // safety net: never leave the cover over a player that is running
    } catch (e) {
      h.remove(); console.warn('[Reels] Error:', e);
      const locked = e?.status === 401 || e?.status === 402;
      // Only genuine browser autoplay rejections get the friendly "tap to play" treatment.
      const isAutoplayError = e?.name === 'NotAllowedError' || e?.name === 'AbortError' || /autoplay/i.test(e?.message || '');
      if (isAutoplayError) {
        sec.classList.add('paused');   // shows the big play glyph: one tap starts it with sound
        return;
      }
      if (!locked && retryLater(i, my)) return;   // try again shortly while this reel is still on screen
      toast(e?.status === 401 ? 'Sign in to watch this premium reel.' : e?.status === 402 ? 'This reel needs an active plan.' : 'Could not load this reel. Check connection.');
      if (locked) sec.classList.add('paused');
    }
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting && en.intersectionRatio > 0.65) activate(+en.target.dataset.i); });
  }, { root: feed, threshold: [0.65] });
  sections.forEach((s) => io.observe(s));
  // Account and plan data can arrive after the first reel was checked: a reel locked before then unlocks now.
  const unlockWhenAccountChanges = () => { if (active >= 0 && sections[active]?.classList.contains('locked')) activate(active, true); };
  const offAccount = [app.user.on('account', unlockWhenAccountChanges), app.user.on('subscription', unlockWhenAccountChanges)];
  ctx.onCleanup(() => { io.disconnect(); token++; clearTimeout(revealTimer); ctl?.destroy(); host?.remove(); offAccount.forEach((off) => off()); });

  feed.addEventListener('click', async (e) => {
    if (e.target.closest('[data-reel-tap]')) {
      // Tap = play/pause (the tap layer also lets a swipe scroll the feed even when the finger starts on the video).
      const sec = e.target.closest('.reel'); if (sections[active] !== sec) return;
      if (!ctl) { activate(active, true); return; }   // the player never started: a tap tries again
      if (!hasPlayed || sec.classList.contains('paused')) { Promise.resolve(ctl.play()).catch(() => {}); sec.classList.remove('paused'); } else { ctl.pause(); sec.classList.add('paused'); }
      return;
    }
    if (e.target.closest('[data-reel-sound]')) {
      soundOn = !soundOn; if (ctl) (soundOn ? ctl.unmute() : ctl.mute()); sections.forEach(setIcon);
    }
    const sh = e.target.closest('[data-reel-share]');
    if (sh) { const r = await shareOrCopy({ title: cat.displayTitle(cat.video(sh.dataset.reelShare)), url: shareUrl('/reels/' + sh.dataset.reelShare) }); if (r === 'copied') toast('Link Copied'); }
  });
  feed.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sections[Math.max(0, Math.min(sections.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)))]?.scrollIntoView({ behavior: 'smooth' }); }
  });
  requestAnimationFrame(() => {
    sections[startIdx]?.scrollIntoView({ block: 'start' });
    feed.focus({ preventScroll: true });
    activate(startIdx); // don't wait for IntersectionObserver on a direct /reels/:id deep link
  });
}
