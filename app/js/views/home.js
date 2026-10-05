// Home page (#/): hero carousel, Continue Watching, recommendations, and rails for trending, latest, reels and upcoming titles.
import { app } from '../app.js';
import { html, $, $$, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, soonCard, listBtn, img, heroBg, showMeta, premiumMark } from '../ui/components.js';

// Place the inactive slides just off one side of the active slide. Recomputing the positions on
// every change gives the browser a direction-aware transform to animate for autoplay, dots and swipes.
function slideSide(index, activeIndex, count, tieDirection = 1) {
  if (index === activeIndex) return 'active';
  const forward = (index - activeIndex + count) % count;
  const backward = count - forward;
  if (forward === backward) return tieDirection >= 0 ? 'after' : 'before';
  return forward < backward ? 'after' : 'before';
}

const initialSlideClass = (index, count) => slideSide(index, 0, count, 1);

function positionSlides(slides, activeIndex, direction = 1, previousIndex = -1, focusable = false) {
  slides.forEach((slide, index) => {
    const state = index === activeIndex ? 'active'
      : index === previousIndex ? (direction > 0 ? 'before' : 'after')
        : slideSide(index, activeIndex, slides.length, direction);
    slide.classList.toggle('active', state === 'active');
    slide.classList.toggle('before', state === 'before');
    slide.classList.toggle('after', state === 'after');
    slide.setAttribute('aria-hidden', String(state !== 'active'));
    if (focusable) slide.tabIndex = state === 'active' ? 0 : -1;
  });
}

function primeIncomingSlide(slide, direction) {
  slide.classList.remove('active', 'before', 'after');
  slide.classList.add(direction > 0 ? 'after' : 'before');
  // Establish the incoming edge before applying .active, including when wrapping a two-slide carousel.
  void slide.offsetWidth;
}

// Let a horizontal pointer drag move the artwork itself, not just queue a slide change for release.
// Keeping this shared also makes the home hero and the Releasing This Month showcase behave alike
// in touch browsers and in the Android/iOS WebViews.
function attachSwipe(surface, slides, getIndex, onSwipe, { ignoreTarget = () => false } = {}) {
  let pointerStart = null, settleTimer, clickTimer, suppressClick = false;

  const widthOf = () => Number(surface.clientWidth) || Number(surface.getBoundingClientRect?.().width)
    || Number(window.innerWidth) || 1;
  const clearStyles = () => {
    clearTimeout(settleTimer); settleTimer = null;
    slides.forEach((slide) => { slide.style.transform = ''; slide.style.transition = ''; slide.style.visibility = ''; });
    surface.classList.remove('is-dragging');
  };
  const setDrag = (start, dx) => {
    const direction = dx < 0 ? 1 : dx > 0 ? -1 : (start.direction || 1);
    const current = getIndex();
    const incoming = slides[(current + direction + slides.length) % slides.length];
    if (start.incoming && start.incoming !== incoming) {
      start.incoming.style.transform = ''; start.incoming.style.transition = ''; start.incoming.style.visibility = '';
    }
    const outgoing = slides[current], width = widthOf();
    outgoing.style.transition = 'none'; incoming.style.transition = 'none';
    outgoing.style.transform = `translate3d(${dx}px, 0, 0)`;
    incoming.style.transform = `translate3d(${dx + direction * width}px, 0, 0)`;
    // Inactive slides are normally visibility:hidden; reveal this neighbor so it follows the current
    // banner into the frame instead of leaving an empty strip during the drag.
    incoming.style.visibility = 'visible';
    surface.classList.add('is-dragging');
    start.direction = direction; start.incoming = incoming;
    start.drag = { outgoing, incoming, dx, width, direction };
    return start.drag;
  };
  const settle = (drag, commit) => {
    if (!drag) return;
    clearTimeout(settleTimer);
    const { outgoing, incoming, dx, width, direction } = drag;
    const remaining = commit ? Math.max(0, width - Math.min(width, Math.abs(dx))) : Math.min(width, Math.abs(dx));
    const duration = commit
      ? Math.round(Math.max(120, Math.min(320, 320 * remaining / width)))
      : Math.round(Math.max(160, Math.min(240, 140 + 100 * remaining / width)));
    const transition = `transform ${duration}ms cubic-bezier(.22,.68,0,1), visibility 1.2s linear`;
    outgoing.style.transition = transition; incoming.style.transition = transition;
    // Commit the current finger positions before animating the short remaining distance.
    void outgoing.offsetWidth; void incoming.offsetWidth;
    if (commit) {
      outgoing.style.transform = `translate3d(${-direction * width}px, 0, 0)`;
      incoming.style.transform = 'translate3d(0px, 0, 0)';
    } else {
      outgoing.style.transform = 'translate3d(0px, 0, 0)';
      incoming.style.transform = `translate3d(${direction * width}px, 0, 0)`;
    }
    settleTimer = setTimeout(clearStyles, duration + 60);
  };
  const position = (event, start) => {
    const x = Number.isFinite(event.clientX) ? event.clientX : start.x;
    const y = Number.isFinite(event.clientY) ? event.clientY : start.y;
    const dx = x - start.x, dy = y - start.y;
    if (!start.drag && !start.vertical) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
      // Leave vertical swipes to the page; touch-action: pan-y allows those to scroll natively.
      if (Math.abs(dy) >= Math.abs(dx)) { start.vertical = true; return null; }
    }
    if (start.vertical) return null;
    return setDrag(start, dx);
  };
  const samePointer = (event, start) => event.pointerId == null || start.pointerId == null || event.pointerId === start.pointerId;

  const onPointerDown = (event) => {
    if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
    // A fresh press means any old swipe-generated click has already been dropped; let this control work.
    clearTimeout(clickTimer); suppressClick = false;
    if (ignoreTarget(event)) return;
    clearStyles();
    pointerStart = {
      x: Number.isFinite(event.clientX) ? event.clientX : 0,
      y: Number.isFinite(event.clientY) ? event.clientY : 0,
      pointerId: event.pointerId,
      direction: 0, incoming: null, drag: null, vertical: false,
    };
  };
  const onPointerMove = (event) => {
    const start = pointerStart;
    if (!start || !samePointer(event, start) || slides.length < 2) return;
    position(event, start);
  };
  const onPointerUp = (event) => {
    const start = pointerStart;
    if (!start || !samePointer(event, start)) return;
    pointerStart = null;
    if (slides.length < 2 || start.vertical) { if (start.drag) settle(start.drag, false); return; }
    const drag = position(event, start) || start.drag;
    if (!drag) return;
    const dx = Number.isFinite(event.clientX) ? event.clientX - start.x : drag.dx;
    const dy = Number.isFinite(event.clientY) ? event.clientY - start.y : 0;
    if (Math.abs(dx) > 12) {
      suppressClick = true; clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { suppressClick = false; }, 500);
    }
    if (Math.abs(dx) >= Math.max(60, drag.width * .15) && Math.abs(dx) > Math.abs(dy)) {
      onSwipe(drag.direction, drag);
    } else settle(drag, false);
  };
  const onPointerCancel = (event) => {
    const start = pointerStart;
    if (!start || !samePointer(event, start)) return;
    pointerStart = null;
    if (start.drag) settle(start.drag, false);
  };
  const onClick = (event) => {
    if (!suppressClick) return;
    suppressClick = false; clearTimeout(clickTimer);
    event.preventDefault(); event.stopPropagation();
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('click', onClick, true);

  return {
    clear() { pointerStart = null; clearStyles(); },
    settle,
    destroy() {
      pointerStart = null; clearStyles(); clearTimeout(clickTimer);
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerCancel);
      surface.removeEventListener('click', onClick, true);
    },
  };
}

// Picks the featured shows for the carousel. Every banner is a still image - the latest episode's
// backdrop, with the show's poster as fallback - and the slideshow moves smoothly between them:
// the banners play no trailer or episode video.
function heroSlides() {
  const cat = app.catalog;
  return cat.shows.filter((s) => s.featured && cat.episodes(s.id).length)
    .map((s) => ({ show: s, latest: cat.latestEpisode(s.id) }))
    .sort((a, b) => b.latest.publishedAt.localeCompare(a.latest.publishedAt));
}

function heroActionButtons(slide) {
  const cat = app.catalog, u = app.user, { show, latest } = slide;
  const target = u.resumeTarget(cat, show.id);
  return html`<a class="btn btn-primary btn-lg" href="#/watch/${(target?.video || latest).id}">${icon('play', { size: 20 })} Watch Now</a>
    ${listBtn('show', show.id, { cls: 'btn btn-glass btn-lg icon-only', iconOnly: true })}
    <a class="btn btn-glass btn-lg" href="#/show/${show.id}">${icon('info', { size: 20 })} More info</a>`;
}

// Markup for the hero carousel. The action dock is a sibling of the moving slides so its buttons
// stay anchored in place while the artwork glides between shows.
function heroHtml(slides) {
  const cat = app.catalog;
  return html`<section class="hero" aria-roledescription="carousel" aria-label="Featured shows">
    ${slides.map(({ show, latest }, i) => html`<article class="hero-slide ${initialSlideClass(i, slides.length)}" data-i="${i}" data-show-id="${show.id}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
      <a class="hero-banner-link" href="#/show/${show.id}" aria-label="View ${show.titleEn || show.title} details">
        <div class="hero-bg">${heroBg(cat.thumb(latest, 'maxresdefault'), show.posterLg || show.poster, { lazy: i > 0, fallback: cat.thumb(latest, 'hqdefault') })}</div>
      </a>
      <div class="hero-shade"></div>
      ${show.access === 'premium' ? premiumMark({ cls: 'premium-mark-hero' }) : ''}
      <div class="hero-inner">
        <div class="hero-copy">
          <h1 class="hero-title bn">${show.title}</h1>
          ${show.titleEn && show.titleEn !== show.title ? html`<div class="hero-title-en">${show.titleEn}</div>` : ''}
          ${showMeta(show, { maxGenres: 1 })}
        </div>
        <a class="hero-poster" href="#/show/${show.id}" tabindex="-1" aria-hidden="true">${img(show.posterLg || show.poster, '', { lazy: i > 0 })}</a>
      </div>
    </article>`)}
    <div class="hero-actions hero-actions-fixed" data-hero-actions>${heroActionButtons(slides[0])}</div>
    ${slides.length > 1 ? html`<div class="hero-dots" role="tablist" aria-label="Choose slide">${slides.map((_, i) => html`<button type="button" role="tab" class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Slide ${i + 1}" aria-selected="${i === 0}"></button>`)}</div>` : ''}
  </section>`;
}

// Slow, direction-aware banner slides with dots and swipe; pause on hover/focus (pointer devices)
// avoids freezing on touch. Touch drags track the finger while the action dock stays still.
function mountHero(root, ctx, slideModels) {
  const hero = $('.hero', root); if (!hero) return;
  const slides = $$('.hero-slide', hero), dots = $$('[data-dot]', hero), actions = $('[data-hero-actions]', hero);
  let i = 0, timer, paused = false, swipe;
  const SLIDE_MS = 8000;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  positionSlides(slides, i);
  const show = (n, directionHint = 0, gesture = null) => {
    if (!gesture) swipe?.clear();
    const next = (n + slides.length) % slides.length;
    if (next === i) return;
    const forward = (next - i + slides.length) % slides.length;
    const direction = directionHint || (forward * 2 < slides.length ? 1
      : forward * 2 > slides.length ? -1 : (next > i ? 1 : -1));
    const previous = i;
    if (!gesture) primeIncomingSlide(slides[next], direction);
    i = next;
    positionSlides(slides, i, direction, previous);
    dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', String(k === i)); });
    if (actions && slideModels[next]) actions.innerHTML = heroActionButtons(slideModels[next]).s;
    $$('img[loading=lazy]', slides[i]).forEach((im) => (im.loading = 'eager'));
    if (gesture) swipe?.settle(gesture, true);
  };
  const schedule = () => { clearInterval(timer); if (slides.length > 1 && !reducedMotion) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1, 1); }, SLIDE_MS); };
  dots.forEach((d) => d.addEventListener('click', () => { show(+d.dataset.dot); schedule(); }));
  // Hover/focus pause is for pointer devices only: on touch, a tap fires mouseenter/focusin with no
  // matching leave, which would freeze the slideshow forever.
  if (window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) {
    hero.addEventListener('mouseenter', () => (paused = true)); hero.addEventListener('mouseleave', () => (paused = false));
    hero.addEventListener('focusin', () => (paused = true)); hero.addEventListener('focusout', () => (paused = false));
  }
  swipe = attachSwipe(hero, slides, () => i, (direction, gesture) => {
    show(i + direction, direction, gesture); schedule();
  }, { ignoreTarget: (event) => !!event.target.closest('.hero-actions-fixed, .hero-dots') });
  schedule(); ctx.onCleanup(() => { clearInterval(timer); swipe.destroy(); });
}

// Homepage release slideshow: slow horizontal slides, pausing while hovered/focused and respecting
// reduced-motion preferences. Arrows and dots animate; touch drags track the finger before settling.
function mountReleaseSlideshow(root, ctx) {
  const carousel = $('[data-release-carousel]', root); if (!carousel) return;
  const region = carousel.parentElement;
  const slides = $$('[data-release-slide]', carousel), dots = $$('[data-release-dot]', region);
  if (slides.length < 2) return;
  let i = 0, timer, paused = false, hovering = false, focused = false, swipe;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const updatePause = () => { paused = hovering || focused; };
  const show = (n, directionHint = 0, gesture = null) => {
    if (!gesture) swipe?.clear();
    const next = (n + slides.length) % slides.length;
    if (next === i) return;
    const forward = (next - i + slides.length) % slides.length;
    const direction = directionHint || (forward * 2 < slides.length ? 1
      : forward * 2 > slides.length ? -1 : (next > i ? 1 : -1));
    const previous = i;
    if (!gesture) primeIncomingSlide(slides[next], direction);
    i = next;
    positionSlides(slides, i, direction, previous, true);
    dots.forEach((dot, k) => {
      dot.classList.toggle('active', k === i);
      dot.setAttribute('aria-selected', String(k === i));
    });
    $$('img[loading=lazy]', slides[i]).forEach((image) => { image.loading = 'eager'; });
    if (gesture) swipe?.settle(gesture, true);
  };
  const schedule = () => {
    clearInterval(timer);
    if (!reducedMotion) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1, 1); }, 9000);
  };
  $('[data-release-prev]', carousel).addEventListener('click', () => { show(i - 1, -1); schedule(); });
  $('[data-release-next]', carousel).addEventListener('click', () => { show(i + 1, 1); schedule(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { show(+dot.dataset.releaseDot); schedule(); }));
  swipe = attachSwipe(carousel, slides, () => i, (direction, gesture) => {
    show(i + direction, direction, gesture); schedule();
  }, { ignoreTarget: (event) => !!event.target.closest('[data-release-prev], [data-release-next]') });
  region.addEventListener('mouseenter', () => { hovering = true; updatePause(); });
  region.addEventListener('mouseleave', () => { hovering = false; updatePause(); });
  region.addEventListener('focusin', () => { focused = true; updatePause(); });
  region.addEventListener('focusout', (event) => { if (!region.contains(event.relatedTarget)) { focused = false; updatePause(); } });
  positionSlides(slides, 0, 1, -1, true);
  schedule();
  ctx.onCleanup(() => { clearInterval(timer); swipe.destroy(); });
}

// One Recently Added section with reels first, followed by full-length episodes and videos.
function recentlyAddedSection(cat, N) {
  const reels = cat.reels().slice(0, N + 6).map((v) => reelCard(v));
  const videos = cat.latestVideos(N).map((v) => videoCard(v));
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
        return html`<a class="home-release-slide ${initialSlideClass(i, items.length)}" data-release-slide="${i}" href="#/soon/${item.id}" aria-label="${title} — Releasing This Month" aria-hidden="${i !== 0}">
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
  const mine = u.listItems().map((x) => (x.type === 'show' ? cat.show(x.id) && showCard(cat.show(x.id)) : x.type === 'video' ? cat.video(x.id) && videoCard(cat.video(x.id)) : cat.soon(x.id) && soonCard(cat.soon(x.id)))).filter(Boolean);
  const slides = heroSlides();
  const N = CONFIG.homeRailSize;
  const rec = u.recommendations(cat, N);
  ctx.setTitle('');
  ctx.root.innerHTML = html`
    ${slides.length ? heroHtml(slides) : ''}
    <div class="rails rails-lean">
      ${rail({ title: 'Continue Watching', items: cw.map(({ video }) => videoCard(video)), cls: 'r-video' })}
      ${rec ? rail({ title: `Because you watched ${rec.because.titleEn || rec.because.title}`, items: rec.items.map((x) => showCard(x)), cls: 'r-poster' }) : ''}
      ${rail({ title: 'My List', items: mine, href: '#/list', cls: 'r-poster' })}
      ${comingSoonSection(cat)}
      ${recentlyAddedSection(cat, N)}
      ${rail({ title: 'Top 10 Episodes', items: cat.trending(10, demoteMature ? { matureCap: 2 } : {}).map((v, i) => videoCard(v, { rank: i + 1 })), cls: 'r-top' })}
      ${rail({ title: 'Shows', items: cat.shows.map((s) => showCard(s)), href: '#/shows', linkLabel: 'Browse all', cls: 'r-poster' })}
      ${cat.shows.map((s) => rail({ title: s.titleEn && s.titleEn !== s.title ? `${s.title} · ${s.titleEn}` : s.title, items: cat.episodes(s.id).slice().reverse().map((v) => videoCard(v, { showName: false })), href: `#/show/${s.id}`, linkLabel: 'Open show', cls: 'r-video' }))}
    </div>
    <section class="cta-band">
      <div><h2>Have a story to tell?</h2><p>ADDABAAZ produces films, web series and ad films from Kolkata. Let’s make something great together.</p></div>
      <a class="btn btn-primary btn-lg" href="#/contact">Start a project</a>
    </section>`.s;

  mountHero(ctx.root, ctx, slides);
  mountReleaseSlideshow(ctx.root, ctx);
  enhanceRails(ctx.root);
}
