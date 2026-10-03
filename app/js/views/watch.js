// Video page (#/watch/:id): the player, episode list, likes, comments and "next episode" countdown.
// Premium videos are checked first (gateFor): signed out -> sign-in wall, no plan -> subscribe wall. Every view is a function of `ctx`
// (the router context: params, root element, setTitle, onCleanup).
import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { ApiError } from '../data/api.js';
import { html, $, fmtDate, fmtViews, fmtDuration, timeAgo, shareOrCopy } from '../util.js';
import { icon } from '../icons.js';
import { createPlayer, loadYouTube } from '../players/index.js';
import { go } from '../router.js';
import { listBtn, videoCard, rail, enhanceRails, metaLine, toast, img, premiumMark } from '../ui/components.js';
import { epRow } from './show.js';
import { shareUrl } from '../platform.js';
import { lockPortrait } from '../orientation.js';

// mountRating, mountComments removed: like/dislike/comments disabled per requirement

// Renders the page, then starts the player and wires progress saving. Cleanup (timers, listeners) is registered with ctx.onCleanup.
export default async function watch(ctx) {
  const cat = app.catalog, u = app.user;
  const v = cat.video(ctx.params.id);
  if (!v) throw new Error('This video is not available.');
  const show = cat.show(v.showId), soon = !show && cat.soon(v.showId);
  const next = cat.nextEpisode(v);
  const title = cat.displayTitle(v);
  // Can this viewer play it? 'ok' | 'login' | 'plan' | 'unavailable' (premium in static mode).
  const gate = u.gateFor(v, cat);                   // Video access includes any Premium parent series.
  // R2 must be signed by the API; start that request while the watch markup is being prepared.
  let streamUrlPromise = null;
  const getStreamUrl = () => {
    if (!streamUrlPromise) {
      streamUrlPromise = Promise.resolve().then(() => u.streamUrl(v)).catch((err) => { streamUrlPromise = null; throw err; });
    }
    return streamUrlPromise;
  };
  if (gate === 'ok' && v.source.type === 'r2') getStreamUrl().catch(() => {});
  // Fetch the YouTube IFrame API while the page renders — script + handshake is the slowest part of playback
  // starting on mobile networks, so overlap it with everything else rather than starting it inside the player.
  if (v.source.type === 'youtube' && gate === 'ok') loadYouTube().catch(() => {});
  const here = encodeURIComponent('/watch/' + v.id);
  ctx.setTitle(title);

  // Page markup (everything interpolated is auto-escaped by html``). The player and title are inserted
  // first; episode/related rails are rendered only after playback setup has begun.
  ctx.root.innerHTML = html`
    <div class="watch">
      <div class="watch-main">
        <div class="player-box ${cat.isPremium(v) ? 'has-premium' : ''}" id="playerBox">
          <div class="player-slot" id="playerSlot"></div>
          <div class="player-overlay" id="playerMsg" hidden></div>
          <div class="next-up" id="nextUp" hidden></div>
          ${cat.isPremium(v) ? premiumMark({ cls: 'premium-mark-player' }) : ''}
        </div>
        <div class="watch-info">
          <div class="crumbs">${show ? html`<a href="#/show/${show.id}">${icon('left', { size: 16 })} ${show.titleEn || show.title}</a>` : soon ? html`<a href="#/soon/${soon.id}">${icon('left', { size: 16 })} ${soon.titleEn || soon.title}</a>` : html`<a href="#/">${icon('left', { size: 16 })} Home</a>`}</div>
          <h1 class="watch-title">${title}</h1>
          ${metaLine([cat.label(v), fmtDate(v.publishedAt), `${fmtViews(v.views)} views`, v.duration > 0 ? fmtDuration(v.duration) : ''])}
          <div class="watch-actions">
            ${show ? listBtn('show', show.id, { label: 'Add show to My List', cls: 'btn btn-ghost' }) : ''}
            ${listBtn('video', v.id, { label: 'Save video', cls: 'btn btn-ghost' })}
            ${next ? html`<a class="btn btn-ghost" href="#/watch/${next.id}">${icon('next', { size: 18 })} Next: ${cat.label(next)}</a>` : ''}
            <button type="button" class="btn btn-ghost" id="castBtn" hidden>${icon('cast', { size: 18 })} Cast</button>
            <button type="button" class="btn btn-ghost" id="shareBtn">${icon('share', { size: 18 })} Share</button>
            <label class="switch" title="Play the next episode automatically"><input type="checkbox" id="autoNext" ${u.pref('autoplayNext') ? 'checked' : ''}><span class="track"></span><span>Autoplay next</span></label>
          </div>
          ${show ? html`<p class="watch-desc">${show.description}</p>` : ''}
          <details class="orig-title"><summary>Original title</summary><p class="bn">${v.title}</p></details>
        </div>
      </div>
      <aside class="watch-side" id="watchSide" aria-busy="true" aria-label="${v.kind === 'episode' ? 'Episodes' : 'Up next'}"></aside>
      <!-- mobile-only: rendered after player setup and comes after the episodes/up-next list in phone layout -->
      <div id="watchMore"></div>
    </div>`.s;
  // Secondary lists are relatively expensive (especially for mobile); fill them after player startup begins.
  const renderSecondary = () => {
    const episodes = v.kind === 'episode' && show ? cat.episodes(show.id) : null;
    const sideList = episodes
      ? html`<div class="section-bar"><h2>Episodes</h2><span class="count">${episodes.length}</span></div><div class="ep-list compact" id="sideEps">${episodes.map((e) => epRow(e, { current: e.id === v.id }))}</div>`
      : html`<div class="section-bar"><h2>Up next</h2></div><div class="stack">${cat.relatedVideos(v, 12).map((x) => videoCard(x, { showName: false }))}</div>`;
    $('#watchSide', ctx.root).innerHTML = sideList.s;
    $('#watchSide', ctx.root).removeAttribute('aria-busy');
    $('#watchMore', ctx.root).innerHTML = rail({ title: 'More from ADDABAAZ', items: cat.latestEpisodes(10).filter((x) => x.id !== v.id).map((x) => videoCard(x)), cls: 'r-video mobile-only' }).s;
    enhanceRails(ctx.root);
    $('#sideEps .current', ctx.root)?.scrollIntoView({ block: 'nearest' });
  };

  $('#autoNext', ctx.root).addEventListener('change', (e) => u.setPref('autoplayNext', e.target.checked));
  $('#shareBtn', ctx.root).addEventListener('click', async () => {
    const r = await shareOrCopy({ title, text: `${title} — ADDABAAZ`, url: shareUrl('/watch/' + v.id) });
    if (r === 'copied') toast('Link copied');
  });

  // mountRating, mountComments removed: like/dislike/comments disabled per requirement
  // mountRating($('#rateBox', ctx.root), { type: 'video', id: v.id, label: 'this video' });
  // mountComments($('#commentsBox', ctx.root), { video: v });
  // The player area shows a message instead of the player when the viewer is locked out.
  const msg = $('#playerMsg', ctx.root), slot = $('#playerSlot', ctx.root);
  // Behind the lock wall the video's own artwork is shown instead of a black background. The same-origin
  // artwork (poster/backdrop) is painted as a CSS background - no image element, nothing that can fail or be
  // hidden - and when the video has a remote thumbnail (YouTube/R2) it is layered on top as a real image that
  // simply drops out if the viewer's network can't fetch it, revealing the background underneath.
  const thumb = v.thumbnail || cat.thumb(v);
  const localArt = v.poster || (show || soon)?.backdrop || (show || soon)?.poster || '';
  const wall = (kind) => {
    msg.hidden = false; slot.innerHTML = '';
    const box = $('#playerBox', ctx.root);
    const base = localArt || thumb;
    if (base && !box.classList.contains('has-wall')) {
      box.classList.add('has-wall');
      box.insertAdjacentHTML('afterbegin', html`<div class="player-wall-bg" style="background-image:url('${base}')"></div>${thumb && thumb !== base ? img(thumb, '', { cls: 'player-wall-art', lazy: false }) : ''}`.s);
    }
    msg.innerHTML = kind === 'login'
      ? html`${icon('lock', { size: 40 })}<h2>Sign in to watch</h2><div class="row"><a class="btn btn-primary btn-lg" href="#/signin?next=${here}">Sign in</a><a class="btn btn-ghost btn-lg" href="#/signup?next=${here}">Create account</a></div>`.s
      : kind === 'plan'
        // Signed in but no active plan: always offer the subscribe path (the plans page works in
        // the app too), with the old escape hatch as the secondary action.
        ? html`${icon('lock', { size: 40 })}<h2>ADDABAAZ Plus exclusive</h2><div class="row"><a class="btn btn-primary btn-lg" href="#/plans?next=${here}">${icon('crown', { size: 20 })} See plans</a><a class="btn btn-ghost btn-lg" href="#/">Back to home</a></div>`.s
        : html`${icon('lock', { size: 40 })}<h2>Premium video needs an account</h2><a class="btn btn-ghost btn-lg" href="#/">Back to home</a>`.s;
  };
  // Locked: show the wall and stop; no player is created.
  if (gate !== 'ok') { wall(gate); renderSecondary(); return; }

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
    msg.innerHTML = html`${icon('wifioff', { size: 40 })}<h2>Can't play this video here</h2><p>${code === 101 || code === 150 || code === 153 ? 'The owner restricted embedded playback.' : 'Check your connection and try again.'}</p><div class="row"><button class="btn btn-primary" id="retry">Try again</button>${yt ? html`<a class="btn btn-ghost" href="${yt}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}</div>`.s;
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
  const premium = cat.isPremium(v), api = u.remote;   // isPremium already excludes free kinds (trailers/clips/reels)
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
  // The Premium crown (top-left of the video) steps aside while the video plays and returns on pause, end or error.
  // 'buffering' keeps whatever state it was in, so a mid-play stall does not make the crown flash back in.
  const markPlaying = (on) => $('#playerBox', ctx.root)?.classList.toggle('is-playing', on);
  const onIdle = (stop) => { flushWatch(); playedAt = 0; clearInterval(tick); tick = null; clearInterval(beat); beat = null; if (stop && premium && u.account && api) api.stopPlayback().catch(() => {}); };

  /* ---------- rotation ----------
   * The app never rotates while watching: the player keeps its own native controls (the YouTube-app
   * look) and the screen turns ONLY while a video is full screen through the player's fullscreen
   * button (app/js/orientation.js locks the orientation there, and the native fullscreen client
   * hides both system bars). Leaving the page always lands back in portrait. */

  // Autoplay: a countdown card for the next episode; tapping cancels or plays now.
  const showNextUp = () => {
    const box = $('#nextUp', ctx.root);
    let n = CONFIG.autoplayCountdown;
    const draw = () => { box.innerHTML = html`<div class="next-card">${img(cat.thumb(next, 'hqdefault'), '')}<div><div class="eyebrow">Up next in ${n}s</div><strong>${cat.label(next)} \u00b7 ${cat.displayTitle(next)}</strong><div class="row"><button class="btn btn-primary btn-sm" id="nuPlay">${icon('play', { size: 16 })} Play now</button><button class="btn btn-ghost btn-sm" id="nuCancel">Cancel</button></div></div></div>`.s; };
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
        const s = await getStreamUrl();
        media = { ...v, source: { type: s.type, url: s.url }, poster: cat.thumb(v) };
      }
      $('#unmutePill', ctx.root)?.remove(); $('#playPill', ctx.root)?.remove();
      ctl = await createPlayer(slot, media, {
        start, autoplay: true,
        // The player keeps its own controls (like the YouTube app): their fullscreen button is the
        // one way into full screen, where the screen may turn (see the rotation note above).
        // The player still runs muted after main's unmute lifts (rare — the browser refused sound):
        // offer one tap to turn the sound on.
        onAutoplayMuted: () => {
          if (dead || $('#unmutePill', ctx.root)) return;
          const b = document.createElement('button'); b.type = 'button'; b.id = 'unmutePill'; b.className = 'unmute-pill';
          b.innerHTML = icon('mute', { size: 18 }).s + '<span>Tap to unmute</span>';
          b.onclick = () => { ctl?.unmute(); b.remove(); };
          $('#playerBox', ctx.root).appendChild(b);
        },
        // Even muted autoplay was refused (Low Power Mode, aggressive data saver): one obvious tap starts it —
        // the tap itself is the gesture the browser was waiting for (reels shows a play glyph in this case).
        onAutoplayBlocked: () => {
          if (dead || $('#playPill', ctx.root)) return;
          const b = document.createElement('button'); b.type = 'button'; b.id = 'playPill'; b.className = 'unmute-pill';
          b.innerHTML = icon('play', { size: 18 }).s + '<span>Tap to play</span>';
          b.onclick = () => { Promise.resolve(ctl?.play?.()).catch(() => {}); b.remove(); };
          $('#playerBox', ctx.root).appendChild(b);
        },
        // The player's first-gesture auto-unmute fired: sound is on, the pill is obsolete.
        onGestureUnmuted: () => { if (dead) return; $('#unmutePill', ctx.root)?.remove(); },
        onProgress: persist,
        onEnded: () => { u.saveProgress(v.id, lastD || v.duration, lastD || v.duration, { flush: true }); if (next && u.pref('autoplayNext')) showNextUp(); },
        onState: (s, code) => { if (s === 'playing') { markPlaying(true); $('#playPill', ctx.root)?.remove(); onPlaying(); } else if (s === 'paused') { markPlaying(false); onIdle(false); } else if (s === 'ended') { markPlaying(false); onIdle(true); } else if (s === 'error') { markPlaying(false); onIdle(true); failed(code); } },
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
  // Wait one paint so Router has connected this view to the document before play() / YouTube
  // iframe creation. Starting a detached media element can delay or block autoplay on mobile Safari.
  const afterViewCommit = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  afterViewCommit(() => {
    if (dead) return;
    startPlayer();
    renderSecondary();
  });

  // Save progress when the tab is hidden or closed, and tidy up on leaving the page.
  const onHide = () => { if (document.hidden && ctl) persist(ctl.time(), ctl.duration(), true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  ctx.onCleanup(() => {
    dead = true; clearInterval(countdown); onIdle(true);
    lockPortrait();   // even if a fullscreen video was open, leaving the page lands back in portrait
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
    if (ctl) { const t = ctl.time(); if (t > 0) u.saveProgress(v.id, t, ctl.duration() || v.duration, { flush: true }); ctl.destroy(); }
  });
}