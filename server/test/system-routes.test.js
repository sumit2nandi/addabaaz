import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSystemRoutes } from '../src/routes/system.js';

function systemHandlers({ dbUp = true, release = null, viewer = null } = {}) {
  const handlers = new Map();
  const catalogReads = [];
  const api = { get: (route, ...middleware) => handlers.set(route, middleware.at(-1)) };
  const db = { async ping() { if (!dbUp) throw new Error('database unavailable'); } };
  registerSystemRoutes(api, {
    db,
    catalog: { async get(options) { catalogReads.push(options); return { catalog: { shows: [] }, studio: { name: 'ADDABAAZ' } }; } },
    payments: { provider: 'mock' },
    billing: { config: { gstEnabled: false } },
    r2: { configured: false },
    version: 'test-version',
    release,
    viewer,
  });
  handlers.catalogReads = catalogReads;
  return handlers;
}

async function invoke(handler, req = {}) {
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers ??= {}; this.headers[name] = value; return this; },
  };
  let error;
  await handler(req, res, (e) => { error = e; });
  if (error) throw error;
  return res;
}

test('public health reports the injected application version and provider state', async () => {
  const routes = systemHandlers();
  const response = await invoke(routes.get('/health'));
  assert.equal(response.body.version, 'test-version');
  assert.equal(response.body.service, 'addabaaz');
  assert.equal(response.body.db, 'up');
  assert.equal(response.body.payments, 'mock');
});

test('public health exposes only a SHA-shaped deployment release marker', async () => {
  const valid = await invoke(systemHandlers({ release: 'a'.repeat(40) }).get('/health'));
  assert.equal(valid.body.commit, 'a'.repeat(40));

  const invalid = await invoke(systemHandlers({ release: 'not-a-commit-or-secret' }).get('/health'));
  assert.equal(Object.hasOwn(invalid.body, 'commit'), false);
});

test('readiness reports unavailable when the database ping fails', async () => {
  const routes = systemHandlers({ dbUp: false });
  const response = await invoke(routes.get('/health/ready'));
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, db: 'down' });
});

test('readiness includes the deployment commit for Render verification', async () => {
  const response = await invoke(systemHandlers({ release: 'b'.repeat(40) }).get('/health/ready'));
  assert.deepEqual(response.body, { ok: true, db: 'up', commit: 'b'.repeat(40) });
});

test('the public catalog endpoint forces a fresh snapshot and forbids HTTP caching', async () => {
  const routes = systemHandlers();
  const response = await invoke(routes.get('/catalog'));
  assert.deepEqual(routes.catalogReads, [{ fresh: true, staff: false }], 'guests get the plain visitor view');
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
});

test('the catalog endpoint widens to the staff view only for a signed-in admin account', async () => {
  const seen = [];
  const viewer = async (req) => { seen.push(req.headers?.authorization || ''); return req.isAdmin ? { id: 'a1', isAdmin: true } : req.viewer || null; };
  const routes = systemHandlers({ viewer });

  await invoke(routes.get('/catalog'), { headers: {} });
  assert.deepEqual(routes.catalogReads.at(-1), { fresh: true, staff: false }, 'an anonymous catalog read stays public');

  await invoke(routes.get('/catalog'), { headers: { authorization: 'Bearer x' } });
  assert.deepEqual(routes.catalogReads.at(-1), { fresh: true, staff: false }, 'a signed-in viewer who is not an admin stays public');

  await invoke(routes.get('/catalog'), { isAdmin: true, headers: { authorization: 'Bearer admin' } });
  assert.deepEqual(routes.catalogReads.at(-1), { fresh: true, staff: true }, 'only an enabled admin account receives the admins-only videos');
  assert.equal(seen.length, 3, 'the resolver is consulted once per catalog read');
});

test('the catalog endpoint stays public when the server has no session resolver', async () => {
  const routes = systemHandlers();
  await invoke(routes.get('/catalog'), { isAdmin: true });
  assert.deepEqual(routes.catalogReads, [{ fresh: true, staff: false }], 'without a resolver nobody can widen the view');
});
