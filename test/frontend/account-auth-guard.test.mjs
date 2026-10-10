import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { app } from '../../app/js/app.js';

test('guest Account visits redirect to Sign in before rendering or accessing profile data', async () => {
  const previousUser = app.user;
  const previous = Object.fromEntries(['history', 'window', 'HashChangeEvent'].map(k => [k, globalThis[k]]));
  let destination;
  globalThis.history = { replaceState: (_state, _title, url) => { destination = url; } };
  globalThis.window = { dispatchEvent() {} };
  globalThis.HashChangeEvent = class {};
  app.user = { account: null, get profile() { throw new Error('Guest profile must not render'); } };
  try {
    const { default: account } = await import('../../app/js/views/account.js');
    await account({ setTitle() { throw new Error('Must redirect before rendering'); } });
    assert.equal(destination, '#/signin?next=/account');
  } finally {
    app.user = previousUser;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('guests sent to Sign in for a protected Account destination can still get home', () => {
  const source = readFileSync(new URL('../../app/js/views/auth.js', import.meta.url), 'utf8');
  // These pages are full pages, not popups: there is no close button any more.
  assert.ok(!source.includes('authClose') && !source.includes('auth-close'));
  // The guest escape hatch still lands people home instead of bouncing them at /account again.
  assert.match(source, /guest-btn[^>]*href=\\?"#\/\\?"/, 'Browse as Guest links home');
  assert.ok(source.includes('guest-btn'));
});
