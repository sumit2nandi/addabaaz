// Pure tests for catalog behavior shared by the website's cards and playback gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../../app/js/data/catalog.js';

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
