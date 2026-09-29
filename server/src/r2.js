import crypto from 'node:crypto';

/**
 * Cloudflare R2 (S3-compatible) access without an SDK: AWS Signature V4 query-string presigning.
 *
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (R2 → Manage API tokens → "Object Read only")
 *   R2_ENDPOINT   optional override (defaults to https://<account>.r2.cloudflarestorage.com; any S3-compatible store works)
 *
 * The bucket stays PRIVATE. The API hands out short-lived signed URLs only after checking the viewer's access.
 */
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');

/** Low-level SigV4 presigner (exported for tests against AWS's published example). */
export function presign({ method = 'GET', host, path, accessKeyId, secretAccessKey, region = 'auto', service = 's3', expires = 3600, now = new Date(), query = {} }) {
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, '');          // 20130524T000000Z
  const day = amz.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const params = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonical = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { queryString: `${canonicalQuery}&X-Amz-Signature=${signature}`, signature };
}

export function createR2(env = process.env) {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket, R2_ENDPOINT: endpoint } = env;
  const configured = !!(accessKeyId && secretAccessKey && bucket && (account || endpoint));
  if (!configured) return { configured: false };
  const base = new URL(endpoint || `https://${account}.r2.cloudflarestorage.com`);
  const r2 = {
    configured: true,
    bucket,
    /** Time-limited GET URL for an object key (path-style: /<bucket>/<key>). */
    presignGet(key, { ttl = 3600, now } = {}) {
      const path = `${base.pathname.replace(/\/$/, '')}/${enc(bucket)}/${encPath(key)}`;
      const { queryString } = presign({ host: base.host, path, accessKeyId, secretAccessKey, expires: Math.min(Math.max(ttl, 1), 604800), now });
      return `${base.origin}${path}?${queryString}`;
    },
    /** Reads a small text object (HLS playlists). Returns null when the object doesn't exist. */
    async getText(key) {
      const res = await fetch(r2.presignGet(key, { ttl: 60 }));
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`R2 responded ${res.status}`);
      return res.text();
    },
    /** For `npm run r2:check` — HEAD request through a presigned URL. */
    async head(key) { const res = await fetch(r2.presignGet(key, { ttl: 60 }), { method: 'HEAD' }); return { status: res.status, size: Number(res.headers.get('content-length')) || null, type: res.headers.get('content-type') }; },
  };
  return r2;
}
