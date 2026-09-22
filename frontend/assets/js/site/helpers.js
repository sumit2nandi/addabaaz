/* ============================================================
     HELPERS
     ============================================================ */
  function getYouTubeThumbnail(youtubeId, fallbackImage) {
    if (!youtubeId) return fallbackImage;
    return 'https://img.youtube.com/vi/' + youtubeId + '/hqdefault.jpg';
  }

  function videoLabel(ep) {
    if (!ep) return 'EPISODE';
    if (ep.kind === 'PROMO') return 'PROMO';
    if (ep.kind === 'SPECIAL') return 'SPECIAL';
    if (ep.episode) return 'EP ' + String(ep.episode).padStart(2, '0');
    return 'EPISODE';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function getShowPoster(show) {
    return show.image || (show.episodes[0] && show.episodes[0].thumbnail) || '';
  }

  function resetScrollPosition() {
    const html = document.documentElement;
    const prevBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
    catch (e) { window.scrollTo(0, 0); }
    html.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    html.style.scrollBehavior = prevBehavior;
  }

  /* Encode only the filename portion of a folder+file path */
  function buildMediaUrl(folder, file) {
    return folder + encodeURIComponent(file).replace(/'/g, '%27');
  }

  /* ============================================================
     SCROLL MEMORY
     ============================================================ */
  const scrollMemory = {
    homeTab: 0,
    aboutTab: 0,
    servicesTab: 0,
    contactTab: 0,
    playerTab: 0,
    upcomingTab: 0,
    btsTab: 0
  };

  function currentTabId() {
    const a = document.querySelector('.tab-content.active');
    return a ? a.id : 'homeTab';
  }

  function saveScrollPosition(tabId) {
    const id = tabId || currentTabId();
    scrollMemory[id] = window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function restoreScrollPosition(tabId) {
    const y = scrollMemory[tabId] || 0;
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    try { window.scrollTo(0, y); }
    catch (e) { window.scrollTo({ top: y, left: 0, behavior: 'auto' }); }
    html.style.scrollBehavior = prev;
  }

  /* ============================================================
     VIDEO PLAYER
     ============================================================ */
  function createVideoPlayer(youtubeId) {
    const playerBox = document.getElementById('videoPlayerBox');
    if (!playerBox) return;

    playerBox.innerHTML =
      '<iframe id="ytPlayerIframe" src="https://www.youtube.com/embed/' + encodeURIComponent(youtubeId) +
      '?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=' +
      encodeURIComponent(location.origin) +
      '" title="ADDABAAZ video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';

    const iframe = document.getElementById('ytPlayerIframe');
    if (!iframe) return;

    const unmute = () => {
      try {
        iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
        iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":"[100]"}', '*');
      } catch (e) {}
    };
    setTimeout(unmute, 600);
    setTimeout(unmute, 1500);
    setTimeout(unmute, 3000);
  }
