// Show page (#/show/:id): banner, action buttons, episode list, extras (trailers/clips), cast and related shows.
import { app } from '../app.js';
import { go } from '../router.js';
import { html, $, fmtDuration, fmtViews, fmtDate, timeAgo, fmtRuntime } from '../util.js';
import { icon } from '../icons.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, listBtn, img, heroBg, showMeta, premiumMark, toast, fitPoster } from '../ui/components.js';
import { openArtwork, tapArtwork } from '../ui/lightbox.js';
import { shareOrCopy } from '../util.js';
import { shareUrl } from '../platform.js';
// mountRating removed: like/dislike removed from the show page per requirement

// One episode row (shared with the watch page's side list).
export function epRow(v, { current = false } = {}) {
  const cat = app.catalog; const frac = app.user.fraction(v.id, v.duration);
  return html`<a class="ep-row ${current ? 'current' : ''}" href="#/watch/${v.id}" ${current ? html`aria-current="true"` : ''}>
    <span class="ep-num">${v.episode || '•'}</span>
    <span class="ep-thumb">${img(cat.thumb(v), '')}${cat.isPremium(v) ? premiumMark({ cls: 'premium-mark-compact' }) : ''}${frac > 0.01 ? html`<span class="progress"><i style="width:${Math.round(frac * 100)}%"></i></span>` : ''}<span class="play-overlay">${icon('play', { size: 18 })}</span></span>
    <span class="ep-info"><span class="ep-title">${cat.displayTitle(v)}</span>
      <span class="ep-meta">${fmtDuration(v.duration)} · ${fmtDate(v.publishedAt)} · ${fmtViews(v.views)} views ${frac >= 0.94 ? html`<em class="watched">${icon('check', { size: 12 })} Watched</em>` : ''}</span></span>
  </a>`;
}

export default async function showView(ctx) {
  const cat = app.catalog, u = app.user;
  const s = cat.show(ctx.params.id);
  if (!s) { if (cat.soon(ctx.params.id)) { go('/soon/' + ctx.params.id, { replace: true }); return; } throw new Error('This show does not exist.'); }
  const eps = cat.episodes(s.id), extras = cat.extras(s.id);
  const latest = cat.latestEpisode(s.id);
  const t = u.resumeTarget(cat, s.id);
  const label = !t ? 'Play' : t.resume ? `Resume ${cat.label(t.video)}` : t.continued ? `Continue ${cat.label(t.video)}` : `Play ${cat.label(t.video)}`;
  const trailer = extras.find((v) => v.kind === 'trailer');
  const totalRun = eps.reduce((n, e) => n + e.duration, 0);
  ctx.setTitle(s.titleEn || s.title);

  ctx.root.innerHTML = html`
    <section class="detail-hero" id="detailHero">
      <div class="hero-bg">${latest ? heroBg(cat.thumb(latest, 'maxresdefault'), s.posterLg || s.poster, { fallback: cat.thumb(latest, 'hqdefault') }) : heroBg(s.posterLg || s.poster, '')}</div>
      <div class="hero-shade"></div>
      ${s.access === 'premium' ? premiumMark({ cls: 'premium-mark-hero' }) : ''}
      <div class="hero-inner">
        <button type="button" class="detail-poster" id="detailPoster" aria-label="Open the full poster">${img(s.posterLg || s.poster, s.title, { lazy: false })}</button>
        <div class="hero-copy">
          <div class="eyebrow">${s.type === 'series' ? 'Original Series' : s.type === 'podcast' ? 'Fake Podcast' : 'Stand-up Comedy'}</div>
          <h1 class="hero-title bn">${s.title}</h1>
          ${s.titleEn && s.titleEn !== s.title ? html`<div class="hero-title-en">${s.titleEn}</div>` : ''}
          ${showMeta(s)}
          <div class="hero-actions">
            ${t ? html`<a class="btn btn-primary btn-lg" href="#/watch/${t.video.id}">${icon('play', { size: 20 })} ${label}</a>` : ''}
            ${trailer ? html`<a class="btn btn-glass btn-lg" href="#/watch/${trailer.id}">${icon('film', { size: 20 })} Trailer</a>` : ''}
            ${listBtn('show', s.id, { cls: 'btn btn-glass btn-lg' })}
            <button type="button" class="btn btn-glass btn-lg icon-only" id="artBtn" aria-label="View the full artwork" title="View the full artwork">${icon('expand', { size: 20 })}</button>
            <button type="button" class="btn btn-glass btn-lg icon-only" id="shareBtn" aria-label="Share">${icon('share', { size: 20 })}</button>
          </div>
          <dl class="facts">
            ${s.cast?.length ? html`<div><dt>Featuring</dt><dd>${s.cast.join(', ')}</dd></div>` : ''}
            <div><dt>Genres</dt><dd>${(s.genres || []).join(', ')}</dd></div>
            ${eps.length ? html`<div><dt>Runtime</dt><dd>${eps.length} episodes · ${fmtRuntime(totalRun)}</dd></div>` : ''}
            ${latest ? html`<div><dt>Latest</dt><dd>${fmtDate(latest.publishedAt)} (${timeAgo(latest.publishedAt)})</dd></div>` : ''}
          </dl>
        </div>
      </div>
    </section>
    <div class="page page-tight">
      ${s.tagline ? html`<p class="show-tagline-below bn">${s.tagline}</p>` : ''}
      ${s.description ? html`<section class="show-description" aria-labelledby="showDescriptionTitle"><h2 id="showDescriptionTitle">Description</h2><p>${s.description}</p></section>` : ''}
      ${eps.length ? html`<section class="ep-section" aria-label="Episodes">
        <div class="section-bar"><h2>Episodes <span class="count">${eps.length}</span></h2>
          <button type="button" class="btn btn-ghost btn-sm" id="sortEps" data-order="asc">${icon('list', { size: 16 })} <span>Oldest first</span></button></div>
        <div class="ep-list" id="epList">${eps.map((v) => epRow(v))}</div></section>`
        : html`<div class="empty small">${icon('film', { size: 36 })}<h2>Episodes coming soon</h2><p>Stay tuned — new episodes land here first.</p></div>`}
      ${rail({ title: 'Trailers, Reels & Clips', items: extras.map((v) => (v.kind === 'reel' ? reelCard(v) : videoCard(v, { showName: false }))), cls: extras.some((v) => v.kind === 'reel') ? 'r-reel' : 'r-video' })}
      ${rail({ title: 'More like this', items: cat.related(s).map((x) => showCard(x)), cls: 'r-poster' })}
    </div>`.s;

  enhanceRails(ctx.root);
  fitPoster(ctx.root);                                   // whatever shape the artwork is, crop it only a little
  // The full artwork popup: the poster box, the expand button, or the banner (the latest episode's still,
  // or the poster when there are no episodes yet) — on a phone the banner is the only one of the three.
  const art = { title: s.titleEn && s.titleEn !== s.title ? `${s.title} · ${s.titleEn}` : s.title, poster: s.posterLg || s.poster, backdrop: latest ? cat.thumb(latest, 'maxresdefault') : (s.posterLg || s.poster) };
  $('#detailPoster', ctx.root)?.addEventListener('click', () => openArtwork(art, 'poster'));
  $('#artBtn', ctx.root)?.addEventListener('click', () => openArtwork(art, 'poster'));
  tapArtwork($('#detailHero', ctx.root), art);
  let order = 'asc';
  $('#sortEps', ctx.root)?.addEventListener('click', (e) => {
    order = order === 'asc' ? 'desc' : 'asc';
    const list = order === 'asc' ? eps : [...eps].reverse();
    $('#epList', ctx.root).innerHTML = list.map((v) => epRow(v)).join('');
    e.currentTarget.querySelector('span').textContent = order === 'asc' ? 'Oldest first' : 'Newest first';
  });
  $('#shareBtn', ctx.root).addEventListener('click', async () => {
    const r = await shareOrCopy({ title: s.titleEn || s.title, text: s.tagline || s.description, url: shareUrl('/show/' + s.id) });
    if (r === 'copied') toast('Link copied');
  });
}
