import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/catalog-schema.js';

test('R2 catalog-photo paths are accepted offline and can be checked by the admin API', () => {
  const show = { id: 'r2-show', title: 'R2 show', description: 'A description', poster: 'r2-assets/catalog/0123456789abcdef01234567-hq.webp' };
  assert.deepEqual(validate('show', show).errors, [], 'offline catalog checks validate the stable path format without R2 credentials');
  const checked = validate('show', show, { r2FileExists: (path) => path === show.poster });
  assert.deepEqual(checked.errors, [], 'the online validator accepts a verified R2 object');
  assert.match(validate('show', show, { r2FileExists: () => false }).errors.join(' '), /R2 photo .* does not exist/);
});

test('R2 video-thumbnail paths allow generated nested WebP renditions and check object existence online', () => {
  const thumbnail = 'r2-assets/video-thumbnails/premium/show-name/0123456789abcdef01234567-hq.webp';
  const video = {
    id: 'video-thumb', kind: 'episode', title: 'Video with a thumbnail',
    source: { type: 'r2', key: 'premium/show-name/episode.mp4' }, thumbnail,
    duration: 60, publishedAt: '2026-01-01', access: 'premium',
  };
  assert.deepEqual(validate('video', video).errors, [], 'offline catalog validation recognizes the stable video-thumbnail path');
  assert.deepEqual(validate('video', video, { r2FileExists: (path) => path === thumbnail }).errors, [], 'the admin validator accepts the verified R2 object');
  assert.match(validate('video', video, { r2FileExists: () => false }).errors.join(' '), /R2 video thumbnail .* does not exist/);
  assert.match(validate('video', { ...video, thumbnail: 'r2-assets/video-thumbnails/premium/../0123456789abcdef01234567-hq.webp' }).errors.join(' '), /thumbnail must be an uploaded image/);
});

test('R2 forced format must match the object: "Force HLS" needs a .m3u8 master playlist key', () => {
  // Error report #861: "Force HLS" on a single uploaded video file sent MP4 bytes to hls.js as a manifest
  // ("no EXTM3U delimiter" on desktop). The schema now blocks the mismatch at save time with a recipe.
  const base = { id: 'fmt-check', kind: 'episode', title: 'Format check', duration: 60, publishedAt: '2026-01-01', access: 'free', thumbnail: 'https://images.example.test/thumb.webp' };
  const errors = (source) => validate('video', { ...base, source }).errors;
  assert.deepEqual(errors({ type: 'r2', key: 'premium/x/master.m3u8', format: 'hls' }), [], 'HLS package with a matching flag is fine');
  assert.deepEqual(errors({ type: 'r2', key: 'premium/x/video.mp4', format: 'mp4' }), [], 'video file with a matching flag is fine');
  assert.deepEqual(errors({ type: 'r2', key: 'premium/x/video.mp4' }), [], 'no flag = detection from the file name');
  assert.match(errors({ type: 'r2', key: 'premium/x/video.mp4', format: 'hls' }).join(' '), /Force HLS needs the key of an HLS master playlist ending in \.m3u8/);
  assert.match(errors({ type: 'r2', key: 'premium/x/master.m3u8', format: 'mp4' }).join(' '), /can't be format mp4/);
});

test('"Show to Admins only" is a video flag that only survives while the video is hidden', () => {
  const base = { id: 'staff-only', kind: 'episode', title: 'Staff review cut', duration: 60, publishedAt: '2026-01-01', access: 'free', source: { type: 'youtube', id: 'abcdefghijk' } };
  const hidden = validate('video', { ...base, hidden: true, adminsOnly: true });
  assert.deepEqual(hidden.errors, []);
  assert.equal(hidden.doc.adminsOnly, true, 'a hidden video may carry the admins-only flag');
  const shown = validate('video', { ...base, hidden: false, adminsOnly: true });
  assert.deepEqual(shown.errors, [], 'the flag on an unhidden video is not an error…');
  assert.equal(shown.doc.adminsOnly, false, '…but it is cleared there, so a public video never carries a widened audience');
  assert.equal(validate('video', { ...base, hidden: true }).doc.adminsOnly, false, 'hidden without the flag stays hidden from everybody');
  assert.equal(validate('video', base).doc.adminsOnly, false, 'the flag defaults to off');
  assert.match(validate('video', { ...base, adminsOnly: true, mystery: 1 }).errors.join(' '), /Unknown field "mystery"/,
    'the field is part of the video schema, so typos around it still fail');
});

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
