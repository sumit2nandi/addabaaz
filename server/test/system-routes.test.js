import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSystemRoutes } from '../src/routes/system.js';

function systemHandlers({ dbUp = true } = {}) {
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
  });
  handlers.catalogReads = catalogReads;
  return handlers;
}

async function invoke(handler) {
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers ??= {}; this.headers[name] = value; return this; },
  };
  let error;
  await handler({}, res, (e) => { error = e; });
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

test('readiness reports unavailable when the database ping fails', async () => {
  const routes = systemHandlers({ dbUp: false });
  const response = await invoke(routes.get('/health/ready'));
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { ok: false, db: 'down' });
});

test('the public catalog endpoint forces a fresh snapshot and forbids HTTP caching', async () => {
  const routes = systemHandlers();
  const response = await invoke(routes.get('/catalog'));
  assert.deepEqual(routes.catalogReads, [{ fresh: true }]);
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
});
