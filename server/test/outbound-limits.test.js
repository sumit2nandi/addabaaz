// Limits on what the server asks of other people's machines, and how the database transport is judged.
// Every one of these is a "one hung upstream should not take the site down" or "say it out loud at boot"
// guard, and none of them needs MySQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, OUTBOUND_TIMEOUT_MS } from '../src/http.js';
import { dbConfigFromEnv, dbTransportWarnings } from '../src/config.js';
import { parseCorsOrigins, allowedOrigin, SITE_CSP } from '../src/middleware/security.js';
import { createR2 } from '../src/r2.js';
import { createMsg91 } from '../src/sms.js';

/* ---------- withTimeout ---------- */

test('withTimeout(): every outbound request gets an abort timer', () => {
  const init = withTimeout({ method: 'POST', body: 'x' }, 5_000);
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'x');
  assert.ok(init.signal instanceof AbortSignal, 'a signal is attached');
  assert.equal(init.signal.aborted, false);
});

test('withTimeout(): a caller-supplied signal is never replaced', () => {
  const controller = new AbortController();
  const init = withTimeout({ signal: controller.signal }, 5_000);
  assert.equal(init.signal, controller.signal);
});

test('withTimeout(): a budget of zero or less disables the timer', () => {
  for (const ms of [0, -1, NaN]) {
    const init = withTimeout({ method: 'GET' }, ms);
    assert.equal(init.signal, undefined, `ms=${ms} must not attach a signal`);
  }
});

test('a provider that never answers is cut off, not awaited forever', async () => {
  const sms = createMsg91({
    authKey: 'k', templateId: 't', timeoutMs: 300,
    log: { warn() {}, error() {}, log() {} },
    // `AbortSignal.timeout()` uses an unref'd timer (so it can never keep a process alive on its own);
    // a real request has a socket holding the loop open, which this fake has to imitate.
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      const socket = setInterval(() => {}, 25);
      init.signal.addEventListener('abort', () => { clearInterval(socket); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    }),
  });
  const started = Date.now();
  await assert.rejects(() => sms.send({ phone: '919812345678', code: '123456', minutes: 10 }), (e) => e.status === 503 && e.code === 'sms_unavailable');
  const took = Date.now() - started;
  assert.ok(took < 5_000, `the call must be abandoned by the timer (took ${took} ms)`);
  assert.ok(took >= 250, `it must not return instantly (took ${took} ms)`);
});

test('OUTBOUND_TIMEOUT_MS is a sane per-request budget', () => {
  assert.ok(Number.isFinite(OUTBOUND_TIMEOUT_MS) && OUTBOUND_TIMEOUT_MS >= 1_000 && OUTBOUND_TIMEOUT_MS <= 120_000, String(OUTBOUND_TIMEOUT_MS));
});

/* ---------- R2: the gateway must not buffer an arbitrarily large object ---------- */

test('r2.getText(): an oversized playlist is refused instead of buffered', async () => {
  // createR2 reads the environment it is given, so a stubbed global fetch is enough for this check.
  const real = globalThis.fetch;
  try {
    const tooBig = 'y'.repeat(2_000_001);
    for (const [headers, why] of [
      [{ 'content-length': '900000000' }, 'declares a huge body'],
      [null, 'lies about its length and streams it anyway'],
    ]) {
      globalThis.fetch = async () => ({
        status: 200, ok: true, headers: { get: (n) => (headers ? headers[n.toLowerCase()] : null) },
        text: async () => tooBig,
      });
      const r2 = createR2({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' });
      await assert.rejects(() => r2.getText('some/file.m3u8'), /too large to be a playlist/, why);
    }
  } finally { globalThis.fetch = real; }
});

test('r2.getText(): a normal playlist is returned untouched', async () => {
  const real = globalThis.fetch;
  try {
    const body = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8\n';
    globalThis.fetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => body });
    const r2 = createR2({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' });
    assert.equal(await r2.getText('premium/show/master.m3u8'), body);
  } finally { globalThis.fetch = real; }
});

/* ---------- database transport advisories ---------- */

const DANGEROUS = { NODE_ENV: 'production', DB_HOST: 'db-prod.internal.example', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'addabaaz' };

test('dbTransportWarnings(): cleartext MySQL in production is reported', () => {
  const cfg = dbConfigFromEnv(DANGEROUS);
  assert.equal(cfg.ssl, undefined);
  const warnings = dbTransportWarnings(cfg, DANGEROUS);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WITHOUT TLS/);
});

test('dbTransportWarnings(): an explicit opt-out, development and a private host stay quiet', () => {
  assert.deepEqual(dbTransportWarnings(dbConfigFromEnv({ ...DANGEROUS, DB_SSL: 'disabled' }), { ...DANGEROUS, DB_SSL: 'disabled' }), []);
  assert.deepEqual(dbTransportWarnings(dbConfigFromEnv({ ...DANGEROUS, NODE_ENV: 'development' }), { ...DANGEROUS, NODE_ENV: 'development' }), [], 'development must not nag');
  for (const host of ['127.0.0.1', 'localhost', 'mysql', '10.0.0.7', '192.168.1.9']) {
    assert.deepEqual(dbTransportWarnings(dbConfigFromEnv({ ...DANGEROUS, DB_HOST: host }), DANGEROUS), [], host);
  }
});

test('dbTransportWarnings(): disabled verification is called out even with TLS on', () => {
  const env = { ...DANGEROUS, DB_SSL: 'true', DB_SSL_VERIFY: 'false', DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n' };
  const warnings = dbTransportWarnings(dbConfigFromEnv(env), env);
  assert.ok(warnings.some((w) => /certificate verification/.test(w)), warnings.join('\n'));
});

test('dbTransportWarnings(): TLS with no CA gets a hint, a private CA is a common cause', () => {
  const env = { ...DANGEROUS, DB_SSL: 'true' };
  const warnings = dbTransportWarnings(dbConfigFromEnv(env), env);
  assert.ok(warnings.some((w) => /no CA certificate|publicly trusted/i.test(w)), warnings.join('\n'));
});

/* ---------- CORS allow-list parsing ---------- */

test('parseCorsOrigins(): blanks and spaces are tolerated, "*" is preserved', () => {
  assert.deepEqual(parseCorsOrigins('https://a.in, https://b.in ,'), ['https://a.in', 'https://b.in']);
  assert.deepEqual(parseCorsOrigins('*'), ['*']);
  assert.deepEqual(parseCorsOrigins(''), []);
});

test('allowedOrigin(): only an exact origin matches', () => {
  const list = parseCorsOrigins('https://addabaaz.in,https://app.addabaaz.in');
  assert.equal(allowedOrigin('https://addabaaz.in', list), true);
  assert.equal(allowedOrigin('https://addabaaz.in.', list), false, 'a trailing dot is a different origin');
  assert.equal(allowedOrigin('http://addabaaz.in', list), false, 'the scheme matters');
  assert.equal(allowedOrigin('https://evil.in', list), false);
  assert.equal(allowedOrigin('https://addabaaz.in.evil.in', list), false);
});

test('the site CSP never falls back to unsafe-inline or a wildcard for scripts and frames', () => {
  for (const directive of ['script-src', 'frame-src', 'default-src', 'object-src']) {
    const value = (SITE_CSP.match(new RegExp(`${directive}([^;]*)`)) || [, ''])[1].trim();
    assert.ok(!/'unsafe-inline'/.test(value), `${directive} must not allow inline content`);
    if (directive !== 'default-src' && directive !== 'object-src') assert.ok(!/(^|\s)\*(\s|;|$)/.test(value), `${directive} must not be a wildcard`);
  }
  assert.match(SITE_CSP, /frame-ancestors 'self'/);
  assert.match(SITE_CSP, /base-uri 'self'/);
  assert.match(SITE_CSP, /object-src 'none'/);
});
