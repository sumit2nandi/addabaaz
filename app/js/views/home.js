// Home page (#/): hero carousel, Continue Watching, recommendations, and rails for trending, latest, reels and upcoming titles.
import { app } from '../app.js';
import { html, $, $$, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, soonCard, galleryCard, listBtn, img, heroBg, showMeta } from '../ui/components.js';
import { openLightbox } from '../ui/lightbox.js';

// Picks the featured shows for the carousel.
function heroSlides() {
  const cat = app.catalog;
  return cat.shows.filter((s) => s.featured && cat.episodes(s.id).length)
    .map((s) => ({ show: s, latest: cat.latestEpisode(s.id) }))
    .sort((a, b) => b.latest.publishedAt.localeCompare(a.latest.publishedAt));
}

// Markup for the hero carousel.
function heroHtml(slides) {
  const cat = app.catalog, u = app.user;
  return html`<section class="hero" aria-roledescription="carousel" aria-label="Featured shows">
    ${slides.map(({ show, latest }, i) => {
      const t = u.resumeTarget(cat, show.id);
      return html`<article class="hero-slide ${i === 0 ? 'active' : ''}" data-i="${i}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
        <div class="hero-bg">${heroBg(cat.thumb(latest, 'maxresdefault'), show.posterLg || show.poster, { lazy: i > 0, fallback: cat.thumb(latest, 'hqdefault') })}</div>
        <div class="hero-shade"></div>
        <div class="hero-inner">
          <div class="hero-copy">
            <div class="eyebrow">${icon('play', { size: 12 })} ${show.type === 'series' ? 'Original Series' : show.type === 'podcast' ? 'Fake Podcast' : 'Stand-up Comedy'} ${show.access === 'premium' ? html`<span class="premium-inline">${icon('lock', { size: 11 })} Premium</span>` : ''}</div>
            <h1 class="hero-title bn">${show.title}</h1>
            ${show.titleEn && show.titleEn !== show.title ? html`<div class="hero-title-en">${show.titleEn}</div>` : ''}
            ${showMeta(show)}
            <div class="hero-actions">
              <a class="btn btn-primary btn-lg" href="#/watch/${(t?.video || latest).id}">${icon('play', { size: 20 })} Watch Now</a>
              ${listBtn('show', show.id, { cls: 'btn btn-glass btn-lg' })}
              <a class="btn btn-glass btn-lg" href="#/show/${show.id}">${icon('info', { size: 20 })} More info</a>
            </div>
          </div>
          <a class="hero-poster" href="#/show/${show.id}" tabindex="-1" aria-hidden="true">${img(show.posterLg || show.poster, '', { lazy: i > 0 })}</a>
        </div>
      </article>`;
    })}
    ${slides.length > 1 ? html`<div class="hero-dots" role="tablist" aria-label="Choose slide">${slides.map((_, i) => html`<button type="button" role="tab" class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Slide ${i + 1}" aria-selected="${i === 0}"></button>`)}</div>` : ''}
  </section>`;
}

// Carousel behaviour: auto-advance, dots, swipe; pauses on hover/focus or when the tab is hidden.
function mountHero(root, ctx) {
  const hero = $('.hero', root); if (!hero) return;
  const slides = $$('.hero-slide', hero), dots = $$('[data-dot]', hero);
  let i = 0, timer, paused = false;
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', k === i); });
    $$('img[loading=lazy]', slides[i]).forEach((im) => (im.loading = 'eager'));
  };
  const schedule = () => { clearInterval(timer); if (slides.length > 1) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1); }, 9000); };
  dots.forEach((d) => d.addEventListener('click', () => { show(+d.dataset.dot); schedule(); }));
  hero.addEventListener('mouseenter', () => (paused = true)); hero.addEventListener('mouseleave', () => (paused = false));
  hero.addEventListener('focusin', () => (paused = true)); hero.addEventListener('focusout', () => (paused = false));
  let x0 = null;
  hero.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  hero.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 60) { show(i + (e.clientX < x0 ? 1 : -1)); schedule(); } x0 = null; });
  schedule(); ctx.onCleanup(() => clearInterval(timer));
}

// One Recently Added section with reels first, followed by full-length episodes and videos.
function recentlyAddedSection(cat, N) {
  const reels = cat.reels().slice(0, N + 6).map((v) => reelCard(v, { showDuration: false }));
  const videos = cat.latestVideos(N).map((v) => videoCard(v, { showDuration: false }));
  if (!reels.length && !videos.length) return html``;
  return html`<section class="recently-added" aria-labelledby="recentlyAddedTitle">
    <div class="rail-head"><div><h2 id="recentlyAddedTitle">Recently Added</h2><p class="rail-sub">The latest from ADDABAAZ</p></div></div>
    ${rail({ title: 'Reels', subtitle: 'Bite-sized ADDABAAZ', items: reels, href: '#/reels', linkLabel: 'Watch reels', cls: 'r-reel' })}
    ${rail({ title: 'Episodes & Videos', subtitle: 'Recent episodes and videos from ADDABAAZ', items: videos, cls: 'r-video' })}
  </section>`;
}

// Two-row Coming Soon section: the legacy featured Durga banner above the current upcoming-title carousel.
function comingSoonSection(cat) {
  if (!cat.upcoming.length) return html``;
  const posters = cat.homePosters || {};
  const desktopPoster = posters.releasingThisMonth || 'media/upcoming/durga-lg.webp';
  const mobilePoster = posters.releasingThisMonthMobile || 'media/upcoming/durga-sm.webp';
  const featureTitle = cat.soon(posters.releasingThisMonthId);
  const featureHref = featureTitle ? `#/soon/${featureTitle.id}` : '#/upcoming';
  const featureLabel = featureTitle ? `Releasing this month — ${featureTitle.titleEn || featureTitle.title}` : 'Releasing this month — browse all upcoming releases';
  return html`<section class="rail r-poster home-coming-soon" aria-label="Coming Soon">
    <div class="rail-head"><div><h2>Coming Soon</h2><p class="rail-sub">New originals from ADDABAAZ</p></div><a class="see-all" href="#/upcoming">Show all ${icon('right', { size: 16 })}</a></div>
    <a class="home-coming-soon-feature" href="${featureHref}" aria-label="${featureLabel}">
      <picture><source media="(max-width: 699px)" srcset="${mobilePoster}">${img(desktopPoster, 'ADDABAAZ original releasing this month')}</picture>
      <span class="home-coming-soon-feature-shade" aria-hidden="true"></span>
      <span class="home-coming-soon-feature-badge">Releasing This Month</span>
    </a>
    <div class="rail-wrap">
      <button type="button" class="rail-arrow left" aria-label="Scroll upcoming releases left" disabled>${icon('left', { size: 22 })}</button>
      <div class="rail-track" role="list">${cat.upcoming.map((u) => html`<div class="rail-item" role="listitem">${soonCard(u)}</div>`)}</div>
      <button type="button" class="rail-arrow right" aria-label="Scroll upcoming releases right">${icon('right', { size: 22 })}</button>
    </div>
  </section>`;
}

// Builds the page from the database-backed catalog and this profile's library (Kids profiles see only kid-safe titles).
export default async function home(ctx) {
  const cat = app.catalog, u = app.user;
  // Top 10: guests and accounts with no mature-content viewing history get mature titles recommended
  // less often (at most 2 of the 10). Accounts that already watch mature content keep the full ranking.
  const demoteMature = !u.account || !Object.keys(u.lib.progress || {}).some((id) => cat.isMature(cat.video(id)));
  const cw = u.continueWatching(cat);
  const mine = u.listItems().map((x) => (x.type === 'show' ? cat.show(x.id) && showCard(cat.show(x.id)) : x.type === 'video' ? cat.video(x.id) && videoCard(cat.video(x.id), { showDuration: false }) : cat.soon(x.id) && soonCard(cat.soon(x.id)))).filter(Boolean);
  const slides = heroSlides();
  const N = CONFIG.homeRailSize;
  const rec = u.recommendations(cat, N);
  ctx.setTitle('');
  ctx.root.innerHTML = html`
    ${slides.length ? heroHtml(slides) : ''}
    <div class="rails rails-lean">
      ${rail({ title: 'Continue Watching', items: cw.map(({ video }) => videoCard(video, { showDuration: false })), cls: 'r-video' })}
      ${rec ? rail({ title: `Because you watched ${rec.because.titleEn || rec.because.title}`, items: rec.items.map((x) => showCard(x)), cls: 'r-poster' }) : ''}
      ${rail({ title: 'My List', items: mine, href: '#/list', cls: 'r-poster' })}
      ${comingSoonSection(cat)}
      ${recentlyAddedSection(cat, N)}
      ${rail({ title: 'Top 10 Episodes', subtitle: 'Most watched on ADDABAAZ', items: cat.trending(10, demoteMature ? { matureCap: 2 } : {}).map((v, i) => videoCard(v, { rank: i + 1, showDuration: false })), cls: 'r-top' })}
      ${rail({ title: 'Shows', items: cat.shows.map((s) => showCard(s)), href: '#/shows', linkLabel: 'Browse all', cls: 'r-poster' })}
      ${cat.shows.map((s) => rail({ title: s.titleEn && s.titleEn !== s.title ? `${s.title} · ${s.titleEn}` : s.title, items: cat.episodes(s.id).slice().reverse().map((v) => videoCard(v, { showName: false, showDuration: false })), href: `#/show/${s.id}`, linkLabel: 'Open show', cls: 'r-video' }))}
      ${rail({ title: 'Behind the Scenes', items: cat.gallery.slice(0, N).map(galleryCard), href: '#/gallery', cls: 'r-poster' })}
    </div>
    <section class="cta-band">
      <div><h2>Have a story to tell?</h2><p>ADDABAAZ produces films, web series and ad films from Kolkata. Let’s make something great together.</p></div>
      <a class="btn btn-primary btn-lg" href="#/contact">Start a project</a>
    </section>`.s;

  mountHero(ctx.root, ctx);
  enhanceRails(ctx.root);
  ctx.root.addEventListener('click', (e) => { const b = e.target.closest('[data-lightbox]'); if (b) openLightbox(cat.gallery, b.dataset.lightbox); });
}
