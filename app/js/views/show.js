// Show page (#/show/:id): banner, action buttons, episode list, extras (trailers/clips), cast and related shows.
import { app } from '../app.js';
import { go } from '../router.js';
import { html, $, fmtDate, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, listBtn, img, heroBg, showMeta, premiumMark, toast, fitPoster, bannerArtMode } from '../ui/components.js';
import { openArtwork, tapArtwork } from '../ui/lightbox.js';
import { shareOrCopy } from '../util.js';
import { shareUrl } from '../platform.js';
// mountRating removed: like/dislike removed from the show page per requirement

// One episode row (shared with the watch page's side list).
export function epRow(v, { current = false } = {}) {
  const cat = app.catalog; const frac = app.user.fraction(v.id, v.duration);
  return html`<a class="ep-row ${current ? 'current' : ''}" href="#/watch/${v.id}" ${current ? html`aria-current="true"` : ''}>
    <span class="ep-num">${v.episode || '•'}</span>
    <span class="ep-thumb">${img(cat.thumb(v, 'maxresdefault'), '', { fallback: cat.thumb(v, 'hqdefault'), lowSrc: cat.thumb(v, 'mqdefault') })}${cat.isPremium(v) ? premiumMark({ cls: 'premium-mark-compact' }) : ''}${frac > 0.01 ? html`<span class="progress"><i style="width:${Math.round(frac * 100)}%"></i></span>` : ''}<span class="play-overlay">${icon('play', { size: 18 })}</span></span>
    <span class="ep-info"><span class="ep-title">${cat.displayTitle(v)}</span>
      <span class="ep-meta">${fmtDate(v.publishedAt)} ${frac >= 0.94 ? html`<em class="watched">${icon('check', { size: 12 })} Watched</em>` : ''}</span></span>
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
  ctx.setTitle(s.titleEn || s.title);
  const bgSrc = s.backdrop || (latest ? cat.thumb(latest, 'maxresdefault') : '');
  const bgFallback = [s.backdrop && latest ? cat.thumb(latest, 'maxresdefault') : '', s.posterLg || s.poster, latest ? cat.thumb(latest, 'hqdefault') : ''].filter(Boolean).join('|');

  ctx.root.innerHTML = html`
    <section class="detail-hero" id="detailHero">
      <div class="hero-bg">${latest ? heroBg(bgSrc, s.posterLg || s.poster, { fallback: bgFallback, blurUp: false }) : heroBg(s.posterLg || s.poster, '', { blurUp: false })}</div>
      <div class="hero-shade"></div>
      ${s.access === 'premium' ? premiumMark({ cls: 'premium-mark-hero' }) : ''}
      <div class="hero-inner">
        <button type="button" class="detail-poster" id="detailPoster" aria-label="Open the full poster">${img(s.posterLg || s.poster, s.title, { lazy: false, lowSrc: s.poster })}</button>
        <div class="hero-copy">
          <div class="eyebrow">${s.type === 'series' ? 'Original Series' : s.type === 'podcast' ? 'Fake Podcast' : 'Stand-up Comedy'}</div>
          <h1 class="hero-title bn">${s.title}</h1>
          ${s.titleEn && s.titleEn !== s.title ? html`<div class="hero-title-en">${s.titleEn}</div>` : ''}
          ${showMeta(s)}
          <div class="hero-actions">
            ${t ? html`<a class="btn btn-primary btn-lg" href="#/watch/${t.video.id}">${icon('play', { size: 20 })} ${label}</a>` : ''}
            ${trailer ? html`<a class="btn btn-glass btn-lg icon-only" href="#/watch/${trailer.id}" aria-label="Watch trailer" title="Watch trailer">${icon('film', { size: 20 })}</a>` : ''}
            ${listBtn('show', s.id, { cls: 'btn btn-glass btn-lg icon-only' })}
            <button type="button" class="btn btn-glass btn-lg icon-only" id="artBtn" aria-label="View the full artwork" title="View the full artwork">${icon('expand', { size: 20 })}</button>
            <button type="button" class="btn btn-glass btn-lg icon-only" id="shareBtn" aria-label="Share">${icon('share', { size: 20 })}</button>
          </div>
        </div>
      </div>
    </section>
    <div class="page page-tight show-details-page">
      <dl class="facts show-facts-below">
        ${s.cast?.length ? html`<div><dt>Featuring</dt><dd>${s.cast.join(', ')}</dd></div>` : ''}
        <div><dt>Genres</dt><dd>${(s.genres || []).join(', ')}</dd></div>
        ${latest ? html`<div><dt>Latest</dt><dd>${fmtDate(latest.publishedAt)} (${timeAgo(latest.publishedAt)})</dd></div>` : ''}
      </dl>
      ${s.tagline ? html`<p class="show-tagline-below">${s.tagline}</p>` : ''}
      ${s.description ? html`<section class="show-description" aria-labelledby="showDescriptionTitle"><h2 id="showDescriptionTitle">Description</h2><p>${s.description}</p></section>` : ''}
      ${eps.length ? html`<section class="ep-section" aria-label="Episodes">
        <div class="section-bar"><h2>Episodes <span class="count">${eps.length}</span></h2>
          <button type="button" class="btn btn-ghost btn-sm" id="sortEps" data-order="asc">${icon('list', { size: 16 })} <span>Oldest First</span></button></div>
        <div class="ep-list ep-frame" id="epList" role="region" tabindex="0" aria-label="Episode list">${eps.map((v) => epRow(v))}</div></section>`
        : html`<div class="empty small">${icon('film', { size: 36 })}<h2>Episodes Coming Soon</h2><p>Stay tuned — new episodes land here first.</p></div>`}
      ${rail({ title: 'Trailers, Reels & Clips', items: extras.map((v) => (v.kind === 'reel' ? reelCard(v) : videoCard(v, { showName: false }))), cls: extras.some((v) => v.kind === 'reel') ? 'r-reel' : 'r-video' })}
      ${rail({ title: 'More like this', items: cat.related(s).map((x) => showCard(x)), cls: 'r-poster' })}
    </div>`.s;

  enhanceRails(ctx.root);
  fitPoster(ctx.root);                                   // whatever shape the artwork is, crop it only a little
  // The full artwork popup. The poster box opens the poster (the picture it shows); the expand button and a
  // tap on the banner open what the BANNER is showing at that moment — the still on a wide screen, the poster
  // on a phone, where `heroBg` swaps it in and the poster box is hidden. Both resolve it on every click, so
  // the two always agree with the artwork on screen. The other picture stays one swipe away in the popup.
  const art = {
    title: s.titleEn && s.titleEn !== s.title ? `${s.title} · ${s.titleEn}` : s.title,
    poster: s.posterLg || s.poster,
    backdrop: latest ? cat.thumb(latest, 'maxresdefault') : (s.posterLg || s.poster),
    backdropFallback: latest ? cat.thumb(latest, 'hqdefault') : '',
  };
  const bannerMode = () => bannerArtMode(art);
  $('#detailPoster', ctx.root)?.addEventListener('click', () => openArtwork(art, 'poster'));
  $('#artBtn', ctx.root)?.addEventListener('click', () => openArtwork(art, bannerMode()));
  tapArtwork($('#detailHero', ctx.root), art, bannerMode);
  let order = 'asc';
  $('#sortEps', ctx.root)?.addEventListener('click', (e) => {
    order = order === 'asc' ? 'desc' : 'asc';
    const list = order === 'asc' ? eps : [...eps].reverse();
    const box = $('#epList', ctx.root);
    box.innerHTML = list.map((v) => epRow(v)).join('');
    box.scrollTop = 0;                                   // the frame starts at the top of the new order
    e.currentTarget.querySelector('span').textContent = order === 'asc' ? 'Oldest first' : 'Newest first';
  });
  $('#shareBtn', ctx.root).addEventListener('click', async () => {
    const r = await shareOrCopy({ title: s.titleEn || s.title, text: s.tagline || s.description, url: shareUrl('/show/' + s.id) });
    if (r === 'copied') toast('Link Copied');
  });
}
