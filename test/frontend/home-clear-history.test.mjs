// The bin at the end of the Continue Watching heading clears this profile's watch history —
// but only after the shared confirmation popup is confirmed; Cancel keeps everything.
// Run: node --test test/frontend/home-clear-history.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('home renders a circular bin on the Continue Watching heading and clears history after confirm', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="toasts"></div></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.IntersectionObserver = undefined;
  // linkedom has no <dialog> behaviour: give the element prototype the two methods openDialog uses.
  const dialogProto = Object.getPrototypeOf(document.createElement('dialog'));
  dialogProto.showModal = function () { this.setAttribute('open', ''); };
  dialogProto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  let cleanup;
  try {
    const { app } = await import('../../app/js/app.js');
    const { Catalog } = await import('../../app/js/data/catalog.js');
    const { default: home } = await import('../../app/js/views/home.js');
    const catalog = new Catalog(JSON.parse(fs.readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')));
    const watched = catalog.trending(1)[0];
    let cleared = 0;
    app.catalog = catalog;
    app.user = {
      account: { email: 'viewer@addabaaz.com' },
      lib: { progress: { [watched.id]: { position: 90, updatedAt: 1 } } },
      continueWatching: () => [{ video: watched }],
      resumeTarget: () => null,
      inList: () => false,
      hasReminder: () => false,
      listItems: () => [],
      recommendations: () => null,
      fraction: () => 0.5,
      clearHistory: () => { cleared++; },
    };
    const root = document.createElement('main');
    await home({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });

    const railEl = root.querySelector('#cw-rail');
    const bin = railEl?.querySelector('button[data-clear-history]');
    assert.ok(bin, 'the Continue Watching heading carries a bin button');
    assert.equal(bin.getAttribute('aria-label'), 'Clear watch history');
    assert.ok(bin.querySelector('svg'), 'the bin renders as an icon-only button');

    bin.click();
    await tick();
    const dlg = document.querySelector('dialog.dialog');
    assert.match(dlg.textContent, /Clear watch history\?/);
    dlg.querySelector('[data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick();
    assert.equal(cleared, 0, 'Cancel keeps the history');
    assert.ok(root.querySelector('#cw-rail'), 'Cancel keeps the rail');

    root.querySelector('button[data-clear-history]').click();
    await tick();
    document.querySelector('dialog #ok').onclick();
    await tick();
    assert.equal(cleared, 1, 'confirming clears the profile watch history');
    assert.equal(root.querySelector('#cw-rail'), null, 'the empty Continue Watching rail is removed');
    assert.equal(root.querySelector('#byw-rail'), null, 'any history-seeded rail goes too');
    assert.match(document.querySelector('#toasts').textContent, /Watch history cleared/);

    cleanup();
    const before = cleared;
    root.dispatchEvent(new window.Event('click', { bubbles: true }));
    await tick();
    assert.equal(cleared, before, 'the listener is removed with the view');
  } finally {
    cleanup?.();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('the shared rail helper accepts heading extras and home wires the destructive confirm', () => {
  const components = read('app/js/ui/components.js');
  assert.match(components, /headExtra = ''/);
  assert.match(components, /\$\{headExtra\}/);
  const view = read('app/js/views/home.js');
  assert.match(view, /id: 'cw-rail'/);
  assert.match(view, /data-clear-history aria-label="Clear watch history"/);
  assert.match(view, /confirmDialog\(\{ title: 'Clear watch history\?', text: 'This removes Continue Watching for this profile\.', confirm: 'Clear', danger: true \}\)/);
  assert.match(view, /u\.clearHistory\(\);\s*toast\('Watch history cleared'\)/);
  assert.match(view, /ctx\.onCleanup\(\(\) => ctx\.root\.removeEventListener\('click', onClear\)\)/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.rail-clear \{[^}]*border-radius: 50%/);
});
