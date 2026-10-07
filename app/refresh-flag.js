/* Pull-to-refresh (app/js/ui/ptr.js) plants `ab:refresh` in sessionStorage right before
 * location.reload(). That reload is an in-app refresh, NOT an app launch — it must not replay
 * the full launch splash (the splash belongs to the first launch only).
 * This plain (non-module) script runs from <head> before the first paint, so the compact loader
 * (html.ab-refresh — see app/css/styles.css) is visible from the very first frame of the reload.
 * The flag is consumed here, so it applies to exactly that one reload: the next genuine launch
 * (new app session) shows the full splash again. */
try {
  if (sessionStorage.getItem('ab:refresh') === '1') {
    sessionStorage.removeItem('ab:refresh');
    document.documentElement.classList.add('ab-refresh');
  }
} catch (e) { /* storage unavailable: the splash shows on this reload — acceptable fallback */ }
