// Continue Watching history is maintained ONLY for signed-in accounts: guests / non-logged-in
// visitors must not accumulate a watch history on the device (saves are no-ops, reads come back empty).
// Run:  node --test test/frontend/history-gating.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { parseHTML } from 'linkedom';

// Minimal browser globals before any app module is imported (they read window/localStorage at module scope).
const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
const mem = new Map();
const storageStub = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage || storageStub;
window.localStorage = globalThis.localStorage;
globalThis.sessionStorage = window.sessionStorage || storageStub;
window.sessionStorage = globalThis.sessionStorage;

const { User } = await import('../../app/js/data/user.js');
const { LocalAdapter } = await import('../../app/js/data/adapters.js');

const VIDEO = { id: 'v1', showId: 's1', duration: 100 };
const catalog = { video: (id) => (id === 'v1' ? VIDEO : null), show: () => null };

async function guestUser() {
  const u = new User(new LocalAdapter());
  await u.init();                              // creates the local guest profile
  u.activeId = u.profiles[0]?.id;
  assert.equal(u.account, null, 'starts signed out');
  return u;
}

beforeEach(() => { mem.clear(); });

test('guest: saveProgress is a no-op — no history is written', async () => {
  const u = await guestUser();
  u.saveProgress('v1', 40, 100, { flush: true });
  assert.deepEqual(Object.keys(u.lib.progress), [], 'nothing is stored for a non-logged-in user');
  assert.equal(u.progressOf('v1'), null);
});

test('guest: leftover history is invisible — Continue Watching, progress bars and resume all read empty', async () => {
  const u = await guestUser();
  u.lib.progress.v1 = { position: 40, duration: 100, updatedAt: '2026-01-01T00:00:00.000Z' };  // saved before this rule
  assert.deepEqual(u.continueWatching(catalog), [], 'no Continue Watching rail for guests');
  assert.equal(u.progressOf('v1'), null, 'no resume point');
  assert.equal(u.fraction('v1', 100), 0, 'no progress bar on cards');
  assert.equal(u.isFinished('v1', 100), false, 'no "Watched" badge');
});

test('guest: recommendations are never seeded from watch history', async () => {
  const u = await guestUser();
  u.lib.progress.v1 = { position: 40, duration: 100, updatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(u.recommendations(catalog), null, 'history-derived suggestions stay off for guests');
});

test('signed-in account: history is maintained (save, resume, Continue Watching)', async () => {
  const u = await guestUser();
  u.account = { id: 'u1', email: 'viewer@example.com' };
  u.saveProgress('v1', 40, 100, { flush: true });
  assert.equal(u.progressOf('v1')?.position, 40, 'progress saved for an account');
  assert.equal(u.fraction('v1', 100), 0.4, 'progress bars work');
  const cw = u.continueWatching(catalog);
  assert.equal(cw.length, 1, 'Continue Watching shows the in-progress video');
  assert.equal(cw[0].video.id, 'v1');
});
