// Explicit YouTube channel reader. It performs no work until an administrator calls refresh().

export const DEFAULT_YOUTUBE_CHANNEL_ID = 'UCdG8idFz3zA7xOaca8H6qtw'; // @ADDABAAZ01
export const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const MAX_BODY_CHARS = 2_000_000;
const MAX_RSS_UPLOADS = 15; // YouTube's public Atom feed returns at most 15 entries.
const PAGE_SIZE = 50;
const MAX_CHANNEL_UPLOADS = 100_000; // Safety bound; fail rather than silently previewing an incomplete channel.

// Decode the five named XML entities and numeric character references (including CDATA-wrapped text).
function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function tagText(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
  return decodeXml(match?.[1] || '').trim();
}

/** A title-only hint for the admin preview; YouTube's API does not expose whether an upload is a Short. */
export function suggestYouTubeKind(title) {
  return /(?:#shorts?\b|\bshorts\b|\breels?\b)/i.test(String(title || '')) ? 'reel' : 'clip';
}

/** Parse and validate a public YouTube Atom feed (kept for diagnostics / legacy feed tests). */
export function parseYouTubeFeed(xml, { limit = MAX_RSS_UPLOADS } = {}) {
  const safeLimit = Math.max(0, Math.min(MAX_RSS_UPLOADS, Math.floor(Number(limit) || 0)));
  const entries = String(xml ?? '').match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  const unique = new Map();
  for (const entry of entries) {
    const id = tagText(entry, 'yt:videoId');
    const title = tagText(entry, 'title');
    const published = tagText(entry, 'published');
    const publishedTime = Date.parse(published);
    if (!VIDEO_ID_RE.test(id) || !title || !Number.isFinite(publishedTime)) continue;
    unique.set(id, {
      id,
      title,
      publishedAt: new Date(publishedTime).toISOString(),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      suggestedKind: suggestYouTubeKind(title),
    });
  }
  return [...unique.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, safeLimit);
}

/**
 * Read every public item in a channel's uploads playlist via the YouTube Data API v3.
 *
 * @param {object} options
 * @param {string} [options.channelId] Permanent YouTube channel ID (the handle can change).
 * @param {string} [options.apiKey] Server-side YouTube Data API key; required for full channel pagination.
 * @param {number} [options.timeoutMs] Per-request timeout (default: fifteen seconds).
 * @param {Function} [options.fetchImpl] Injectable fetch for tests.
 * @param {Function} [options.now] Injectable clock.
 */
export function createYouTubeFeed({
  channelId = process.env.YOUTUBE_CHANNEL_ID || DEFAULT_YOUTUBE_CHANNEL_ID,
  apiKey = process.env.YOUTUBE_API_KEY || '',
  timeoutMs = 15_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  maxUploads = MAX_CHANNEL_UPLOADS,
} = {}) {
  const id = String(channelId || '').trim();
  const key = String(apiKey || '').trim();
  const configuredId = YOUTUBE_CHANNEL_ID_RE.test(id) ? id : '';
  const safeMax = Math.min(MAX_CHANNEL_UPLOADS, Math.max(1, Math.floor(Number(maxUploads) || MAX_CHANNEL_UPLOADS)));
  let pending = null;

  async function apiRequest(resource, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const url = new URL(`${API_ROOT}/${resource}`);
      for (const [name, value] of Object.entries({ ...params, key })) if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const body = await response.text();
      if (body.length > MAX_BODY_CHARS) throw new Error('YouTube Data API response is too large.');
      let data;
      try { data = JSON.parse(body); } catch { throw new Error('YouTube Data API returned invalid JSON.'); }
      if (!response.ok) {
        const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
        throw new Error(`YouTube Data API returned HTTP ${response.status}${reason ? ` (${reason})` : ''}.`);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('YouTube Data API returned an invalid response.');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll() {
    const channel = await apiRequest('channels', { part: 'contentDetails', id: configuredId });
    const uploadsPlaylist = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(String(uploadsPlaylist || ''))) throw new Error('YouTube did not return an uploads playlist for the channel.');

    const videos = [], seenIds = new Set(), seenPageTokens = new Set();
    let pageToken = '', pages = 0;
    do {
      const page = await apiRequest('playlistItems', {
        part: 'snippet,contentDetails', playlistId: uploadsPlaylist, maxResults: PAGE_SIZE, pageToken,
      });
      if (!Array.isArray(page.items)) throw new Error('YouTube returned an invalid uploads playlist page.');
      pages++;
      for (const item of page.items) {
        const id = String(item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId || '').trim();
        const title = String(item?.snippet?.title || '').trim();
        const published = item?.contentDetails?.videoPublishedAt || item?.snippet?.publishedAt;
        const publishedTime = Date.parse(published || '');
        if (/^(?:deleted|private) video$/i.test(title)) continue;
        if (!VIDEO_ID_RE.test(id) || !title || !Number.isFinite(publishedTime)) throw new Error('YouTube returned an invalid public upload entry; the full channel scan was stopped.');
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        videos.push({
          id,
          title: title.slice(0, 300),
          publishedAt: new Date(publishedTime).toISOString(),
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
          suggestedKind: suggestYouTubeKind(title),
        });
        if (videos.length > safeMax) throw new Error(`The channel has more than ${safeMax.toLocaleString('en-IN')} uploads; the full channel scan was stopped rather than returning a partial list.`);
      }
      const next = String(page.nextPageToken || '');
      if (next && (seenPageTokens.has(next) || pages > Math.ceil(safeMax / PAGE_SIZE) + 1)) throw new Error('YouTube returned an invalid or overlong pagination sequence.');
      if (next) seenPageTokens.add(next);
      pageToken = next;
    } while (pageToken);

    videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    return { videos, updatedAt: new Date(now()).toISOString(), configured: true, complete: true, pages };
  }

  return {
    /** An explicit admin preview checks every page; concurrent admin clicks share the same in-flight scan. */
    async refresh() {
      if (!configuredId) return { videos: [], updatedAt: null, configured: false, complete: false, reason: 'invalid_channel_id' };
      if (!key) return { videos: [], updatedAt: null, configured: false, complete: false, reason: 'missing_api_key' };
      if (pending) return pending;
      pending = fetchAll().finally(() => { pending = null; });
      return pending;
    },
  };
}
