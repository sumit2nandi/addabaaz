/* ============================================================
     CARD BUILDERS  (video cards)
     ============================================================ */
  function makeShowCard(showKey) {
    const show = projectDetails[showKey];
    const firstEp = (show.episodes && show.episodes[0]) || null;
    const yt = firstEp ? (firstEp.youtubeId || '') : '';
    return '<div class="card" tabindex="0" data-type="show" data-show-key="' + escapeHtml(showKey) +
      '" data-yt="' + escapeHtml(yt) +
      '" data-preview-title="' + escapeHtml(show.title) +
      '" data-preview-meta="' + escapeHtml(show.subtitle) +
      '" onclick="openModal(\'' + showKey + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openModal(\'' + showKey + '\')}">' +
      '<div class="poster" style="background-image:url(\'' + escapeHtml(getShowPoster(show)) + '\')">' +
        '<div class="tag">' + escapeHtml(show.subtitle.split('•')[0].trim()) + '</div>' +
        '<div class="play-overlay"><div class="play-btn">▶</div></div>' +
      '</div>' +
      '<div class="meta"><div><strong>' + escapeHtml(show.title) + '</strong></div></div>' +
    '</div>';
  }

  function makePromoCard(v) {
    const thumb = v.thumbnail || getYouTubeThumbnail(v.youtubeId, '');
    const badge = v.kind === 'SPECIAL' ? 'SPECIAL' : 'PROMO';
    return '<div class="card catalog-card" tabindex="0" data-type="promo" data-promo-id="' + escapeHtml(v.id) +
      '" data-yt="' + escapeHtml(v.youtubeId || '') +
      '" data-preview-title="' + escapeHtml(v.title) +
      '" data-preview-meta="' + escapeHtml((v.duration || '') + ' • ' + badge) +
      '" onclick="playStandalone(\'' + v.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();playStandalone(\'' + v.id + '\')}">' +
      '<div class="poster">' +
        '<img class="catalog-poster-image" src="' + escapeHtml(thumb) + '" alt="" loading="lazy" decoding="async" onerror="this.style.display=\'none\';" />' +
        '<div class="kind-badge">' + badge + '</div>' +
        '<div class="play-overlay"><div class="play-btn">▶</div></div>' +
      '</div>' +
      '<div class="meta"><div class="video-title"><strong>' + escapeHtml(v.title) + '</strong></div><div class="video-meta">' + escapeHtml(v.duration) + '</div></div>' +
    '</div>';
  }

  function buildPromoRows() {
    const container = document.getElementById('promoRowsContainer');
    if (!container) return;
    container.innerHTML = '';

    const promos = promoVideos;
    const CHUNK = 10;
    if (promos.length === 0) return;

    for (let i = 0; i < promos.length; i += CHUNK) {
      const chunk = promos.slice(i, i + CHUNK);
      const rowNum = i / CHUNK + 1;
      const viewportId = 'promoViewport_' + rowNum;
      const leftId = 'promoLeft_' + rowNum;
      const rightId = 'promoRight_' + rowNum;

      const section = document.createElement('section');
      section.className = 'row animate-row';
      section.setAttribute('aria-label', 'Promos and reels part ' + rowNum);
      section.innerHTML =
        '<h3>Promos &amp; Reels ' + rowNum + '</h3>' +
        '<div class="rail">' +
          '<div class="arrow arrow-left disabled" id="' + leftId + '" onclick="scrollRail(\'' + viewportId + '\',-1)">◀</div>' +
          '<div class="rail-viewport" id="' + viewportId + '">' +
            '<div class="rail-track">' + chunk.map(makePromoCard).join('') + '</div>' +
          '</div>' +
          '<div class="arrow arrow-right" id="' + rightId + '" onclick="scrollRail(\'' + viewportId + '\',1)">▶</div>' +
        '</div>';
      container.appendChild(section);
    }
  }

  function renderShowRows() {
    const eligible = projectOrder.filter(k => projectDetails[k].episodes && projectDetails[k].episodes.length);

    const scored = eligible.map(k => {
      const p = projectDetails[k];
      const views = p.episodes.reduce((n, v) => n + Number(String(v.views).replace(/,/g, '') || 0), 0);
      return { k, views };
    }).sort((a, b) => b.views - a.views);

    document.getElementById('allShowsTrack').innerHTML = scored.map(x => makeShowCard(x.k)).join('');
    buildPromoRows();
    bindCardHoverListeners();
  }

  /* ============================================================
     PLAYBACK
     ============================================================ */
  function playStandalone(id, opts = {}) {
    const v = promoVideos.find(x => x.id === id);
    if (!v) return;
    currentPlayback = { type: 'standalone', id: v.id };
    closeModal();
    stopHeroBanner();
    hideCardPreview();
    hidePosterPreview();
    if (v.youtubeId && v.availability === 'available') createVideoPlayer(v.youtubeId);
    else document.getElementById('videoPlayerBox').innerHTML = '<div class="coming-soon-box"><h2>VIDEO UNAVAILABLE</h2><p>This video is currently unavailable.</p></div>';
    document.getElementById('playerTitle').textContent = v.title;
    document.getElementById('playerSub').textContent = v.kind + ' • ' + v.duration;
    document.getElementById('playerDesc').textContent = 'ADDABAAZ short-form content.';
    document.getElementById('episodesTrack').innerHTML = '';
    const epSection = document.getElementById('episodesSection');
    if (epSection) epSection.style.display = 'none';
    openTab('playerTab', null, opts);
    if (!opts.fromHistory) {
      resetScrollPosition();
      requestAnimationFrame(resetScrollPosition);
    }
  }

  function playVideo(showKey, videoId) {
    const show = projectDetails[showKey];
    if (!show) return;
    const video = show.episodes.find(v => v.id === videoId) || show.episodes[0];
    if (!video) return;
    playMedia(showKey, video.id);
  }

  function playFirstEpisode(showKey) {
    const show = projectDetails[showKey];
    if (!show || !show.episodes.length) return;
    playMedia(showKey, show.episodes[0].id);
  }

  function playMedia(showKey, episodeId, opts = {}) {
    const show = projectDetails[showKey];
    if (!show) return;
    const ep = show.episodes.find(e => e.id === episodeId) || show.episodes[0];
    if (!ep) return;

    currentPlayback = { type: 'media', showKey, episodeId: ep.id };

    closeModal();
    stopHeroBanner();
    hideCardPreview();
    hidePosterPreview();

    if (ep.youtubeId && ep.availability === 'available') {
      createVideoPlayer(ep.youtubeId);
    } else {
      const playerBox = document.getElementById('videoPlayerBox');
      if (playerBox) {
        playerBox.innerHTML = '<div class="coming-soon-box"><h2>VIDEO UNAVAILABLE</h2><p>This episode is currently unavailable.</p></div>';
      }
    }

    document.getElementById('playerTitle').innerText = ep.title;
    document.getElementById('playerSub').innerText = show.title + ' • Episode ' + String(ep.episode || 1).padStart(2, '0') + ' • ' + ep.duration;
    document.getElementById('playerDesc').innerText = show.description;
    document.getElementById('epListTitle').innerText = show.title + ' — Episodes';

    const epSection = document.getElementById('episodesSection');
    if (epSection) epSection.style.display = '';

    const epTrack = document.getElementById('episodesTrack');
    epTrack.innerHTML = show.episodes.map(e => {
      const thumbUrl = e.thumbnail || getYouTubeThumbnail(e.youtubeId, show.image);
      return '<div class="ep-card ' + (e.id === ep.id ? 'active-ep' : '') + '" role="button" tabindex="0" ' +
        'onclick="playVideo(\'' + showKey + '\', \'' + e.id + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();playVideo(\'' + showKey + '\', \'' + e.id + '\')}" aria-label="Play ' + escapeHtml(e.title) + '">' +
        '<div class="ep-thumb" style="background-image:url(\'' + escapeHtml(thumbUrl) + '\')">' +
          '<div class="play-btn" style="width:36px;height:36px;font-size:14px;">▶</div>' +
          '<div class="ep-badge">' + escapeHtml(videoLabel(e)) + '</div>' +
        '</div>' +
        '<div class="meta">' +
          '<strong>' + escapeHtml(e.title) + '</strong>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:4px;">' + escapeHtml(e.duration) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    openTab('playerTab', null, opts);
    if (!opts.fromHistory) {
      resetScrollPosition();
      requestAnimationFrame(resetScrollPosition);
    }

    setTimeout(() => {
      const epViewport = document.getElementById('epViewport');
      if (epViewport) {
        epViewport.addEventListener('scroll', () => updateArrowState(epViewport, 'epArrowLeft', 'epArrowRight'));
        updateArrowState(epViewport, 'epArrowLeft', 'epArrowRight');
      }
    }, 400);
  }

  /* ============================================================
     RAIL SCROLL
     ============================================================ */
  function scrollRail(viewportId, dir) {
    const viewport = document.getElementById(viewportId);
    if (!viewport) return;
    const card = viewport.querySelector('.card, .ep-card, .modal-ep-item, .upcoming-card');
    const step = (card ? card.offsetWidth : 210) + 18;
    viewport.scrollBy({ left: dir * step * 2, behavior: 'smooth' });
  }

  function updateArrowState(viewport, leftId, rightId) {
    const arrowLeft = document.getElementById(leftId);
    const arrowRight = document.getElementById(rightId);
    if (!viewport || !arrowLeft || !arrowRight) return;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    arrowLeft.classList.toggle('disabled', viewport.scrollLeft <= 5);
    arrowRight.classList.toggle('disabled', viewport.scrollLeft >= maxScrollLeft - 5);
  }

  function updateScrollArrowsFor(v) {
    const rail = v && v.closest ? v.closest('.rail') : null;
    const arrows = rail ? rail.querySelectorAll('.arrow') : null;
    if (!v || !arrows || arrows.length !== 2) return;
    const maxScroll = Math.max(0, v.scrollWidth - v.clientWidth);
    arrows[0].classList.toggle('disabled', v.scrollLeft <= 5);
    arrows[1].classList.toggle('disabled', v.scrollLeft >= maxScroll - 5);
  }

  /* ============================================================
     SCROLL ANIMATIONS
     ============================================================ */
  function setupRowAnimations() {
    const rows = document.querySelectorAll('.animate-row');
    if (!('IntersectionObserver' in window)) { rows.forEach(r => r.classList.add('in-view')); return; }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -60px 0px' });
    rows.forEach(r => observer.observe(r));
  }
