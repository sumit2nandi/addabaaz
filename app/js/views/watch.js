import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { ApiError } from '../data/api.js';
import { html, $, fmtDate, fmtViews, fmtDuration, timeAgo, shareOrCopy } from '../util.js';
import { icon } from '../icons.js';
import { createPlayer } from '../players/index.js';
import { go } from '../router.js';
import { listBtn, videoCard, rail, enhanceRails, metaLine, toast, img } from '../ui/components.js';
import { epRow } from './show.js';
import { shareUrl } from '../platform.js';

export default async function watch(ctx) {
  const cat = app.catalog, u = app.user;
  const v = cat.video(ctx.params.id);
  if (!v) throw new Error('This video is not available.');
  const show = cat.show(v.showId), soon = !show && cat.soon(v.showId);
  const next = cat.nextEpisode(v);
  const title = cat.displayTitle(v);
  const gate = u.gateFor(v);                       // 'ok' | 'login' | 'plan' | 'unavailable'
  const here = encodeURIComponent('/watch/' + v.id);
  ctx.setTitle(title);

  const sideList = v.kind === 'episode' && show
    ? html`<div class="section-bar"><h2>Episodes</h2><span class="count">${cat.episodes(show.id).length}</span></div><div class="ep-list compact" id="sideEps">${cat.episodes(show.id).map((e) => epRow(e, { current: e.id === v.id }))}</div>`
    : html`<div class="section-bar"><h2>Up next</h2></div><div class="stack">${cat.relatedVideos(v, 12).map((x) => videoCard(x, { showName: false }))}</div>`;

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
            <button type="button" class="btn btn-ghost" id="shareBtn">${icon('share', { size: 18 })} Share</button>
            <label class="switch" title="Play the next episode automatically"><input type="checkbox" id="autoNext" ${u.pref('autoplayNext') ? 'checked' : ''}><span class="track"></span><span>Autoplay next</span></label>
          </div>
          ${show ? html`<p class="watch-desc">${show.description}</p>` : ''}
          <details class="orig-title"><summary>Original title</summary><p class="bn">${v.title}</p></details>
        </div>
        ${rail({ title: 'More from ADDABAAZ', items: cat.latestEpisodes(10).filter((x) => x.id !== v.id).map((x) => videoCard(x)), cls: 'r-video mobile-only' })}
      </div>
      <aside class="watch-side" aria-label="${v.kind === 'episode' ? 'Episodes' : 'Up next'}">${sideList}</aside>
    </div>`.s;
  enhanceRails(ctx.root);
  $('#sideEps .current', ctx.root)?.scrollIntoView({ block: 'nearest' });

  $('#autoNext', ctx.root).addEventListener('change', (e) => u.setPref('autoplayNext', e.target.checked));
  $('#shareBtn', ctx.root).addEventListener('click', async () => {
    const r = await shareOrCopy({ title, text: `${title} — ADDABAAZ`, url: shareUrl('/watch/' + v.id) });
    if (r === 'copied') toast('Link copied');
  });

  const msg = $('#playerMsg', ctx.root), slot = $('#playerSlot', ctx.root);
  const wall = (kind) => {
    msg.hidden = false; slot.innerHTML = '';
    msg.innerHTML = kind === 'login'
      ? html`${icon('lock', { size: 40 })}<h2>Sign in to watch</h2><p>This is ADDABAAZ Premium. Sign in or create a free account to watch it — everything else on ADDABAAZ stays open to everyone.</p><div class="row"><a class="btn btn-primary btn-lg" href="#/signin?next=${here}">Sign in</a><a class="btn btn-ghost btn-lg" href="#/signup?next=${here}">Create account</a></div>`.s
      : kind === 'plan'
        ? html`${icon('lock', { size: 40 })}<h2>ADDABAAZ Plus exclusive</h2><p>Subscribe to watch this title and get early access to every new original.</p><a class="btn btn-primary btn-lg" href="#/plans">${icon('crown', { size: 20 })} See plans</a>`.s
        : html`${icon('lock', { size: 40 })}<h2>Premium video needs an account</h2><p>This copy of ADDABAAZ runs without the ADDABAAZ API, so premium titles can’t be unlocked here.</p><a class="btn btn-ghost btn-lg" href="#/">Back to home</a>`.s;
  };
  if (gate !== 'ok') { wall(gate); return; }

  /* ---------- playback + progress ---------- */
  const prog = u.progressOf(v.id);
  const start = prog && prog.position >= CONFIG.resumeMinSeconds && !u.isFinished(v.id, v.duration) ? prog.position : 0;
  let ctl = null, lastSaved = 0, dead = false, countdown = null, lastT = start, lastD = v.duration;

  const persist = (t, d, flush = false) => {
    if (!(t > 0)) return; lastT = t; lastD = d || v.duration;
    const now = Date.now();
    if (flush || now - lastSaved > 5000) { lastSaved = now; u.saveProgress(v.id, t, lastD, { flush }); }
  };
  const failed = (code) => {
    msg.hidden = false;
    const yt = v.source.type === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.source.id)}` : '';
    msg.innerHTML = html`${icon('wifioff', { size: 40 })}<h2>Can’t play this video here</h2><p>${code === 101 || code === 150 || code === 153 ? 'The owner restricted embedded playback.' : 'Check your connection and try again.'}</p><div class="row"><button class="btn btn-primary" id="retry">Try again</button>${yt ? html`<a class="btn btn-ghost" href="${yt}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}</div>`.s;
    $('#retry', msg).onclick = () => { msg.hidden = true; startPlayer(); };
  };
  const showNextUp = () => {
    const box = $('#nextUp', ctx.root);
    let n = CONFIG.autoplayCountdown;
    const draw = () => { box.innerHTML = html`<div class="next-card">${img(cat.thumb(next, 'hqdefault'), '')}<div><div class="eyebrow">Up next in ${n}s</div><strong>${cat.label(next)} · ${cat.displayTitle(next)}</strong><div class="row"><button class="btn btn-primary btn-sm" id="nuPlay">${icon('play', { size: 16 })} Play now</button><button class="btn btn-ghost btn-sm" id="nuCancel">Cancel</button></div></div></div>`.s; };
    box.hidden = false; draw();
    const stop = () => { clearInterval(countdown); box.hidden = true; };
    countdown = setInterval(() => { n -= 1; if (n <= 0) { stop(); go('/watch/' + next.id, { replace: true }); } else draw(); }, 1000);
    box.onclick = (e) => { if (e.target.closest('#nuPlay')) { stop(); go('/watch/' + next.id, { replace: true }); } else if (e.target.closest('#nuCancel')) stop(); };
  };
  async function startPlayer() {
    try {
      let media = v;
      if (v.source.type === 'r2') {                     // premium/own-hosted video in Cloudflare R2: the API checks access and signs a short-lived URL
        const s = await u.streamUrl(v);
        media = { ...v, source: { type: s.type, url: s.url }, poster: cat.thumb(v) };
      }
      ctl = await createPlayer(slot, media, {
        start, autoplay: true,
        onProgress: (t, d) => persist(t, d),
        onEnded: () => { u.saveProgress(v.id, lastD || v.duration, lastD || v.duration, { flush: true }); if (next && u.pref('autoplayNext')) showNextUp(); },
        onState: (s, code) => { if (s === 'error') failed(code); },
      });
      if (dead) ctl.destroy();
    } catch (e) {
      console.warn(e);
      if (e instanceof ApiError && e.status === 401) return wall('login');       // session expired or never signed in
      if (e instanceof ApiError && e.status === 402) return wall('plan');
      failed();
    }
  }
  startPlayer();

  const onHide = () => { if (document.hidden && ctl) persist(ctl.time(), ctl.duration(), true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  ctx.onCleanup(() => {
    dead = true; clearInterval(countdown);
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
    if (ctl) { const t = ctl.time(); if (t > 0) u.saveProgress(v.id, t, ctl.duration() || v.duration, { flush: true }); ctl.destroy(); }
  });
}
