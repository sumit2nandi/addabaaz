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
