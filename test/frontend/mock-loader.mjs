// Module loader for frontend player tests: when app/js/players/index.js imports its adapters,
// serve controllable mocks instead so we can assert the autoplay-fallback decisions in isolation.
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || '';
  if (parent.includes('app/js/players/index.js')) {
    if (specifier === './youtube.js') return { url: new URL('./mock-youtube.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === './html5.js') return { url: new URL('./mock-html5.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
