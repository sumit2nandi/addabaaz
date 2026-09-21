/* ============================================================
     POSTER-STYLE CARDS  (Upcoming Releases + Behind the Scenes)
     ------------------------------------------------------------
     Both sections share the same portrait 2:3 card frame.
     ============================================================ */

  /* Generic maker — used by both rails/grids below */
  function makePosterCard(item, opts) {
    opts = opts || {};
    const folder = opts.folder || UPCOMING_FOLDER;
    const badge = opts.badge || 'Coming Soon';
    const cardClass = opts.cardClass || '';
    const fallbackIcon = opts.fallbackIcon || 'fa-film';
    const src = buildMediaUrl(folder, item.file);
    const title = item.title || '';
    const altText = title || 'ADDABAAZ image';

    return '<div class="upcoming-card ' + cardClass + '" tabindex="0" role="button" ' +
        'data-poster-src="' + escapeHtml(src) + '" ' +
        'data-poster-title="' + escapeHtml(title) + '" ' +
        'aria-label="' + escapeHtml(altText) + '">' +
        '<div class="upcoming-poster-wrap">' +
          '<div class="upcoming-fallback"><i class="fas ' + fallbackIcon + '"></i><span>' + escapeHtml(badge) + '</span></div>' +
          '<img class="upcoming-poster-img" src="' + escapeHtml(src) + '" alt="' + escapeHtml(altText) + '" loading="lazy" onerror="this.style.display=\'none\';" />' +
          '<div class="upcoming-badge">' + escapeHtml(badge) + '</div>' +
        '</div>' +
        (title ? '<div class="meta">' + escapeHtml(title) + '</div>' : '') +
      '</div>';
  }

  function makeUpcomingCard(item) {
    return makePosterCard(item, {
      folder: UPCOMING_FOLDER,
      badge: 'Coming Soon',
      cardClass: '',
      fallbackIcon: 'fa-film'
    });
  }
    function renderFeaturedUpcoming() {
    const container = document.getElementById('featuredUpcomingContainer');
    if (!container) return;

    const item = upcomingReleases.find(row => row.featured === 'yes');
    if (!item) { container.replaceChildren(); return; }
    const src = buildMediaUrl(UPCOMING_FOLDER, item.file);
    container.innerHTML = `
      <div class="featured-upcoming-card">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" />
        <div class="featured-upcoming-overlay"></div>
        <div class="featured-upcoming-badge">${escapeHtml(item.title)}</div>
      </div>
    `;
  }

  function makeBtsCard(item) {
    return makePosterCard(item, {
      folder: BTS_FOLDER,
      badge: 'BTS',
      cardClass: 'bts-card',
      fallbackIcon: 'fa-camera'
    });
  }

  function renderComingSoonRow() {
    const section = document.getElementById('comingSoonSection');
    const track = document.getElementById('comingSoonTrack');
    if (!track) return;

    if (!upcomingReleases.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    const items = upcomingReleases.filter(item => item.home === 'yes').slice(0, UPCOMING_HOME_LIMIT);
    track.innerHTML = items.map(makeUpcomingCard).join('');
    bindPosterHoverListeners();
  }

  function renderBtsRow() {
    const section = document.getElementById('btsSection');
    const track = document.getElementById('btsTrack');
    if (!track) return;

    if (!behindTheScenes.length) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';

    const items = behindTheScenes.slice(0, BTS_HOME_LIMIT);
    track.innerHTML = items.map(makeBtsCard).join('');
    bindPosterHoverListeners();
  }

  function renderUpcomingGrid() {
    const grid = document.getElementById('upcomingGrid');
    if (!grid) return;

    if (!upcomingReleases.length) {
      grid.innerHTML = '<div class="upcoming-empty">New releases are on their way — check back soon.</div>';
      return;
    }
    grid.innerHTML = upcomingReleases.map(makeUpcomingCard).join('');
    bindPosterHoverListeners();
  }

  function renderBtsGrid() {
    const grid = document.getElementById('btsGrid');
    if (!grid) return;

    if (!behindTheScenes.length) {
      grid.innerHTML = '<div class="upcoming-empty">Behind-the-scenes moments are coming soon.</div>';
      return;
    }
    grid.innerHTML = behindTheScenes.map(makeBtsCard).join('');
    bindPosterHoverListeners();
  }
