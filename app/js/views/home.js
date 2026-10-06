// Home page (#/): hero carousel, Continue Watching, recommendations, and rails for trending, latest, reels and upcoming titles.
import { app } from '../app.js';
import { html, $, $$, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { rail, enhanceRails, showCard, videoCard, reelCard, soonCard, listBtn, img, heroBg, showMeta, premiumMark, syncButtons } from '../ui/components.js';

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

// A pointer coordinate: plain events (tests, older WebViews) arrive without clientY, and one NaN
// would poison every comparison below.
const px = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Finger-tracking shared by the home hero and the Releasing This Month carousel. While a finger is
// down the carousel gets every horizontal move 1:1 (`onMove` with the offset in px); when the finger
// lifts, `onEnd` decides where it lands (-1 back, 1 forward, 0 = snap back) and the CSS transition
// carries the banner the rest of the way. A mostly vertical drag is dropped immediately so the page
// keeps scrolling natively, and the click a drag leaves behind is swallowed, so a swipe never opens
// the banner link underneath it.
function trackDrag(el, { onMove, onEnd, ignore }) {
  const AXIS_PX = 8, TAP_PX = 12;    // movement before a drag starts, and before the click is dropped
  let start = null, dragging = false, offset = 0, suppressClick = false, clickTimer;
  // How far a drag has to travel before it changes slide: a fraction of the carousel, so a phone
  // never needs a huge sweep and a wide desktop window never flips on a twitch.
  const releasePx = () => { const w = el.getBoundingClientRect?.().width || 0; return w ? Math.min(160, Math.max(48, w * 0.18)) : 48; };
  const swallow = () => { suppressClick = true; clearTimeout(clickTimer); clickTimer = setTimeout(() => { suppressClick = false; }, 500); };
  const allow = () => { suppressClick = false; clearTimeout(clickTimer); };
  el.addEventListener('click', (e) => {
    if (!suppressClick) return;
    allow();
    e.preventDefault(); e.stopPropagation();
  }, true);
  el.addEventListener('pointerdown', (e) => {
    if (e.isPrimary === false) return;
    // A drag that starts on a control is a tap on that control: never a swipe, and never a
    // swallowed click (the action dock and the arrows have to stay tappable).
    if (ignore && e.target?.closest?.(ignore)) return;
    start = { x: px(e.clientX), y: px(e.clientY), id: e.pointerId };
    dragging = false; offset = 0;
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || start.dropped) return;
    if (e.pointerId != null && start.id != null && e.pointerId !== start.id) return;    // a second finger
    const dx = px(e.clientX) - start.x, dy = px(e.clientY) - start.y;
    if (!dragging) {
      if (Math.abs(dy) > AXIS_PX && Math.abs(dy) >= Math.abs(dx)) { start.dropped = true; return; }   // vertical: leave the page to scroll
      if (Math.abs(dx) < AXIS_PX) return;                                                             // tap slop
      dragging = true;
      // Keep the events coming (a mouse that leaves the carousel mid-drag would otherwise strand the
      // banners at the drag offset: touch keeps the events by itself, a mouse does not).
      try { el.setPointerCapture?.(e.pointerId); } catch { /* capture is a bonus, not a requirement */ }
    }
    offset = dx;
    onMove(dx);
  });
  const finish = (e) => {
    const s = start; start = null;
    const wasDragging = dragging, moved = offset;
    dragging = false; offset = 0;
    if (!s || s.dropped) return;
    if (wasDragging) {
      if (Math.abs(moved) >= TAP_PX) swallow();        // the click at the end of a drag is not a tap
      onEnd(Math.abs(moved) >= releasePx() ? (moved < 0 ? 1 : -1) : 0);
      return;
    }
    // No move events at all (some touch WebViews only send down/up): the plain distance swipe still works.
    const dx = px(e?.clientX) - s.x, dy = px(e?.clientY) - s.y;
    if (Math.abs(dx) >= releasePx() && Math.abs(dx) > Math.abs(dy)) { swallow(); onEnd(dx < 0 ? 1 : -1); }
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', () => {   // the browser took the gesture for scrolling
    const wasDragging = dragging;
    start = null; dragging = false; offset = 0;
    if (wasDragging) { swallow(); onEnd(0); } else allow();
  });
  return () => clearTimeout(clickTimer);
}

// The drag itself, for any carousel whose slides sit at translateX(±100%): the active banner and the
// neighbour it is pulling in move together, so the incoming artwork is already on screen and under the
// finger for the whole gesture. Both banners drop their transition while being dragged and take it
// back the moment the finger lifts, which is what makes the release glide instead of jump.
function attachSlideDrag(el, { slides, current, go, ignore }) {
  let pair = null;
  const settle = (direction) => {
    if (pair) {
      el.classList.remove('is-dragging');
      for (const slide of pair) { slide.classList.remove('dragging', 'peek'); slide.style.transform = ''; }
      pair[1].setAttribute('aria-hidden', 'true');
      pair = null;
    }
    if (direction) go(direction);
  };
  const move = (dx) => {
    const from = current();
    const direction = dx < 0 ? 1 : -1;                                  // dragging left pulls the next banner in
    const neighbour = slides[(from + direction + slides.length) % slides.length];
    if (pair && pair[1] !== neighbour) settle(0);                       // the finger crossed back the other way
    if (!pair) {
      pair = [slides[from], neighbour];
      el.classList.add('is-dragging');
      neighbour.classList.add('peek');                                  // visible for the duration of the drag
      neighbour.setAttribute('aria-hidden', 'false');
      $$('img[loading=lazy]', neighbour).forEach((image) => { image.loading = 'eager'; });
      for (const slide of pair) slide.classList.add('dragging');        // follow the finger exactly: no easing
    }
    pair[0].style.transform = `translate3d(${dx}px,0,0)`;
    pair[1].style.transform = `translate3d(calc(${direction > 0 ? '' : '-'}100% ${dx < 0 ? '-' : '+'} ${Math.abs(dx)}px),0,0)`;
  };
  return trackDrag(el, { onMove: move, onEnd: (direction) => settle(direction), ignore });
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

// One row of actions for the whole carousel. It hangs off the carousel itself rather than off a
// banner, so it stays put while the banners slide underneath it; mountHero() repoints it at whichever
// show is on screen. (Banners used to carry their own copy of the three buttons, which meant the
// whole dock slid away with the artwork every 8 seconds.)
function heroDockHtml(entry) {
  return html`<div class="hero-actions hero-dock" data-hero-dock role="group" aria-label="${entry.show.titleEn || entry.show.title} actions">
    <a class="btn btn-primary btn-lg" data-hero-watch href="#/watch/${entry.watch}">${icon('play', { size: 20 })} Watch Now</a>
    ${listBtn('show', entry.show.id, { cls: 'btn btn-glass btn-lg icon-only' })}
    <a class="btn btn-glass btn-lg" data-hero-info href="#/show/${entry.show.id}">${icon('info', { size: 20 })} More info</a>
  </div>`;
}

// Markup for the hero carousel.
function heroHtml(slides) {
  const cat = app.catalog, u = app.user;
  // Each banner carries the two ids the dock needs, so the single row of actions can be repointed at it.
  const entries = slides.map(({ show, latest }) => ({ show, watch: (u.resumeTarget(cat, show.id)?.video || latest).id }));
  return html`<section class="hero" aria-roledescription="carousel" aria-label="Featured shows">
    ${slides.map(({ show, latest }, i) => {
      const entry = entries[i];
      return html`<article class="hero-slide ${initialSlideClass(i, slides.length)}" data-i="${i}" data-show-id="${show.id}" data-watch-id="${entry.watch}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
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
      </article>`;
    })}
    ${entries.length ? heroDockHtml(entries[0]) : ''}
    ${slides.length > 1 ? html`<div class="hero-dots" role="tablist" aria-label="Choose slide">${slides.map((_, i) => html`<button type="button" role="tab" class="${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Slide ${i + 1}" aria-selected="${i === 0}"></button>`)}</div>` : ''}
  </section>`;
}

// Slow, direction-aware banner slides with dots and swipe; pause on hover/focus (pointer devices)
// avoids freezing on touch. Banners remain images only.
function mountHero(root, ctx) {
  const hero = $('.hero', root); if (!hero) return;
  const slides = $$('.hero-slide', hero), dots = $$('[data-dot]', hero);
  const dock = $('[data-hero-dock]', hero);
  let i = 0, timer, paused = false;
  const SLIDE_MS = 8000;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  positionSlides(slides, i);
  // The dock is stationary, so instead of moving it the three actions are repointed at the banner
  // that is on screen: the video Watch Now would resume, the show page More info opens, and the id
  // My List stores.
  const paintDock = () => {
    if (!dock) return;
    const slide = slides[i];
    const watch = $('[data-hero-watch]', dock), info = $('[data-hero-info]', dock), list = $('[data-list]', dock);
    if (watch) watch.href = `#/watch/${slide.dataset.watchId}`;
    if (info) info.href = `#/show/${slide.dataset.showId}`;
    if (list) {
      list.dataset.list = `show:${slide.dataset.showId}`;
      syncButtons(dock);                       // the + / ✓ state belongs to the show now on screen
    }
    const title = $('.hero-title', slide)?.textContent;
    if (title) dock.setAttribute('aria-label', `${title} actions`);
  };
  const show = (n, directionHint = 0) => {
    const next = (n + slides.length) % slides.length;
    if (next === i) return;
    const forward = (next - i + slides.length) % slides.length;
    const direction = directionHint || (forward * 2 < slides.length ? 1
      : forward * 2 > slides.length ? -1 : (next > i ? 1 : -1));
    const previous = i;
    primeIncomingSlide(slides[next], direction);
    i = next;
    positionSlides(slides, i, direction, previous);
    dots.forEach((d, k) => { d.classList.toggle('active', k === i); d.setAttribute('aria-selected', String(k === i)); });
    $$('img[loading=lazy]', slides[i]).forEach((im) => (im.loading = 'eager'));
    paintDock();
  };
  const schedule = () => { clearInterval(timer); if (slides.length > 1 && !reducedMotion) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1, 1); }, SLIDE_MS); };
  dots.forEach((d) => d.addEventListener('click', () => { show(+d.dataset.dot); schedule(); }));
  // Hover/focus pause is for pointer devices only: on touch, a tap fires mouseenter/focusin with no
  // matching leave, which would freeze the slideshow forever.
  if (window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches) {
    hero.addEventListener('mouseenter', () => (paused = true)); hero.addEventListener('mouseleave', () => (paused = false));
    hero.addEventListener('focusin', () => (paused = true)); hero.addEventListener('focusout', () => (paused = false));
  }
  paintDock();
  // Touch/pointer drags: the banner under the finger and the neighbour it is pulling in move together,
  // so the incoming artwork is visible for the whole gesture and glides home on release.
  const stopDrag = slides.length > 1 ? attachSlideDrag(hero, {
    slides,
    current: () => i,
    go: (direction) => { show(i + direction, direction); schedule(); },
    ignore: '[data-hero-dock], .hero-dots, button',      // a drag from an action or a dot is a tap, not a swipe
  }) : null;
  schedule(); ctx.onCleanup(() => { clearInterval(timer); stopDrag?.(); });
}

// Homepage release slideshow: slow horizontal slides, pausing while hovered/focused and respecting
// reduced-motion preferences. Arrows, dots, mouse/touch swipes all use the same animated transition;
// a finger drag keeps the release on screen and the one coming in together, in either direction.
function mountReleaseSlideshow(root, ctx) {
  const carousel = $('[data-release-carousel]', root); if (!carousel) return;
  const region = carousel.parentElement;
  const slides = $$('[data-release-slide]', carousel), dots = $$('[data-release-dot]', region);
  if (slides.length < 2) return;
  let i = 0, timer, paused = false, hovering = false, focused = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const updatePause = () => { paused = hovering || focused; };
  const show = (n, directionHint = 0) => {
    const next = (n + slides.length) % slides.length;
    if (next === i) return;
    const forward = (next - i + slides.length) % slides.length;
    const direction = directionHint || (forward * 2 < slides.length ? 1
      : forward * 2 > slides.length ? -1 : (next > i ? 1 : -1));
    const previous = i;
    primeIncomingSlide(slides[next], direction);
    i = next;
    positionSlides(slides, i, direction, previous, true);
    dots.forEach((dot, k) => {
      dot.classList.toggle('active', k === i);
      dot.setAttribute('aria-selected', String(k === i));
    });
    $$('img[loading=lazy]', slides[i]).forEach((image) => { image.loading = 'eager'; });
  };
  const schedule = () => {
    clearInterval(timer);
    if (!reducedMotion) timer = setInterval(() => { if (!paused && !document.hidden) show(i + 1, 1); }, 9000);
  };
  $('[data-release-prev]', carousel).addEventListener('click', () => { show(i - 1, -1); schedule(); });
  $('[data-release-next]', carousel).addEventListener('click', () => { show(i + 1, 1); schedule(); });
  dots.forEach((dot) => dot.addEventListener('click', () => { show(+dot.dataset.releaseDot); schedule(); }));
  // Touch/pointer drags: the release on screen and the one being pulled in travel together under the
  // finger, in either direction, and the incoming artwork is visible for the whole gesture.
  const stopDrag = attachSlideDrag(carousel, {
    slides,
    current: () => i,
    go: (direction) => { show(i + direction, direction); schedule(); },
    ignore: 'button',                                   // a drag that starts on an arrow is a tap on it
  });
  region.addEventListener('mouseenter', () => { hovering = true; updatePause(); });
  region.addEventListener('mouseleave', () => { hovering = false; updatePause(); });
  region.addEventListener('focusin', () => { focused = true; updatePause(); });
  region.addEventListener('focusout', (event) => { if (!region.contains(event.relatedTarget)) { focused = false; updatePause(); } });
  positionSlides(slides, 0, 1, -1, true);
  schedule();
  ctx.onCleanup(() => { clearInterval(timer); stopDrag?.(); });
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

  mountHero(ctx.root, ctx);
  mountReleaseSlideshow(ctx.root, ctx);
  enhanceRails(ctx.root);
}
