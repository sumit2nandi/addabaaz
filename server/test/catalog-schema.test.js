import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/catalog-schema.js';

test('Premium show and video access are independent of the media source', () => {
  const youtubeChild = { id: 'youtube-child', showId: 'premium-show', source: { type: 'youtube', id: 'abcdefghijk' } };
  const show = validate('show', {
    id: 'premium-show', title: 'Premium show', description: 'A description',
    poster: 'https://images.example.test/poster.webp', access: 'premium',
  }, { videosByShow: new Map([['premium-show', [youtubeChild]]]) });
  assert.deepEqual(show.errors, [], 'a Premium show may contain a YouTube episode');

  const sources = [
    { type: 'youtube', id: 'abcdefghijk' },
    { type: 'mp4', url: 'https://media.example.test/video.mp4' },
    { type: 'hls', url: 'https://media.example.test/video.m3u8' },
    { type: 'r2', key: 'premium/video.mp4' },
  ];
  for (const [index, source] of sources.entries()) {
    const result = validate('video', {
      id: `premium-${index}`, kind: 'reel', title: 'Premium video', source,
      ...(source.type === 'r2' ? { thumbnail: 'https://images.example.test/thumb.webp' } : {}),
      duration: 60, publishedAt: '2026-01-01', access: 'premium',
    });
    assert.deepEqual(result.errors, [], `Premium ${source.type} video should validate`);
  }
});

test('Top 10 ranking: 1…10 on an episode, ignored everywhere else', () => {
  const video = (extra) => ({ id: 'ep-1', showId: 'show-1', kind: 'episode', title: 'Episode', source: { type: 'youtube', id: 'abcdefghijk' }, duration: 60, publishedAt: '2026-01-01', access: 'free', ...extra });
  assert.deepEqual(validate('video', video({ topRank: 1 }), { showIds: new Set(['show-1']) }).errors, []);
  assert.equal(validate('video', video({ topRank: 7 }), { showIds: new Set(['show-1']) }).doc.topRank, 7);
  assert.equal(validate('video', video({}), { showIds: new Set(['show-1']) }).doc.topRank, null, 'no rank is fine');
  assert.match(validate('video', video({ topRank: 11 }), { showIds: new Set(['show-1']) }).errors.join(' '), /topRank must be a whole number between 1 and 10/);
  assert.match(validate('video', video({ topRank: 0 }), { showIds: new Set(['show-1']) }).errors.join(' '), /topRank must be a whole number/);

  // Only episodes belong in the rail: a ranked reel is quietly unranked rather than rejected.
  const reel = validate('video', { ...video({ topRank: 3 }), kind: 'reel' }, { showIds: new Set(['show-1']) });
  assert.deepEqual(reel.errors, []);
  assert.equal(reel.doc.topRank, null, 'a reel can never hold a Top 10 slot');
});
