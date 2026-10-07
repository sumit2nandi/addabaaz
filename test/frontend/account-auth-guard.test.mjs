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

test('closing Sign in for a protected Account destination returns guests home', () => {
  const source = readFileSync(new URL('../../app/js/views/auth.js', import.meta.url), 'utf8');
  assert.ok(source.includes("go(!u.account && /^\\/account(?:[/?]|$)/.test(next) ? '/' : next)"));
});
