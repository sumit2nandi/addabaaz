/* Banner-style featured posters: crossfade, swipe/drag, dots and endless rotation.
   Excel row order is slide order. Tapping a poster opens the shared gallery popup. */
const FEATURED_SLIDE_DURATION = 5000;
let disposeFeaturedUpcoming = () => {};

function renderFeaturedUpcoming() {
  disposeFeaturedUpcoming();
  disposeFeaturedUpcoming = () => {};
  const container = document.getElementById('featuredUpcomingContainer');
  if (!container) return;
  container.replaceChildren();
  const items = upcomingReleases.filter(row => row.featured === 'yes');
  container.parentElement.hidden = items.length === 0;
  if (!items.length) return;

  const controller = new AbortController();
  const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: controller.signal });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const home = document.getElementById('homeTab');
  const modal = document.getElementById('modalBackdrop');
  let index = 0, requestedIndex = 0, requestId = 0, timer = null;
  let pointer = null, suppressClick = false, pending = false;
  const dots = [];

  const carousel = document.createElement('div');
  carousel.className = 'featured-upcoming-carousel';
  carousel.setAttribute('role', 'region');
  carousel.setAttribute('aria-label', 'Featured upcoming releases');
  if (items.length > 1) carousel.setAttribute('aria-roledescription', 'carousel');
  const stage = document.createElement('div');
  stage.className = 'featured-upcoming-slides';
  carousel.append(stage);
  container.append(carousel);

  const slides = items.map((item, i) => {
    const src = buildMediaUrl(UPCOMING_FOLDER, item.file);
    const title = item.title || 'Upcoming release';
    const slide = document.createElement('button');
    slide.type = 'button';
    slide.id = `featured-upcoming-slide-${i}`;
    slide.className = 'featured-upcoming-card';
    slide.setAttribute('aria-label', `Open ${title} poster (${i + 1} of ${items.length})`);

    const image = document.createElement('img');
    image.alt = title;
    image.draggable = false;
    image.loading = i < 2 ? 'eager' : 'lazy';
    const fallback = document.createElement('span');
    fallback.className = 'featured-upcoming-fallback';
    fallback.textContent = 'Image unavailable — open poster';
    fallback.hidden = true;
    listen(image, 'error', () => { image.hidden = true; fallback.hidden = false; });
    image.src = src;
    const overlay = document.createElement('span');
    overlay.className = 'featured-upcoming-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    slide.append(image, fallback, overlay);
    if (item.title) {
      const badge = document.createElement('span');
      badge.className = 'featured-upcoming-badge';
      badge.textContent = item.title;
      slide.append(badge);
    }
    listen(slide, 'click', () => openPosterModal(src, item.title));
    stage.append(slide);
    return slide;
  });

  function syncTimer() {
    clearTimeout(timer);
    timer = null;
    const focused = document.activeElement;
    const keyboardFocus = carousel.contains(focused) && focused.matches(':focus-visible');
    if (controller.signal.aborted || items.length < 2 || reducedMotion.matches || pointer || pending ||
        keyboardFocus || document.hidden || !home.classList.contains('active') || modal.classList.contains('show')) return;
    timer = setTimeout(() => showSlide(index + 1), FEATURED_SLIDE_DURATION);
  }

  function updateSlides() {
    slides.forEach((slide, i) => {
      // Keep outgoing imagery painted during the crossfade, but never interactive.
      slide.classList.toggle('active', i === index);
      slide.inert = i !== index;
      slide.tabIndex = i === index ? 0 : -1;
      slide.setAttribute('aria-hidden', String(i !== index));
    });
    for (const i of [(index + 1) % items.length, (index - 1 + items.length) % items.length]) {
      slides[i].querySelector('img').loading = 'eager';
    }
    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
  }

  async function showSlide(next, focusSlide = false) {
    const currentRequest = ++requestId;
    requestedIndex = ((next % items.length) + items.length) % items.length;
    const target = requestedIndex;
    pending = true;
    syncTimer();
    const image = slides[target].querySelector('img');
    image.loading = 'eager';
    // Keep the old poster visible while a new image loads; failures use its fallback.
    if (!image.complete) {
      try { await image.decode(); } catch { /* the error listener supplies a fallback */ }
    }
    if (controller.signal.aborted || currentRequest !== requestId) return;
    index = target;
    pending = false;
    updateSlides();
    if (focusSlide) slides[index].focus({ preventScroll: true });
    syncTimer();
  }

  if (items.length > 1) {
    const dotGroup = document.createElement('div');
    dotGroup.className = 'featured-upcoming-dots';
    items.forEach((item, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show featured release ${i + 1}: ${item.title || 'Upcoming release'}`);
      dot.setAttribute('aria-controls', slides[i].id);
      listen(dot, 'click', () => showSlide(i));
      dots.push(dot);
      dotGroup.append(dot);
    });
    carousel.append(dotGroup);
    listen(carousel, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      showSlide(requestedIndex + (event.key === 'ArrowLeft' ? -1 : 1), slides.includes(document.activeElement));
    });

    listen(stage, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || pointer) return;
      suppressClick = false;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      syncTimer();
    });
    listen(window, 'pointermove', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.hypot(dx, dy) > 8) pointer.moved = true;
      stage.classList.toggle('is-dragging', Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5);
    });
    listen(window, 'pointerup', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      suppressClick = pointer.moved || Math.hypot(dx, dy) > 8;
      pointer = null;
      stage.classList.remove('is-dragging');
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) showSlide(requestedIndex + (dx < 0 ? 1 : -1));
      else syncTimer();
    });
    const cancelPointer = () => {
      if (pointer) suppressClick = true;
      pointer = null;
      stage.classList.remove('is-dragging');
      syncTimer();
    };
    listen(window, 'pointercancel', event => { if (pointer?.id === event.pointerId) cancelPointer(); });
    listen(window, 'blur', cancelPointer);
    listen(stage, 'dragstart', event => event.preventDefault());
    // Drag/swipe must not be interpreted as a tap on the old or new poster.
    listen(stage, 'click', event => {
      if (suppressClick && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    }, { capture: true });
  }

  listen(reducedMotion, 'change', syncTimer);
  listen(carousel, 'focusin', syncTimer);
  listen(carousel, 'focusout', () => queueMicrotask(syncTimer));
  listen(document, 'visibilitychange', syncTimer);
  const observer = new MutationObserver(syncTimer);
  observer.observe(home, { attributes: true, attributeFilter: ['class'] });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  disposeFeaturedUpcoming = () => {
    clearTimeout(timer);
    controller.abort();
    observer.disconnect();
  };
  updateSlides();
  syncTimer();
}
