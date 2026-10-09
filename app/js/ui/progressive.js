// Progressive artwork: show a small, quick-to-download rendition first, then swap in the best one once it has
// arrived. On a slow connection the card or banner is never blank while the full-size file is still on its way.
//
// Markup contract (written by ui/components.js `img()` and `heroBg()`):
//   <img src="LOW" data-hq="HIGH">                       → when LOW loads, src becomes HIGH
//   <picture><source media="…" srcset="LOW" data-hq="HIGH"><img src="LOW" data-hq="HIGH"></picture>
//                                                        → the source wins where its media query matches
//
// main.js calls swapToHighQuality() from its delegated `load` and `error` listeners. It returns true when it
// started loading the best rendition, so the caller can stop there; false means there is nothing to upgrade
// (already upgraded, or no best rendition was given) and the normal data-fb fallback applies.

const matchesMedia = (mq) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(mq).matches : true);

/**
 * @param {HTMLImageElement} img
 * @param {(mq: string) => boolean} [mediaMatches] tests a <source media>; defaults to window.matchMedia
 */
export function swapToHighQuality(img, mediaMatches = matchesMedia) {
  const pic = img.parentElement?.tagName === 'PICTURE' ? img.parentElement : null;
  if (pic) {
    // The <source> that the browser is using for this picture decides which rendition is upgraded.
    const source = [...pic.querySelectorAll('source')].find((s) => !s.media || mediaMatches(s.media));
    if (source) {
      const hq = source.dataset.hq;
      if (!hq) return false;
      delete source.dataset.hq;
      source.srcset = hq;
      img.src = hq; // assigning src makes the browser re-run source selection, so the high-quality file is fetched
      return true;
    }
  }
  const hq = img.dataset.hq;
  if (!hq) return false;
  delete img.dataset.hq;
  img.src = hq;
  return true;
}
