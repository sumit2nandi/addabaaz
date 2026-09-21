/* ============================================================
     CARD HOVER PREVIEW — popup OPENS OVER the tile
     ============================================================ */
  let cardPreviewShowTimer = null;
  let cardPreviewHideTimer = null;
  let cardPreviewCleanupTimer = null;
  let cardPreviewActiveCard = null;
  let cardPreviewMuted = true;

  const SPEAKER_MUTED_SVG =
    '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
  const SPEAKER_UNMUTED_SVG =
    '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';

  function updateCardPreviewSoundIcon() {
    const icon = document.getElementById('cardPreviewSoundIcon');
    const btn = document.getElementById('cardPreviewSoundBtn');
    if (icon) icon.innerHTML = cardPreviewMuted ? SPEAKER_MUTED_SVG : SPEAKER_UNMUTED_SVG;
    if (btn) {
      btn.classList.toggle('is-unmuted', !cardPreviewMuted);
      btn.setAttribute('aria-label', cardPreviewMuted ? 'Unmute preview' : 'Mute preview');
      btn.title = cardPreviewMuted ? 'Unmute' : 'Mute';
    }
  }

  function toggleCardPreviewSound(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const preview = document.getElementById('cardPreview');
    if (!preview) return;
    const iframe = preview.querySelector('.card-preview-video iframe');
    if (!iframe || !iframe.contentWindow) return;

    cardPreviewMuted = !cardPreviewMuted;
    try {
      if (cardPreviewMuted) {
        iframe.contentWindow.postMessage('{"event":"command","func":"mute","args":""}', '*');
      } else {
        iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
        iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":"[100]"}', '*');
      }
    } catch (err) {}
    updateCardPreviewSoundIcon();
  }

  function supportsHoverPreview() {
    if (window.innerWidth <= 820) return false;
    if (typeof window.matchMedia !== 'function') return true;
    try {
      return window.matchMedia('(hover: hover), (pointer: fine)').matches;
    } catch (e) { return true; }
  }

  function initCardPreview() {
    const preview = document.getElementById('cardPreview');
    if (!preview) return;

    if (!supportsHoverPreview()) {
      preview.style.display = 'none';
      return;
    }

    preview.addEventListener('mouseenter', () => clearTimeout(cardPreviewHideTimer));
    preview.addEventListener('mouseleave', () => scheduleHideCardPreview());

    bindCardHoverListeners();

    window.addEventListener('scroll', hideCardPreview, { passive: true });
    window.addEventListener('resize', hideCardPreview);

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('#cardPreview')) return;
      hideCardPreview();
    }, true);
  }

  function bindCardHoverListeners() {
    document.querySelectorAll('.card').forEach(card => {
      if (card._hoverBound) return;
      card._hoverBound = true;

      card.addEventListener('mouseenter', () => {
        clearTimeout(cardPreviewShowTimer);
        clearTimeout(cardPreviewHideTimer);
        cardPreviewShowTimer = setTimeout(() => showCardPreview(card), 400);
      });

      card.addEventListener('mouseleave', (e) => {
        clearTimeout(cardPreviewShowTimer);
        const to = e.relatedTarget;
        if (to && (to.id === 'cardPreview' || (to.closest && to.closest('#cardPreview')))) return;
        scheduleHideCardPreview();
      });
    });
  }

  function scheduleHideCardPreview() {
    clearTimeout(cardPreviewHideTimer);
    cardPreviewHideTimer = setTimeout(hideCardPreview, 180);
  }

  function showCardPreview(card) {
    const preview = document.getElementById('cardPreview');
    if (!preview) return;
    if (cardPreviewActiveCard === card) return;

    const yt = card.dataset ? card.dataset.yt : '';
    if (!yt) return;

    cardPreviewActiveCard = card;

    const title = card.dataset.previewTitle || '';
    const meta = card.dataset.previewMeta || '';
    const type = card.dataset.type || 'show';

    preview.querySelector('.card-preview-title').textContent = title;
    preview.querySelector('.card-preview-meta').textContent = meta;

    const detailsBtn = preview.querySelector('.card-preview-details');
    detailsBtn.style.display = (type === 'show') ? '' : 'none';

    const videoBox = preview.querySelector('.card-preview-video');
    const posterEl = card.querySelector('.poster');
    videoBox.style.backgroundImage = posterEl ? posterEl.style.backgroundImage : 'none';

    const originParam = (location.origin && location.origin !== 'null')
      ? '&origin=' + encodeURIComponent(location.origin)
      : '';

    videoBox.innerHTML =
      '<iframe src="https://www.youtube.com/embed/' + encodeURIComponent(yt) +
      '?autoplay=1&mute=1&loop=1&playlist=' + encodeURIComponent(yt) +
      '&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1' + originParam +
      '" title="ADDABAAZ preview" allow="autoplay; encrypted-media; picture-in-picture" frameborder="0"></iframe>';

    cardPreviewMuted = true;
    updateCardPreviewSoundIcon();

    positionPreviewOverTile(preview, card);
    void preview.offsetWidth;
    preview.classList.add('show');
    preview.setAttribute('aria-hidden', 'false');

    const iframe = videoBox.querySelector('iframe');
    setTimeout(() => { if (iframe && iframe.isConnected) iframe.classList.add('ready'); }, 450);

    const playBtn = preview.querySelector('.card-preview-play');
    playBtn.onclick = () => {
      hideCardPreview();
      if (type === 'show') playFirstEpisode(card.dataset.showKey);
      else playStandalone(card.dataset.promoId);
    };

    detailsBtn.onclick = () => {
      hideCardPreview();
      if (type === 'show') openModal(card.dataset.showKey);
      else playStandalone(card.dataset.promoId);
    };
  }

  function positionPreviewOverTile(preview, card) {
    const rect = card.getBoundingClientRect();
    const pw = preview.offsetWidth || 420;
    const ph = preview.offsetHeight || 320;
    const margin = 12;

    let left = rect.left + rect.width / 2;
    if (left - pw / 2 < margin) left = margin + pw / 2;
    if (left + pw / 2 > window.innerWidth - margin) left = window.innerWidth - margin - pw / 2;

    let top = rect.top + rect.height / 2;
    if (top - ph / 2 < margin) top = margin + ph / 2;
    if (top + ph / 2 > window.innerHeight - margin) top = window.innerHeight - margin - ph / 2;

    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
  }

  function hideCardPreview() {
    const preview = document.getElementById('cardPreview');
    if (!preview) return;
    clearTimeout(cardPreviewShowTimer);
    clearTimeout(cardPreviewHideTimer);
    clearTimeout(cardPreviewCleanupTimer);

    preview.classList.remove('show');
    preview.setAttribute('aria-hidden', 'true');
    cardPreviewActiveCard = null;
    cardPreviewMuted = true;

    cardPreviewCleanupTimer = setTimeout(() => {
      if (preview.classList.contains('show')) return;
      const videoBox = preview.querySelector('.card-preview-video');
      if (videoBox) { videoBox.innerHTML = ''; videoBox.style.backgroundImage = 'none'; }
    }, 260);
  }
