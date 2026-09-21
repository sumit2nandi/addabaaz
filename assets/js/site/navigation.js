/* ============================================================
     TAB SWITCHER
     ============================================================ */
  let currentPlayback = null;

  function openTab(tabId, el, opts = {}) {
    hideCardPreview();
    hidePosterPreview();

    const fromHistory = !!opts.fromHistory;
    const contents = document.querySelectorAll('.tab-content');
    const activeTab = document.querySelector('.tab-content.active');
    const targetTab = document.getElementById(tabId);

    if (activeTab === targetTab) {
      if (fromHistory) restoreScrollPosition(tabId);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (activeTab) saveScrollPosition(activeTab.id);

    if (!fromHistory) {
      history.pushState(
        { tab: tabId, playback: tabId === 'playerTab' ? currentPlayback : null },
        '',
        location.pathname + location.search
      );
    }

    if (activeTab && activeTab.id === 'playerTab' && tabId !== 'playerTab') {
      const playerBox = document.getElementById('videoPlayerBox');
      if (playerBox) playerBox.innerHTML = '';
    }

    if (tabId === 'homeTab') initHeroBanner(); else stopHeroBanner();

    const navLinks = document.querySelectorAll('.nav a');
    navLinks.forEach(link => link.classList.remove('active'));
    if (el && el.classList.contains('nav-link')) el.classList.add('active');
    else {
      const targetLink = document.querySelector('.nav a[onclick*="' + tabId + '"]');
      if (targetLink) targetLink.classList.add('active');
    }

    const afterSwap = fromHistory
      ? () => restoreScrollPosition(tabId)
      : () => resetScrollPosition();

    if (activeTab) {
      activeTab.classList.remove('show');
      setTimeout(() => {
        contents.forEach(content => content.classList.remove('active'));
        if (targetTab) {
          targetTab.classList.add('active');
          requestAnimationFrame(() => targetTab.classList.add('show'));
        }
        afterSwap();
        requestAnimationFrame(afterSwap);
        setTimeout(afterSwap, 60);
        setTimeout(afterSwap, 200);
      }, 350);
    } else if (targetTab) {
      targetTab.classList.add('active');
      requestAnimationFrame(() => targetTab.classList.add('show'));
    }

    if (!fromHistory) {
      resetScrollPosition();
      requestAnimationFrame(resetScrollPosition);
    }
  }
