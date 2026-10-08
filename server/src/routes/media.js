// Private video access policy and the R2/HLS gateway. No storage keys or provider SDK leak into handlers.
import path from 'node:path';
import { mediaHeadCache } from '../media-head-cache.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpError, wrap } from '../http.js';
import { signJwt, verifyToken } from '../auth.js';
import { FREE_KINDS } from '../catalog-schema.js';

const CAPACITOR_ORIGIN = 'https://app.addabaaz.in';
const isNativeWebView = (req) => req.get('origin') === CAPACITOR_ORIGIN || /\bwv\b/i.test(req.get('user-agent') || '');

export function registerMediaRoutes(api, { db, secret, publicApiUrl, streamTtl, r2, catalog, features, userFromRequest, logger = console }) {
  const checkObject = mediaHeadCache((key) => r2.head(key));
  // Small helpers: catalog lookup, the public base URL for links we hand out, and mp4-vs-HLS detection.
  const findVideo = (id) => catalog.video(id);
  const isPremiumVideo = async (v) => {
    if (FREE_KINDS.includes(v.kind)) return false;   // trailers, clips and reels are never locked, even for premium shows
    if (v.access === 'premium') return true;
    if (!v.showId) return false;
    const { catalog: snapshot } = await catalog.get();
    return snapshot.shows.some((s) => s.id === v.showId && s.access === 'premium');
  };
  const originOf = (req) => (publicApiUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const r2Format = (src) => src.format || (/\.m3u8$/i.test(src.key) ? 'hls' : 'mp4');
  /** Returns a playable URL for a video hosted in R2. Premium titles need a signed-in account with an active paid plan. */
  api.post('/videos/:id/stream', wrap(async (req, res) => {
    const v = await findVideo(req.params.id);
    if (!v) throw new HttpError(404, 'not_found', 'Unknown video.');
    if (v.source?.type !== 'r2') throw new HttpError(400, 'not_hosted', 'This video isn’t available right now.');
    // Premium gate: must be signed in (401), have a paid plan (402) and be within the simultaneous-screens limit (429). Free videos skip all of this.
    if (await isPremiumVideo(v)) {
      const user = await userFromRequest(req);
      if (!user) throw new HttpError(401, 'login_required', 'Please sign in to watch premium videos.');
      if ((await db.subscriptions.get(user.id)).planId === 'free') throw new HttpError(402, 'subscription_required', 'Subscribe to ADDABAAZ Premium to watch this video.');   // premium = signed in AND paid
      const dev = features.deviceOf(req);                                  // screens-at-once limit (premium playback only)
      const seat = await db.playback.touch(user.id, dev.id, dev.label, v.id, { limit: features.cfg.streamLimit, windowSec: features.cfg.heartbeatWindowSec });
      if (!seat.ok) throw new HttpError(429, 'stream_limit', `Your plan allows ${features.cfg.streamLimit} screens at once. Stop playback on another device to continue.`);
      req.user = user;
    }
    // Only after the access checks: is storage set up at all, and does the video object exist in R2?
    // Public viewer messages stay non-technical; detailed storage diagnostics are only shown in the Admin console.
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'This video isn’t available right now — please try again later.');
    if (typeof r2.head === 'function') {
      const h = await checkObject(v.source.key).catch((cause) => ({ status: 0, cause }));
      if (h.status === 404) throw new HttpError(404, 'video_file_missing', 'This video isn’t available right now — please try again later.');
      if (h.status === 403) throw new HttpError(502, 'storage_access_denied', 'This video isn’t available right now — please try again later.');
      if (h.status === 0) throw new HttpError(502, 'storage_unreachable', 'This video isn’t available right now — please try again later.', { cause: h.cause });
      if (h.status !== 200) throw new HttpError(502, 'storage_error', 'This video isn’t available right now — please try again later.');
    }
    const format = r2Format(v.source), expiresAt = new Date(Date.now() + streamTtl * 1000).toISOString();
    res.set('Cache-Control', 'no-store');
    // HLS: return a short-lived token URL that points at our own gateway (below).
    if (format === 'hls') {   // segments can't be pre-signed one by one, so playback goes through the token gateway below
      const token = signJwt({ aud: 'media', vid: v.id, sub: req.user?.id || null }, secret, streamTtl);
      return res.json({ type: 'hls', url: `${originOf(req)}/api/v1/media/${token}/${encodeURIComponent(v.source.key.split('/').pop())}`, expiresAt });
    }
    // Plain MP4: a time-limited signed R2 link the browser can play directly.
    res.json({ type: 'mp4', url: r2.presignGet(v.source.key, { ttl: streamTtl }), expiresAt });
  }));
  /** HLS gateway: playlists stay on this gateway; web browsers get signed R2 redirects, native WebViews stream fragments through the API. */
  api.get('/media/:token/*', wrap(async (req, res) => {
    const claims = verifyToken(req.params.token, secret);
    if (!claims || claims.aud !== 'media') throw new HttpError(401, 'invalid_token', 'This playback link has expired.');
    const v = await findVideo(claims.vid);
    if (!v || v.source?.type !== 'r2' || r2Format(v.source) !== 'hls') throw new HttpError(404, 'not_found', 'Unknown video.');
    if (!r2.configured) throw new HttpError(503, 'storage_not_configured', 'Video playback isn’t available right now — please try again later.');
    // Only files in the same folder (or below) as the video's master playlist may be requested; anything else is rejected as a path-traversal attempt.
    const dir = path.posix.dirname(v.source.key);
    const rest = req.params[0];                                  // Express has already URL-decoded it once
    const target = path.posix.normalize(`${dir}/${rest}`);
    if (rest.includes('\0') || rest.startsWith('/') || !target.startsWith(dir === '.' ? '' : dir + '/') || target.split('/').includes('..')) throw new HttpError(404, 'not_found', 'Not found.');
    // Playlists are fetched from R2 and rewritten/proxied by us; everything else (video segments) is a 15-minute signed redirect straight to R2.
    if (/\.m3u8$/i.test(target)) {
      const text = await r2.getText(target);
      if (text == null) throw new HttpError(404, 'not_found', 'Not found.');
      // Playlists of an encoded video don't change, and the token URL is private to this viewer: let the browser reuse them for a few minutes
      // (replays, re-opening a reel) instead of two server-to-R2 trips every time.
      return res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, max-age=300' }).send(text);
    }
    // Capacitor WebViews can fail XHR on the cross-origin 302 to R2 even when the bucket CORS rule is correct.
    // Stream only native-app fragments through the API; desktop browsers keep the bandwidth-saving direct redirect.
    if (isNativeWebView(req) && typeof r2.getObject === 'function') {
      const upstream = await r2.getObject(target, { ttl: 900, range: req.get('range') || '' });
      res.status(upstream.status).set({ 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range' });
      for (const name of ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type', 'ETag', 'Last-Modified']) {
        const value = upstream.headers.get(name);
        if (value) res.set(name, value);
      }
      if (!upstream.body) return res.end();
      try { await pipeline(Readable.fromWeb(upstream.body), res); }
      catch (e) {
        if (!res.headersSent) throw e;
        logger.error('[media] native video stream failed after headers were sent:', e);
        res.destroy(e);
      }
      return;
    }
    res.set('Cache-Control', 'no-store').redirect(302, r2.presignGet(target, { ttl: 900 }));
  }));

}
