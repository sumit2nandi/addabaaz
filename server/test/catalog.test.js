// Pure tests for catalog behavior shared by the website's cards and playback gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../../app/js/data/catalog.js';

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
