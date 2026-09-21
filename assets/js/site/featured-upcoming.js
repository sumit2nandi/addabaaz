/* Featured posters share the full-size popup with the upcoming gallery.
   Excel row order is slide order; a single featured poster needs no controls. */
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
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: controller.signal });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const home = document.getElementById('homeTab');
  const modal = document.getElementById('modalBackdrop');
  let index = 0, timer = null, hovered = false, paused = reducedMotion.matches;
  let pauseButton, counter;
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
    slide.hidden = i !== 0;

    const image = document.createElement('img');
    image.alt = title;
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
    if (controller.signal.aborted || items.length < 2 || paused || hovered || document.hidden ||
        carousel.contains(document.activeElement) || !home.classList.contains('active') ||
        modal.classList.contains('show')) return;
    timer = setTimeout(() => showSlide(index + 1), FEATURED_SLIDE_DURATION);
  }

  function showSlide(next) {
    index = (next + items.length) % items.length;
    slides.forEach((slide, i) => { slide.hidden = i !== index; });
    // Preload only the next image instead of eagerly fetching the entire collection.
    slides[(index + 1) % items.length].querySelector('img').loading = 'eager';
    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    if (counter) counter.textContent = `${index + 1} / ${items.length}`;
    syncTimer();
  }

  if (items.length > 1) {
    const controls = document.createElement('div');
    controls.className = 'featured-upcoming-controls';
    const makeButton = (label, text, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.textContent = text;
      listen(button, 'click', action);
      return button;
    };
    const previous = makeButton('Previous featured release', '←', () => showSlide(index - 1));
    const next = makeButton('Next featured release', '→', () => showSlide(index + 1));
    const dotGroup = document.createElement('div');
    dotGroup.className = 'featured-upcoming-dots';
    items.forEach((item, i) => {
      const dot = makeButton(`Show featured release ${i + 1}: ${item.title || 'Upcoming release'}`, '', () => showSlide(i));
      dot.setAttribute('aria-controls', slides[i].id);
      dots.push(dot);
      dotGroup.append(dot);
    });
    counter = document.createElement('span');
    counter.className = 'featured-upcoming-counter';
    counter.setAttribute('aria-live', 'off');
    pauseButton = makeButton('', '', () => { paused = !paused; updatePauseButton(); syncTimer(); });
    function updatePauseButton() {
      pauseButton.textContent = paused ? 'Play' : 'Pause';
      pauseButton.setAttribute('aria-label', paused ? 'Play featured slideshow' : 'Pause featured slideshow');
    }
    updatePauseButton();
    controls.append(previous, dotGroup, next, counter, pauseButton);
    carousel.append(controls);
    listen(carousel, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const focusedSlide = slides.includes(document.activeElement);
      showSlide(index + (event.key === 'ArrowLeft' ? -1 : 1));
      if (focusedSlide) slides[index].focus({ preventScroll: true });
    });
    listen(reducedMotion, 'change', () => {
      paused = reducedMotion.matches;
      updatePauseButton();
      syncTimer();
    });
  }

  listen(carousel, 'mouseenter', () => { hovered = true; syncTimer(); });
  listen(carousel, 'mouseleave', () => { hovered = false; syncTimer(); });
  listen(carousel, 'focusin', syncTimer);
  listen(carousel, 'focusout', () => queueMicrotask(syncTimer));
  listen(document, 'visibilitychange', syncTimer);
  // Navigation and the shared popup change classes; stop rotation while either hides the carousel.
  const observer = new MutationObserver(syncTimer);
  observer.observe(home, { attributes: true, attributeFilter: ['class'] });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  disposeFeaturedUpcoming = () => {
    clearTimeout(timer);
    controller.abort();
    observer.disconnect();
  };
  showSlide(0);
}
