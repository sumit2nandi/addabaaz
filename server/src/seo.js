import fs from 'node:fs';
import path from 'node:path';
import { Catalog } from '../../app/js/data/catalog.js';
import { matchRoute } from '../../app/js/routes.js';
import { pageMeta, absUrl, clip, showFullName, videoIndexable, videoDescription, SITE, TYPE_LABEL } from '../../app/js/seo/meta.js';
import { esc } from '../../app/js/util.js';
import { legalDoc, LEGAL_PAGES, LEGAL_UPDATED } from '../../app/js/legal-text.js';

/**
 * Search-engine support for the website served by this server:
 *  - every page URL (/show/shahid …) returns the app shell with that page's <title>, description, canonical URL, Open Graph /
 *    Twitter tags and JSON-LD already in the HTML, plus a plain-text copy of the page content (headings, links, images with
 *    alt text) — so crawlers and link-preview bots that don't run JavaScript still see it. The app then takes over.
 *  - correct status codes (real 404 for unknown pages, 301 for renamed/duplicate URLs), robots.txt, sitemap.xml.
 * The metadata itself comes from app/js/seo/meta.js, which the browser also uses, so both always agree.
 */

// Tiny HTML builders used to write the crawler-visible copy of each page (all text is escaped).
const A = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const li = (href, text, extra = '') => `<li>${A(href, text)}${extra ? ` — ${esc(extra)}` : ''}</li>`;
const enc = encodeURIComponent;
// JSON for embedding in a <script> tag: `<` is escaped so the data can never close the tag early.
const jsonForHtml = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const showName = (s) => s.titleEn || s.title;

/** Origin used in canonical URLs, the sitemap and structured data. PUBLIC_SITE_URL wins; otherwise what the request said. */
// Falls back to the request's own host when PUBLIC_SITE_URL is not set.
export function siteOrigin(req, configured) {
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/** The visible-to-crawlers copy of a page (kept visually hidden: the real page is drawn by the app). */
// One `case` per page type; each writes a heading, description and links to related pages.
export function bodyHtml(m, { view, params }, cat, studio, plans) {
  const h1 = (t) => `<h1>${esc(t)}</h1>`;
  const intro = (t, d = m.description) => `${h1(t)}<p>${esc(d)}</p>`;
  const nav = `<nav aria-label="Site">${[['/', 'Home'], ['/shows', 'All shows'], ['/reels', 'Reels'], ['/upcoming', 'Coming soon'], ['/plans', 'Plans'], ['/about', 'About'], ['/services', 'Services'], ['/contact', 'Contact'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Use'], ['/refunds', 'Refund Policy']].map(([h, t]) => A(h, t)).join(' · ')}</nav>`;
  const showList = (list) => `<ul>${list.map((s) => li(`/show/${s.id}`, showFullName(s), s.tagline)).join('')}</ul>`;
  const epList = (list) => `<ul>${list.map((v) => li(`/watch/${v.id}`, `${v.kind === 'episode' && v.episode ? `EP ${v.episode}: ` : ''}${cat.displayTitle(v)}`)).join('')}</ul>`;
  let b = '';
  // Choose the content by which page (view) was requested.
  switch (view) {
    case 'home': {
      const latest = cat.latestVideos(12);
      b = `${intro('ADDABAAZ — Bengali web series, comedy and originals')}<h2>Shows</h2>${showList(cat.shows)}<h2>Latest episodes and videos</h2>${epList(latest)}` +
        (cat.upcoming.length ? `<h2>Coming soon</h2><ul>${cat.upcoming.map((u) => li(`/soon/${u.id}`, showFullName(u), u.note)).join('')}</ul>` : ''); break;
    }
    case 'browse': b = `${intro('All shows')}${showList(cat.shows)}`; break;
    case 'show': {
      const s = cat.show(params.id), eps = cat.episodes(s.id), extras = cat.extras(s.id).filter(videoIndexable);
      b = `${h1(showFullName(s))}<p>${esc(s.tagline || '')}</p><p>${esc(s.description || '')}</p>` +
        `<p>${esc(TYPE_LABEL[s.type] || 'Show')}${(s.genres || []).length ? ` · ${esc(s.genres.join(', '))}` : ''}${s.year ? ` · ${esc(s.year)}` : ''}${(s.cast || []).length ? ` · Starring ${esc(s.cast.join(', '))}` : ''}</p>` +
        (eps.length ? `<h2>Episodes</h2>${epList(eps)}` : '') + (extras.length ? `<h2>Trailers and clips</h2>${epList(extras)}` : ''); break;
    }
    case 'reels': if (!params.id) {          // /reels (the feed itself, no particular reel): a plain collection page
      b = `${intro('Reels')}<ul>${cat.reels().slice(0, 30).map((r) => li(`/reels/${r.id}`, cat.displayTitle(r), '')).join('')}</ul>`; break;
    }
    // falls through: /reels/:id is described like a watch page
    case 'watch': {
      const v = cat.video(params.id), s = cat.show(v.showId), eps = s ? cat.episodes(s.id) : [], i = eps.findIndex((e) => e.id === v.id);
      b = `${h1(cat.displayTitle(v))}<p>${esc(videoDescription(v, s, cat))}</p>` + (s ? `<p>From ${A(`/show/${s.id}`, showFullName(s))}</p>` : '') +
        (i > 0 ? `<p>Previous: ${A(`/watch/${eps[i - 1].id}`, cat.displayTitle(eps[i - 1]))}</p>` : '') + (i >= 0 && i < eps.length - 1 ? `<p>Next: ${A(`/watch/${eps[i + 1].id}`, cat.displayTitle(eps[i + 1]))}</p>` : ''); break;
    }
    case 'upcoming': b = `${intro('Coming soon')}<ul>${cat.upcoming.map((u) => li(`/soon/${u.id}`, showFullName(u), u.note)).join('')}</ul>`; break;
    case 'soon': { const u = cat.soon(params.id); b = `${intro(`${showFullName(u)} — coming soon`)}<p>${esc(u.note || '')}</p>${cat.show(u.showId) ? `<p>${A(`/show/${u.showId}`, 'Watch the show')}</p>` : ''}`; break; }
    // Legal pages (Privacy, Terms, ...) come from the shared legal-text module.
    case 'legal': {
      const d = legalDoc(LEGAL_PAGES[m.canonical], { studio: studio?.studio });
      b = `${h1(d.title)}<p>Last updated ${esc(LEGAL_UPDATED)}.</p><p>${esc(d.intro)}</p>` + d.sections.map(([h, ps]) => `<h2>${esc(h)}</h2>${ps.map((t) => `<p>${esc(t)}</p>`).join('')}`).join(''); break;
    }
    case 'plans': b = `${intro('Plans and pricing')}<ul>${(plans || []).map((p) => `<li>${esc(p.name)} — ${p.priceINR ? `₹${p.priceINR} per ${esc(p.interval)}` : 'free'}: ${esc((p.features || []).join('; '))}</li>`).join('')}</ul>`; break;
    case 'studio': {
      const st = studio?.studio || {}, path = m.canonical;
      b = intro(path === '/contact' ? 'Contact ADDABAAZ' : path === '/services' ? 'Our services' : 'About ADDABAAZ') +
        (path === '/services' ? `<ul>${(studio?.services || []).map((x) => `<li><strong>${esc(x.title)}</strong> ${esc(x.text || x.description || '')}</li>`).join('')}</ul>` : '') +
        (path === '/about' ? `<ul>${(studio?.missionEn || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '') +
        (path === '/contact' ? `<address>${(st.address || []).map(esc).join(', ')}<br>${st.email ? A(`mailto:${st.email}`, st.email) : ''}<br>${(st.phones || []).map(esc).join(', ')}</address>` : ''); break;
    }
    default: b = m.status === 404 ? `${h1('Page not found')}<p>${A('/', 'Go to the ADDABAAZ home page')}</p>` : h1(m.title.replace(/ — ADDABAAZ$/, ''));
  }
  // Visually hidden but present in the HTML for crawlers; the browser app draws the real page on top.
  return `<div class="sr-only" id="seo-content">${nav}${b}</div>`;
}

// Factory. `catalog` supplies the data; `indexable` decides if search engines may index this deployment at all.
export function createSeo({ catalog, root, plans, origin: configuredOrigin = '', indexable = false, verification = {}, staticDir = root }) {
  // The app shell (index.html) is read once and re-read only when the file changes.
  const indexFile = path.join(root, 'index.html');
  let tpl = null, tplMtime = 0, preloads = null;
  const template = () => {
    const mt = fs.statSync(indexFile).mtimeMs;
    if (!tpl || mt !== tplMtime) { tpl = fs.readFileSync(indexFile, 'utf8'); tplMtime = mt; preloads = null; }
    return tpl;
  };
  /** URLs of main.js and everything it imports statically — preloaded so the app starts without a request waterfall. */
  const modulePreloads = () => {
    if (preloads) return preloads;
    // Follow `import` statements from main.js to list every module the page needs; each is preloaded so the app starts faster.
    const seen = new Set(), walk = (rel) => {
      if (seen.has(rel)) return; seen.add(rel);
      let src = ''; try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return; }
      for (const m of src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm)) {
        const spec = m[1] || m[2]; walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      }
    };
    walk('app/js/main.js');
    return (preloads = [...seen].filter((f) => f.endsWith('.js')));
  };

  // The catalog view (with lookup helpers) is rebuilt only when the catalog version changes.
  let catCache = { version: null, cat: null };
  const view = async () => {
    const snap = await catalog.get();
    if (catCache.version !== snap.version || !catCache.cat) catCache = { version: snap.version, cat: new Catalog(snap.catalog) };
    return { cat: catCache.cat, studio: snap.studio, snap };
  };
  const originOf = (req) => siteOrigin(req, configuredOrigin);

  // Builds the <head> tags for one page: title, description, robots, canonical URL, Open Graph / Twitter cards, verification tags and JSON-LD structured data.
  const headHtml = (m, origin, path_) => {
    const url = m.canonical ? origin + m.canonical : null;
    const robots = indexable ? m.robots : 'noindex,nofollow';
    const tags = [
      '<base href="/">',
      `<title>${esc(m.title)}</title>`,
      `<meta name="description" content="${esc(m.description)}">`,
      `<meta name="robots" content="${esc(robots)}">`,
      url ? `<link rel="canonical" href="${esc(url)}">` : '',
      '<meta property="og:site_name" content="ADDABAAZ"><meta property="og:locale" content="en_IN">',
      `<meta property="og:type" content="${esc(m.ogType)}">`,
      `<meta property="og:title" content="${esc(m.title)}">`,
      `<meta property="og:description" content="${esc(m.description)}">`,
      url ? `<meta property="og:url" content="${esc(url)}">` : '',
      `<meta property="og:image" content="${esc(m.image)}">`,
      m.imageAlt ? `<meta property="og:image:alt" content="${esc(m.imageAlt)}">` : '',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${esc(m.title)}">`,
      `<meta name="twitter:description" content="${esc(m.description)}">`,
      `<meta name="twitter:image" content="${esc(m.image)}">`,
      '<meta name="ab:routing" content="history">',
      verification.google ? `<meta name="google-site-verification" content="${esc(verification.google)}">` : '',
      /^G-[A-Z0-9]+$/.test(verification.ga4 || '') ? `<meta name="ab:ga4" content="${esc(verification.ga4)}">` : '',
      verification.bing ? `<meta name="msvalidate.01" content="${esc(verification.bing)}">` : '',
      ...modulePreloads().map((f) => `<link rel="modulepreload" href="/${esc(f)}">`),
      m.status === 200 && /^\/(show|soon)\//.test(path_) && m.image.startsWith(origin + '/') ? `<link rel="preload" as="image" href="${esc(m.image.slice(origin.length))}" fetchpriority="high">` : '',
      m.jsonld?.length ? `<script type="application/ld+json" id="ld-page">${jsonForHtml(m.jsonld)}</script>` : '',
    ];
    return tags.filter(Boolean).join('\n');
  };

  // Makes footer links real URLs (not #hash links) so crawlers can follow them.
  const footerLinks = (html) => html.replace(/(<footer[\s\S]*?<\/footer>)/, (f) => f.replace(/href="#\/([^"]*)"/g, 'href="/$1"'));

  /** Render the shell for a path. Returns { status, headers, body } or { redirect }. */
  async function render(req) {
    const origin = originOf(req);
    const urlPath = req.path;
    // one URL per page: no trailing slash, no /index.html
    if (urlPath === '/index.html') return { redirect: '/' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') };
    if (urlPath.length > 1 && urlPath.endsWith('/')) return { redirect: urlPath.replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') };
    const { cat, studio } = await view();
    const query = req.query || {};
    // The metadata comes from the same module the browser uses (app/js/seo/meta.js), so both always agree.
    const m = pageMeta({ path: urlPath, query, cat, studio, origin, plans });
    if (m.redirect) return { redirect: m.redirect, status: m.status };
    // Pages that do not exist are rendered as the 404 view (with a real 404 status).
    const route = (m.status === 200 && matchRoute(urlPath)) || { view: '404', params: {} };
    // Fill the placeholders in index.html with the generated head and body.
    let html = template();
    html = html.replace(/<!--seo:head-->[\s\S]*?<!--\/seo:head-->/, () => headHtml(m, origin, urlPath));
    html = html.replace(/<!--seo:body--><!--\/seo:body-->/, () => bodyHtml(m, route, cat, studio, plans));
    html = footerLinks(html);
    const robotsHeader = !indexable || m.robots.startsWith('noindex') ? { 'X-Robots-Tag': 'noindex' } : {};
    return { status: m.status, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8', ...robotsHeader, ...(m.status === 200 ? { 'Cache-Control': 'public, max-age=0, must-revalidate' } : { 'Cache-Control': 'no-cache' }) } };
  }

  // robots.txt: staging/preview deployments block everything; production allows all but /admin and /api.
  const robotsTxt = (req) => indexable
    ? `User-agent: *\nDisallow: /admin\nDisallow: /content\nDisallow: /api/\n\nSitemap: ${originOf(req)}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';

  // sitemap.xml lists every indexable page, with last-modified dates and video info for watch pages.
  async function sitemapXml(req) {
    const origin = originOf(req), { cat } = await view();
    const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
    const url = (p, { lastmod, extra = '' } = {}) => `<url><loc>${esc(origin + p)}</loc>${lastmod ? `<lastmod>${day(lastmod)}</lastmod>` : ''}${extra}</url>`;
    const newest = (list) => list.map((v) => v.publishedAt).filter(Boolean).sort().at(-1);
    const out = [url('/', { lastmod: newest(cat.videos) })];
    for (const p of ['/shows', '/upcoming', '/plans', '/about', '/services', '/contact', '/privacy', '/terms', '/refunds']) out.push(url(p));
    for (const s of cat.shows) out.push(url(`/show/${s.id}`, { lastmod: newest(cat.videos.filter((v) => v.showId === s.id)) }));
    for (const u of cat.upcoming) out.push(url(`/soon/${u.id}`));
    for (const v of cat.videos) {
      if (!videoIndexable(v)) continue;
      const show = cat.show(v.showId), meta = pageMeta({ path: `/watch/${v.id}`, cat, origin });
      const thumb = absUrl(origin, cat.thumb(v));
      const vid = thumb ? `<video:video><video:thumbnail_loc>${esc(thumb)}</video:thumbnail_loc><video:title>${esc(clip(cat.displayTitle(v) + (show ? ` — ${showName(show)}` : ''), 100))}</video:title><video:description>${esc(clip(meta.description, 2000))}</video:description>${v.source?.type === 'youtube' ? `<video:player_loc>${esc(`https://www.youtube.com/embed/${v.source.id}`)}</video:player_loc>` : ''}<video:publication_date>${esc(v.publishedAt)}</video:publication_date>${(v.access === 'premium' || show?.access === 'premium') ? '<video:requires_subscription>yes</video:requires_subscription>' : ''}</video:video>` : '';
      out.push(url(`/watch/${v.id}`, { lastmod: v.publishedAt, extra: vid }));
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${out.join('\n')}\n</urlset>\n`;
  }

  // What app.js uses.
  return { render, robotsTxt, sitemapXml, indexable, origin: originOf, modulePreloads };
}
