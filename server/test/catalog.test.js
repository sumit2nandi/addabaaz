// Pure tests for catalog behavior shared by the website's cards and playback gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../../app/js/data/catalog.js';
import { createCatalogStore } from '../src/catalog.js';

test('upcoming categories support multiple releases and a legacy featured-title fallback', () => {
  const cat = new Catalog({
    homePosters: { releasingThisMonthId: 'legacy-release' },
    upcoming: [
      { id: 'legacy-release' },
      { id: 'release-two', category: 'releasing-this-month' },
      { id: 'soon-one', category: 'coming-soon' },
    ],
  });
  assert.deepEqual(cat.upcomingByCategory('releasing-this-month').map((item) => item.id), ['legacy-release', 'release-two']);
  assert.deepEqual(cat.upcomingByCategory('coming-soon').map((item) => item.id), ['soon-one']);
  assert.equal(cat.upcomingCategory({ id: 'legacy-release', category: 'coming-soon' }), 'coming-soon', 'an explicit admin choice overrides the old banner link');
});

test('premium access is inherited from a series for every child video', () => {
  const cat = new Catalog({
    shows: [
      { id: 'premium-series', access: 'premium' },
      { id: 'free-series', access: 'free' },
    ],
    videos: [
      { id: 'series-episode', showId: 'premium-series', access: 'free' },
      { id: 'premium-clip', showId: 'free-series', access: 'premium' },
      { id: 'free-clip', showId: 'free-series', access: 'free' },
    ],
  });
  assert.equal(cat.isPremium(cat.video('series-episode')), true);
  assert.equal(cat.isPremium(cat.video('premium-clip')), true);
  assert.equal(cat.isPremium(cat.video('free-clip')), false);
});

test('hidden "Show to Admins only" videos join the catalog for signed-in admins and nobody else', async () => {
  const snapshot = {
    catalog: {
      shows: [], upcoming: [], videos: [
        { id: 'public-one' },
        { id: 'gone', hidden: true },
        { id: 'staff-review', hidden: true, adminsOnly: true },
        { id: 'later', publishAt: new Date(Date.now() + 3_600_000).toISOString() },
      ],
    },
    studio: null,
  };
  const db = { catalog: { async version() { return 1; }, async snapshot() { return structuredClone(snapshot); } } };
  const store = createCatalogStore({ db, catalogPath: null, ttl: 60_000 });
  const ids = (view) => view.catalog.videos.map((v) => v.id);

  assert.deepEqual(ids(await store.get()), ['public-one'], 'visitors see neither hidden videos nor scheduled ones');
  assert.deepEqual(ids(await store.get({ staff: true })), ['public-one', 'staff-review'],
    'signed-in admin accounts additionally receive the hidden video marked admins-only, verbatim');
  assert.deepEqual(ids(await store.get({ all: true })), ['public-one', 'gone', 'staff-review', 'later'],
    'the admin console keeps the full snapshot');
  assert.equal((await store.get({ staff: true })).videoById.has('staff-review'), true,
    'the staff view is indexed like every other catalog view, so watch pages resolve admins-only videos');
});

test('a fresh catalog read checks the database version even inside the in-memory TTL', async () => {
  let version = 1;
  let snapshot = { catalog: { shows: [], upcoming: [], videos: [{ id: 'before-admin-edit' }] }, studio: null };
  let snapshotReads = 0;
  const db = {
    catalog: {
      async version() { return version; },
      async snapshot() { snapshotReads++; return structuredClone(snapshot); },
    },
  };
  const store = createCatalogStore({ db, catalogPath: null, ttl: 60_000 });

  assert.equal((await store.get()).catalog.videos[0].id, 'before-admin-edit');
  version++;
  snapshot = { catalog: { shows: [], upcoming: [], videos: [{ id: 'after-admin-edit' }] }, studio: null };
  assert.equal((await store.get()).catalog.videos[0].id, 'before-admin-edit', 'the ordinary cached read remains within its TTL');
  assert.equal((await store.get({ fresh: true })).catalog.videos[0].id, 'after-admin-edit', 'the refresh path sees Admin writes immediately');
  assert.equal(snapshotReads, 2);
});
