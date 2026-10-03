/**
 * The catalog schema in one place: used by the admin API (validates every write), by `npm run validate:catalog` and by the CLI import.
 * validate(type, input, ctx) → { doc, errors }  — `doc` is the normalised document to store (only known fields, trimmed, typed).
 *   upcoming.category controls the homepage placement; studio.homePosters remains only for compatibility with older catalogs.
 *   ctx.fileExists(rel)  optional: check that local image paths (media/…, uploads/…) exist
 *   ctx.showIds / ctx.upcomingIds  optional Sets: check catalog references
 */
export const TYPES = { shows: 'show', videos: 'video', upcoming: 'upcoming', gallery: 'gallery' };
// Reusable patterns and allowed values. IDs are short slugs; image paths must be local uploads/media files or https URLs; subtitle files must be .vtt.
const ID = /^[\w-]{1,64}$/;
const IMG = /^(?:(?:media|uploads)\/[\w\-./]+|https:\/\/[^\s"'<>]+)$/;
const ACCESS = ['free', 'premium'], SHOW_TYPES = ['series', 'standup', 'podcast', 'film'];
const RATINGS = ['U', '7+', '13+', '16+', '18+'];   // U = suitable for everyone; the Kids profile shows only U and 7+ (unrated titles stay hidden from it)
const SUB = /^(?:(?:media|uploads)\/[\w\-./]+\.vtt|https:\/\/[^\s"'<>?#]+\.vtt(?:\?[^\s"'<>]*)?)$/i;
const KINDS = ['episode', 'trailer', 'reel', 'clip'], STATUSES = ['ongoing', 'completed', 'paused'];
// Trailers, clips and reels are the marketing for a title: they stream for everyone,
// even when the video itself is flagged premium or the parent show is Plus-only.
export const FREE_KINDS = ['trailer', 'reel', 'clip'];

// A small validation toolkit for one JSON object.
// Create a reader with the list of allowed fields, then call r.str / r.int / r.bool / r.oneOf / r.list / r.img / r.date for each field.
// Valid values are copied (trimmed / normalised) into `r.out`; problems are collected in `r.errors` as sentences an admin can read.
// Unknown fields are rejected so typos do not silently disappear.
function reader(input, allowed, label, ctx) {
  const errors = [], out = {};
  const ok = input && typeof input === 'object' && !Array.isArray(input);
  if (!ok) errors.push(`${label} must be an object.`);
  const src = ok ? input : {};
  for (const k of Object.keys(src)) if (!allowed.includes(k)) errors.push(`Unknown field "${k}".`);
  const has = (k) => src[k] !== undefined && src[k] !== null && !(typeof src[k] === 'string' && !src[k].trim());
  const r = {
    errors, out, src, has,
    str(k, { req = false, max = 200, pattern, msg, nullable = false } = {}) {
      if (!has(k)) { if (req) errors.push(`${k} is required.`); else if (nullable) out[k] = null; return; }
      if (typeof src[k] !== 'string') return void errors.push(`${k} must be text.`);
      const v = src[k].trim();
      if (v.length > max) return void errors.push(`${k} is too long (max ${max} characters).`);
      if (pattern && !pattern.test(v)) return void errors.push(msg || `${k} is not valid.`);
      out[k] = v;
    },
    int(k, { req = false, min = 0, max = 4_294_967_295, nullable = false, dflt } = {}) {
      if (!has(k)) { if (req) errors.push(`${k} is required.`); else if (nullable) out[k] = null; else if (dflt !== undefined) out[k] = dflt; return; }
      const n = typeof src[k] === 'string' && /^\d+$/.test(src[k].trim()) ? Number(src[k]) : src[k];
      if (!Number.isInteger(n) || n < min || n > max) return void errors.push(`${k} must be a whole number between ${min} and ${max}.`);
      out[k] = n;
    },
    bool(k, dflt = false) { out[k] = src[k] === undefined ? dflt : src[k] === true || src[k] === 1 || src[k] === '1' || src[k] === 'true'; },
    oneOf(k, values, { req = false, dflt } = {}) {
      if (!has(k)) { if (req) errors.push(`${k} is required.`); else if (dflt !== undefined) out[k] = dflt; return; }
      if (!values.includes(src[k])) return void errors.push(`${k} must be one of: ${values.join(', ')}.`);
      out[k] = src[k];
    },
    list(k, { max = 80, maxItems = 40, keepEmpty = true } = {}) {
      if (src[k] === undefined || src[k] === null) { if (keepEmpty) out[k] = []; return; }
      if (!Array.isArray(src[k])) return void errors.push(`${k} must be a list.`);
      const v = src[k].map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '');
      if (v.length > maxItems || v.some((x) => typeof x !== 'string' || x.length > max)) return void errors.push(`${k} has too many or too long entries.`);
      out[k] = v;
    },
    img(k, { req = false } = {}) {
      if (!has(k)) { if (req) errors.push(`${k} (an image) is required.`); return; }
      const v = typeof src[k] === 'string' ? src[k].trim() : '';
      if (!IMG.test(v) || v.includes('..')) return void errors.push(`${k} must be an uploaded image, a media/… path or an https:// URL.`);
      if (!/^https:/.test(v) && ctx.fileExists && !ctx.fileExists(v)) return void errors.push(`${k}: file ${v} does not exist.`);
      out[k] = v;
    },
    date(k, { req = false } = {}) {
      if (!has(k)) { if (req) errors.push(`${k} is required.`); return; }
      const t = Date.parse(src[k]);
      if (Number.isNaN(t)) return void errors.push(`${k} must be a date.`);
      out[k] = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
    },
    id() { r.str('id', { req: true, max: 64, pattern: ID, msg: 'id may only contain letters, digits, "-" and "_" (max 64).' }); },
  };
  return r;
}

// Checks that a reference (e.g. a video's showId) points at an item that exists.
const ref = (r, ctx, k, sets) => {
  if (r.out[k] && sets.length && !sets.some((s) => s?.has(r.out[k]))) r.errors.push(`${k} "${r.out[k]}" does not exist.`);
};

// ---- One validator per document type. Each returns a reader whose `.out` is the cleaned document. ----
// Show / series.
function show(input, ctx) {
  const r = reader(input, ['id', 'title', 'titleEn', 'type', 'genres', 'tagline', 'description', 'cast', 'language', 'year', 'status', 'featured', 'poster', 'posterLg', 'access', 'rating'], 'A show', ctx);
  r.id(); r.str('title', { req: true }); r.str('titleEn'); r.oneOf('type', SHOW_TYPES, { dflt: 'series' }); r.list('genres', { max: 30, maxItems: 10 });
  r.str('tagline', { max: 300 }); r.str('description', { req: true, max: 3000 }); r.list('cast', { max: 60 }); r.str('language', { max: 40 });
  r.int('year', { min: 1900, max: 2100 }); r.oneOf('status', STATUSES, { dflt: 'ongoing' }); r.bool('featured'); r.img('poster', { req: true }); r.img('posterLg');
  r.oneOf('access', ACCESS, { dflt: 'free' }); r.oneOf('rating', RATINGS);
  return r;
}

// Video or episode. The `source` decides where it plays from: YouTube id, Cloudflare R2 object, or a direct mp4/hls URL; premium access is independent of source.
function video(input, ctx) {
  const r = reader(input, ['id', 'showId', 'kind', 'episode', 'title', 'shortTitle', 'description', 'source', 'thumbnail', 'duration', 'publishedAt', 'views', 'access', 'rating', 'subtitles', 'publishAt', 'hidden', 'topRank'], 'A video', ctx);
  r.id(); r.oneOf('kind', KINDS, { req: true }); r.str('showId', { max: 64, pattern: ID, nullable: true }); ref(r, ctx, 'showId', [ctx.showIds, ctx.upcomingIds].filter(Boolean));
  r.int('episode', { min: 1, max: 100000, nullable: true }); if (r.out.kind && r.out.kind !== 'episode') r.out.episode = null;
  r.str('title', { req: true, max: 300 }); r.str('shortTitle', { max: 120 }); r.str('description', { max: 500 });
  const s = r.src.source;
  if (!s || typeof s !== 'object' || Array.isArray(s)) r.errors.push('source is required.');
  else {
    const t = s.type, extra = (allowed) => Object.keys(s).filter((k) => !allowed.includes(k)).forEach((k) => r.errors.push(`Unknown source field "${k}".`));
    // Each source type has its own required fields; anything else is rejected.
    if (t === 'youtube') { extra(['type', 'id']); if (!/^[\w-]{11}$/.test(String(s.id || ''))) r.errors.push('source.id must be an 11-character YouTube video id.'); else r.out.source = { type: 'youtube', id: s.id }; }
    else if (t === 'r2') {
      extra(['type', 'key', 'format']); const key = String(s.key || '').trim();
      if (!/^[\w\-./]+$/.test(key) || key.includes('..') || key.startsWith('/') || key.endsWith('/')) r.errors.push('source.key must be a safe R2 object key (e.g. premium/shahid-ep6/master.m3u8).');
      else if (s.format && !['mp4', 'hls'].includes(s.format)) r.errors.push('source.format must be mp4 or hls.');
      else if (/\.m3u8$/i.test(key) && s.format === 'mp4') r.errors.push("A .m3u8 key can't be format mp4.");
      else r.out.source = { type: 'r2', key, ...(s.format ? { format: s.format } : {}) };
      if (!r.has('thumbnail')) r.errors.push('R2 videos need a public thumbnail image.');
    } else if (t === 'mp4' || t === 'hls') {
      extra(['type', 'url']); if (!/^https?:\/\/[^\s"'<>]+$/.test(String(s.url || ''))) r.errors.push(`source.url must be an absolute http(s) URL for ${t} videos.`); else r.out.source = { type: t, url: s.url.trim() };
    } else r.errors.push('source.type must be youtube, r2, mp4 or hls.');
  }
  r.img('thumbnail'); r.int('duration', { req: true, max: 86400 }); r.date('publishedAt', { req: true }); r.int('views', { dflt: 0 });
  r.oneOf('access', ACCESS, { req: true }); r.oneOf('rating', RATINGS); r.date('publishAt'); r.bool('hidden', false);
  // The homepage "Top 10 Episodes" rail: an editor's pick, 1 = first (Content studio → Top 10).
  r.int('topRank', { min: 1, max: 10, nullable: true });
  if (r.out.topRank && r.out.kind !== 'episode') r.out.topRank = null;   // only episodes can be ranked
  // Optional subtitle tracks: max 12, each with a language code, label and a .vtt file; one track per language.
  if (r.src.subtitles !== undefined && r.src.subtitles !== null) {
    const subs = r.src.subtitles;
    if (!Array.isArray(subs) || subs.length > 12) r.errors.push('subtitles must be a list of at most 12 tracks.');
    else {
      const seen = new Set(), list = [];
      subs.forEach((t, i) => {
        const tr = reader(t, ['lang', 'label', 'url'], `subtitles[${i + 1}]`, ctx);
        tr.str('lang', { req: true, max: 12, pattern: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, msg: 'lang must be a language code such as bn, en or hi.' }); tr.str('label', { req: true, max: 40 });
        tr.str('url', { req: true, max: 500, pattern: SUB, msg: 'url must be an uploaded .vtt file (uploads/… or media/…) or an https:// .vtt URL.' });
        if (tr.out.url && !/^https:/.test(tr.out.url) && (tr.out.url.includes('..') || (ctx.fileExists && !ctx.fileExists(tr.out.url)))) tr.errors.push(`file ${tr.out.url} does not exist.`);
        if (tr.out.lang) { if (seen.has(tr.out.lang)) tr.errors.push(`two subtitle tracks use the language “${tr.out.lang}”.`); seen.add(tr.out.lang); }
        r.errors.push(...tr.errors); list.push(tr.out);
      });
      if (subs.length) r.out.subtitles = list;
    }
  }
  if (r.out.source?.type === 'r2' && r.out.access === 'free') { /* allowed: free video hosted in R2 */ }
  return r;
}

// "Coming soon" entry.
function upcoming(input, ctx) {
  const r = reader(input, ['id', 'title', 'titleEn', 'type', 'category', 'genres', 'note', 'showId', 'poster', 'posterLg', 'backdrop'], 'A coming-soon title', ctx);
  r.id(); r.str('title', { req: true }); r.str('titleEn'); r.oneOf('type', SHOW_TYPES, { dflt: 'series' }); r.oneOf('category', ['coming-soon', 'releasing-this-month'], { dflt: 'coming-soon' }); r.list('genres', { max: 30, maxItems: 10 });
  r.str('note', { max: 200 }); r.str('showId', { max: 64, pattern: ID }); r.img('poster', { req: true }); r.img('posterLg'); r.img('backdrop');
  return r;
}

// Behind-the-scenes photo.
function gallery(input, ctx) {
  const r = reader(input, ['id', 'group', 'image', 'imageLg', 'caption'], 'A gallery photo', ctx);
  r.id(); r.str('group', { req: true, max: 60 }); r.img('image', { req: true }); r.img('imageLg'); r.str('caption', { max: 200 }); if (r.out.caption === undefined) r.out.caption = '';
  return r;
}

// The studio (About / Contact) page: a nested document with contact details, social links, mission text, services and team lists.
const URL_OK = /^https?:\/\/[^\s"'<>]+$/;
function studio(input, ctx) {
  const errors = [];
  const o = input && typeof input === 'object' && !Array.isArray(input) ? input : (errors.push('Studio info must be an object.'), {});
  for (const k of Object.keys(o)) if (!['studio', 'missionEn', 'missionBn', 'services', 'team', 'homePosters'].includes(k)) errors.push(`Unknown field "${k}".`);
  const st = reader(o.studio, ['name', 'tagline', 'address', 'mapsUrl', 'email', 'phones', 'whatsapp', 'social'], 'studio', ctx);
  st.str('name', { req: true, max: 80 }); st.str('tagline', { max: 300 }); st.list('address', { max: 120, maxItems: 8 });
  st.str('mapsUrl', { pattern: URL_OK, msg: 'mapsUrl must be a URL.', max: 500 }); st.str('email', { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'email is not valid.', max: 254 });
  st.list('phones', { max: 30, maxItems: 8 }); st.str('whatsapp', { pattern: /^\d{8,15}$/, msg: 'whatsapp must be digits with country code, e.g. 919876543210.', max: 15 });
  const soc = reader(o.studio?.social || {}, ['facebook', 'instagram', 'youtube', 'x', 'twitter', 'linkedin'], 'social', ctx);
  for (const k of ['facebook', 'instagram', 'youtube', 'x', 'twitter', 'linkedin']) soc.str(k, { pattern: URL_OK, msg: `${k} must be a URL.`, max: 500 });
  st.out.social = soc.out; errors.push(...st.errors, ...soc.errors);
  const home = reader(o.homePosters || {}, ['releasingThisMonth', 'releasingThisMonthMobile', 'releasingThisMonthId'], 'homePosters', ctx);
  home.img('releasingThisMonth'); home.img('releasingThisMonthMobile'); home.str('releasingThisMonthId', { max: 64, pattern: ID, msg: 'releasingThisMonthId must be a valid upcoming-title ID.' });
  ref(home, ctx, 'releasingThisMonthId', [ctx.upcomingIds].filter(Boolean)); errors.push(...home.errors);
  const out = { studio: st.out, homePosters: home.out };
  for (const k of ['missionEn', 'missionBn']) {
    const l = reader({ [k]: o[k] }, [k], k, ctx); l.list(k, { max: 400, maxItems: 12 }); errors.push(...l.errors); out[k] = l.out[k];
  }
  // Validates a list of small objects (services, team) with a maximum length.
  const rows = (k, fields, max) => {
    const arr = o[k] === undefined ? [] : o[k];
    if (!Array.isArray(arr) || arr.length > max) { errors.push(`${k} must be a list of at most ${max} entries.`); return []; }
    return arr.map((x, i) => {
      const rr = reader(x, fields.map((f) => f[0]), `${k}[${i + 1}]`, ctx);
      for (const [f, opt] of fields) opt.image ? rr.img(f, { req: opt.req }) : rr.str(f, opt);
      errors.push(...rr.errors); return rr.out;
    });
  };
  out.services = rows('services', [['num', { max: 4 }], ['title', { req: true, max: 100 }], ['text', { max: 600 }]], 24);
  out.team = rows('team', [['name', { req: true, max: 80 }], ['role', { max: 100 }], ['quote', { max: 400 }], ['photo', { image: true }]], 40);
  return { errors, out };
}

// Entry point: pick the validator by type and return `{ doc, errors }` (doc is null when there are errors).
const VALIDATORS = { show, video, upcoming, gallery, studio };
export function validate(type, input, ctx = {}) {
  const v = VALIDATORS[type];
  if (!v) return { doc: null, errors: [`Unknown type "${type}".`] };
  const r = v(input, ctx);
  return { doc: r.errors.length ? null : r.out, errors: r.errors };
}

/** Whole-catalog check (used by `npm run validate:catalog`). Returns a list of problems. */
export function checkCatalog(cat, studioDoc, { fileExists } = {}) {
  const problems = [];
  const seen = (arr, label) => { const s = new Set(); for (const x of arr) { if (s.has(x.id)) problems.push(`duplicate ${label} id: ${x.id}`); s.add(x.id); } return s; };
  const showIds = seen(cat.shows || [], 'show'), upcomingIds = seen(cat.upcoming || [], 'upcoming'); seen(cat.videos || [], 'video'); seen(cat.gallery || [], 'gallery');
  const ctx = { fileExists, showIds, upcomingIds };
  for (const [key, type] of Object.entries(TYPES)) for (const d of cat[key] || []) for (const e of validate(type, d, ctx).errors) problems.push(`${type} ${d?.id}: ${e}`);
  if (studioDoc) for (const e of validate('studio', studioDoc, ctx).errors) problems.push(`studio: ${e}`);
  return problems;
}
