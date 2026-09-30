// Module loader for the watch-page autoplay tests: when views/watch.js imports its player adapter,
// serve a controllable mock instead so the page's blocked/muted fallback UI can be asserted without a browser.
export async function resolve(specifier, context, next) {
  if ((context.parentURL || '').includes('app/js/views/watch.js') && specifier === '../players/index.js') {
    return { url: new URL('./mock-player-index.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
