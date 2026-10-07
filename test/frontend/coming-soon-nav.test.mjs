// Coming Soon is part of Shows:
//
//   1. tapping a Coming Soon banner on the home page opens #/soon/:id — the floating menu must light up
//      SHOWS there (it has no Coming Soon item of its own), not leave the bar with nothing highlighted;
//   2. those pages carry the same circular Back button as the rest of the app, so a viewer who arrived
//      from a banner gets back to where they were.
//
// Run: node --test test/frontend/coming-soon-nav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('a Coming Soon page highlights Shows in the floating menu (and Coming Soon in the top bar)', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><header id="topbar" class="topbar"></header><nav id="tabbar" class="tabbar"></nav><main id="view"></main></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.ADDABAAZ_ENV = {};

  const { app } = await import('../../app/js/app.js');
  const { renderShell, markActive } = await import('../../app/js/ui/shell.js');
  app.user = {
    supportsAuth: true,
    account: { id: 'test' },
    profile: { id: 'profile', name: 'Viewer', color: 0 },
    profiles: [{ id: 'profile', name: 'Viewer', color: 0 }],
    activeId: 'profile',
  };
  renderShell();

  const activeTab = () => [...document.querySelectorAll('#tabbar a.active')].map((a) => a.dataset.tab);
  const activeNav = () => [...document.querySelectorAll('#topbar [data-nav].active')].map((a) => a.dataset.nav);

  // Every entry point into Coming Soon: a "Releasing This Month" / "Coming Soon" banner on the home
  // page (#/soon/:id) and the list itself (#/upcoming).
  for (const path of ['/soon/mayer-golpo', '/upcoming']) {
    markActive({ path });
    assert.deepEqual(activeTab(), ['/shows'], `${path} lights up Shows in the floating menu`);
    assert.deepEqual(activeNav(), ['upcoming'], `${path} still lights up Coming Soon in the top bar`);
  }

  // Released shows, the home page and the other tabs keep their own highlight.
  markActive({ path: '/shows' });
  assert.deepEqual(activeTab(), ['/shows']);
  markActive({ path: '/' });
  assert.deepEqual(activeTab(), ['/']);
  assert.deepEqual(activeNav(), ['home']);
  markActive({ path: '/reels/x' });
  assert.deepEqual(activeTab(), ['/reels']);
});

test('both Coming Soon pages use the shared circular Back button', () => {
  for (const view of ['soon', 'upcoming']) {
    const source = read(`app/js/views/${view}.js`);
    assert.match(source, /import \{ pageBack \} from '\.\.\/ui\/page-back\.js';/, `${view}.js imports the shared button`);
    assert.match(source, /pageBack\(ctx/, `${view}.js wires it to the previous page`);
    assert.match(source, /\$\{backButton\}/, `${view}.js renders it`);
    assert.doesNotMatch(source, /class="back-link"/, `${view}.js has no old text back link`);
  }
  // A shared /soon/… link opened cold has no in-app page to go back to: Back lands on the Coming Soon list.
  assert.match(read('app/js/views/soon.js'), /pageBack\(ctx, '\/upcoming'\)/);
  // The banner's button sits in the copy column (the top bar's brand owns the top-left corner) and the
  // hero's own gap spaces it, so it needs no extra margin.
  const css = read('app/css/styles.css');
  assert.match(css, /\.detail-hero \.hero-copy > \.back-row \{ margin: 0; \}/);
});

test('the rendered Coming Soon list carries a working Back button', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  window.matchMedia = () => ({ matches: false });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };

  const { app } = await import('../../app/js/app.js');
  const { Catalog } = await import('../../app/js/data/catalog.js');
  const { default: upcoming } = await import('../../app/js/views/upcoming.js');
  app.catalog = new Catalog({ schema: 1, updatedAt: '', shows: [], videos: [], gallery: [], upcoming: [{ id: 'x', title: 'X', category: 'coming-soon', poster: 'media/x.webp' }] });
  app.user = { account: null, lib: {}, hasReminder: () => false, on: () => {}, listItems: () => [] };

  const root = document.createElement('main');
  let cleanup;
  await upcoming({ root, setTitle() {}, onCleanup(fn) { cleanup = fn; } });
  const back = root.querySelector('.account-edit-back');
  assert.ok(back, 'the Coming Soon page shows the circular Back button');
  assert.equal(back.getAttribute('aria-label'), 'Back to previous page');
  assert.match(root.textContent, /Coming Soon/, 'and the page itself still renders');
  cleanup?.();
});
