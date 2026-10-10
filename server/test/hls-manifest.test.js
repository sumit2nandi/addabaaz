// HLS manifest delivery regressions (error report #861: "no EXTM3U delimiter" on desktop while the same video
// played on mobile). Root cause: "Force HLS" on a single uploaded video file made the stream endpoint hand hls.js
// MP4 bytes as a manifest. The effective format now comes from the R2 key, playlists are normalized and validated
// at the gateway, and the admin schema blocks the mismatch before it can be saved again.
// Run: node --test server/test/hls-manifest.test.js   (no database or network needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectR2Format, normalizePlaylist, isHlsPlaylist } from '../src/hls.js';
import { signJwt } from '../src/auth.js';
import { registerMediaRoutes } from '../src/routes/media.js';

/* ---------------- pure helpers ---------------- */

test('detectR2Format judges the object by its key, case-insensitively', () => {
  assert.equal(detectR2Format('premium/test/master.m3u8'), 'hls');
  assert.equal(detectR2Format('premium/test/720p/index.M3U8'), 'hls');
  assert.equal(detectR2Format('premium/test/abcd-test.mp4'), 'mp4');
  assert.equal(detectR2Format('premium/test/IMG_6304.MOV'), 'mp4');
  assert.equal(detectR2Format(''), 'mp4');
  assert.equal(detectR2Format(undefined), 'mp4');
});

test('normalizePlaylist strips editor prefixes (BOM, zero-width chars, leading blank lines) but never content', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8\n';
  assert.equal(normalizePlaylist(master), master, 'a clean manifest passes through untouched');
  assert.equal(normalizePlaylist(`\uFEFF${master}`), master, 'UTF-8 BOM is stripped');
  assert.equal(normalizePlaylist(`\u200B\uFEFF\r\n\n  \t${master}`), master, 'zero-width chars and leading whitespace/blank lines are stripped');
  assert.equal(normalizePlaylist(''), '');
  assert.equal(normalizePlaylist(null), '');
  assert.equal(normalizePlaylist(undefined), '');
  assert.equal(normalizePlaylist('#EXTM3U\n\uFEFF720p/index.m3u8\n'), '#EXTM3U\n\uFEFF720p/index.m3u8\n', 'only the prefix is touched, never the body');
});

test('isHlsPlaylist requires the RFC 8216 #EXTM3U first line', () => {
  assert.equal(isHlsPlaylist('#EXTM3U\n#EXTINF:6,\nseg0.ts\n'), true);
  assert.equal(isHlsPlaylist('\uFEFF#EXTM3U\n'), false, 'a BOM prefix is not a playlist until normalized');
  assert.equal(isHlsPlaylist('ftypisom\x00\x00'), false, 'MP4 bytes are not a playlist');
  assert.equal(isHlsPlaylist(''), false);
  assert.equal(isHlsPlaylist(null), false);
});

/* ---------------- stream endpoint + gateway behaviour ---------------- */

const SECRET = 'hls-manifest-test-secret';
// Minimal express-router stand-in that just records the handlers by method + path.
function mountMedia({ videos, files, logCalls = [] }) {
  const routes = new Map();
  const api = { post: (p, h) => routes.set(`POST ${p}`, h), get: (p, h) => routes.set(`GET ${p}`, h) };
  const r2 = {
    configured: true,
    head: async (key) => ({ status: files[key] != null ? 200 : 404 }),
    presignGet: (key, { ttl }) => `https://r2.test/${key}?ttl=${ttl}`,
    getText: async (key) => files[key] ?? null,
  };
  const log = { warn: (m) => logCalls.push(m) };
  registerMediaRoutes(api, {
    db: {}, secret: SECRET, publicApiUrl: 'https://api.example', streamTtl: 600, r2,
    catalog: { video: (id) => videos[id] ?? null, get: async () => ({ catalog: { shows: [] } }) },
    features: {}, userFromRequest: async () => null, log,
  });
  return routes;
}
const jsonRes = () => { const res = { headers: {}, body: null, set(n, v) { Object.assign(this.headers, typeof n === 'object' ? n : { [n]: v }); return this; }, json(b) { this.body = b; return this; } }; return res; };
const gatewayRes = () => { const res = { headers: {}, body: null, set(n, v) { Object.assign(this.headers, typeof n === 'object' ? n : { [n]: v }); return this; }, send(t) { this.body = t; return this; }, status(s) { this.statusCode = s; return this; } }; return res; };
const run = async (handler, req, res) => { let err = null; await handler(req, res, (e) => { err = e; }); return err; };
const streamReq = (id) => ({ params: { id }, get: () => '' });
const gatewayReq = (token, rest, { origin = 'https://www.addabaaz.in', ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0 Safari/537.36 Edg/154.0' } = {}) => ({
  params: { token, 0: rest }, headers: { origin, 'user-agent': ua }, get(name) { return this.headers[name.toLowerCase()] || ''; },
});

test('forced HLS on a single video file streams progressive MP4 instead of breaking hls.js (error #861)', async () => {
  const logCalls = [];
  const routes = mountMedia({
    logCalls,
    videos: { test: { id: 'test', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/test/abcd-test.mp4', format: 'hls' } } },
    files: { 'premium/test/abcd-test.mp4': 'not really read — binary MP4' },
  });
  const handler = routes.get('POST /videos/:id/stream');

  const res1 = jsonRes();
  assert.equal(await run(handler, streamReq('test'), res1), null);
  assert.equal(res1.body.type, 'mp4', 'the key (an .mp4 object) beats the contradictory "Force HLS" flag');
  assert.match(res1.body.url, /^https:\/\/r2\.test\/premium\/test\/abcd-test\.mp4\?ttl=/, 'the viewer gets a direct signed MP4 URL every player can play');
  assert.equal(logCalls.length, 1, 'the mismatch is flagged for the admin console');
  assert.match(logCalls[0], /contradicts the R2 key/);

  const res2 = jsonRes();
  await run(handler, streamReq('test'), res2);
  assert.equal(logCalls.length, 1, 'the warning fires once per key, not once per play');
});

test('format detection still serves real HLS packages and reconciles the reverse mismatch', async () => {
  const routes = mountMedia({
    videos: {
      'real-hls': { id: 'real-hls', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/real-hls/master.m3u8' } },
      'forced-mp4-pl': { id: 'forced-mp4-pl', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/forced-mp4-pl/master.m3u8', format: 'mp4' } },
      'plain-mp4': { id: 'plain-mp4', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/plain-mp4/video.mp4', format: 'mp4' } },
    },
    files: { 'premium/real-hls/master.m3u8': '#EXTM3U\n', 'premium/forced-mp4-pl/master.m3u8': '#EXTM3U\n', 'premium/plain-mp4/video.mp4': 'mp4' },
  });
  const handler = routes.get('POST /videos/:id/stream');

  const hls = jsonRes(); await run(handler, streamReq('real-hls'), hls);
  assert.equal(hls.body.type, 'hls');
  assert.match(hls.body.url, /^https:\/\/api\.example\/api\/v1\/media\/[^/]+\/master\.m3u8$/, 'HLS keeps the tokenized gateway URL');

  const forced = jsonRes(); await run(handler, streamReq('forced-mp4-pl'), forced);
  assert.equal(forced.body.type, 'hls', 'a playlist key wins over a contradictory "Force MP4" flag too');

  const mp4 = jsonRes(); await run(handler, streamReq('plain-mp4'), mp4);
  assert.equal(mp4.body.type, 'mp4');
});

test('gateway normalizes playlists so strict parsers see a body starting with #EXTM3U', async () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720p/index.m3u8\n';
  const variant = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n#EXT-X-ENDLIST\n';
  const routes = mountMedia({
    videos: { gw: { id: 'gw', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/gw/master.m3u8', format: 'hls' } } },
    files: {
      'premium/gw/master.m3u8': `\uFEFF\r\n\n${master}`,                       // saved by a Windows editor: BOM + blank lines
      'premium/gw/720p/index.m3u8': ` \t\u200B${variant}`,                     // leading whitespace + zero-width char
    },
  });
  const handler = routes.get('GET /media/:token/*');
  const token = signJwt({ aud: 'media', vid: 'gw', sub: null }, SECRET, 600);

  const masterRes = gatewayRes();
  assert.equal(await run(handler, gatewayReq(token, 'master.m3u8'), masterRes), null);
  assert.equal(masterRes.body.startsWith('#EXTM3U'), true, 'the exact hls.js requirement that produced "no EXTM3U delimiter"');
  assert.equal(masterRes.body, master, 'the playlist content itself is unchanged');
  assert.match(masterRes.headers['Content-Type'], /mpegurl/);

  const variantRes = gatewayRes();
  assert.equal(await run(handler, gatewayReq(token, '720p/index.m3u8'), variantRes), null);
  assert.equal(variantRes.body, variant, 'variant playlists are normalized the same way');
});

test('gateway refuses a stored object that is not a playable playlist with a clear 502, not 200 garbage', async () => {
  const cases = [
    ['premium/gw2/master.m3u8', '<!doctype html><html><body>oops</body></html>'],
    ['premium/gw3/master.m3u8', ''],
    ['premium/gw4/master.m3u8', 'ftypisom MP4 bytes pretending to be a playlist'],
  ];
  const videos = {}, files = {};
  cases.forEach(([key, body], i) => { videos[`gw${i + 2}`] = { id: `gw${i + 2}`, kind: 'trailer', access: 'free', source: { type: 'r2', key, format: 'hls' } }; files[key] = body; });
  const routes = mountMedia({ videos, files });
  const handler = routes.get('GET /media/:token/*');

  for (const [i, [key]] of cases.entries()) {
    const token = signJwt({ aud: 'media', vid: `gw${i + 2}`, sub: null }, SECRET, 600);
    const err = await run(handler, gatewayReq(token, 'master.m3u8'), gatewayRes());
    assert.ok(err, `case ${key}: the request must fail instead of serving unparseable bytes`);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'invalid_manifest');
    assert.match(err.cause?.message || '', new RegExp(key.replace(/\//g, '\\/')), 'the admin-facing cause names the exact R2 object to fix');
  }
});

test('legacy "Force HLS" rows keep old gateway tokens from streaming MP4 bytes as segments', async () => {
  const routes = mountMedia({
    videos: { legacy: { id: 'legacy', kind: 'trailer', access: 'free', source: { type: 'r2', key: 'premium/legacy/video.mp4', format: 'hls' } } },
    files: { 'premium/legacy/video.mp4': 'mp4 bytes' },
  });
  const handler = routes.get('GET /media/:token/*');
  const token = signJwt({ aud: 'media', vid: 'legacy', sub: null }, SECRET, 600);
  const err = await run(handler, gatewayReq(token, 'video.mp4'), gatewayRes());
  assert.ok(err, 'the gateway no longer treats a mislabelled video as HLS content');
  assert.equal(err.status, 404);
});
