/**
 * Cloudflare R2 (S3-compatible) client — no SDK, just AWS Signature V4 presigning plus the handful of
 * operations this service needs. The same signing code as the main app (validated against AWS's
 * published example in test/r2.test.js), extended with what a converter requires:
 *
 *   putFile   — stream a produced file to the bucket (presigned PUT, retried, verified by HEAD)
 *   getToFile — pull a source video down from the bucket before encoding it
 *   getText   — read a playlist back (verification)
 *   head      — existence/size check
 *   list      — list a prefix (the R2 self-check, and finding orphaned segments)
 *   remove    — delete an object (the self-check probe)
 *
 * Unlike the website's read-only token, this service needs Object READ + WRITE.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// URL encoding exactly as AWS Signature V4 requires (RFC 3986: also escapes ! ' ( ) *).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => String(p).split('/').map(enc).join('/');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');

/** Low-level SigV4 presigner (exported so the signature can be checked against AWS's published example). */
export function presign({ method = 'GET', host, path, accessKeyId, secretAccessKey, region = 'auto', service = 's3', expires = 3600, now = new Date(), query = {} }) {
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, '');          // 20130524T000000Z
  const day = amz.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const params = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
  const canonical = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  return { queryString: `${canonicalQuery}&X-Amz-Signature=${crypto.createHmac('sha256', key).update(toSign).digest('hex')}` };
}

/** Minimal XML field reader — enough for S3 ListObjectsV2 replies, no XML parser dependency. */
export function parseListXml(xml) {
  const items = [...String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
    const size = /<Size>(\d+)<\/Size>/.exec(m[1]);
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1]);
    return { key: decodeXml(key?.[1] || ''), size: size ? Number(size[1]) : null };
  });
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  return { items, truncated };
}
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates the client. Without credentials it returns `{ configured: false, reason }` so the service can
 * still encode and let the operator download the package by hand.
 */
export function createR2(cfg = {}, { fetchImpl = fetch, retries = 3, log = () => {} } = {}) {
  const { accountId, accessKeyId, secretAccessKey, bucket, endpoint } = cfg;
  const configured = !!(accessKeyId && secretAccessKey && bucket && (accountId || endpoint));
  if (!configured) {
    return {
      configured: false,
      bucket: bucket || '',
      reason: 'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET are not all set.',
    };
  }
  const base = new URL(endpoint || `https://${accountId}.r2.cloudflarestorage.com`);
  const objectPath = (key) => `${base.pathname.replace(/\/$/, '')}/${enc(bucket)}/${encPath(key)}`;
  const url = (key, { method = 'GET', ttl = 3600, query = {} } = {}) =>
    `${base.origin}${objectPath(key)}?${presign({ method, host: base.host, path: objectPath(key), accessKeyId, secretAccessKey, expires: ttl, query }).queryString}`;

  /** Retries network errors, 429 and 5xx — a big package means thousands of PUTs, one hiccup must not fail the job. */
  async function withRetry(what, fn) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fn();
        if (res && res.status === 429 || (res && res.status >= 500)) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (e) {
        lastError = e;
        if (e.fatal) throw e;                                      // a 4xx answer will not change on a retry
        if (attempt < retries) { const wait = 400 * 2 ** (attempt - 1); log(`retry ${attempt}/${retries - 1} for ${what} in ${wait}ms (${e.message})`); await sleep(wait); }
      }
    }
    throw new Error(`${what} failed after ${retries} attempts: ${lastError?.message}`);
  }

  const r2 = {
    configured: true,
    bucket,
    presignGet: (key, { ttl = 3600 } = {}) => url(key, { method: 'GET', ttl: Math.min(Math.max(ttl, 1), 604800) }),
    presignPut: (key, { ttl = 3600 } = {}) => url(key, { method: 'PUT', ttl: Math.min(Math.max(ttl, 1), 86400) }),

    /** Streams a local file to the bucket. Returns `{ key, bytes, contentType }`. */
    async putFile(key, filePath, { contentType = 'application/octet-stream', size = null } = {}) {
      const bytes = size ?? fs.statSync(filePath).size;
      await withRetry(`PUT ${key}`, async () => {
        const body = Readable.toWeb(fs.createReadStream(filePath));
        const res = await fetchImpl(r2.presignPut(key, { ttl: 3600 }), {
          method: 'PUT', body, duplex: 'half', headers: { 'Content-Type': contentType, 'Content-Length': String(bytes) },
        });
        // 401/403/400 mean the token or the bucket policy is wrong — retrying cannot help, say it plainly.
        if (!res.ok && res.status < 500 && res.status !== 429) {
          throw Object.assign(new Error(res.status === 403
            ? 'R2 refused the upload (HTTP 403) — this token needs “Object Read & Write” permission on the bucket.'
            : `R2 refused the upload (HTTP ${res.status}).`), { fatal: true, status: 502, code: 'r2_upload_denied' });
        }
        return res;
      });
      return { key, bytes, contentType };
    },

    /** Downloads an object to a local file (streamed). Returns `{ key, bytes }`. */
    async getToFile(key, destPath, { onBytes = null } = {}) {
      const res = await withRetry(`GET ${key}`, () => fetchImpl(r2.presignGet(key, { ttl: 3600 })));
      if (res.status === 404) throw Object.assign(new Error(`No object “${key}” in bucket “${bucket}”.`), { status: 404, code: 'r2_object_missing' });
      if (!res.ok) throw Object.assign(new Error(`R2 returned HTTP ${res.status} for “${key}”.`), { status: 502, code: 'r2_error' });
      let bytes = 0;
      const stream = Readable.fromWeb(res.body);
      if (onBytes) stream.on('data', (c) => { bytes += c.length; onBytes(bytes); });
      await pipeline(stream, fs.createWriteStream(destPath));
      return { key, bytes: bytes || fs.statSync(destPath).size };
    },

    /** Reads a small text object (playlists). Returns null when it does not exist. */
    async getText(key) {
      const res = await withRetry(`GET ${key}`, () => fetchImpl(r2.presignGet(key, { ttl: 120 })));
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`R2 responded ${res.status} for “${key}”.`);
      return res.text();
    },

    /** Existence + size + type. Falls back to a ranged GET when the endpoint refuses HEAD. */
    async head(key) {
      let res = await fetchImpl(url(key, { method: 'HEAD', ttl: 120 }), { method: 'HEAD' });
      if (res.status === 403 || res.status === 405 || res.status === 501) {
        const getRes = await fetchImpl(r2.presignGet(key, { ttl: 120 }), { method: 'GET', headers: { Range: 'bytes=0-0' } });
        getRes.body?.cancel?.().catch(() => {});
        if (getRes.status === 206 || getRes.status === 200) {
          const cr = getRes.headers.get('content-range') || '';
          return { status: 200, size: Number(cr.split('/')[1]) || Number(getRes.headers.get('content-length')) || null, type: getRes.headers.get('content-type') };
        }
        res = getRes;
      }
      return { status: res.status, size: Number(res.headers.get('content-length')) || null, type: res.headers.get('content-type') };
    },

    /** Lists one page of a prefix (paginate with `token`). */
    async list(prefix = '', { max = 1000, token = null } = {}) {
      const query = { 'list-type': '2', 'max-keys': String(Math.min(max, 1000)) };
      if (prefix) query.prefix = prefix;
      if (token) query['continuation-token'] = token;
      const res = await withRetry(`LIST ${prefix}`, () => fetchImpl(url('', { method: 'GET', ttl: 300, query })));
      if (!res.ok) throw Object.assign(new Error(`R2 list failed (HTTP ${res.status}) — check the token's read permission.`), { status: 502, code: 'r2_list_failed' });
      const xml = await res.text();
      const parsed = parseListXml(xml);
      const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
      return { ...parsed, nextToken: parsed.truncated && tokenMatch ? decodeXml(tokenMatch[1]) : null };
    },

    /** Lists every object under a prefix (used by verification and the cleanup tool). */
    async listAll(prefix = '', { max = 100000 } = {}) {
      const items = []; let token = null;
      do {
        const page = await r2.list(prefix, { max: Math.min(1000, max - items.length), token });
        items.push(...page.items); token = page.nextToken;
      } while (token && items.length < max);
      return items;
    },

    /** Deletes one object (a missing object is not an error). */
    async remove(key) {
      const res = await withRetry(`DELETE ${key}`, () => fetchImpl(url(key, { method: 'DELETE', ttl: 300 }), { method: 'DELETE' }));
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete of “${key}” failed (HTTP ${res.status}).`);
      return true;
    },

    /**
     * End-to-end check of the credentials the service will use: read, write, read-back and delete.
     * Returns `{ ok, steps: [{ name, ok, detail }] }` — never throws, so the portal can always show it.
     */
    async check() {
      const steps = [];
      const probeKey = `_hls-service-selfcheck/probe-${Date.now()}.txt`;
      const add = (name, ok, detail) => { steps.push({ name, ok, detail }); return ok; };
      try {
        const list = await r2.list('', { max: 1 });
        add('List bucket', true, `${list.items.length} object(s) in the first page of “${bucket}”.`);
      } catch (e) { add('List bucket', false, e.message); }
      try {
        const body = Readable.toWeb(Readable.from([`addabaaz-hls-service self-check ${new Date().toISOString()}\n`]));
        const res = await fetchImpl(r2.presignPut(probeKey, { ttl: 300 }), { method: 'PUT', body, duplex: 'half', headers: { 'Content-Type': 'text/plain' } });
        add('Write object', res.ok, res.ok ? `Uploaded ${probeKey}.` : `HTTP ${res.status} — the token needs write (“Object Read & Write”) permission.`);
      } catch (e) { add('Write object', false, e.message); }
      try {
        const h = await r2.head(probeKey);
        add('Read object back', h.status === 200, h.status === 200 ? `${h.size} byte(s).` : `HTTP ${h.status} — the token needs read permission.`);
      } catch (e) { add('Read object back', false, e.message); }
      try { await r2.remove(probeKey); add('Delete object', true, 'Cleaned the probe file up.'); }
      catch (e) { add('Delete object', false, e.message); }
      return { ok: steps.every((s) => s.ok), bucket, steps };
    },
  };
  return r2;
}
