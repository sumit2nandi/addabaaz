/* Search-engine and social metadata for every page — ONE implementation used by the server (initial HTML, so crawlers and
 * link-preview bots that don't run JavaScript see it) and by the browser (kept in sync while you navigate, so what Google
 * sees after rendering matches the server's answer). Pure functions: no DOM, no Node APIs.
 *
 *   pageMeta({ path, query, cat, studio, origin, plans }) → {
 *     status, redirect?, title, description, canonical (path, or null), robots, image (absolute), imageAlt, ogType, jsonld: [...]
 *   }
 */
import { matchRoute } from '../routes.js';

import { legalDoc, LEGAL_PAGES, LEGAL_UPDATED } from '../legal-text.js';
// Labels and constants used in titles and descriptions.
export const SITE = 'ADDABAAZ';
export const TYPE_LABEL = { series: 'Bengali web series', standup: 'Stand-up comedy', podcast: 'Fake podcast', film: 'Bengali short film' };
const KIND_LABEL = { episode: 'episode', trailer: 'trailer', reel: 'reel', clip: 'clip' };
// Pages that must never be indexed (they show personal data); value = the page name used in their title.
const PRIVATE = { mylist: 'My List', account: 'Account', profiles: 'Choose a profile', billing: 'Billing & invoices', recover: 'Account recovery' };
// The robots directive for normal, indexable pages (allows large image and video previews).
const ROBOTS_INDEX = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';

/** Collapse whitespace and cut at a word boundary. */
// Shortens text for meta descriptions: prefers ending on a full sentence, otherwise a whole word, and adds an ellipsis.
export function clip(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('। '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > max * 0.4) return cut.slice(0, sentence + 1);          // end on a full sentence when there is one
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:|–—-]+$/, '') + '…';
}
export const absUrl = (origin, p) => (!p ? '' : /^(https?:)?\/\//.test(p) ? p : `${origin}/${String(p).replace(/^\/+/, '')}`);
/** Seconds → ISO 8601 duration (PT1H2M3S), as schema.org wants. */
export function isoDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (r || (!h && !m) ? r + 'S' : '');
}
/** First candidate title that fits in ~65 characters (search results cut longer ones), else the last one shortened. */
// Titles longer than ~65 characters get cut off in search results, so pick the first candidate that fits.
const fit = (options, max = 65) => options.find((t) => t.length <= max) || clip(options.at(-1), max);
const names = (list) => list.filter(Boolean);
const showName = (s) => s.titleEn || s.title;
/** "Shahid (শহীদ)" — English + native title, for titles and headings. */
export const showFullName = (s) => (s.titleEn && s.titleEn !== s.title ? `${s.titleEn} (${s.title})` : s.title);
const joinList = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1));

/** Description for a video that has none of its own — built from real fields so pages stay distinct. */
export function videoDescription(v, show, cat) {
  if (v.description) return v.description;
  const dt = cat.displayTitle(v), nm = show ? showName(show) : SITE;
  const what = v.kind === 'episode' ? (v.episode ? `episode ${v.episode}` : 'an episode') : `a ${KIND_LABEL[v.kind] || 'video'}`;
  const tail = show ? [show.tagline, (show.genres || []).length ? `${(show.genres || []).join(', ')}.` : ''] : [];
  return clip(names([`Watch ${dt} — ${what} of ${nm}${show ? `, ${TYPE_LABEL[show.type] || 'a show'} by ${SITE}` : ` from ${SITE}`}.`, ...tail]).join(' '), 158);
}
/** Reels are short and repetitive; they are only put in the index when someone wrote a real description for them. */
export const videoIndexable = (v) => v.kind !== 'reel' || !!(v.description && v.description.trim().length >= 40);

// JSON-LD structured data builders (schema.org): the organisation, breadcrumbs, item lists and VideoObject. Search engines use these for rich results.
const org = (origin, studio) => {
  const st = studio?.studio || {}, addr = st.address || [];
  const m = /^(.+?),\s*(.+?)\s+(\d{6})$/.exec(addr[1] || '');
  return {
    '@type': 'Organization', '@id': `${origin}/#org`, name: st.name || SITE, url: origin + '/', logo: `${origin}/media/icons/icon-512.png`,
    ...(st.email ? { email: st.email } : {}), ...((st.phones || [])[0] ? { telephone: st.phones[0] } : {}),
    ...(addr.length ? { address: { '@type': 'PostalAddress', streetAddress: addr[0], ...(m ? { addressLocality: m[1], addressRegion: m[2], postalCode: m[3] } : {}), addressCountry: 'IN' } } : {}),
    sameAs: Object.values(st.social || {}).filter(Boolean),
  };
};
const orgRef = (origin) => ({ '@type': 'Organization', name: SITE, url: origin + '/' });
const crumbs = (origin, items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: absUrl(origin, p) })) });
const itemList = (origin, items) => ({ '@type': 'ItemList', numberOfItems: items.length, itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, url: absUrl(origin, p) })) });
const video = (origin, v, cat, show, { url, full = true } = {}) => ({
  '@type': 'VideoObject', name: full ? clip(`${cat.displayTitle(v)}${show && !cat.displayTitle(v).includes(showName(show)) ? ` — ${showName(show)}` : ''}`, 110) : cat.displayTitle(v),
  description: videoDescription(v, show, cat), thumbnailUrl: [absUrl(origin, cat.thumb(v, 'hqdefault'))].filter(Boolean),
  uploadDate: v.publishedAt, duration: isoDuration(v.duration), inLanguage: 'bn', isFamilyFriendly: true,
  ...(url ? { url } : {}),
  ...(v.source?.type === 'youtube' ? { embedUrl: `https://www.youtube.com/embed/${v.source.id}` } : {}),
  ...(v.access === 'premium' ? { isAccessibleForFree: false } : { isAccessibleForFree: true }),
  ...(v.views ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: v.views } } : {}),
});

// MAIN FUNCTION: given a URL path, returns everything a page's <head> needs. One `if` branch per page type below.
// Unknown paths return status 404; renamed or duplicate URLs return a `redirect`.
export function pageMeta({ path, query = {}, cat, studio = null, origin, plans = null }) {
  path = (path || '/').replace(/\/+$/, '') || '/';
  const m = matchRoute(path);
  const out = { status: 200, title: '', description: '', canonical: path, robots: ROBOTS_INDEX, image: '', imageAlt: '', ogType: 'website', jsonld: [] };
  // Fallback share image: the featured show's poster.
  const defaultImage = () => { const f = cat.shows.find((s) => s.featured) || cat.shows[0]; return f ? absUrl(origin, f.posterLg || f.poster) : `${origin}/media/icons/icon-512.png`; };
  const finish = () => { if (!out.image) out.image = defaultImage(); return out; };
  const notFound = () => Object.assign(out, { status: 404, title: `Page not found — ${SITE}`, description: 'This page does not exist on ADDABAAZ.', canonical: null, robots: 'noindex,follow' });
  if (!m) return finish(notFound());
  const { view, params } = m;
  const site = org(origin, studio);
  const home = ['Home', '/'];

  // Home page.
  if (view === 'home') {
    const feat = cat.shows.filter((s) => s.featured).slice(0, 3), list = feat.length ? feat : cat.shows.slice(0, 3);
    out.title = `${SITE} — Bengali Web Series, Comedy & Originals`;
    out.description = clip(`Watch ${joinList(list.map(showName))} and more Bengali web series, stand-up comedy, fake podcasts and reels from ${SITE}, Kolkata's film & ad production house. Free episodes, new every week.`, 158);
    out.image = list[0] ? absUrl(origin, list[0].posterLg || list[0].poster) : '';
    out.jsonld = [{ '@type': 'WebSite', '@id': `${origin}/#website`, url: origin + '/', name: SITE, inLanguage: ['en', 'bn'], publisher: orgRef(origin),
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } }, site];
  // All shows.
  } else if (view === 'browse') {
    out.title = `All Shows — Bengali Web Series, Comedy & Podcasts | ${SITE}`; out.canonical = '/shows';
    out.description = clip(`Browse every ${SITE} show: ${joinList(cat.shows.map(showName))}. Bengali web series, stand-up comedy and fake podcasts — watch free online.`, 158);
    out.jsonld = [{ '@type': 'CollectionPage', name: 'All shows', url: `${origin}/shows` }, itemList(origin, cat.shows.map((s) => [showName(s), `/show/${s.id}`])), crumbs(origin, [home, ['Shows', '/shows']])];
  // A show page: TVSeries / CreativeWorkSeries data with breadcrumbs.
  } else if (view === 'show') {
    const s = cat.show(params.id);
    if (!s) return finish(cat.soon(params.id) ? Object.assign(out, { redirect: `/soon/${encodeURIComponent(params.id)}`, status: 301 }) : notFound());
    const eps = cat.episodes(s.id), extras = cat.extras(s.id), trailer = extras.find((v) => v.kind === 'trailer');
    const label = TYPE_LABEL[s.type] || 'Show';
    out.title = fit([`${showFullName(s)} — ${label} | ${SITE}`, `${showName(s)} — ${label} | ${SITE}`, `${showName(s)} | ${SITE}`]); out.canonical = `/show/${s.id}`;
    out.description = clip([s.tagline, s.description].filter(Boolean).join(' — ') || `Watch ${showName(s)} on ${SITE}.`, 158);
    out.image = absUrl(origin, s.posterLg || s.poster); out.imageAlt = `${showName(s)} poster`; out.ogType = 'video.tv_show';
    out.jsonld = [{
      '@type': s.type === 'series' ? 'TVSeries' : 'CreativeWorkSeries', name: s.title, ...(s.titleEn && s.titleEn !== s.title ? { alternateName: s.titleEn } : {}),
      url: `${origin}${out.canonical}`, description: s.description || s.tagline || '', image: out.image, genre: s.genres || [], inLanguage: s.language === 'Bengali' ? 'bn' : s.language || 'bn',
      ...(s.year ? { startDate: String(s.year) } : {}), ...((s.cast || []).length ? { actor: s.cast.map((n) => ({ '@type': 'Person', name: n })) } : {}),
      ...(eps.length && s.type === 'series' ? { numberOfEpisodes: eps.length } : {}), isAccessibleForFree: s.access !== 'premium',
      productionCompany: orgRef(origin),
      ...(trailer ? { trailer: video(origin, trailer, cat, s, { full: false }) } : {}),
    }, crumbs(origin, [home, ['Shows', '/shows'], [showName(s), out.canonical]])];
  // A video page: VideoObject data. Reels without a real description are marked noindex to avoid thin content.
  } else if (view === 'watch' || (view === 'reels' && params.id)) {
    const v = cat.video(params.id);
    if (!v) return finish(notFound());
    const s = cat.show(v.showId), dt = cat.displayTitle(v), nm = s ? showName(s) : SITE;
    const lead = v.kind === 'episode' && v.episode ? `${dt}${dt.includes(nm) ? '' : ` — ${nm}`} EP ${v.episode}` : `${dt}${dt.includes(nm) ? '' : ` — ${nm}`}`;
    out.title = `${clip(lead, 58)} | ${SITE}`; out.canonical = `/watch/${v.id}`;
    out.description = clip(videoDescription(v, s, cat), 158);
    out.image = absUrl(origin, cat.thumb(v, 'hqdefault')); out.imageAlt = dt; out.ogType = v.kind === 'episode' ? 'video.episode' : 'video.other';
    if (!videoIndexable(v)) out.robots = 'noindex,follow';
    out.jsonld = [video(origin, v, cat, s, { url: `${origin}${out.canonical}` }),
      crumbs(origin, [home, ...(s ? [['Shows', '/shows'], [showName(s), `/show/${s.id}`]] : []), [dt, out.canonical]])];
  // Reels listing.
  } else if (view === 'reels') {
    out.title = `Bengali Comedy & Drama Reels | ${SITE}`; out.canonical = '/reels';
    out.description = `Quick Bengali reels from ${SITE}: comedy sketches, stand-up clips and scenes from our web series. Swipe through and watch free.`;
    out.jsonld = [{ '@type': 'CollectionPage', name: 'Reels', url: `${origin}/reels` }, crumbs(origin, [home, ['Reels', '/reels']])];
  // Coming-soon listing.
  } else if (view === 'upcoming') {
    out.title = `Coming Soon — New Bengali Web Series & Films | ${SITE}`; out.canonical = '/upcoming';
    out.description = clip(`Upcoming ${SITE} releases: ${joinList(cat.upcoming.map(showName))}. Get a first look and set a reminder for launch day.`, 158);
    out.jsonld = [{ '@type': 'CollectionPage', name: 'Coming soon', url: `${origin}/upcoming` }, itemList(origin, cat.upcoming.map((u) => [showName(u), `/soon/${u.id}`])), crumbs(origin, [home, ['Coming soon', '/upcoming']])];
  // A single upcoming title.
  } else if (view === 'soon') {
    const u = cat.soon(params.id);
    if (!u) return finish(notFound());
    out.title = fit([`${showFullName(u)} — Coming Soon | ${SITE}`, `${showName(u)} — Coming Soon | ${SITE}`, `${showName(u)} | ${SITE}`]); out.canonical = `/soon/${u.id}`;
    out.description = clip([u.note, (u.genres || []).length ? `${(u.genres || []).join(' / ')} ${(TYPE_LABEL[u.type] || 'title').toLowerCase()} coming soon to ${SITE}.` : `Coming soon to ${SITE}.`, 'Set a reminder for launch day.'].filter(Boolean).join(' '), 158);
    out.image = absUrl(origin, u.backdrop || u.posterLg || u.poster); out.imageAlt = `${showName(u)} poster`;
    out.jsonld = [{ '@type': 'CreativeWork', name: u.title, ...(u.titleEn && u.titleEn !== u.title ? { alternateName: u.titleEn } : {}), url: `${origin}${out.canonical}`, image: out.image, genre: u.genres || [], inLanguage: 'bn', producer: orgRef(origin) },
      crumbs(origin, [home, ['Coming soon', '/upcoming'], [showName(u), out.canonical]])];
  // Behind-the-scenes gallery.
  } else if (view === 'gallery') {
    out.title = `Behind the Scenes — ${SITE} Sets, Shoots & Making-of Photos`; out.canonical = '/gallery';
    out.description = `Photos from the sets of ${SITE} productions${cat.gallery.length ? ` — ${joinList([...new Set(cat.gallery.map((g) => g.group))].slice(0, 4))}` : ''}: behind-the-scenes moments from our Kolkata film and web-series shoots.`;
    out.jsonld = [{ '@type': 'ImageGallery', name: 'Behind the scenes', url: `${origin}/gallery` }, crumbs(origin, [home, ['Behind the scenes', '/gallery']])];
  // Pricing page: describes the paid plans as schema.org offers.
  } else if (view === 'plans') {
    out.title = `Plans & Pricing — ${SITE} Plus | ${SITE}`; out.canonical = '/plans';
    out.description = `Watch free episodes and reels on ${SITE}, or go Plus from ₹99 a month for premium originals, early access and ad-free viewing on any device.`;
    const paid = (plans || []).filter((p) => p.priceINR > 0);
    out.jsonld = [...(paid.length ? [{ '@type': 'Product', name: `${SITE} Plus`, description: 'Premium originals, early access and ad-free viewing.', brand: { '@type': 'Brand', name: SITE }, url: `${origin}/plans`,
      offers: paid.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.priceINR), priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `${origin}/plans` })) }] : []), crumbs(origin, [home, ['Plans', '/plans']])];
  // About / Services / Contact pages.
  } else if (view === 'studio') {
    const st = studio?.studio || {};
    const page = { '/about': ['About ADDABAAZ — Kolkata Film & Ad Production House', `${st.tagline ? st.tagline.replace(/\.$/, '') + '. ' : ''}${SITE} makes Bengali web series, stand-up specials, films and commercial ad films — meet the team and our mission.`, 'AboutPage', 'About'],
      '/services': ['Film, Ad-Film & Web-Series Production Services in Kolkata | ADDABAAZ', `Services from ${SITE}: ${joinList((studio?.services || []).map((x) => x.title).slice(0, 5)) || 'film production, ad films and web series'} — a full-service production house in Kolkata.`, 'WebPage', 'Services'],
      '/contact': ['Contact ADDABAAZ — Production House in Kolkata', `Get in touch with ${SITE}: ${[st.email, (st.phones || [])[0]].filter(Boolean).join(' · ') || 'send us a message'}${(st.address || [])[1] ? ` — ${st.address[1]}` : ''}.`, 'ContactPage', 'Contact'] }[path];
    out.title = page[0]; out.description = clip(page[1], 158); out.canonical = path;
    out.jsonld = [{ '@type': page[2], name: page[3], url: `${origin}${path}` }, site, crumbs(origin, [home, [page[3], path]])];
  // Privacy, Terms and Refund policy.
  } else if (view === 'legal') {
    const d = legalDoc(LEGAL_PAGES[path], { studio: studio?.studio });
    out.title = `${d.title} — ${SITE}`; out.description = clip(d.intro, 158); out.canonical = path;
    out.jsonld = [{ '@type': 'WebPage', name: d.title, url: `${origin}${path}`, dateModified: LEGAL_UPDATED }, crumbs(origin, [home, [d.title, path]])];
  // Search and sign-in pages are indexable shells; personal pages (below) are noindex.
  } else if (view === 'search') {
    out.title = `Search — ${SITE}`; out.description = `Search ${SITE} shows, episodes and reels.`; out.canonical = '/search'; out.robots = 'noindex,follow';
  } else if (view === 'auth') {
    out.title = `${path === '/signup' ? 'Create your account' : 'Sign in'} — ${SITE}`; out.description = `${path === '/signup' ? 'Create a free' : 'Sign in to your'} ${SITE} account.`; out.canonical = null; out.robots = 'noindex,nofollow';
  // Private pages: titled, but robots is set to noindex by the PRIVATE table.
  } else if (PRIVATE[view]) {
    out.title = `${PRIVATE[view]} — ${SITE}`; out.description = `${PRIVATE[view]} on ${SITE}.`; out.canonical = null; out.robots = 'noindex,nofollow';
  }
  // Wrap every structured-data node with its schema.org context.
  if (out.jsonld.length) out.jsonld = out.jsonld.map((n) => ({ '@context': 'https://schema.org', ...n }));
  return finish(out);
}
