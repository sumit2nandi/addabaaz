/* ============================================================
     INIT
     ============================================================ */
  let resizeDebounceTimer = null;

  function initializeSite() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    renderShowRows();
    renderFeaturedUpcoming();
    renderComingSoonRow();
    renderBtsRow();
    renderUpcomingGrid();
    renderBtsGrid();
    initHeroBanner();
    setupRowAnimations();
    setupHeroSwipe();
    initCardPreview();
    initPosterPreview();

    requestAnimationFrame(() => generateCaptcha(true));
    history.replaceState({ tab: 'homeTab', playback: null }, '', location.pathname + location.search);
    resetScrollPosition();

    document.querySelectorAll('.rail-viewport').forEach(v => {
      if (v.id) v.addEventListener('scroll', () => updateScrollArrowsFor(v));
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll('.rail-viewport').forEach(v => updateScrollArrowsFor(v));
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => { generateCaptcha(); }, 250);
    });

    setTimeout(() => {
      document.querySelectorAll('.rail-viewport').forEach(v => updateScrollArrowsFor(v));
    }, 0);
  }

  window.addEventListener('popstate', (e) => {
    const st = e.state || {};
    const tabId = st.tab || 'homeTab';
    if (tabId === 'playerTab') {
      const pb = st.playback || currentPlayback;
      if (pb && pb.type === 'standalone') { playStandalone(pb.id, { fromHistory: true }); return; }
      if (pb && pb.type === 'media') { playMedia(pb.showKey, pb.episodeId, { fromHistory: true }); return; }
    }
    openTab(tabId, null, { fromHistory: true });
  });

  function openModal(key) {
    const data = projectDetails[key];
    if (!data) return;
    hideCardPreview();
    hidePosterPreview();

    const modalEl = document.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('poster-modal');

    const container = document.getElementById('modalContent');

    const episodesListHtml = data.episodes && data.episodes.length > 0 ?
      '<div style="margin-top:28px;">' +
        '<h5 style="margin:0 0 12px;font-size:16px;color:var(--text-primary);">Episodes</h5>' +
        '<div class="modal-ep-list">' +
          data.episodes.map(ep =>
            '<div class="modal-ep-item" role="button" tabindex="0" onclick="playVideo(\'' + data.key + '\', \'' + ep.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();playVideo(\'' + data.key + '\', \'' + ep.id + '\')}" aria-label="Play ' + escapeHtml(ep.title) + '">' +
              '<div class="modal-ep-thumb" style="background-image:url(\'' + escapeHtml(getYouTubeThumbnail(ep.youtubeId, data.image)) + '\')">' +
                '<button type="button" class="play-btn modal-play-btn" onclick="event.stopPropagation(); playVideo(\'' + data.key + '\', \'' + ep.id + '\')" aria-label="Play ' + escapeHtml(ep.title) + '">▶</button>' +
              '</div>' +
              '<div class="modal-ep-info">' +
                '<h5>' + escapeHtml(ep.title) + '</h5>' +
                '<p>' + escapeHtml(ep.duration || '') + '</p>' +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>' : '';

    container.innerHTML =
      '<div style="display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="flex:0 0 200px;border-radius:12px;overflow:hidden;background:#111">' +
          '<img src="' + escapeHtml(data.image || getShowPoster(data)) + '" alt="' + escapeHtml(data.title) + '" style="width:100%;height:auto;aspect-ratio:2/3;object-fit:cover;display:block" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div style="flex:1;min-width:280px">' +
          '<h4 style="margin:0 0 6px;font-size:28px;font-weight:800;">' + escapeHtml(data.title) + '</h4>' +
          '<div style="color:var(--gold);margin-bottom:16px;font-size:15px;font-weight:600;">' + escapeHtml(data.subtitle) + '</div>' +
          '<div style="margin-bottom:18px;">' +
            '<button type="button" class="btn btn-primary" onclick="playFirstEpisode(\'' + data.key + '\')">▶ Play First Episode</button>' +
          '</div>' +
          '<div class="content" style="font-size:15px;line-height:1.65;color:var(--text-secondary);">' + escapeHtml(data.description) + '</div>' +
        '</div>' +
      '</div>' + episodesListHtml;

    document.getElementById('modalBackdrop').classList.add('show');
  }

  function openAuthModal(type) {
    const modalEl = document.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('poster-modal');

    const container = document.getElementById('modalContent');
    if (type === 'signIn') {
      container.innerHTML =
        '<h4 style="margin:0 0 10px; font-size:24px;">Sign In to ADDABAAZ</h4>' +
        '<p style="color:var(--muted); margin-bottom:20px;">Enter your details to access exclusive streaming content and production updates.</p>' +
        '<div class="social-btns">' +
          '<button class="btn-social" onclick="alert(\'Signed in with Google!\'); closeModal();">Continue with Google</button>' +
          '<button class="btn-social" onclick="alert(\'Signed in with Facebook!\'); closeModal();">Continue with Facebook</button>' +
        '</div>' +
        '<div class="social-login-divider"><span>or sign in with email</span></div>' +
        '<form onsubmit="event.preventDefault(); alert(\'Signed in successfully!\'); closeModal();">' +
          '<div class="form-group"><label>Email Address</label><input type="email" placeholder="name@example.com" required /></div>' +
          '<div class="form-group"><label>Password</label><input type="password" placeholder="••••••••" required /></div>' +
          '<button type="submit" class="btn btn-primary" style="width:100%; padding:12px; margin-top:8px;">Sign In</button>' +
        '</form>';
    } else if (type === 'subscribe') {
      container.innerHTML =
        '<h4 style="margin:0 0 10px; font-size:24px;">Subscribe to ADDABAAZ Premium</h4>' +
        '<p style="color:var(--muted); margin-bottom:20px;">Get unlimited access to original web series, documentaries, and ad film releases.</p>' +
        '<form onsubmit="event.preventDefault(); alert(\'Thank you for subscribing!\'); closeModal();">' +
          '<div class="form-group"><label>Full Name</label><input type="text" placeholder="Your name" required /></div>' +
          '<div class="form-group"><label>Email Address</label><input type="email" placeholder="name@example.com" required /></div>' +
          '<button type="submit" class="btn btn-primary" style="width:100%; padding:12px; margin-top:8px;">Join Premium Subscription</button>' +
        '</form>';
    }
    document.getElementById('modalBackdrop').classList.add('show');
  }

  function closeModal() {
    document.getElementById('modalBackdrop').classList.remove('show');
    const modalEl = document.querySelector('.modal');
    if (modalEl) modalEl.classList.remove('poster-modal');
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
