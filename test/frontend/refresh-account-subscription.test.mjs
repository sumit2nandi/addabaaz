// refreshAccount() re-reads the signed-in session from the server. It must pick up BOTH halves of
// what /me returns — the account AND the subscription — because a plan bought or cancelled elsewhere
// (another device, the payment provider's own page) only ever reaches this tab through a call like this
// one. Before this fix it silently dropped the subscription half, so header/plan state built on
// `user.isPremium` (e.g. the premium mark beside the ADDABAAZ logo) stayed stale until a full restart —
// including after a pull-to-refresh, which calls this during its soft refresh (see main.js `softRefresh`).
// Run: node --test test/frontend/refresh-account-subscription.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

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

beforeEach(() => { mem.clear(); });

test('refreshAccount() applies a refreshed subscription, not just the account', async () => {
  const freeSub = { planId: 'free', status: 'active' };
  const premiumSub = { planId: 'plus-yearly', status: 'active' };
  const remote = {
    async init() { return { account: { id: 'u1', name: 'Sumit' }, profiles: [], subscription: premiumSub }; },
  };
  const u = new User({ async init() { return { account: null, profiles: [], subscription: freeSub }; } }, remote);
  u.account = { id: 'u1', name: 'Sumit' };
  u.subscription = freeSub;
  assert.equal(u.isPremium, false, 'starts on the free plan');

  const events = [];
  u.on('account', () => events.push('account'));
  u.on('subscription', () => events.push('subscription'));

  await u.refreshAccount();

  assert.deepEqual(u.subscription, premiumSub, 'the fresh subscription is applied, not dropped');
  assert.equal(u.isPremium, true, 'so isPremium (and anything gated on it, like the header premium mark) updates');
  assert.deepEqual(events.sort(), ['account', 'subscription'], 'both halves of the session are announced');
});

test("pull-to-refresh's softRefresh re-syncs a signed-in viewer's account/subscription before redrawing", () => {
  const main = fs.readFileSync(new URL('../../app/js/main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('export async function softRefresh'), main.indexOf('// The first-run "turn on notifications"'));
  assert.match(body, /if \(app\.user\.account\) await app\.user\.refreshAccount\(\)\.catch\(/,
    'a signed-in viewer\'s account/subscription is re-read, same as the catalog, so the header premium mark never sits stale');
  // Comes before the redraw, so the fresh subscription is what router.refresh()'s markActive()/syncBrandPremium() see.
  assert.ok(body.indexOf('app.user.refreshAccount()') < body.indexOf('await app.router.refresh()'),
    'the account/subscription sync happens before the page (and header) is redrawn');
});
