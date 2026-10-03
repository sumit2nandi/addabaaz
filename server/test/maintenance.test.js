// Maintenance mode: the switch (server/src/maintenance.js), the API guard, and the page visitors get.
//
// Runs the *real* app (`createApp` + `mountWebsite`) with fake storage, so the mount order is the one that
// ships: the guard really is in front of the viewer routes, /status really is never blocked, the consoles
// really do stay reachable, and a browser page really is answered with maintenance.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMaintenance, maintenanceAllows, DEFAULT_MESSAGE, MAX_MESSAGE } from '../src/maintenance.js';
import { fakeDeps } from './helpers/app-fakes.js';

const TOKEN = 'test-admin-token-that-is-long-enough-1234';

/* --------------------------------------------------------------- the service */

test('the switch reads, writes and expires by itself', async () => {
  const store = new Map();
  const db = { settings: { async all() { return Object.fromEntries(store); }, async set(k, v) { store.set(k, v); } } };
  const m = createMaintenance({ db, ttlMs: 0 });

  assert.deepEqual(await m.state(), { active: false, enabled: false, expired: false, message: DEFAULT_MESSAGE, until: null, startedAt: null, since: null }, 'off by default, with a friendly message ready');

  const on = await m.update({ enabled: true });
  assert.equal(on.active, true);
  assert.ok(on.startedAt, 'we remember when it started');

  const tuned = await m.update({ message: '  Back at 6 pm  ', until: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(tuned.message, 'Back at 6 pm', 'the message is trimmed');
  assert.ok(tuned.until > new Date().toISOString());
  assert.equal(m.retryAfter(tuned) > 1800, true, 'Retry-After points at the end of the window');

  // A window that has passed brings the site back on its own.
  store.set('maintenance_until', new Date(Date.now() - 1000).toISOString());
  const expired = await m.state({ fresh: true });
  assert.equal(expired.active, false, 'an expired window is not maintenance');
  assert.equal(expired.enabled, true, 'the stored switch is untouched');
  assert.equal(expired.expired, true);

  assert.equal((await m.update({ enabled: false })).active, false);
  assert.equal(store.get('maintenance_started_at'), '');
});

test('the switch rejects input it cannot honour', async () => {
  const store = new Map();
  const db = { settings: { async all() { return Object.fromEntries(store); }, async set(k, v) { store.set(k, v); } } };
  const m = createMaintenance({ db, ttlMs: 0 });
  await assert.rejects(() => m.update({ message: 'x'.repeat(MAX_MESSAGE + 1) }), (e) => e.code === 'message_too_long');
  await assert.rejects(() => m.update({ until: 'not a date' }), (e) => e.code === 'invalid_until');
  await assert.rejects(() => m.update({ until: new Date(Date.now() - 60_000).toISOString() }), (e) => e.code === 'invalid_until');
});

test('a database that cannot answer never looks like maintenance', async () => {
  const m = createMaintenance({ db: { settings: { all: async () => { throw new Error('down'); }, set: async () => {} } }, log: { warn() {} }, ttlMs: 0 });
  assert.equal((await m.state()).active, false);
});

test('only the paths an operator (or a settled payment) needs survive the guard', () => {
  for (const p of ['/health', '/health/ready', '/status', '/admin/maintenance', '/auth/login', '/payments/webhook', '/notifications/unsubscribe'])
    assert.equal(maintenanceAllows(p), true, `${p} stays available`);
  for (const p of ['/catalog', '/plans', '/credits', '/support/tickets', '/push/subscribe', '/media/1'])
    assert.equal(maintenanceAllows(p), false, `${p} is refused`);
});

/* --------------------------------------------------------------- the app */

/** Boots the real app against fake storage. `settings` is the app_settings table. */
function boot({ settings = {}, ...opts } = {}) {
  const { db, mailer, payments, sms, secret } = fakeDeps({ settings });
  const app = createApp({
    db, jwtSecret: secret, serveStatic: true, payments, sms, mailer, rate: false, adminToken: TOKEN,
    uploadDir: '/tmp/addabaaz-maintenance-uploads', catalogPath: '/tmp/addabaaz-maintenance-catalog.json',
    ...opts,
  });
  return { app, db, secret };
}

async function serve(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', token = '', body, accept = 'text/html' } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: accept },
      body: body ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { base, call, close: () => new Promise((r) => server.close(r)) };
}

test('while the switch is on the API refuses viewers, the console keeps working, and pages show the page', async () => {
  const { app } = boot();
  const { call, close } = await serve(app);
  try {
    // Off to start with.
    assert.equal((await call('/api/v1/status', { accept: 'application/json' })).body.maintenance.active, false);

    // The console flips the switch (ADMIN_TOKEN path — the same API the Maintenance page uses).
    const on = await call('/api/v1/admin/maintenance', { method: 'PATCH', token: TOKEN, accept: 'application/json', body: { enabled: true, message: 'Upgrading the app — back by 6 pm.', until: new Date(Date.now() + 3600e3).toISOString() } });
    assert.equal(on.status, 200, 'the console may always write');
    assert.equal(on.body.active, true);
    assert.equal(on.body.stillOnline.includes('This console'), true, 'and is told what stays reachable');

    // Viewer API: refused, with the reason and a Retry-After.
    const blocked = await call('/api/v1/catalog', { accept: 'application/json' });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'maintenance');
    assert.equal(blocked.body.error.message, 'Upgrading the app — back by 6 pm.');
    assert.ok(Number(blocked.headers.get('retry-after')) > 60, 'crawlers and clients are told when to come back');
    assert.equal(blocked.headers.get('cache-control'), 'no-store');

    // The public status probe, health checks and the console itself are untouched.
    const status = await call('/api/v1/status', { accept: 'application/json' });
    assert.equal(status.status, 200);
    assert.equal(status.body.maintenance.active, true);
    assert.equal(status.body.maintenance.until.length > 0, true);
    assert.equal((await call('/api/v1/health', { accept: 'application/json' })).status, 200);
    assert.equal((await call('/api/v1/admin/stats', { accept: 'application/json' })).status, 401, 'reachable — it asks for a session instead of refusing');
    assert.equal((await call('/admin/')).status, 200, 'the console page loads');
    assert.equal((await call('/app/js/router.js')).status, 200, 'assets still load (the page uses them)');

    // Pages: the maintenance page instead of the app shell.
    const page = await call('/');
    assert.equal(page.status, 503);
    assert.match(page.body, /We’ll be right back/);
    assert.match(page.body, /Upgrading the app — back by 6 pm\./, 'the operator’s message is on the page');
    assert.match(page.body, /api\/v1\/status/, 'and the page can poll for our return');
    assert.doesNotMatch(page.body, /\{\{/, 'every placeholder was filled in — the page is valid, JS included');
    assert.match(page.body, /var until = (?:null|")/, 'the end of the window arrives as JavaScript');
    assert.equal((await call('/show/shahid')).status, 503, 'deep links too');
    assert.equal((await call('/maintenance')).status, 503, 'the page itself reports honestly');
    assert.equal((await call('/api/v1/catalog', { accept: 'text/plain' })).status, 503, 'non-HTML clients get a status, not a page');

    // And back off again.
    const off = await call('/api/v1/admin/maintenance', { method: 'PATCH', token: TOKEN, accept: 'application/json', body: { enabled: false } });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    assert.equal((await call('/api/v1/catalog', { accept: 'application/json' })).status, 200);
    assert.equal((await call('/')).status, 200, 'the app shell is served again');
    assert.equal((await call('/maintenance')).status, 200, 'and /maintenance is a preview');
  } finally { await close(); }
});

test('a server that never touches the switch is completely unaffected', async () => {
  const { app } = boot();
  const { call, close } = await serve(app);
  try {
    assert.equal((await call('/api/v1/status', { accept: 'application/json' })).body.maintenance.active, false);
    assert.equal((await call('/api/v1/catalog', { accept: 'application/json' })).status, 200);
    assert.equal((await call('/')).status, 200);
    assert.equal((await call('/api/v1/admin/maintenance', { accept: 'application/json' })).status, 401, 'the endpoint exists but needs an admin');
  } finally { await close(); }
});

test('a window that expires reopens the site without anybody touching the switch', async () => {
  const { app } = boot({ settings: { maintenance_enabled: 'true', maintenance_until: new Date(Date.now() - 60_000).toISOString(), maintenance_message: 'Short break' } });
  const { call, close } = await serve(app);
  try {
    assert.equal((await call('/')).status, 200, 'the window is over');
    assert.equal((await call('/api/v1/catalog', { accept: 'application/json' })).status, 200);
    const status = await call('/api/v1/status', { accept: 'application/json' });
    assert.equal(status.body.maintenance.enabled, true, 'the operator can see why');
    assert.equal(status.body.maintenance.expired, true);
  } finally { await close(); }
});
