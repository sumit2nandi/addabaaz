// Progressive artwork: show a small, quick-to-download rendition first, fetch the best one in the background,
// and keep the small image visible until the sharp file has finished downloading. On a slow connection the
// card or banner is never blank while the full-size file is still on its way.
//
// Markup contract (written by ui/components.js `img()` and `heroBg()`):
//   <img src="LOW" data-hq="HIGH">                       → low stays visible while HIGH downloads, then swaps
//   <picture><source media="…" srcset="LOW" data-hq="HIGH"><img src="LOW" data-hq="HIGH">
//                                                        → the source wins where its media query matches
//
// main.js calls loadHighQuality() from its delegated `load` listener. The high-quality file is preloaded into
// a separate Image and only assigned to the live element after it has loaded. If the low rendition itself
// fails, swapToHighQuality() assigns the best one directly so the element can recover immediately.

/** Return the compact WebP sibling for a new multi-resolution upload, or an empty string for legacy and
 *  non-uploaded assets. Only paths tagged `-hq` opt in, so older content never causes a pointless 404. */
export function lowResolutionSrc(src) {
  const match = /^(.*\/)([0-9a-f]{24})-hq\.(?:webp|png|jpg|gif)([?#].*)?$/i.exec(String(src || ''));
  if (!match || !/(?:^|\/)(?:uploads|r2-assets\/broadcast|r2-assets\/catalog)\/$/.test(match[1])) return '';
  return `${match[1]}${match[2]}-low.webp${match[3] || ''}`;
}

const matchesMedia = (mq) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(mq).matches : true);

/** Find the best rendition for the source currently selected by a <picture>, or the image itself. */
function highQualityTarget(img, mediaMatches) {
  const pic = img.parentElement?.tagName === 'PICTURE' ? img.parentElement : null;
  if (pic) {
    // The <source> that the browser is using for this picture decides which rendition is upgraded.
    const source = [...pic.querySelectorAll('source')].find((s) => !s.media || mediaMatches(s.media));
    if (source) {
      const hq = source.dataset.hq;
      return hq ? { source, hq } : null;
    }
  }
  const hq = img.dataset.hq;
  return hq ? { source: null, hq } : null;
}

/** Assign a rendition to the visible element and consume its pending upgrade. */
function applyHighQuality(img, target) {
  if (target.source) {
    delete target.source.dataset.hq;
    target.source.srcset = target.hq;
    // Setting src causes the browser to re-run <picture> source selection; this URL is already preloaded.
  } else delete img.dataset.hq;
  delete img.dataset.hqLoading;
  delete img.dataset.hqFailed;
  img.src = target.hq;
  return true;
}

/** Assign the best rendition immediately. Used when the placeholder itself has failed, so the element can recover. */
export function swapToHighQuality(img, mediaMatches = matchesMedia) {
  const target = highQualityTarget(img, mediaMatches);
  if (!target) return false;
  return applyHighQuality(img, target);
}

/** Begin fetching the best rendition without replacing the visible low-quality image until the fetch succeeds. */
export function loadHighQuality(img, mediaMatches = matchesMedia) {
  const target = highQualityTarget(img, mediaMatches);
  if (!target) return false;
  if (img.dataset.hqLoading === target.hq || img.dataset.hqFailed === target.hq) return true;

  // Older/test environments without the Image constructor retain the direct-swap behavior.
  const ImageCtor = typeof Image === 'function' ? Image : null;
  if (!ImageCtor) return swapToHighQuality(img, mediaMatches);

  img.dataset.hqLoading = target.hq;
  const preload = new ImageCtor();
  preload.onload = () => {
    if (img.dataset.hqLoading !== target.hq) return; // another viewport rendition took over while this loaded
    delete img.dataset.hqLoading;
    const active = highQualityTarget(img, mediaMatches);
    if (!active) return;
    if (active.hq !== target.hq) { loadHighQuality(img, mediaMatches); return; }
    applyHighQuality(img, active);
  };
  preload.onerror = () => {
    if (img.dataset.hqLoading !== target.hq) return;
    delete img.dataset.hqLoading;
    img.dataset.hqFailed = target.hq;
    // Keep the successfully-loaded compact image on screen; the failed upgrade is never allowed to blank it.
  };
  preload.src = target.hq;
  return true;
}
