// CORS tests: the Android app WebView (origin https://app.addabaaz.in) — and any other cross-origin
// page — calls the API from a browser. Preflights must therefore allow the app's custom X-Device-*
// / X-Parental-Pin headers; if they are missing the WebView rejects the request and the app reports
// "You appear to be offline" (this is what broke sign-up in the APK). Needs no MySQL: only the CORS
// middleware runs, so a stub database is enough.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// Stub database: none of the requests below ever reach a route that touches the db.
const db = new Proxy({}, { get: () => async () => null });

let server, base;
test.before(async () => {
  const app = createApp({ db, jwtSecret: 'test-secret', rate: false, serveStatic: false });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

// The exact preflight the WebView sends before sign-up/sign-in (X-Device-* forces one on every call).
test('preflight allows the app device headers', async () => {
  const res = await fetch(`${base}/api/v1/auth/signup`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.addabaaz.in',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-device-id, x-device-label',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const allowed = (res.headers.get('access-control-allow-headers') || '').toLowerCase();
  for (const h of ['content-type', 'authorization', 'range', 'if-range', 'x-device-id', 'x-device-label', 'x-parental-pin', 'x-image-renditions', 'x-image-variant-of']) {
    assert.ok(allowed.includes(h), `Access-Control-Allow-Headers must include ${h} (got "${allowed}")`);
  }
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
});

// With an explicit CORS_ORIGINS list the app origin must be listed, and other origins get nothing.
test('explicit origin list echoes allowed origins and withholds the rest', async () => {
  const app = createApp({
    db, jwtSecret: 'test-secret', rate: false, serveStatic: false,
    corsOrigins: 'https://app.addabaaz.in, https://addabaaz.in',
  });
  const s = app.listen(0); await new Promise((r) => s.once('listening', r));
  try {
    const url = `http://127.0.0.1:${s.address().port}/api/v1/health`;
    const allowed = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://app.addabaaz.in', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.addabaaz.in');
    const denied = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  } finally { s.close(); }
});
