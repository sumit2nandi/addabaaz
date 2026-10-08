// "Your Devices" → Remove must survive a failed request: the error has to appear INSIDE the modal
// (a toast is hidden behind the <dialog> top layer) and the button must re-enable so the tap can be
// retried — a single network blip used to leave Remove permanently dead (error report #729).
// Run: node --test test/frontend/device-remove.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body><main id="view"></main><div id="toasts"></div></body></html>');
globalThis.window = window; globalThis.document = document;
globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
window.location = globalThis.location;
globalThis.localStorage = window.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch = async () => { throw new Error('offline'); };

const { app } = await import('../../app/js/app.js');
app.user = {
  account: { name: 'Tester', email: 't@example.in', emailVerified: true, hasPassword: true },
  profile: { id: 'p1', name: 'Tester' },
  supportsAuth: true, isPremium: true, mode: 'remote', hasPin: false,
  pref: () => false, setPref: () => {}, on: () => () => {},
  remote: {
    devices: async () => ({ streamLimit: 2, devices: [
      { deviceId: 'd1', label: 'OnePlus EB2101 · app', current: false, watching: false, lastSeen: new Date().toISOString() },
      { deviceId: 'me', label: 'iPhone / iPad · Chrome', current: true, watching: false, lastSeen: new Date().toISOString() },
    ] }),
    forgetDevice: async () => {},
  },
};
const settings = (await import('../../app/js/views/settings.js')).default;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

test('the dialog lists PLAYBACK devices: exactly one devices() on the adapter, and it calls /me/devices', async () => {
  // A second `devices()` (GET /devices, push registrations) once shadowed the playback one — the
  // class silently keeps the LAST definition — so the list had no deviceId and Remove called
  // DELETE /me/devices/ (empty id) → 404 "Unknown endpoint."
  const { readFileSync } = await import('node:fs');
  const adapters = readFileSync(new URL('../../app/js/data/adapters.js', import.meta.url), 'utf8');
  const remote = adapters.slice(adapters.indexOf('class RemoteAdapter'));
  const defs = [...remote.matchAll(/^\s*devices\(\)\s*\{[^}]*\}/gm)].map((m) => m[0]);
  assert.equal(defs.length, 1, 'exactly one devices() method on RemoteAdapter');
  assert.match(defs[0], /\/me\/devices/, 'and it fetches the playback device list');
  assert.match(remote, /forgetDevice\(id\) \{ return this\.api\.del\(`\/me\/devices\/\$\{encodeURIComponent\(id\)\}`\); \}/);
});

test('a failed Remove shows its error inside the dialog and stays clickable; the retry succeeds', async () => {
  const root = document.createElement('div');
  const ctx = { root, params: { group: 'security' }, query: {}, path: '/account/security', title: '', setTitle(t) { ctx.title = t; }, onCleanup: () => {} };
  await settings(ctx);

  let calls = 0;
  app.user.remote.forgetDevice = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('You appear to be offline.'), { friendly: true, status: 0 });
  };

  click(root.querySelector('#devices'));
  await tick();
  const dlg = [...document.querySelectorAll('dialog')].pop();
  assert.ok(dlg, 'the Your Devices dialog opened');
  const btn = dlg.querySelector('[data-forget="d1"]');
  assert.ok(btn, 'the other device offers Remove');
  assert.equal(btn.getAttribute('type'), 'button', 'Remove never behaves like a submit button');

  click(btn);                                            // first tap: the request fails
  await tick();
  assert.equal(calls, 1, 'the request was attempted');
  assert.equal(btn.disabled, false, 'the button re-enables after a failure');
  const status = dlg.querySelector('#devStatus');
  assert.ok(status, 'the dialog has an inline status line');
  assert.match(status.textContent, /offline/i, 'the error is visible inside the modal, not in a hidden toast');

  click(btn);                                            // second tap: retried and succeeds
  await tick();
  assert.equal(calls, 2, 'the retry reached the API');
  assert.equal(status.textContent, '', 'the stale error clears when a new attempt starts');
  assert.equal(dlg.querySelector('[data-forget="d1"]')?.disabled ?? false, false, 'the list redrew');
});
