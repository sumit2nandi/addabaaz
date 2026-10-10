import crypto from 'node:crypto';
import { withTimeout, OUTBOUND_TIMEOUT_MS } from './http.js';

/**
 * Cloudflare R2 (S3-compatible) access without an SDK: AWS Signature V4 query-string presigning.
 *
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (R2 → Manage API tokens → "Object Read & Write", scoped to the media bucket)
 *   R2_ENDPOINT   optional override (defaults to https://<account>.r2.cloudflarestorage.com; any S3-compatible store works)
 *
 * The bucket stays PRIVATE. Video APIs issue short-lived signatures after access checks; stable app routes expose only validated catalog, Broadcast and video-thumbnail image keys.
 */
// An HLS playlist is a few kilobytes of text; anything larger is not a playlist and is refused rather than
// buffered into memory by the gateway (server/src/routes/media.js).
const MAX_PLAYLIST_BYTES = 2_000_000;
// Small-image uploads get a longer budget than a metadata call, but still cannot hang a request forever.
const PUT_TIMEOUT_MS = Math.max(OUTBOUND_TIMEOUT_MS, 120_000);

// URL encoding exactly as AWS Signature V4 requires (RFC 3986: also escapes ! ' ( ) *).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');
// Crypto helpers for signing.
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');

/** Low-level SigV4 presigner (exported for tests against AWS's published example). */
export function presign({ method = 'GET', host, path, accessKeyId, secretAccessKey, region = 'auto', service = 's3', expires = 3600, now = new Date(), query = {} }) {
  // Step 1: timestamps. `amz` is the request time in compact ISO form, `day` its date, `scope` the credential scope.
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, '');          // 20130524T000000Z
  const day = amz.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  // Step 2: the signing parameters travel in the query string (that is what makes the URL "presigned").
  const params = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  // Step 3: build the canonical request, then the string to sign.
  const canonical = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  // Step 4: derive the signing key from the secret (chain of HMACs over date, region, service), then sign.
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { queryString: `${canonicalQuery}&X-Amz-Signature=${signature}`, signature };
}

// Returns `{ configured: false }` when credentials are missing, so callers can degrade gracefully.
export function createR2(env = process.env, { fetchImpl = (...args) => fetch(...args) } = {}) {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket, R2_ENDPOINT: endpoint } = env;
  const configured = !!(accessKeyId && secretAccessKey && bucket && (account || endpoint));
  if (!configured) return { configured: false };
  // R2 endpoint: https://<account id>.r2.cloudflarestorage.com unless overridden.
  const base = new URL(endpoint || `https://${account}.r2.cloudflarestorage.com`);
  const r2 = {
    configured: true,
    bucket,
    /** Time-limited GET URL for an object key (path-style: /<bucket>/<key>). */
    presignGet(key, { ttl = 3600, now, method = 'GET' } = {}) {
      const path = `${base.pathname.replace(/\/$/, '')}/${enc(bucket)}/${encPath(key)}`;
      const { queryString } = presign({ method, host: base.host, path, accessKeyId, secretAccessKey, expires: Math.min(Math.max(ttl, 1), 604800), now });
      return `${base.origin}${path}?${queryString}`;
    },
    /** Time-limited HEAD URL for checking object metadata without downloading the body. */
    presignHead(key, { ttl = 60, now } = {}) {
      return r2.presignGet(key, { ttl, now, method: 'HEAD' });
    },
    /** Time-limited PUT URL — lets the admin console upload a video straight from the browser to the bucket (needs a write-capable token + bucket CORS). */
    presignPut(key, { ttl = 3600, now } = {}) {
      const path = `${base.pathname.replace(/\/$/, '')}/${enc(bucket)}/${encPath(key)}`;
      const { queryString } = presign({ method: 'PUT', host: base.host, path, accessKeyId, secretAccessKey, expires: Math.min(Math.max(ttl, 1), 86400), now });
      return `${base.origin}${path}?${queryString}`;
    },
    /** Uploads a small server-validated image to private R2 storage without copying its bytes into MySQL. */
    async putObject(key, body, { contentType = 'application/octet-stream', cacheControl = '', ttl = 900 } = {}) {
      const response = await fetchImpl(r2.presignPut(key, { ttl }), withTimeout({
        method: 'PUT',
        headers: { 'Content-Type': contentType, ...(cacheControl ? { 'Cache-Control': cacheControl } : {}) },
        body,
      }, PUT_TIMEOUT_MS));
      if (!response.ok) throw Object.assign(new Error(`R2 upload failed (HTTP ${response.status}).`), { statusCode: response.status });
      return { status: response.status, etag: response.headers?.get?.('etag') || null };
    },
    /**
     * Fetches an object response server-side; used to stream HLS fragments through the API for native WebViews.
     * Deliberately no AbortSignal here: the caller pipes the body straight to the response, and an abort timer
     * would cut off a legitimate multi-megabyte segment on a slow connection. A dead viewer disconnects the
     * downstream socket, which ends this request.
     */
    getObject(key, { ttl = 900, range } = {}) {
      return fetch(r2.presignGet(key, { ttl }), { headers: range ? { Range: range } : {} });
    },
    /** Reads a small text object (HLS playlists). Returns null when the object doesn't exist. */
    async getText(key) {
      const res = await r2.getObject(key, { ttl: 60 });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`R2 responded ${res.status}`);
      // Bound what is read into memory: a playlist is tiny, so a huge body is a mistake or an attack,
      // and the gateway would otherwise buffer it for every viewer of that video.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_PLAYLIST_BYTES) throw new Error(`R2 object is too large to be a playlist (${declared} bytes).`);
      const text = await res.text();
      if (text.length > MAX_PLAYLIST_BYTES) throw new Error('R2 object is too large to be a playlist.');
      return text;
    },
    /** For `npm run r2:check` and server verification — HEAD request through a HEAD-presigned URL (with 1-byte Range GET fallback). */
    async head(key) {
      let res = await fetch(r2.presignHead(key, { ttl: 60 }), withTimeout({ method: 'HEAD' }));
      if (res.status === 403 || res.status === 405 || res.status === 501) {
        const getRes = await fetch(r2.presignGet(key, { ttl: 60 }), withTimeout({ method: 'GET', headers: { Range: 'bytes=0-0' } }));
        getRes.body?.cancel?.().catch(() => {});
        if (getRes.status === 206 || getRes.status === 200) {
          const cr = getRes.headers.get('content-range') || '';
          const total = Number(cr.split('/')[1]) || Number(getRes.headers.get('content-length')) || null;
          return { status: 200, size: total, type: getRes.headers.get('content-type') };
        }
        res = getRes;
      }
      return { status: res.status, size: Number(res.headers.get('content-length')) || null, type: res.headers.get('content-type') };
    },
  };
  return r2;
}
