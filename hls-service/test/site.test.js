// The optional bridge to the ADDABAAZ catalog: listing videos and attaching a finished HLS key.
// A stub of the main app's admin API stands in for the real site.
// Run: node --test test/site.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSiteBridge } from '../src/site.js';

/** A stand-in for /api/v1/admin/catalog of the main app. */
async function startFakeApp({ token = 'ADMIN_TOKEN_12345678901234567890', catalog } = {}) {
  const state = { puts: [], catalog: catalog || {
    shows: [{ id: 'shahid', title: 'Shahid' }],
    videos: [
      { id: 'ep1', title: 'Episode 1', showId: 'shahid', kind: 'episode', access: 'premium', source: { type: 'youtube', url: 'https://youtu.be/x' } },
      { id: 'ep2', title: 'Episode 2', showId: 'shahid', kind: 'episode', access: 'premium', source: { type: 'r2', key: 'premium/old/ep2.mp4' } },
    ],
    upcoming: [], homePosters: {},
  } };
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if ((req.headers.authorization || '') !== `Bearer ${token}`) return send(401, { error: { code: 'unauthorized', message: 'Please sign in.' } });
    if (req.url === '/api/v1/admin/catalog' && req.method === 'GET') return send(200, state.catalog);
    const m = /^\/api\/v1\/admin\/catalog\/videos\/([^/]+)$/.exec(req.url);
    if (m && req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; });
      return req.on('end', () => {
        const doc = JSON.parse(body || '{}');
        state.puts.push({ id: decodeURIComponent(m[1]), doc });
        const video = state.catalog.videos.find((v) => v.id === doc.id);
        if (!video) return send(404, { error: { code: 'not_found', message: 'Unknown videos.' } });
        if (doc.source?.type === 'r2' && typeof doc.source.key !== 'string') return send(400, { error: { code: 'invalid', message: 'key is required' } });
        return send(200, { item: doc });
      });
    }
    return send(404, { error: { code: 'not_found', message: 'Unknown endpoint.' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, state, stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

const bridgeFor = (app, token = 'ADMIN_TOKEN_12345678901234567890') =>
  createSiteBridge({ site: { apiUrl: app.url, adminToken: token, get configured() { return true; } } });

test('the bridge is off until APP_API_URL and APP_ADMIN_TOKEN are both set', async () => {
  const off = createSiteBridge({ site: { apiUrl: '', adminToken: '', configured: undefined } });
  assert.equal(off.configured, false);
  await assert.rejects(() => off.videos(), (e) => { assert.equal(e.code, 'site_not_configured'); return true; });
});

test('videos are listed with their show name, and a finished package is attached as an R2 HLS source', async () => {
  const app = await startFakeApp();
  const bridge = bridgeFor(app);
  const videos = await bridge.videos();
  assert.deepEqual(videos.map((v) => v.id), ['ep1', 'ep2']);
  assert.equal(videos[0].show, 'Shahid', 'the show title is resolved for the picker');
  assert.equal(videos[1].source.type, 'r2');

  const out = await bridge.publish({ videoId: 'ep2', masterKey: 'premium/shahid-ep6/master.m3u8' });
  assert.equal(out.videoId, 'ep2');
  assert.equal(app.state.puts.length, 1);
  const sent = app.state.puts[0].doc;
  assert.deepEqual(sent.source, { type: 'r2', key: 'premium/shahid-ep6/master.m3u8', format: 'hls' });
  assert.equal(sent.title, 'Episode 2', 'the rest of the document is sent back unchanged (PUT replaces it)');
  assert.equal(sent.id, 'ep2');
  assert.equal(sent.access, 'premium', 'access is left exactly as the operator configured it');
  await app.stop();
});

test('bad input and app errors come back as clear API errors', async () => {
  const app = await startFakeApp();
  const bridge = bridgeFor(app);
  await assert.rejects(() => bridge.publish({ videoId: '', masterKey: 'x' }), (e) => { assert.equal(e.code, 'missing_video'); return true; });
  await assert.rejects(() => bridge.publish({ videoId: 'nope', masterKey: 'x' }), (e) => { assert.equal(e.code, 'video_not_found'); return true; });

  const wrongToken = bridgeFor(app, 'not-the-admin-token');
  await assert.rejects(() => wrongToken.videos(), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.code, 'site_api_error');
    assert.match(e.message, /ADDABAAZ API: Please sign in/);
    return true;
  });
  await app.stop();
});
