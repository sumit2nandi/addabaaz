// Home page (#/): hero carousel, Continue Watching, recommendations, and rails for trending, latest, reels and upcoming titles.
import { app } from '../app.js';
import { html, $, $$, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, soonCard, galleryCard, listBtn, img, heroBg, showMeta, premiumMark } from '../ui/components.js';
import { openLightbox } from '../ui/lightbox.js';

// Picks the featured shows for the carousel. Every show slide carries a muted preview that starts
// when the slide activates - the show's trailer, or its first episode when there is no trailer
// (the episode only plays when the viewer's gate allows it; otherwise the poster stays). Like the
// main-branch hero, playback starts muted with an unmute switch on the banner; each slide's preview
// never plays longer than 5 seconds and the carousel moves on every 5 seconds.
function heroSlides() {
  const cat = app.catalog;
  return cat.shows.filter((s) => s.featured && cat.episodes(s.id).length)
    .map((s) => {
      const trailer = cat.videos.find((v) => v.showId === s.id && v.kind === 'trailer' && v.source?.type === 'youtube');
      const first = !trailer ? [...cat.episodes(s.id)].sort((a, b) => (a.episode || 0) - (b.episode || 0) || a.publishedAt.localeCompare(b.publishedAt))[0] : null;
      return { show: s, latest: cat.latestEpisode(s.id), preview: trailer || first };
    })
    .sort((a, b) => b.latest.publishedAt.localeCompare(a.latest.publishedAt));
}

// Markup for the hero carousel.
function heroHtml(slides) {
  const cat = app.catalog, u = app.user;
  return html`<section class="hero" aria-roledescription="carousel" aria-label="Featured shows">
    ${slides.map(({ show, latest, preview }, i) => {
      const t = u.resumeTarget(cat, show.id);
      return html`<article class="hero-slide ${i === 0 ? 'active' : ''}" data-i="${i}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
        <div class="hero-bg">${heroBg(cat.thumb(latest, 'maxresdefault'), show.posterLg || show.poster, { lazy: i > 0, fallback: cat.thumb(latest, 'hqdefault') })}</div>
        <div class="hero-video" data-prev-id="${preview ? preview.id : ''}" data-prev-type="${preview ? (preview.source.type === 'youtube' ? 'yt' : 'file') : ''}" aria-hidden="true"></div>
        <div class="hero-shade"></div>
        ${show.access === 'premium' ? premiumMark({ cls: 'premium-mark-hero' }) : ''}
        ${preview ? html`<button type="button" class="hero-sound" data-sound aria-pressed="false" aria-label="Unmute preview">${icon('mute', { size: 18 })}</button>` : ''}
        <div class="hero-inner">
          <div class="hero-copy">
            <div class="eyebrow">${icon('play', { size: 12 })} ${show.type === 'series' ? 'Original Series' : show.type === 'podcast' ? 'Fake Podcast' : 'Stand-up Comedy'}</div>
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
// The active slide plays the show's YouTube trailer muted (autoplay policy) behind the shade, with
// an unmute switch on the banner - the same behaviour the main branch's hero had.
export const heroTrailerSrc = (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(id)}&playsinline=1&enablejsapi=1&rel=0&modestbranding=1`;
function mountHero(root, ctx) {
  const hero = $('.hero', root); if (!hero) return;
  const slides = $$('.hero-slide', hero), dots = $$('[data-dot]', hero);
  let i = 0, timer, vTimer, capT, paused = false;
  const SLIDE_MS = 5000;   // a banner slide never lasts longer than 5 seconds…
  const CAP_MS = 5000;     // …and a slide's preview never plays longer than 5 seconds (unless unmuted)
  let unmuted = false;
  const setSound = (btn, on) => { btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'Mute preview' : 'Unmute preview'); btn.innerHTML = icon(on ? 'volume' : 'mute', { size: 18 }).s; };
  const pausePreview = (slide) => {
    const f = $('iframe', slide);
    if (f) { try { f.contentWindow?.postMessage?.(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'); } catch { /* iframe gone */ } }
    $('video', slide)?.pause?.();
  };
  const stopVideo = () => { clearTimeout(vTimer); clearTimeout(capT); $$('.hero-video', hero).forEach((b) => (b.innerHTML = '')); };
  const startVideo = (slide) => {
    clearTimeout(vTimer); clearTimeout(capT);
    const box = $('.hero-video', slide), id = box?.dataset.prevId, type = box?.dataset.prevType;
    if (!id || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    // Let the slide's crossfade start first; the poster underneath covers the first frame.
    vTimer = setTimeout(async () => {
      if (!slide.classList.contains('active') || document.hidden) return;
      if (type === 'yt') box.innerHTML = `<iframe src="${heroTrailerSrc(id)}" title="" allow="autoplay" tabindex="-1"></iframe>`;
      else {
        // First-episode fallback: needs a signed URL, which the API refuses for locked content -
        // in that case the poster simply stays. Never block the carousel on a slow answer.
        try {
          const s = await app.user.streamUrl(app.catalog.video(id));
          if (!slide.classList.contains('active')) return;
          box.innerHTML = `<video src="${s.url}" muted autoplay playsinline></video>`;
        } catch { /* locked or offline: poster only */ }
      }
      if (!unmuted) capT = setTimeout(() => pausePreview(slide), CAP_MS);
    }, 900);
  };
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', k === i); });
    $$('img[loading=lazy]', slides[i]).forEach((im) => (im.loading = 'eager'));
    unmuted = false;
    $$('[data-sound]', hero).forEach((b) => setSound(b, false));   // every slide (re)starts muted
    stopVideo(); startVideo(slides[i]);
  };
  const schedule = () => { clearInterval(timer); if (slides.length > 1 && !unmuted) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1); }, SLIDE_MS); };
  dots.forEach((d) => d.addEventListener('click', () => { show(+d.dataset.dot); schedule(); }));
  hero.addEventListener('mouseenter', () => (paused = true)); hero.addEventListener('mouseleave', () => (paused = false));
  hero.addEventListener('focusin', () => (paused = true)); hero.addEventListener('focusout', () => (paused = false));
  hero.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sound]'); if (!b) return;
    const slide = b.closest('.hero-slide');
    const on = b.getAttribute('aria-pressed') !== 'true';
    const f = $('iframe', slide), vid = $('video', slide);
    if (f) { try { f.contentWindow?.postMessage?.(JSON.stringify({ event: 'command', func: on ? 'unMute' : 'mute', args: [] }), '*'); } catch { /* iframe not ready */ } }
    if (vid) vid.muted = !on;
    unmuted = on;
    if (on) { clearInterval(timer); clearTimeout(capT); }   // chose to listen: stop the rotation and the 5 s cap
    else schedule();                                       // muted again: the 5 s slideshow resumes
    setSound(b, on);
  });
  let x0 = null;
  hero.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  hero.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 60) { show(i + (e.clientX < x0 ? 1 : -1)); schedule(); } x0 = null; });
  hero.addEventListener('pointercancel', () => { x0 = null; });    // touch drags handed to scrolling must not leave a stale swipe
  const onVis = () => { if (document.hidden) stopVideo(); else startVideo(slides[i]); };
  document.addEventListener('visibilitychange', onVis);
  startVideo(slides[0]);
  schedule(); ctx.onCleanup(() => { clearInterval(timer); stopVideo(); document.removeEventListener('visibilitychange', onVis); });
}

// Homepage poster slideshow: pauses while hovered/focused and does not auto-advance for reduced-motion users.
function mountReleaseSlideshow(root, ctx) {
  const carousel = $('[data-release-carousel]', root); if (!carousel) return;
  const region = carousel.parentElement;
  const slides = $$('[data-release-slide]', carousel), dots = $$('[data-release-dot]', region);
  if (slides.length < 2) return;
  let i = 0, timer, paused = false, hovering = false, focused = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const updatePause = () => { paused = hovering || focused; };
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((slide, k) => {
      const active = k === i;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.tabIndex = active ? 0 : -1;
    });
    dots.forEach((dot, k) => {
      dot.classList.toggle('active', k === i);
      dot.setAttribute('aria-selected', String(k === i));
    });
    $$('img[loading=lazy]', slides[i]).forEach((image) => { image.loading = 'eager'; });
  };
  const schedule = () => {
    clearInterval(timer);
    if (!reducedMotion) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1); }, 7000);
  };
  $('[data-release-prev]', carousel).addEventListener('click', () => { show(i - 1); schedule(); });
  $('[data-release-next]', carousel).addEventListener('click', () => { show(i + 1); schedule(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { show(+dot.dataset.releaseDot); schedule(); }));
  region.addEventListener('mouseenter', () => { hovering = true; updatePause(); });
  region.addEventListener('mouseleave', () => { hovering = false; updatePause(); });
  region.addEventListener('focusin', () => { focused = true; updatePause(); });
  region.addEventListener('focusout', (event) => { if (!region.contains(event.relatedTarget)) { focused = false; updatePause(); } });
  show(0);
  schedule();
  ctx.onCleanup(() => clearInterval(timer));
}

// One Recently Added section with reels first, followed by full-length episodes and videos.
function recentlyAddedSection(cat, N) {
  const reels = cat.reels().slice(0, N + 6).map((v) => reelCard(v, { showDuration: false }));
  const videos = cat.latestVideos(N).map((v) => videoCard(v, { showDuration: false }));
  if (!reels.length && !videos.length) return html``;
  return html`<section class="recently-added" aria-labelledby="recentlyAddedTitle">
    <div class="rail-head"><div><h2 id="recentlyAddedTitle">Recently Added</h2></div></div>
    ${rail({ title: 'Reels', items: reels, href: '#/reels', linkLabel: 'Watch reels', cls: 'r-reel', hideHeading: true })}
    ${rail({ title: 'Episodes & Videos', items: videos, cls: 'r-video', hideHeading: true })}
  </section>`;
}

// The artwork a Releasing This Month slide shows: the wide backdrop first, then the large poster, then the card poster
// (the same order as the title's own page). Release posters are finished landscape artwork with their title and logo
// printed on them, so the slide shows the whole picture, uncovered: no overlaid gradient, title or badge.
const releaseArt = (item) => item.backdrop || item.posterLg || item.poster;

// Landscape (16:9) slideshow. `contain` keeps the entire artwork visible; if a poster is not 16:9 (say a portrait one) it is centred
// over a blurred copy of itself instead of being cropped. The heading above the slideshow already says "Releasing This Month".
function releaseSlideshow(items) {
  return html`<div class="home-release-showcase">
    <div class="home-release-carousel" data-release-carousel role="region" aria-roledescription="carousel" aria-label="Releasing This Month">
      ${items.map((item, i) => {
        const title = item.titleEn || item.title, art = releaseArt(item);
        return html`<a class="home-release-slide ${i === 0 ? 'active' : ''}" data-release-slide="${i}" href="#/soon/${item.id}" aria-label="${title} — Releasing This Month" aria-hidden="${i !== 0}">
          ${img(art, '', { cls: 'home-release-bg', lazy: i > 0 })}
          ${img(art, `${title} — Releasing This Month`, { cls: 'home-release-art', lazy: i > 0 })}
        </a>`;
      })}
      ${items.length > 1 ? html`<div class="home-release-arrows">
        <button type="button" class="home-release-arrow" data-release-prev aria-label="Previous release">${icon('left', { size: 20 })}</button>
        <button type="button" class="home-release-arrow" data-release-next aria-label="Next release">${icon('right', { size: 20 })}</button>
      </div>` : ''}
    </div>
    ${items.length > 1 ? html`<div class="home-release-dots" role="tablist" aria-label="Choose a release">${items.map((item, i) => html`<button type="button" role="tab" data-release-dot="${i}" aria-label="${item.titleEn || item.title}" aria-selected="${i === 0}" class="${i === 0 ? 'active' : ''}"></button>`)}</div>` : ''}
  </div>`;
}

// Releasing titles rotate as full landscape posters; the remaining titles stay in the Coming Soon rail.
function comingSoonSection(cat) {
  const releases = cat.upcomingByCategory('releasing-this-month');
  const comingSoon = cat.upcomingByCategory('coming-soon');
  if (!releases.length && !comingSoon.length) return html``;
  return html`<div class="home-upcoming-sections">
    ${releases.length ? html`<section class="rail home-release-section" aria-label="Releasing This Month">
      <div class="rail-head"><div><h2>Releasing This Month</h2></div><a class="see-all" href="#/upcoming">Show all ${icon('right', { size: 16 })}</a></div>
      ${releaseSlideshow(releases)}
    </section>` : ''}
    ${comingSoon.length ? rail({ title: 'Coming Soon', items: comingSoon.map(soonCard), href: '#/upcoming', linkLabel: 'Show all', cls: 'r-poster home-coming-soon' }) : ''}
  </div>`;
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
      ${rail({ title: 'Top 10 Episodes', items: cat.trending(10, demoteMature ? { matureCap: 2 } : {}).map((v, i) => videoCard(v, { rank: i + 1, showDuration: false })), cls: 'r-top' })}
      ${rail({ title: 'Shows', items: cat.shows.map((s) => showCard(s)), href: '#/shows', linkLabel: 'Browse all', cls: 'r-poster' })}
      ${cat.shows.map((s) => rail({ title: s.titleEn && s.titleEn !== s.title ? `${s.title} · ${s.titleEn}` : s.title, items: cat.episodes(s.id).slice().reverse().map((v) => videoCard(v, { showName: false, showDuration: false })), href: `#/show/${s.id}`, linkLabel: 'Open show', cls: 'r-video' }))}
      ${rail({ title: 'Behind the Scenes', items: cat.gallery.slice(0, N).map(galleryCard), href: '#/gallery', cls: 'r-poster' })}
    </div>
    <section class="cta-band">
      <div><h2>Have a story to tell?</h2><p>ADDABAAZ produces films, web series and ad films from Kolkata. Let’s make something great together.</p></div>
      <a class="btn btn-primary btn-lg" href="#/contact">Start a project</a>
    </section>`.s;

  mountHero(ctx.root, ctx);
  mountReleaseSlideshow(ctx.root, ctx);
  enhanceRails(ctx.root);
  ctx.root.addEventListener('click', (e) => { const b = e.target.closest('[data-lightbox]'); if (b) openLightbox(cat.gallery, b.dataset.lightbox); });
}
