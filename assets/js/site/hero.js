/* ============================================================
     HERO SLIDESHOW
     ============================================================ */
  const HERO_SLIDE_DURATION = 12000;
  let heroSlides = [];
  let heroCurrentIndex = 0;
  let heroSlideTimer = null;
  let heroVideoTimer = null;
  let heroMuted = true;

  function computeHeroSlides() {
    const ranked = projectOrder
      .map(k => {
        const p = projectDetails[k];
        if (!p || !p.episodes || !p.episodes.length) return null;
        const views = p.episodes.reduce((n, v) => n + Number(String(v.views).replace(/,/g, '') || 0), 0);
        return { key: k, show: p, views };
      })
      .filter(Boolean)
      .sort((a, b) => b.views - a.views)
      .slice(0, 3);

    heroSlides = ranked.map(r => {
      const show = r.show;
      const withYT = show.episodes.filter(e => e.youtubeId);
      const previewEp = withYT[0] || show.episodes[0];
      return {
        key: r.key,
        show,
        previewEpisode: previewEp,
        thumbnail: getShowPoster(show) || (previewEp && previewEp.thumbnail) || '',
        youtubeId: previewEp ? previewEp.youtubeId : null
      };
    });
  }

  function buildHeroDots() {
    const dotsContainer = document.getElementById('heroDots');
    if (!dotsContainer) return;
    dotsContainer.innerHTML = heroSlides.map((_, i) =>
      '<button class="hero-dot" data-dot="' + i + '" onclick="goToHeroSlide(' + i + ')" aria-label="Go to slide ' + (i + 1) + '"></button>'
    ).join('');
  }

  function updateHeroDots() {
    document.querySelectorAll('.hero-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === heroCurrentIndex);
    });
  }

  function renderHeroSlide(index) {
    if (!heroSlides.length) return;
    heroCurrentIndex = index;
    const slide = heroSlides[index];

    document.querySelectorAll('.hero-slide-thumb').forEach((thumb, i) => {
      if (i === index) {
        thumb.style.backgroundImage = "url('" + slide.thumbnail + "')";
        thumb.classList.add('active');
        thumb.classList.remove('fade-out');
      } else {
        thumb.classList.remove('active');
      }
    });

    const content = document.getElementById('heroContent');
    if (content) {
      const epCount = slide.show.episodes.length;
      content.innerHTML =
        '<div class="hero-content-swap">' +
          '<div class="hero-kicker">ADDABAAZ Original</div>' +
          '<h1 class="hero-title">' + escapeHtml(slide.show.title) + '</h1>' +
          '<div class="hero-meta">' + escapeHtml(slide.show.subtitle) + ' • ' + epCount + ' episodes • Bengali</div>' +
          '<div class="hero-ctas">' +
            '<button class="btn btn-primary" onclick="playFirstEpisode(\'' + slide.key + '\')">▶ Play</button>' +
            '<button class="btn btn-ghost" onclick="openModal(\'' + slide.key + '\')">Details</button>' +
            '<button class="hero-sound-btn" id="heroSoundBtn" onclick="toggleHeroMute()" style="display: ' + (heroVideoActive() ? 'inline-flex' : 'none') + ';" aria-label="Toggle audio">' +
              '<svg id="heroSoundIcon" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
    }

    updateHeroDots();
    startHeroVideoForCurrentSlide();
  }

  function heroVideoActive() { return !!document.getElementById('heroIframe'); }

  function startHeroVideoForCurrentSlide() {
    const bgContainer = document.getElementById('heroBgContainer');
    if (!bgContainer) return;
    const slide = heroSlides[heroCurrentIndex];
    if (!slide) return;

    bgContainer.innerHTML = '';
    if (heroVideoTimer) { clearTimeout(heroVideoTimer); heroVideoTimer = null; }

    const soundBtn = document.getElementById('heroSoundBtn');
    if (soundBtn) soundBtn.style.display = 'none';

    if (!slide.youtubeId) return;

    heroVideoTimer = setTimeout(() => {
      const activeThumb = document.querySelector('.hero-slide-thumb.active');
      if (activeThumb) activeThumb.classList.add('fade-out');

      heroMuted = true;
      bgContainer.innerHTML = '<iframe id="heroIframe" src="https://www.youtube.com/embed/' + encodeURIComponent(slide.youtubeId) + '?autoplay=1&mute=1&enablejsapi=1&controls=0&loop=1&playlist=' + encodeURIComponent(slide.youtubeId) + '&modestbranding=1&playsinline=1" title="' + escapeHtml(slide.show.title) + ' background" allow="autoplay"></iframe>';

      const soundBtnInner = document.getElementById('heroSoundBtn');
      if (soundBtnInner) soundBtnInner.style.display = 'inline-flex';

      heroVideoTimer = setTimeout(() => {
        bgContainer.innerHTML = '';
        const thumb = document.querySelector('.hero-slide-thumb.active');
        if (thumb) thumb.classList.remove('fade-out');
        const sb = document.getElementById('heroSoundBtn');
        if (sb) sb.style.display = 'none';
      }, HERO_SLIDE_DURATION - 4000);
    }, 2500);
  }

  function toggleHeroMute() {
    const iframe = document.getElementById('heroIframe');
    const soundIcon = document.getElementById('heroSoundIcon');
    if (!iframe) return;
    heroMuted = !heroMuted;
    const playerWin = iframe.contentWindow;
    if (heroMuted) {
      playerWin.postMessage('{"event":"command","func":"mute","args":""}', '*');
      if (soundIcon) soundIcon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
    } else {
      playerWin.postMessage('{"event":"command","func":"unMute","args":""}', '*');
      if (soundIcon) soundIcon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
  }

  function goToHeroSlide(index) {
    if (!heroSlides.length) return;
    if (heroSlideTimer) { clearTimeout(heroSlideTimer); heroSlideTimer = null; }
    heroCurrentIndex = index;
    renderHeroSlide(index);
    scheduleHeroSlide();
  }

  function nextHeroSlide() { if (!heroSlides.length) return; goToHeroSlide((heroCurrentIndex + 1) % heroSlides.length); }
  function prevHeroSlide() { if (!heroSlides.length) return; goToHeroSlide((heroCurrentIndex - 1 + heroSlides.length) % heroSlides.length); }

  function scheduleHeroSlide() {
    if (heroSlideTimer) clearTimeout(heroSlideTimer);
    heroSlideTimer = setTimeout(() => {
      goToHeroSlide((heroCurrentIndex + 1) % heroSlides.length);
    }, HERO_SLIDE_DURATION);
  }

  function initHeroBanner() {
    computeHeroSlides();
    if (!heroSlides.length) return;
    buildHeroDots();
    renderHeroSlide(0);
    scheduleHeroSlide();
  }

  function stopHeroBanner() {
    if (heroSlideTimer) { clearTimeout(heroSlideTimer); heroSlideTimer = null; }
    if (heroVideoTimer) { clearTimeout(heroVideoTimer); heroVideoTimer = null; }
    const bgContainer = document.getElementById('heroBgContainer');
    if (bgContainer) bgContainer.innerHTML = '';
    const soundBtn = document.getElementById('heroSoundBtn');
    if (soundBtn) soundBtn.style.display = 'none';
    document.querySelectorAll('.hero-slide-thumb').forEach(t => t.classList.remove('fade-out'));
  }

  function setupHeroSwipe() {
    const heroWrap = document.querySelector('.hero-wrap');
    if (!heroWrap) return;
    let startX = 0, startY = 0, dragging = false;

    heroWrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dragging = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) nextHeroSlide(); else prevHeroSlide();
      }
    });
    window.addEventListener('pointercancel', () => { dragging = false; });
  }
