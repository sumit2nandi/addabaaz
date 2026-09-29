/* Keeps <title>, description, canonical, robots, Open Graph / Twitter tags and JSON-LD in step with the page shown
 * (the server writes the same tags into the first HTML response — see seo/meta.js). Browser only. */
const ensure = (selector, make) => document.head.querySelector(selector) || document.head.appendChild(make());
const meta = (attr, key) => ensure(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; });
const set = (attr, key, value) => {
  if (value == null || value === '') { document.head.querySelector(`meta[${attr}="${key}"]`)?.remove(); return; }
  meta(attr, key).setAttribute('content', value);
};

export function applyHead(m, { canonical = true } = {}) {
  document.title = m.title;
  set('name', 'description', m.description); set('name', 'robots', m.robots);
  const link = document.head.querySelector('link[rel="canonical"]');
  let origin = location.origin;
  try { if (link?.href) origin = new URL(link.href).origin; } catch { /* keep */ }
  const url = canonical && m.canonical ? origin + m.canonical : null;
  if (url) (link || ensure('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }))).setAttribute('href', url);
  else link?.remove();
  set('property', 'og:title', m.title); set('property', 'og:description', m.description); set('property', 'og:type', m.ogType);
  set('property', 'og:url', url); set('property', 'og:image', m.image); set('property', 'og:image:alt', m.imageAlt);
  set('name', 'twitter:title', m.title); set('name', 'twitter:description', m.description); set('name', 'twitter:image', m.image); set('name', 'twitter:card', 'summary_large_image');
  let ld = document.getElementById('ld-page');
  if (m.jsonld?.length) {
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'ld-page'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify(m.jsonld).replace(/</g, '\\u003c');
  } else ld?.remove();
}
