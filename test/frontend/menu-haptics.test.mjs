import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// Tapping the top-bar or bottom-tab menu icons fires a short vibration on devices that support it,
// and stays a silent no-op where the Vibration API is missing.
test('menu icon taps vibrate where supported and never throw where they do not', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><header id="topbar" class="topbar"></header><nav id="tabbar" class="tabbar"></nav><main id="view"></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};

  const { app } = await import('../../app/js/app.js');
  const { renderShell } = await import('../../app/js/ui/shell.js');
  app.user = {
    supportsAuth: true,
    account: { id: 'test' },
    profile: { id: 'profile', name: 'Viewer', color: 0 },
    profiles: [{ id: 'profile', name: 'Viewer', color: 0 }],
    activeId: 'profile',
  };
  renderShell();

  const buzzes = [];
  const origNav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (ms) => { buzzes.push(ms); return true; } }, configurable: true });
  try {
    document.querySelector('#tabbar a[data-tab="/shows"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(buzzes.length, 1, 'tapping a bottom tab vibrates');
    assert.equal(buzzes[0], 12, 'the tick is a short 12ms pulse');
    document.querySelector('#topbar .search-link').dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(buzzes.length, 2, 'tapping a top-bar icon vibrates too');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  }

  // No Vibration API at all (desktops, iOS Safari): taps must not throw.
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  try {
    assert.doesNotThrow(() => document.querySelector('#tabbar a[data-tab="/reels"]').dispatchEvent(new window.Event('click', { bubbles: true })), 'taps stay silent without vibrate support');
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  }
});
