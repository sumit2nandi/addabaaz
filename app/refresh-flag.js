/* Pull-to-refresh (app/js/ui/ptr.js) refreshes the page IN PLACE — it re-reads the catalog and
 * redraws the current page, with no reload at all, so the launch screen is never involved.
 *
 * This file covers the fallback: when the in-place refresh is unavailable or fell over, ptr.js plants
 * `ab:refresh` in sessionStorage right before location.reload(). That reload is an in-app refresh,
 * NOT an app launch — it must not replay the launch splash (the splash belongs to the first launch
 * only).
 * The script runs from <head> before the first paint, so the compact loader (html.ab-refresh — see
 * app/css/styles.css, which also keeps the app's dark background instead of the launch canvas) is
 * visible from the very first frame of the reload.
 * The flag is consumed here, so it applies to exactly that one reload: the next genuine launch
 * (new app session) shows the full splash again. */
try {
  if (sessionStorage.getItem('ab:refresh') === '1') {
    sessionStorage.removeItem('ab:refresh');
    document.documentElement.classList.add('ab-refresh');
  }
} catch (e) { /* storage unavailable: the splash shows on this reload — acceptable fallback */ }
