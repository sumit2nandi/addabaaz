/**
 * Optional bridge to the ADDABAAZ site: after a package is in R2, attach it to an existing video in
 * the catalog from the portal, instead of pasting the key into the Content studio by hand.
 *
 * Only active when APP_API_URL and APP_ADMIN_TOKEN are set (the main app's `ADMIN_TOKEN`). It speaks
 * the same admin API the Content studio uses, so nothing new is needed on the app side:
 *
 *   GET /api/v1/admin/catalog            → shows, upcoming, videos, studio
 *   PUT /api/v1/admin/catalog/videos/:id → replace a video (with  source = { type: 'r2', key, format: 'hls' })
 *
 * If either value is missing the portal simply hides the panel — the service stays a standalone tool.
 */
import { HttpError } from './http.js';

export function createSiteBridge(cfg, { fetchImpl = fetch } = {}) {
  const { apiUrl, adminToken } = cfg.site;
  const configured = !!(apiUrl && adminToken);
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${adminToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const message = data?.error?.message || `The site API answered HTTP ${res.status}.`;
      throw new HttpError(502, 'site_api_error', `ADDABAAZ API: ${message}`);
    }
    return data;
  };

  return {
    configured,
    apiUrl,
    /** Videos the operator can publish into — trimmed to what the picker shows. */
    async videos() {
      if (!configured) throw new HttpError(503, 'site_not_configured', 'APP_API_URL and APP_ADMIN_TOKEN are not set on this service.');
      const catalog = await call('GET', '/api/v1/admin/catalog');
      const shows = new Map((catalog?.shows || []).map((s) => [s.id, s.title]));
      return (catalog?.videos || []).map((v) => ({
        id: v.id, title: v.title || v.shortTitle || v.id, show: shows.get(v.showId) || null, kind: v.kind || null,
        access: v.access || 'free', source: v.source ? { type: v.source.type, key: v.source.key || v.source.url || null, format: v.source.format || null } : null,
      }));
    },
    /** Points one catalog video at the finished HLS master playlist. Returns the updated video id. */
    async publish({ videoId, masterKey }) {
      if (!configured) throw new HttpError(503, 'site_not_configured', 'APP_API_URL and APP_ADMIN_TOKEN are not set on this service.');
      if (!videoId) throw new HttpError(400, 'missing_video', 'Choose which video this package belongs to.');
      const catalog = await call('GET', '/api/v1/admin/catalog');
      const video = (catalog?.videos || []).find((v) => v.id === videoId);
      if (!video) throw new HttpError(404, 'video_not_found', `No video “${videoId}” in the catalog.`);
      // The admin API replaces the whole document, so send it back with only the source changed.
      const body = { ...video, source: { type: 'r2', key: masterKey, format: 'hls' } };
      const out = await call('PUT', `/api/v1/admin/catalog/videos/${encodeURIComponent(videoId)}`, body);
      return { videoId, title: out?.item?.title || video.title || videoId, source: out?.item?.source || body.source };
    },
  };
}
