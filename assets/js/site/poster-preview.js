/* ============================================================
     POSTER HOVER PREVIEW (desktop only)
     ============================================================ */
  let posterPreviewShowTimer = null;
  let posterPreviewHideTimer = null;
  let posterPreviewCleanupTimer = null;
  let posterPreviewActiveCard = null;

  function initPosterPreview() {
    const preview = document.getElementById('posterPreview');
    if (!preview) return;

    if (!supportsHoverPreview()) {
      preview.style.display = 'none';
      return;
    }

    window.addEventListener('scroll', hidePosterPreview, { passive: true });
    window.addEventListener('resize', hidePosterPreview);

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('#posterPreview')) return;
      hidePosterPreview();
    }, true);
  }

  function bindPosterHoverListeners() {
    document.querySelectorAll('.upcoming-card').forEach(card => {
      if (card._posterHoverBound) return;
      card._posterHoverBound = true;

      card.addEventListener('mouseenter', () => {
        clearTimeout(posterPreviewShowTimer);
        clearTimeout(posterPreviewHideTimer);
        posterPreviewShowTimer = setTimeout(() => showPosterPreview(card), 350);
      });

      card.addEventListener('mouseleave', () => {
        clearTimeout(posterPreviewShowTimer);
        scheduleHidePosterPreview();
      });
    });
  }

  function scheduleHidePosterPreview() {
    clearTimeout(posterPreviewHideTimer);
    posterPreviewHideTimer = setTimeout(hidePosterPreview, 160);
  }

  function showPosterPreview(card) {
    const preview = document.getElementById('posterPreview');
    if (!preview) return;
    if (posterPreviewActiveCard === card) return;

    const src = card.dataset ? card.dataset.posterSrc : '';
    if (!src) return;

    posterPreviewActiveCard = card;

    const img = preview.querySelector('.poster-preview-media img');
    const fallback = preview.querySelector('.poster-preview-fallback');
    const titleEl = preview.querySelector('.poster-preview-title');

    if (img) {
      img.style.display = '';
      img.onerror = function () {
        this.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
      };
      img.src = src;
    }
    if (fallback) fallback.style.display = 'none';

    const title = card.dataset.posterTitle || '';
    if (titleEl) {
      if (title) { titleEl.textContent = title; titleEl.style.display = ''; }
      else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
    }

    positionPosterPreviewOverTile(preview, card);
    void preview.offsetWidth;
    preview.classList.add('show');
    preview.setAttribute('aria-hidden', 'false');
  }

  function positionPosterPreviewOverTile(preview, card) {
    const rect = card.getBoundingClientRect();
    const pw = preview.offsetWidth || 340;
    const ph = preview.offsetHeight || 480;
    const margin = 14;

    let left = rect.left + rect.width / 2;
    if (left - pw / 2 < margin) left = margin + pw / 2;
    if (left + pw / 2 > window.innerWidth - margin) left = window.innerWidth - margin - pw / 2;

    let top = rect.top + rect.height / 2;
    if (top - ph / 2 < margin) top = margin + ph / 2;
    if (top + ph / 2 > window.innerHeight - margin) top = window.innerHeight - margin - ph / 2;

    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
  }

  function hidePosterPreview() {
    const preview = document.getElementById('posterPreview');
    if (!preview) return;
    clearTimeout(posterPreviewShowTimer);
    clearTimeout(posterPreviewHideTimer);
    clearTimeout(posterPreviewCleanupTimer);

    preview.classList.remove('show');
    preview.setAttribute('aria-hidden', 'true');
    posterPreviewActiveCard = null;

    posterPreviewCleanupTimer = setTimeout(() => {
      if (preview.classList.contains('show')) return;
      const img = preview.querySelector('.poster-preview-media img');
      if (img) { img.removeAttribute('src'); img.style.display = ''; }
      const fallback = preview.querySelector('.poster-preview-fallback');
      if (fallback) fallback.style.display = 'none';
      const titleEl = preview.querySelector('.poster-preview-title');
      if (titleEl) { titleEl.textContent = ''; titleEl.style.display = 'none'; }
    }, 240);
  }

  /* ============================================================
     POSTER FULL-SIZE MODAL
     ============================================================ */
  function openPosterModal(src, title) {
    if (!src) return;

    hidePosterPreview();
    hideCardPreview();

    const modalEl = document.querySelector('.modal');
    if (modalEl) modalEl.classList.add('poster-modal');

    const container = document.getElementById('modalContent');
    const caption = title ? '<div class="poster-modal-caption">' + escapeHtml(title) + '</div>' : '';

    container.innerHTML =
      '<div class="poster-modal-inner">' +
        '<div class="poster-modal-imgwrap">' +
          '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(title || 'ADDABAAZ image') + '" ' +
            'onerror="this.style.display=\'none\'; if(this.nextElementSibling){this.nextElementSibling.style.display=\'flex\';}" />' +
          '<div class="poster-modal-fallback" style="display:none;">' +
            '<i class="fas fa-camera"></i>' +
            '<span>Preview</span>' +
          '</div>' +
        '</div>' +
        caption +
      '</div>';

    document.getElementById('modalBackdrop').classList.add('show');
  }

  /* Delegated click / keyboard handling for poster-style cards */
  document.addEventListener('click', (e) => {
    const card = e.target && e.target.closest ? e.target.closest('.upcoming-card') : null;
    if (!card) return;
    openPosterModal(card.dataset.posterSrc, card.dataset.posterTitle);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target && e.target.closest ? e.target.closest('.upcoming-card') : null;
    if (!card) return;
    e.preventDefault();
    openPosterModal(card.dataset.posterSrc, card.dataset.posterTitle);
  });
