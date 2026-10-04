/**
 * A tiny in-process S3-compatible server used by the tests (and handy for a dry run without Cloudflare).
 *
 * It stores objects in memory and — the point of it — VERIFIES the AWS Signature V4 presigned URLs our
 * client produces: it recomputes the signature exactly as R2 would and rejects anything that does not
 * match. So a passing test means real requests to R2 will be authenticated, not just “we called fetch”.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
// NOTE: every request is signature-checked below, so a bug in the client's SigV4 code fails the test.

/**
 * Starts the fake bucket.
 * Returns `{ url, bucket, objects, requests, stop(), usage() }` — `objects` is a Map of key → { body, contentType }.
 */
export async function startFakeS3({ bucket = 'test-bucket', accessKeyId = 'AKIDEXAMPLE', secretAccessKey = 'secret-key-example', port = 0, onRequest = null } = {}) {
  const objects = new Map();
  const requests = [];
  let failNextPut = 0;                       // lets a test force a retry
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const query = Object.fromEntries(url.searchParams.entries());
    const key = path.split('/').slice(2).join('/');                    // /<bucket>/<key...>
    const headerHost = req.headers.host || '';
    const sigOk = (() => {
      // Recompute the signature with the real Host header.
      const signature = query['X-Amz-Signature'];
      if (!signature) return false;
      const scope = String(query['X-Amz-Credential'] || '').split('/').slice(1).join('/');
      const [day, reg, svc] = scope.split('/');                 // <date>/<region>/<service>/aws4_request
      const canonicalQuery = Object.keys(query).filter((k) => k !== 'X-Amz-Signature').sort()
        .map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
      const canonical = [req.method, path, canonicalQuery, `host:${headerHost}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
      // (the same canonical request the client builds — any mismatch means a real R2 would answer 403)
      const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), reg), svc), 'aws4_request');
      const expected = crypto.createHmac('sha256', signingKey)
        .update(['AWS4-HMAC-SHA256', query['X-Amz-Date'], scope, sha(canonical)].join('\n')).digest('hex');
      return expected === signature;
    })();
    requests.push({ method: req.method, path, key, query, signed: sigOk });
    onRequest?.({ method: req.method, path, key, signed: sigOk });
    if (!path.startsWith(`/${bucket}`)) return res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
    if (!sigOk) {
      res.writeHead(403, { 'Content-Type': 'application/xml' });
      return res.end('<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>');
    }
    // ListObjectsV2
    if (req.method === 'GET' && query['list-type'] === '2') {
      const prefix = query.prefix || '';
      const max = Number(query['max-keys'] || 1000);
      const items = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max);
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>` +
        items.map((k) => `<Contents><Key>${k.replace(/&/g, '&amp;')}</Key><Size>${objects.get(k).body.length}</Size></Contents>`).join('') +
        '</ListBucketResult>';
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(xml);
    }
    if (req.method === 'PUT') {
      if (failNextPut > 0) { failNextPut--; req.resume(); res.writeHead(503, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>SlowDown</Code></Error>'); }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        objects.set(key, { body, contentType: req.headers['content-type'] || 'application/octet-stream', at: Date.now() });
        res.writeHead(200, { ETag: `"${sha(body).slice(0, 32)}"` });
        res.end();
      });
      return undefined;
    }
    if (req.method === 'HEAD') {
      const o = objects.get(key);
      if (!o) return res.writeHead(404).end();
      return res.writeHead(200, { 'Content-Length': String(o.body.length), 'Content-Type': o.contentType }).end();
    }
    if (req.method === 'DELETE') { objects.delete(key); return res.writeHead(204).end(); }
    if (req.method === 'GET') {
      const o = objects.get(key);
      if (!o) return res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
      if (req.headers.range) {
        res.writeHead(206, { 'Content-Range': `bytes 0-0/${o.body.length}`, 'Content-Length': '1' });
        return res.end(o.body.subarray(0, 1));
      }
      res.writeHead(200, { 'Content-Length': String(o.body.length), 'Content-Type': o.contentType });
      return res.end(o.body);
    }
    return res.writeHead(405).end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const boundPort = server.address().port;
  return {
    bucket, objects, requests,
    url: `http://127.0.0.1:${boundPort}`,
    /** Forces the next `n` PUTs to answer 503, so retry logic can be exercised. */
    failPuts(n) { failNextPut = n; },
    /** The keys as the R2 client sees them, with sizes. */
    list: () => [...objects.entries()].map(([key, o]) => ({ key, bytes: o.body.length, contentType: o.contentType })),
    // Keep-alive sockets from fetch keep `close()` waiting, so they are cut explicitly.
    stop: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
