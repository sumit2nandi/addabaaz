// Coming Soon is part of Shows:
//
//   1. tapping a Coming Soon banner on the home page opens #/soon/:id — the floating menu must light up
//      SHOWS there (it has no Coming Soon item of its own), not leave the bar with nothing highlighted;
//   2. those pages carry the same plain-arrow Back action as the rest of the app, beside the page title.
//
// Run: node --test test/frontend/coming-soon-nav.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('a Coming Soon page highlights Shows in mobile tabs and Coming Soon in the desktop rail', async () => {
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
    assert.deepEqual(activeNav(), ['upcoming'], `${path} still lights up Coming Soon in the desktop rail`);
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

test('both Coming Soon pages use the shared plain-arrow Back beside the title', () => {
  for (const view of ['soon', 'upcoming']) {
    const source = read(`app/js/views/${view}.js`);
    assert.match(source, /import \{ pageBack \} from '\.\.\/ui\/page-back\.js';/, `${view}.js imports the shared button`);
    assert.match(source, /pageBack\(ctx/, `${view}.js wires it to the previous page`);
    if (view === 'soon') assert.match(source, /class="detail-title-row">\$\{backButton\}<h1/, `${view}.js puts it beside the title`);
    else assert.match(source, /back: backButton/, `${view}.js puts it beside the title`);
    assert.doesNotMatch(source, /class="back-link"|class="back-row"/, `${view}.js has no old standalone Back row`);
  }
  // A shared /soon/… link opened cold has no in-app page to go back to: Back lands on the Coming Soon list.
  assert.match(read('app/js/views/soon.js'), /pageBack\(ctx, '\/upcoming'\)/);
  const css = read('app/css/styles.css');
  assert.match(css, /\.detail-title-row \.page-back \{[^}]*color: #fff;/, 'the plain arrow stays visible on the artwork');
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
  const back = root.querySelector('.page-back');
  assert.ok(back, 'the Coming Soon page shows its plain-arrow Back action beside the heading');
  assert.equal(back.getAttribute('aria-label'), 'Back to previous page');
  assert.match(root.textContent, /Coming Soon/, 'and the page itself still renders');
  cleanup?.();
});
