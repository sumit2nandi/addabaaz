// Explicit YouTube channel feed reader. It performs no work until an administrator calls refresh().

export const DEFAULT_YOUTUBE_CHANNEL_ID = 'UCdG8idFz3zA7xOaca8H6qtw'; // @ADDABAAZ01
export const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FEED_ROOT = 'https://www.youtube.com/feeds/videos.xml';
const MAX_BODY_CHARS = 1_000_000;
const MAX_UPLOADS = 15; // YouTube's public Atom feed returns at most 15 entries.

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

/** Parse and validate the fields needed to create catalog records from a YouTube Atom feed. */
export function parseYouTubeFeed(xml, { limit = MAX_UPLOADS } = {}) {
  const safeLimit = Math.max(0, Math.min(MAX_UPLOADS, Math.floor(Number(limit) || 0)));
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
    });
  }
  return [...unique.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, safeLimit);
}

/**
 * @param {object} options
 * @param {string} [options.channelId] Permanent YouTube channel id (the handle can change).
 * @param {number} [options.timeoutMs] Upstream request timeout (default: eight seconds).
 * @param {Function} [options.fetchImpl] Injectable fetch for tests.
 * @param {Function} [options.now] Injectable clock for tests.
 */
export function createYouTubeFeed({
  channelId = process.env.YOUTUBE_CHANNEL_ID || DEFAULT_YOUTUBE_CHANNEL_ID,
  timeoutMs = 8_000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const id = String(channelId || '').trim();
  const configuredId = YOUTUBE_CHANNEL_ID_RE.test(id) ? id : '';
  let pending = null;

  async function fetchLatest() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(`${FEED_ROOT}?channel_id=${encodeURIComponent(configuredId)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
      });
      if (!response.ok) throw new Error(`YouTube feed returned HTTP ${response.status}.`);
      const xml = await response.text();
      if (xml.length > MAX_BODY_CHARS) throw new Error('YouTube feed response is too large.');
      if (!/<feed(?:\s|>)/i.test(xml)) throw new Error('YouTube did not return an Atom feed.');
      return {
        videos: parseYouTubeFeed(xml),
        updatedAt: new Date(now()).toISOString(),
        configured: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** A manual refresh always asks YouTube for a fresh feed. Concurrent admin clicks share one request. */
    async refresh() {
      if (!configuredId) return { videos: [], updatedAt: null, configured: false };
      if (pending) return pending;
      pending = fetchLatest().finally(() => { pending = null; });
      return pending;
    },
  };
}
