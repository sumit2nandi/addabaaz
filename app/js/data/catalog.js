import { norm } from '../util.js';
import { reportClientError } from '../errors.js';

// Words that make a poor display title (channel/brand names); they are skipped when deriving a title from a long YouTube title.
const GENERIC = /^(laugh\s*bite|lught\s*bite|addabaaz|addabazz|আড্ডাবাজ.*|fake podcast|ফালতু কথা|faltu kotha|ep[-\s]?\d+|reels?[-\s]?\d*|part[-\s]?\d+|stand\s?up\s?comedy|standupcomedy|shahid|শহীদ|promo|trailer|ytshorts|new web series|comedy series|ckb|.*addabaaz reels.*|পর্ব\s*-?\s*[\d০-৯]+)$/i;

// Ratings that count as mature for recommendation demotion (the Kids profile already hides these entirely).
const MATURE = new Set(['16+', '18+']);

/** Read-only, indexed view of data/catalog.json. */
// All lookups the UI needs (by id, by show, search, ranking). Built once from the catalog JSON with Maps for speed.
export class Catalog {
  constructor(data) {
    this.data = data;
    this.shows = data.shows || [];
    this.videos = (data.videos || []).filter((v) => !v.hidden);
    this.upcoming = data.upcoming || [];
    this.gallery = data.gallery || [];
    this.homePosters = data.homePosters || {};
    this._show = new Map(this.shows.map((s) => [s.id, s]));
    this._video = new Map(this.videos.map((v) => [v.id, v]));
    this._soon = new Map(this.upcoming.map((u) => [u.id, u]));
    this._byShow = new Map();
    for (const v of this.videos) {
      const k = v.showId || '_studio';
      if (!this._byShow.has(k)) this._byShow.set(k, []);
      this._byShow.get(k).push(v);
    }
    this._genres = [...new Set(this.shows.flatMap((s) => s.genres || []))].sort();
  }

  /** A Catalog with only the titles a Kids profile may see: rated U or 7+ (a video without its own rating inherits its show's; unrated = hidden). */
  kidsView() {
    const ok = (r) => r === 'U' || r === '7+';
    const shows = this.shows.filter((s) => ok(s.rating)), showIds = new Set(shows.map((s) => s.id));
    const videos = this.videos.filter((v) => ok(v.rating || (v.showId && showIds.has(v.showId) ? this._show.get(v.showId).rating : null)));
    const k = new Catalog({ ...this.data, shows, videos, upcoming: [], gallery: [] }); k.kids = true; return k;
  }
  show(id) { return this._show.get(id); }
  video(id) { return this._video.get(id); }
  soon(id) { return this._soon.get(id); }
  /** Old catalog rows without a category keep the former single featured title until an admin edits them. */
  upcomingCategory(item) {
    return item?.category || (item?.id === this.homePosters.releasingThisMonthId ? 'releasing-this-month' : 'coming-soon');
  }
  upcomingByCategory(category) { return this.upcoming.filter((item) => this.upcomingCategory(item) === category); }
  /** Premium access is inherited from the parent series so every episode is gated consistently. */
  isPremium(video) {
    if (this.isFreeKind(video)) return false;   // trailers, clips and reels play for everyone - no crown, no lock
    return video?.access === 'premium' || (video?.showId && this._show.get(video.showId)?.access === 'premium') || false;
  }
  // Trailers, clips and reels are the marketing for a title: they always play for everyone,
  // even when flagged premium themselves or belonging to a Plus-only show (the gate skips them).
  isFreeKind(video) {
    return video?.kind === 'trailer' || video?.kind === 'reel' || video?.kind === 'clip';
  }
  get genres() { return this._genres; }

  /** Episodes of a show in watch order (EP 1 → n). */
  // Query helpers used by the pages: episodes in order, extras, latest, trending, reels, next episode, related titles.
  episodes(showId) {
    return (this._byShow.get(showId) || []).filter((v) => v.kind === 'episode')
      .sort((a, b) => (a.episode ?? 1e9) - (b.episode ?? 1e9) || a.publishedAt.localeCompare(b.publishedAt));
  }
  /** Trailers, reels and clips for a show, newest first. */
  extras(showId) {
    return (this._byShow.get(showId) || []).filter((v) => v.kind !== 'episode')
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  allEpisodes() { return this.videos.filter((v) => v.kind === 'episode'); }
  latestEpisodes(n = 12) {
    return [...this.allEpisodes()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, n);
  }
  /** Latest episodes plus standalone landscape videos imported from YouTube (Shorts/Reels are listed separately). */
  latestVideos(n = 12) {
    return this.videos.filter((v) => v.kind === 'episode' || (v.kind === 'clip' && v.source?.type === 'youtube'))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, n);
  }
  latestEpisode(showId) {
    return [...this.episodes(showId)].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  }
  /** Mature = rated 16+ or 18+, falling back from the video to its show (same inheritance as kidsView()). */
  isMature(v) {
    if (!v) return false;
    const show = v.showId ? this._show.get(v.showId) : null;
    return MATURE.has(v.rating || (show ? show.rating : null));
  }
  /**
   * The "Top 10 Episodes" rail, in two parts:
   *
   *  1. episodes an editor picked in Content studio → Top 10 (`topRank` 1…10), in that exact order. An
   *     editorial pick is a decision, so the mature cap does not quietly drop it;
   *  2. the rest of the slots, filled by most-watched (`views`), where `matureCap` still applies — guests
   *     and accounts that never watch mature content get it demoted, and the cap only relaxes when there
   *     aren't enough other episodes to fill the list.
   *
   * With nothing picked this is exactly the old most-watched list.
   */
  trending(n = 10, { matureCap = Infinity } = {}) {
    const eps = [...this.allEpisodes()].sort((a, b) => b.views - a.views);
    const pinned = this.allEpisodes().filter((v) => Number(v.topRank) >= 1 && Number(v.topRank) <= 10).sort((a, b) => Number(a.topRank) - Number(b.topRank)).slice(0, n);
    const rest = eps.filter((v) => !pinned.includes(v));
    const out = [...pinned];
    if (out.length >= n) return out.slice(0, n);
    if (!Number.isFinite(matureCap)) return [...out, ...rest].slice(0, n);
    let cap = Math.max(0, matureCap);
    for (const v of rest) {
      const mature = this.isMature(v);
      if (mature && cap <= 0) continue;
      if (mature) cap--;
      out.push(v);
      if (out.length === n) return out;
    }
    // Not enough non-mature episodes to fill the rail: top up with the highest-viewed skipped ones.
    for (const v of rest) { if (out.includes(v)) continue; out.push(v); if (out.length === n) break; }
    return out;
  }
  reels() {
    return this.videos.filter((v) => v.kind === 'reel').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  showViews(showId) { return (this._byShow.get(showId) || []).reduce((n, v) => n + (v.views || 0), 0); }

  nextEpisode(video) {
    if (!video || video.kind !== 'episode') return null;
    const eps = this.episodes(video.showId);
    const i = eps.findIndex((e) => e.id === video.id);
    return i >= 0 ? eps[i + 1] || null : null;
  }
  /** First episode to play for a show (or the latest if it has no numbering). */
  firstEpisode(showId) { return this.episodes(showId)[0] || null; }

  related(show, n = 8) {
    const g = new Set(show.genres || []);
    return this.shows.filter((s) => s.id !== show.id && (s.genres || []).some((x) => g.has(x)))
      .concat(this.shows.filter((s) => s.id !== show.id && !(s.genres || []).some((x) => g.has(x)))).slice(0, n);
  }
  relatedVideos(video, n = 10) {
    const pool = (this._byShow.get(video.showId || '_studio') || []).filter((v) => v.id !== video.id && v.kind === video.kind);
    return pool.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, n);
  }

  /** Human-friendly title: strips hashtags, cast/credit noise and generic segments. */
  // Cleans long, hashtag-filled video titles into something readable for cards and headings.
  displayTitle(v) {
    if (!v) return '';
    if (v.shortTitle) return v.shortTitle;
    const show = this.show(v.showId);
    const parts = v.title.replace(/#\S+/g, '').split(/\s*\|{1,2}\s*/).map((p) => p.replace(/^[“"'‘’”\s]+|[“"'‘’”\s]+$/g, '').trim()).filter(Boolean);
    const good = parts.find((p) => !GENERIC.test(p) && !(show?.cast || []).includes(p) && p.length > 3);
    if (good) return good;
    const performer = parts.find((p) => (show?.cast || []).includes(p) || (!GENERIC.test(p) && p.length > 3));
    const name = show?.titleEn || show?.title || 'ADDABAAZ';
    if (v.kind === 'episode' && v.episode) return performer ? `${name} · ${performer}` : `${name} · Episode ${v.episode}`;
    return performer ? `${name} · ${performer}` : `${name} · ${v.kind === 'reel' ? 'Reel' : 'Clip'}`;
  }
  /** Small label for a card: "EP 05", "Trailer", "Reel". */
  label(v) {
    if (v.kind === 'episode') return v.episode ? `EP ${String(v.episode).padStart(2, '0')}` : 'Episode';
    return { trailer: 'Trailer', reel: 'Reel', clip: 'Clip' }[v.kind] || 'Video';
  }
  thumb(v, q = 'hqdefault') {
    if (v.thumbnail) return v.thumbnail;
    if (v.source?.type === 'youtube') return `https://i.ytimg.com/vi/${v.source.id}/${q}.jpg`;
    return '';
  }

  /** Ranked search over shows, videos and upcoming titles. */
  // Simple ranked search: every word must match; matches at the start of a word score higher; shows outrank videos.
  search(query, { limit = 60 } = {}) {
    const tokens = norm(query).split(/[\s|,]+/).filter(Boolean);
    if (!tokens.length) return { shows: [], videos: [], upcoming: [] };
    const score = (hay, boost = 1) => {
      const h = norm(hay); let s = 0;
      for (const t of tokens) { const i = h.indexOf(t); if (i < 0) return 0; s += (i === 0 ? 3 : 1) * boost; }
      return s;
    };
    const shows = this.shows.map((s) => ({ s, sc: score([s.title, s.titleEn, ...(s.genres || []), ...(s.cast || []), s.tagline].join(' '), 2) }))
      .filter((x) => x.sc).sort((a, b) => b.sc - a.sc).map((x) => x.s);
    const videos = this.videos.map((v) => {
      const show = this.show(v.showId);
      const sc = score([v.title, show?.title, show?.titleEn, v.kind].join(' '));
      return { v, sc: sc ? sc + (v.kind === 'episode' ? 1 : 0) : 0 };
    }).filter((x) => x.sc).sort((a, b) => b.sc - a.sc || b.v.views - a.v.views).slice(0, limit).map((x) => x.v);
    const upcoming = this.upcoming.filter((u) => score([u.title, u.titleEn, ...(u.genres || [])].join(' '), 2));
    return { shows, videos, upcoming };
  }
}

/** Admin uploads are stored as `uploads/<hash>.webp`. When the app is served from a different origin than the API (native apps, split hosting), point them at the API host. */
// Rewrites `uploads/...` paths to absolute URLs.
export function rebaseUploads(data, base) {
  if (!base || base === 'off') return data;
  const walk = (v) => {
    if (typeof v === 'string') return v.startsWith('uploads/') ? `${base}/${v}` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(data);
}

// Fetch the catalog; if the API is unreachable fall back to the JSON file bundled with the app (so the site still works offline).
export async function loadCatalog(url, fallbackUrl = 'data/catalog.json', { mediaBase = '' } = {}) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('Couldn’t load the catalogue — please try again.'), { friendly: true, status: r.status, code: 'catalog_api' });
    return new Catalog(rebaseUploads(await r.json(), mediaBase));
  } catch (e) {
    if (url === fallbackUrl) throw e;
    console.warn('[catalog] falling back to bundled catalog', e);
    reportClientError(e, { where: 'catalog-api-fallback' });
    const r = await fetch(fallbackUrl, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('Couldn’t load the catalogue — please try again.'), { friendly: true, status: r.status, code: 'catalog_api' });
    return new Catalog(await r.json());
  }
}
