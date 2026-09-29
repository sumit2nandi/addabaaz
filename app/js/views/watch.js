// Video page (#/watch/:id): the player, episode list, likes, comments and "next episode" countdown.
// Premium videos are checked first (gateFor): signed out -> sign-in wall, no plan -> subscribe wall. Every view is a function of `ctx`
// (the router context: params, root element, setTitle, onCleanup).
import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { ApiError } from '../data/api.js';
import { html, $, fmtDate, fmtViews, fmtDuration, timeAgo, shareOrCopy } from '../util.js';
import { icon } from '../icons.js';
import { createPlayer } from '../players/index.js';
import { go } from '../router.js';
import { listBtn, videoCard, rail, enhanceRails, metaLine, toast, img } from '../ui/components.js';
import { epRow } from './show.js';
import { shareUrl, isNative } from '../platform.js';
import { mountRating, mountComments } from './engage.js';

// Renders the page, then starts the player and wires progress saving. Cleanup (timers, listeners) is registered with ctx.onCleanup.
export default async function watch(ctx) {
  const cat = app.catalog, u = app.user;
  const v = cat.video(ctx.params.id);
  if (!v) throw new Error('This video is not available.');
  const show = cat.show(v.showId), soon = !show && cat.soon(v.showId);
  const next = cat.nextEpisode(v);
  const title = cat.displayTitle(v);
  // Can this viewer play it? 'ok' | 'login' | 'plan' | 'unavailable' (premium in static mode).
  const gate = u.gateFor(v);                       // 'ok' | 'login' | 'plan' | 'unavailable'
  const here = encodeURIComponent('/watch/' + v.id);
  ctx.setTitle(title);

  // Right-hand list: all episodes for a series episode, otherwise related videos.
  const sideList = v.kind === 'episode' && show
    ? html`<div class="section-bar"><h2>Episodes</h2><span class="count">${cat.episodes(show.id).length}</span></div><div class="ep-list compact" id="sideEps">${cat.episodes(show.id).map((e) => epRow(e, { current: e.id === v.id }))}</div>`
    : html`<div class="section-bar"><h2>Up next</h2></div><div class="stack">${cat.relatedVideos(v, 12).map((x) => videoCard(x, { showName: false }))}</div>`;

  // Page markup (everything interpolated is auto-escaped by html``).
  ctx.root.innerHTML = html`
    <div class="watch">
      <div class="watch-main">
        <div class="player-box" id="playerBox">
          <div class="player-slot" id="playerSlot"></div>
          <div class="player-overlay" id="playerMsg" hidden></div>
          <div class="next-up" id="nextUp" hidden></div>
        </div>
        <div class="watch-info">
          <div class="crumbs">${show ? html`<a href="#/show/${show.id}">${icon('left', { size: 16 })} ${show.titleEn || show.title}</a>` : soon ? html`<a href="#/soon/${soon.id}">${icon('left', { size: 16 })} ${soon.titleEn || soon.title}</a>` : html`<a href="#/">${icon('left', { size: 16 })} Home</a>`}</div>
          <h1 class="watch-title">${title}</h1>
          ${metaLine([cat.label(v), fmtDate(v.publishedAt), `${fmtViews(v.views)} views`, fmtDuration(v.duration)])}
          <div class="watch-actions">
            ${show ? listBtn('show', show.id, { label: 'Add show to My List', cls: 'btn btn-ghost' }) : ''}
            ${listBtn('video', v.id, { label: 'Save video', cls: 'btn btn-ghost' })}
            ${next ? html`<a class="btn btn-ghost" href="#/watch/${next.id}">${icon('next', { size: 18 })} Next: ${cat.label(next)}</a>` : ''}
            <span id="rateBox" class="rate-box"></span>
            <button type="button" class="btn btn-ghost" id="castBtn" hidden>${icon('cast', { size: 18 })} Cast</button>
            <button type="button" class="btn btn-ghost" id="shareBtn">${icon('share', { size: 18 })} Share</button>
            <label class="switch" title="Play the next episode automatically"><input type="checkbox" id="autoNext" ${u.pref('autoplayNext') ? 'checked' : ''}><span class="track"></span><span>Autoplay next</span></label>
          </div>
          ${show ? html`<p class="watch-desc">${show.description}</p>` : ''}
          <details class="orig-title"><summary>Original title</summary><p class="bn">${v.title}</p></details>
        </div>
        <div id="commentsBox" class="watch-info"></div>
        ${rail({ title: 'More from ADDABAAZ', items: cat.latestEpisodes(10).filter((x) => x.id !== v.id).map((x) => videoCard(x)), cls: 'r-video mobile-only' })}
      </div>
      <aside class="watch-side" aria-label="${v.kind === 'episode' ? 'Episodes' : 'Up next'}">${sideList}</aside>
    </div>`.s;
  // Wire up interactive bits: rails, auto-play switch, share button, likes and comments.
  enhanceRails(ctx.root);
  $('#sideEps .current', ctx.root)?.scrollIntoView({ block: 'nearest' });

  $('#autoNext', ctx.root).addEventListener('change', (e) => u.setPref('autoplayNext', e.target.checked));
  $('#shareBtn', ctx.root).addEventListener('click', async () => {
    const r = await shareOrCopy({ title, text: `${title} — ADDABAAZ`, url: shareUrl('/watch/' + v.id) });
    if (r === 'copied') toast('Link copied');
  });

  mountRating($('#rateBox', ctx.root), { type: 'video', id: v.id, label: 'this video' });
  mountComments($('#commentsBox', ctx.root), { video: v });
  // The player area shows a message instead of the player when the viewer is locked out.
  const msg = $('#playerMsg', ctx.root), slot = $('#playerSlot', ctx.root);
  const wall = (kind) => {
    msg.hidden = false; slot.innerHTML = '';
    msg.innerHTML = kind === 'login'
      ? html`${icon('lock', { size: 40 })}<h2>Sign in to watch</h2><p>This is ADDABAAZ Premium. Sign in or create a free account to watch it — everything else on ADDABAAZ stays open to everyone.</p><div class="row"><a class="btn btn-primary btn-lg" href="#/signin?next=${here}">Sign in</a><a class="btn btn-ghost btn-lg" href="#/signup?next=${here}">Create account</a></div>`.s
      : kind === 'plan'
        ? isNative
          ? html`${icon('lock', { size: 40 })}<h2>ADDABAAZ Plus exclusive</h2><p>This title needs an active ADDABAAZ Plus plan. Plans are managed on the ADDABAAZ website — once you’ve subscribed with this account it unlocks here.</p><a class="btn btn-ghost btn-lg" href="#/">Back to home</a>`.s
          : html`${icon('lock', { size: 40 })}<h2>ADDABAAZ Plus exclusive</h2><p>You’re signed in — subscribe to watch this title and get early access to every new original.</p><a class="btn btn-primary btn-lg" href="#/plans?next=${here}">${icon('crown', { size: 20 })} See plans</a>`.s
        : html`${icon('lock', { size: 40 })}<h2>Premium video needs an account</h2><p>This copy of ADDABAAZ runs without the ADDABAAZ API, so premium titles can’t be unlocked here.</p><a class="btn btn-ghost btn-lg" href="#/">Back to home</a>`.s;
  };
  // Locked: show the wall and stop; no player is created.
  if (gate !== 'ok') { wall(gate); return; }

  /* ---------- playback + progress ---------- */
  // Resume where the viewer left off (unless they had almost finished).
  const prog = u.progressOf(v.id);
  const start = prog && prog.position >= CONFIG.resumeMinSeconds && !u.isFinished(v.id, v.duration) ? prog.position : 0;
  let ctl = null, lastSaved = 0, dead = false, countdown = null, lastT = start, lastD = v.duration;

  // Save watch position at most every 5 s (or immediately when `flush` is set, e.g. on pause or leaving the page).
  const persist = (t, d, flush = false) => {
    if (!(t > 0)) return; lastT = t; lastD = d || v.duration;
    const now = Date.now();
    if (flush || now - lastSaved > 5000) { lastSaved = now; u.saveProgress(v.id, t, lastD, { flush }); }
  };
  // Player error message with a Retry button (and a YouTube link when relevant).
  const failed = (code) => {
    msg.hidden = false;
    const yt = v.source.type === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.source.id)}` : '';
    msg.innerHTML = html`${icon('wifioff', { size: 40 })}<h2>Can’t play this video here</h2><p>${code === 101 || code === 150 || code === 153 ? 'The owner restricted embedded playback.' : 'Check your connection and try again.'}</p><div class="row"><button class="btn btn-primary" id="retry">Try again</button>${yt ? html`<a class="btn btn-ghost" href="${yt}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}</div>`.s;
    $('#retry', msg).onclick = () => { msg.hidden = true; startPlayer(); };
  };
  // Shown when the plan's simultaneous-screens limit is reached.
  const limitWall = (text) => {
    if (ctl) { try { ctl.pause(); } catch { /* ignore */ } }
    msg.hidden = false;
    msg.innerHTML = html`${icon('tv', { size: 40 })}<h2>Too many screens</h2><p>${text || 'Your plan allows a limited number of screens at once. Stop playback on another device to continue here.'}</p><div class="row"><button class="btn btn-primary" id="retry">Try again</button><a class="btn btn-ghost" href="#/account">Manage devices</a></div>`.s;
    $('#retry', msg).onclick = () => { msg.hidden = true; startPlayer(); };
  };
  /* Screens-at-once seat (premium only) and first-party play statistics (plays and watch time, no personal data). */
  const premium = v.access === 'premium', api = u.remote;
  let beat = null, tick = null, playedAt = 0, started = false;
  const flushWatch = () => { if (playedAt && api) { const secs = Math.round((Date.now() - playedAt) / 1000); playedAt = Date.now(); if (secs > 0) api.playEvent(v.id, 'progress', secs); } };
  const onPlaying = () => {
    if (!api) return;
    if (!started) { started = true; api.playEvent(v.id, 'start'); }
    if (!playedAt) playedAt = Date.now();
    if (!tick) tick = setInterval(flushWatch, 30_000);
    if (premium && u.account && !beat) {
      const hb = () => api.heartbeat(v.id).catch((e) => { if (e.status === 429) { clearInterval(beat); beat = null; limitWall(e.message); } });
      beat = setInterval(hb, 30_000);
    }
  };
  const onIdle = (stop) => { flushWatch(); playedAt = 0; clearInterval(tick); tick = null; clearInterval(beat); beat = null; if (stop && premium && u.account && api) api.stopPlayback().catch(() => {}); };
  // Autoplay: a countdown card for the next episode; tapping cancels or plays now.
  const showNextUp = () => {
    const box = $('#nextUp', ctx.root);
    let n = CONFIG.autoplayCountdown;
    const draw = () => { box.innerHTML = html`<div class="next-card">${img(cat.thumb(next, 'hqdefault'), '')}<div><div class="eyebrow">Up next in ${n}s</div><strong>${cat.label(next)} · ${cat.displayTitle(next)}</strong><div class="row"><button class="btn btn-primary btn-sm" id="nuPlay">${icon('play', { size: 16 })} Play now</button><button class="btn btn-ghost btn-sm" id="nuCancel">Cancel</button></div></div></div>`.s; };
    box.hidden = false; draw();
    const stop = () => { clearInterval(countdown); box.hidden = true; };
    countdown = setInterval(() => { n -= 1; if (n <= 0) { stop(); go('/watch/' + next.id, { replace: true }); } else draw(); }, 1000);
    box.onclick = (e) => { if (e.target.closest('#nuPlay')) { stop(); go('/watch/' + next.id, { replace: true }); } else if (e.target.closest('#nuCancel')) stop(); };
  };
  // Create the player. R2 videos first ask the API for a short-lived signed URL (this is where login and payment are enforced server-side);
  // errors map to the matching wall (401 sign in, 402 needs plan, stream_limit) or a generic failure.
  async function startPlayer() {
    try {
      let media = v;
      if (v.source.type === 'r2') {                     // premium/own-hosted video in Cloudflare R2: the API checks access and signs a short-lived URL
        const s = await u.streamUrl(v);
        media = { ...v, source: { type: s.type, url: s.url }, poster: cat.thumb(v) };
      }
      $('#unmutePill', ctx.root)?.remove();
      ctl = await createPlayer(slot, media, {
        start, autoplay: true,
        // The browser refused autoplay with sound (usual on phones), so the video runs muted: offer one tap to turn the sound on.
        onAutoplayMuted: () => {
          if (dead || $('#unmutePill', ctx.root)) return;
          const b = document.createElement('button'); b.type = 'button'; b.id = 'unmutePill'; b.className = 'unmute-pill';
          b.innerHTML = icon('mute', { size: 18 }).s + '<span>Tap to unmute</span>';
          b.onclick = () => { ctl?.unmute(); b.remove(); };
          $('#playerBox', ctx.root).appendChild(b);
        },
        onProgress: (t, d) => persist(t, d),
        onEnded: () => { u.saveProgress(v.id, lastD || v.duration, lastD || v.duration, { flush: true }); if (next && u.pref('autoplayNext')) showNextUp(); },
        onState: (s, code) => { if (s === 'playing') onPlaying(); else if (s === 'paused') onIdle(false); else if (s === 'ended') onIdle(true); else if (s === 'error') { onIdle(true); failed(code); } },
      });
      if (dead) ctl.destroy();
      if (ctl.castSupported?.()) { const cb = $('#castBtn', ctx.root); cb.hidden = false; cb.onclick = () => ctl.cast().catch((e) => { if (e?.name !== 'NotAllowedError') toast('No cast devices found nearby.'); }); }
    } catch (e) {
      console.warn(e);
      if (e instanceof ApiError && e.status === 401) return wall('login');       // session expired or never signed in
      if (e instanceof ApiError && e.status === 402) return wall('plan');
      if (e instanceof ApiError && e.code === 'stream_limit') return limitWall(e.message);
      failed();
    }
  }
  // Save progress when the tab is hidden or closed, and tidy up on leaving the page.
  startPlayer();

  const onHide = () => { if (document.hidden && ctl) persist(ctl.time(), ctl.duration(), true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  ctx.onCleanup(() => {
    dead = true; clearInterval(countdown); onIdle(true);
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
    if (ctl) { const t = ctl.time(); if (t > 0) u.saveProgress(v.id, t, ctl.duration() || v.duration, { flush: true }); ctl.destroy(); }
  });
}
