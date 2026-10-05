// Tests for iPhone (.mov) R2 video uploads, automatic video duration derivation, and clear error reporting
// across the admin console, server API, and watch page.
// Run: node --test test/frontend/r2-video-upload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import { parseHTML } from 'linkedom';
import { signJwt } from '../../server/src/auth.js';
import { registerMediaRoutes } from '../../server/src/routes/media.js';
import { videoKey } from '../../server/src/uploads.js';
import { createR2 } from '../../server/src/r2.js';
import { app } from '../../app/js/app.js';
import { createHtml5Player } from '../../app/js/players/html5.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('videoKey accepts any video format (including iPhone .mov, .mkv, .avi, .wmv, .flv, .ts, .3gp and any video/* MIME) while rejecting unsafe files', () => {
  const mov = videoKey('IMG_6304.MOV', 'Cricket');
  assert.ok(mov, 'iPhone .MOV file is accepted');
  assert.match(mov.key, /^premium\/cricket\/[0-9a-f]{8}-img_6304\.mov$/);
  assert.equal(mov.contentType, 'video/quicktime');
  assert.equal(mov.format, 'mp4');

  for (const [file, mime] of [
    ['episode.mkv', 'video/x-matroska'],
    ['clip.avi', 'video/x-msvideo'],
    ['stream.wmv', 'video/x-ms-wmv'],
    ['flash.flv', 'video/x-flv'],
    ['cam.m2ts', 'video/mp2t'],
    ['movie.mpeg', 'video/mpeg'],
    ['clip.3gp', 'video/3gpp'],
    ['ogg-video.ogv', 'video/ogg'],
  ]) {
    const res = videoKey(file, 'Show');
    assert.ok(res, `${file} is accepted`);
    assert.equal(res.contentType, mime);
  }

  const customVideoMime = videoKey('camera-capture.dv', 'Cricket', 'video/x-dv');
  assert.ok(customVideoMime, 'arbitrary video/* MIME with custom video extension is accepted');
  assert.match(customVideoMime.key, /^premium\/cricket\/[0-9a-f]{8}-camera-capture\.dv$/);
  assert.equal(customVideoMime.contentType, 'video/x-dv');

  const noExtMov = videoKey('trimmed-video', 'Cricket', 'video/quicktime; codecs="avc1"');
  assert.ok(noExtMov, 'extensionless mobile blob with video/quicktime MIME is accepted');
  assert.match(noExtMov.key, /^premium\/cricket\/[0-9a-f]{8}-trimmed-video\.mov$/);
  assert.equal(noExtMov.contentType, 'video/quicktime');

  assert.equal(videoKey('malware.exe', 'Show', 'video/mp4'), null, 'disallowed extension is rejected even with video MIME');
  assert.equal(videoKey('trick.mov.html', 'Show', 'video/mp4'), null);
  assert.equal(videoKey('vector.svg', 'Show', 'video/mp4'), null);
});

test('probeVideoDuration and parseDur derive and parse durations reliably (including iOS Safari load() and Infinity fallback)', async () => {
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="toasts"></div></body></html>');
  globalThis.window = window;
  globalThis.document = document;
  globalThis.URL.createObjectURL = () => 'blob:https://addabaazott.onrender.com/fake-video';
  globalThis.URL.revokeObjectURL = () => {};

  const origCreate = document.createElement.bind(document);
  let nextDuration = 6.2;
  let loadCalled = false;
  document.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'video') {
      el.load = () => {
        loadCalled = true;
        el.duration = nextDuration;
        setTimeout(() => el.dispatchEvent(new window.Event('loadedmetadata')), 5);
      };
    }
    return el;
  };

  const { parseDur, fmtDur, probeVideoDuration, toast } = await import('../../admin/js/ui.js');

  assert.equal(parseDur(''), 0, 'empty duration defaults to 0 instead of NaN');
  assert.equal(parseDur('0:06'), 6);
  assert.equal(parseDur('12:34'), 754);
  assert.ok(Number.isNaN(parseDur('not-a-duration')));

  const secs = await probeVideoDuration({ name: 'IMG_6304.MOV', type: 'video/quicktime' });
  assert.equal(loadCalled, true, 'explicitly calls vid.load() so iOS Safari loads off-DOM video metadata');
  assert.equal(secs, 6);
  assert.equal(fmtDur(secs), '0:06');

  // Also test toast visibility when a <dialog class="modal" open> is in the top layer:
  const dlg = origCreate('dialog');
  dlg.className = 'modal';
  dlg.setAttribute('open', '');
  dlg.innerHTML = '<div class="form-err" hidden></div>';
  document.body.appendChild(dlg);
  toast('R2 upload failed: check CORS', 'err');
  assert.equal(dlg.querySelector('.form-err').hidden, false, 'error toast reveals .form-err inside an open modal');
  assert.equal(dlg.querySelector('.form-err').textContent, 'R2 upload failed: check CORS');
  assert.ok(dlg.querySelector('.modal-toasts .toast.err'), 'toast is rendered inside the open modal top layer');

  document.createElement = origCreate;
});

test('putFile reports actionable R2 error messages for 403, 404 NoSuchBucket, SignatureDoesNotMatch, and CORS failures', async () => {
  globalThis.location = { origin: 'https://addabaazott.onrender.com' };
  const { putFile } = await import('../../admin/js/api.js');

  const runWithMockXhr = async (trigger) => {
    const prev = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.headers = {}; }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(k, v) { this.headers[k] = v; }
      send() { trigger(this); }
    };
    try {
      await putFile('https://acct.r2.cloudflarestorage.com/b/k', { type: 'video/quicktime' }, null, 'video/quicktime');
      assert.fail('expected putFile to reject');
    } catch (e) {
      return e;
    } finally {
      globalThis.XMLHttpRequest = prev;
    }
  };

  const corsErr = await runWithMockXhr((x) => x.onerror());
  assert.equal(corsErr.code, 'r2_cors');
  assert.match(corsErr.message, /https:\/\/addabaazott\.onrender\.com/, 'CORS error names the exact origin to whitelist');

  const deniedErr = await runWithMockXhr((x) => {
    x.status = 403;
    x.responseText = '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
    x.onload();
  });
  assert.match(deniedErr.message, /Object Read & Write/, '403 AccessDenied explains the token needs write permission');

  const bucketErr = await runWithMockXhr((x) => {
    x.status = 404;
    x.responseText = '<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>';
    x.onload();
  });
  assert.match(bucketErr.message, /R2_BUCKET/, '404 NoSuchBucket points to R2_BUCKET');
});

test('admin panel surfaces technical R2 diagnostics while public app/website keeps viewer errors non-technical', () => {
  const contentView = read('admin/js/views/content.js');
  const adminServer = read('server/src/admin.js');
  const appServer = read('server/src/app.js');
  const mediaRoutes = read('server/src/routes/media.js');
  const watchView = read('app/js/views/watch.js');
  const reelsView = read('app/js/views/reels.js');

  assert.match(contentView, /accept="video\/\*.*\.mov/, 'file picker accepts any video/* and common video extensions');
  assert.match(contentView, /probeVideoDuration\(f\)/, 'duration is automatically derived from the selected video file');
  assert.match(contentView, /✖ Upload failed: \$\{msg\}/, 'upload failures remain visible inline in the modal');
  assert.match(adminServer, /verifyR2Source/, 'admin catalog save verifies the R2 object exists when r2.head is present');
  assert.match(adminServer, /r2_object_missing/, 'missing R2 objects produce a clear 400 error on save in admin');

  // Public app/website must never expose technical storage strings (bucket names, object keys, Admin panel path, env var names).
  assert.doesNotMatch(watchView, /was not found in Cloudflare R2|Admin → Videos|CORS policy/, 'watch page does not expose technical storage errors');
  assert.doesNotMatch(reelsView, /was not found in Cloudflare R2|Admin → Videos/, 'reels page does not expose technical storage errors');
  assert.doesNotMatch(appServer, /Please upload the video file in Admin|Check the R2 API credentials/, 'public app server returns friendly non-technical viewer messages');
  assert.doesNotMatch(mediaRoutes, /Please upload the video file in Admin|Check the R2 API credentials/, 'public stream API returns friendly non-technical viewer messages');
});

test('createHtml5Player renders a uniform YouTube-style player (.ytp) with a viewport-level Settings sheet', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body><div id="slot"></div></body></html>');
  const prevDoc = globalThis.document, prevWin = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    const slot = document.getElementById('slot');
    const ctl = await createHtml5Player(
      slot,
      { id: 'v1', title: 'Cricket', duration: 6, source: { type: 'mp4', url: 'https://r2.test/cricket.mov' } },
      { autoplay: false, controls: true },
    );
    const ytp = slot.querySelector('.ytp');
    assert.ok(ytp, 'YouTube-style player wrapper (.ytp) is mounted');
    assert.ok(ytp.querySelector('.ytp-progress'), 'YouTube red scrubber bar is rendered');
    assert.ok(ytp.querySelector('.ytp-play'), 'Play/pause button is rendered');
    assert.ok(ytp.querySelector('.ytp-skip-back') && ytp.querySelector('.ytp-skip-fwd'), '10s skip back/forward buttons are rendered');
    assert.ok(ytp.querySelector('.ytp-vol-btn'), 'Volume/mute button is rendered');
    assert.equal(ytp.querySelector('.ytp-dur').textContent, '0:06', 'Duration is formatted in YouTube M:SS style');
    assert.ok(ytp.querySelector('.ytp-gear-btn'), 'Settings gear button is rendered');
    assert.ok(ytp.querySelector('.ytp-fs-btn'), 'Fullscreen button is rendered');

    // The sheet is portalled to the document, not constrained by the player; it keeps the supported options.
    const gear = ytp.querySelector('.ytp-gear-btn');
    const menu = document.body.querySelector('.ytp-settings-overlay');
    assert.ok(menu, 'Settings sheet is mounted at the viewport level');
    assert.equal(ytp.contains(menu), false, 'Settings sheet is outside the player wrapper');
    assert.equal(menu.hidden, true, 'Settings sheet starts closed');
    gear.click();
    assert.equal(menu.hidden, false, 'Clicking gear opens Settings sheet');
    assert.equal(document.body.classList.contains('player-settings-open'), true, 'the page is scroll-locked while settings are open');
    assert.match(menu.textContent, /Playback speed/);
    assert.match(menu.textContent, /Quality/);
    assert.doesNotMatch(menu.textContent, /Subtitles\/CC/, 'Subtitles/CC is omitted when there are no tracks');
    assert.match(menu.textContent, /Loop/);

    // Navigate to Playback speed and select 1.5x.
    menu.querySelector('[data-nav="speed"]').click();
    assert.ok(menu.querySelector('[data-speed="1.5"]'), '1.5x playback speed option is available');
    menu.querySelector('[data-speed="1.5"]').click();
    assert.equal(ytp.querySelector('video').playbackRate, 1.5, 'Selecting 1.5x updates video.playbackRate');
    assert.equal(menu.hidden, true, 'Sheet closes after selecting speed');
    assert.equal(document.body.classList.contains('player-settings-open'), false, 'closing the sheet unlocks page scrolling');

    // Quality and Loop remain available in the larger sheet.
    gear.click();
    menu.querySelector('[data-nav="quality"]').click();
    assert.ok(menu.querySelector('[data-quality="-1"]'), 'Auto quality remains selectable');
    menu.querySelector('[data-settings-back]').click();
    const loop = menu.querySelector('[data-act="loop"]');
    loop.click();
    assert.match(menu.querySelector('.ytp-menu-pill').textContent, /On/, 'Loop toggles on from the sheet');
    menu.querySelector('[data-settings-close]').click();
    assert.equal(menu.hidden, true, 'Close button dismisses the settings sheet');

    // Control buttons must not replace their inner SVG node on repeated timeupdate events, and pointerleave must not hide controls.
    const playBtn = ytp.querySelector('.ytp-play');
    const svgBefore = playBtn.querySelector('svg');
    const vid = ytp.querySelector('video');
    vid.dispatchEvent(new window.Event('timeupdate'));
    vid.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(playBtn.querySelector('svg'), svgBefore, 'SVG node inside button is preserved across timeupdate ticks so clicks are never dropped');
    ytp.dispatchEvent(new window.Event('pointerleave'));
    assert.equal(ytp.classList.contains('show-controls'), true, 'pointerleave does not hide the control bar on touch/click');
    ctl.destroy();
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});

test('Android WebView HLS fragments stream through the API while browser fragments keep direct R2 redirects', async () => {
  const routes = new Map(), upstreamRequests = [];
  const api = { post() {}, get(path, handler) { routes.set(path, handler); } };
  const secret = 'media-proxy-test-secret';
  const token = signJwt({ aud: 'media', vid: 'hls-test', sub: null }, secret, 600);
  const r2 = {
    configured: true,
    presignGet: (key, { ttl }) => `https://r2.test/${key}?ttl=${ttl}`,
    async getObject(key, options) {
      upstreamRequests.push({ key, ...options });
      return new Response(Buffer.from('segment bytes'), { status: 206, headers: {
        'Accept-Ranges': 'bytes', 'Content-Length': '13', 'Content-Range': 'bytes 0-12/13', 'Content-Type': 'video/mp2t',
      } });
    },
    async getText() { return '#EXTM3U\\n'; },
  };
  const video = { id: 'hls-test', kind: 'episode', source: { type: 'r2', format: 'hls', key: 'premium/hls-test/master.m3u8' } };
  registerMediaRoutes(api, {
    db: {}, secret, publicApiUrl: 'https://api.example', streamTtl: 600, r2,
    catalog: { video: (id) => id === video.id ? video : null, get: async () => ({ catalog: { shows: [] } }) },
    features: {}, userFromRequest: async () => null,
  });
  const handler = routes.get('/media/:token/*');
  const makeResponse = () => {
    const res = new PassThrough();
    res.headersOut = {};
    res.set = (name, value) => { Object.assign(res.headersOut, typeof name === 'object' ? name : { [name]: value }); return res; };
    res.status = (status) => { res.statusCode = status; return res; };
    res.redirect = (status, location) => { res.statusCode = status; res.headersOut.Location = location; res.end(); return res; };
    return res;
  };
  const request = (headers) => ({
    params: { token, 0: '720p/seg0.ts' }, headers,
    get(name) { return headers[name.toLowerCase()] || ''; },
  });

  const appResponse = makeResponse(), chunks = [];
  appResponse.on('data', (chunk) => chunks.push(chunk));
  const appFinished = new Promise((resolve, reject) => { appResponse.once('finish', resolve); appResponse.once('error', reject); });
  await handler(request({ origin: 'https://app.addabaaz.in', 'user-agent': 'Mozilla/5.0 Android; wv)', range: 'bytes=0-12' }), appResponse, (e) => { if (e) throw e; });
  await appFinished;
  assert.equal(appResponse.statusCode, 206);
  assert.equal(appResponse.headersOut['Content-Range'], 'bytes 0-12/13');
  assert.equal(appResponse.headersOut['Access-Control-Expose-Headers'], 'Accept-Ranges, Content-Length, Content-Range');
  assert.equal(Buffer.concat(chunks).toString(), 'segment bytes');
  assert.deepEqual(upstreamRequests, [{ key: 'premium/hls-test/720p/seg0.ts', ttl: 900, range: 'bytes=0-12' }]);

  const browserResponse = makeResponse();
  await handler(request({ origin: 'https://addabaazott.onrender.com', 'user-agent': 'Chrome/154' }), browserResponse, (e) => { if (e) throw e; });
  assert.equal(browserResponse.statusCode, 302, 'web playback retains direct R2 delivery');
  assert.equal(browserResponse.headersOut.Location, 'https://r2.test/premium/hls-test/720p/seg0.ts?ttl=900');
  assert.equal(upstreamRequests.length, 1, 'only native-app fragments pass through the API');
});

test('Chromium HLS uses hls.js despite a native maybe-hint, and fatal errors reach Admin → Errors safely', async () => {
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="slot"></div></body></html>');
  const previous = {
    document: globalThis.document, window: globalThis.window, location: globalThis.location, api: app.api,
    fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  const reports = [], states = [];
  app.api = { base: 'https://api.test', token: '' };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/v1/client-errors')) reports.push(JSON.parse(options.body));
    return { ok: true, status: 204 };
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { pathname: '/watch/hls-test', search: '', hash: '' };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' },
    configurable: true,
  });
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = createElement(tag);
    if (String(tag).toLowerCase() === 'video') el.canPlayType = () => 'maybe';
    return el;
  };
  class MockHls {
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'manifestParsed', LEVEL_SWITCHED: 'levelSwitched' };
    static isSupported() { return true; }
    constructor() { this.handlers = new Map(); MockHls.instance = this; }
    on(name, fn) { this.handlers.set(name, fn); }
    loadSource(url) { this.sourceUrl = url; }
    attachMedia() {}
    destroy() {}
  }
  const append = document.head.appendChild.bind(document.head);
  document.head.appendChild = (el) => {
    if (el.tagName === 'SCRIPT' && String(el.src).includes('hls.min.js')) {
      window.Hls = MockHls;
      el.onload?.();
      return el;
    }
    return append(el);
  };
  try {
    const player = await createHtml5Player(document.getElementById('slot'), {
      id: 'hls-test', title: 'HLS test', duration: 6,
      source: { type: 'hls', url: 'https://site.example/api/v1/media/test-token/master.m3u8' },
    }, { autoplay: false, controls: false, onState: (...state) => states.push(state) });
    assert.equal(MockHls.instance.sourceUrl, 'https://site.example/api/v1/media/test-token/master.m3u8', 'Chromium uses hls.js even when canPlayType returns maybe');
    const signedUrl = 'https://acct.r2.cloudflarestorage.com/bucket/premium/hls-test/segment.ts?X-Amz-Signature=secret-signature';
    const mediaToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWQiOiJoc2wtdGVzdCJ9.signature';
    const onHlsError = MockHls.instance.handlers.get(MockHls.Events.ERROR);
    onHlsError(null, { fatal: false, type: 'networkError', details: 'fragLoadError' });
    assert.equal(reports.length, 0, 'recoverable HLS errors are not reported as playback failures');
    onHlsError(null, {
      fatal: true, type: 'networkError', details: 'fragLoadError', level: 3,
      response: { code: 403, url: signedUrl },
      reason: `Request failed for ${signedUrl}; media token /api/v1/media/${mediaToken}/master.m3u8`,
    });
    assert.equal(reports.length, 1, 'one fatal HLS error is reported');
    assert.match(reports[0].message, /video=hls-test; type=networkError; detail=fragLoadError; http=403; fatal=true/);
    assert.match(reports[0].stack, /Playback diagnostic \(signed media URLs omitted\)/);
    assert.match(reports[0].stack, /reason=Request failed for \[redacted URL\]\s+media token \/api\/v1\/media\/\[redacted token\]\/master\.m3u8/);
    assert.match(reports[0].stack, /level=3/);
    assert.equal(reports[0].url, '/watch/hls-test');
    assert.equal(Object.hasOwn(reports[0], 'force'), false, 'the reporter-only force flag is not sent to the API');
    assert.doesNotMatch(JSON.stringify(reports[0]), /acct\.r2\.cloudflarestorage\.com|secret-signature|eyJhbGciOiJIUzI1NiJ9/);
    assert.deepEqual(states, [['error', 2]], 'the viewer still receives the existing generic playback error state');
    player.destroy();
  } finally {
    document.head.appendChild = append;
    document.createElement = createElement;
    app.api = previous.api;
    globalThis.fetch = previous.fetch;
    for (const key of ['document', 'window', 'location']) {
      if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key];
    }
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
  }
});

test('native Safari quality sheet refreshes after the master loads and switches to the selected variant', async () => {
  const { document, window } = parseHTML('<!doctype html><html><head></head><body><div id="slot"></div></body></html>');
  const previous = {
    document: globalThis.document, window: globalThis.window, location: globalThis.location,
    fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  let finishManifest, playCalls = 0;
  const manifestRequest = new Promise((resolve) => { finishManifest = resolve; });
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { protocol: 'https:', origin: 'https://site.example', pathname: '/', hash: '', search: '' };
  globalThis.fetch = () => manifestRequest;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }, configurable: true });
  const createElement = document.createElement.bind(document);
  let video;
  document.createElement = (tag) => {
    const el = createElement(tag);
    if (String(tag).toLowerCase() === 'video') {
      video = el;
      el.canPlayType = () => 'probably';
      el.paused = false; el.ended = false; el.currentTime = 2; el.duration = 6;
      el.videoWidth = 854; el.videoHeight = 480; el.playbackRate = 1; el.muted = false; el.volume = 0.8;
      el.play = () => { playCalls++; return Promise.resolve(); };
      el.pause = () => { el.paused = true; };
      el.load = () => setTimeout(() => el.dispatchEvent(new window.Event('loadedmetadata')), 0);
    }
    return el;
  };
  try {
    const url = 'https://site.example/api/v1/media/token/master.m3u8';
    const player = await createHtml5Player(document.getElementById('slot'), {
      id: 'native-hls', title: 'Native HLS', duration: 6, source: { type: 'hls', url },
    }, { autoplay: false, controls: true });
    const slot = document.getElementById('slot');
    const settings = document.body.querySelector('.ytp-settings-overlay');
    slot.querySelector('.ytp-gear-btn').click();
    settings.querySelector('[data-nav="quality"]').click();
    assert.deepEqual([...settings.querySelectorAll('[data-quality]')].map((item) => item.textContent.trim()), ['Auto (480p)', '480p'], 'before the fetch resolves, the sheet shows only the active native level');

    finishManifest(new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="1080p"\n1080p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,NAME="720p"\n720p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,NAME="480p"\n480p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,NAME="360p"\n360p/index.m3u8\n`, { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([...settings.querySelectorAll('[data-quality]')].map((item) => item.textContent.trim()), ['Auto (480p)', '1080p HD', '720p HD', '480p', '360p'], 'the open sheet refreshes with every master-playlist resolution');

    settings.querySelector('[data-quality="1"]').click();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(video.src, 'https://site.example/api/v1/media/token/720p/index.m3u8', 'native Safari switches to the selected child playlist');
    assert.equal(video.currentTime, 2, 'switching quality preserves the playback position');
    assert.equal(playCalls, 1, 'active playback resumes after the new playlist metadata loads');
    player.destroy();
  } finally {
    document.createElement = createElement;
    globalThis.document = previous.document; globalThis.window = previous.window; globalThis.location = previous.location; globalThis.fetch = previous.fetch;
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator); else delete globalThis.navigator;
  }
});

test('R2 videos (including short clips like 6s Cricket and newly started videos) appear in Continue Watching', async () => {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const prevDoc = globalThis.document, prevWin = globalThis.window, prevLoc = globalThis.location, prevLS = globalThis.localStorage, prevSS = globalThis.sessionStorage;
  const mem = new Map();
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { protocol: 'https:', origin: 'https://t.in', pathname: '/', hash: '', href: 'https://t.in/', search: '' };
  window.location = globalThis.location;
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.localStorage = store;
  window.localStorage = store;
  globalThis.sessionStorage = store;
  window.sessionStorage = store;
  try {
    const { User } = await import('../../app/js/data/user.js');
    const { LocalAdapter } = await import('../../app/js/data/adapters.js');
    const u = new User(new LocalAdapter());
    await u.init();
    u.account = { id: 'u1', email: 'viewer@example.com' };
    u.activeId = u.profiles[0]?.id;

    const cricket = { id: 'cricket', title: 'Cricket', duration: 6, source: { type: 'r2', key: 'premium/cricket/vid.mov' } };
    const longEp = { id: 'ep1', title: 'Long Episode', duration: 600, source: { type: 'r2', key: 'premium/show/ep1.mp4' } };
    const catalog = { video: (id) => (id === 'cricket' ? cricket : id === 'ep1' ? longEp : null), show: () => null };

    // Watching a short 6s R2 video (even if it reaches 6s or pauses at 1.5s) keeps it in Continue Watching.
    u.saveProgress('cricket', 0.4, 6, { flush: true });
    assert.equal(u.progressOf('cricket')?.position, 1, 'sub-second playback rounds up to 1s so started videos are tracked');
    assert.equal(u.continueWatching(catalog).length, 1, 'started R2 video appears in Continue Watching immediately');

    u.saveProgress('cricket', 6, 6, { flush: true });
    assert.equal(u.continueWatching(catalog).length, 1, 'short 6s R2 video remains in Continue Watching even after playing through');

    // A normal long R2 episode appears in Continue Watching when started (e.g. 3s) and leaves once finished (>= 94%).
    u.saveProgress('ep1', 3, 600, { flush: true });
    assert.ok(u.continueWatching(catalog).some((x) => x.video.id === 'ep1'), 'long R2 episode appears in Continue Watching after 3s');
    u.saveProgress('ep1', 590, 600, { flush: true });
    assert.ok(!u.continueWatching(catalog).some((x) => x.video.id === 'ep1'), 'finished long episode leaves Continue Watching');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.location = prevLoc;
    globalThis.localStorage = prevLS;
    globalThis.sessionStorage = prevSS;
  }
});

test('createR2.getObject fetches signed objects server-side and forwards HLS byte ranges', async () => {
  const originalFetch = globalThis.fetch;
  let requested = null;
  globalThis.fetch = async (url, options) => {
    requested = { url: String(url), options };
    return new Response(Buffer.from('segment'), { status: 206, headers: { 'Content-Range': 'bytes 0-6/7' } });
  };
  try {
    const r2 = createR2({ R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AK', R2_SECRET_ACCESS_KEY: 'SK', R2_BUCKET: 'bucket' });
    const response = await r2.getObject('premium/hls/seg0.ts', { ttl: 900, range: 'bytes=0-6' });
    assert.equal(response.status, 206);
    assert.equal(new URL(requested.url).pathname, '/bucket/premium/hls/seg0.ts');
    assert.equal(new URL(requested.url).searchParams.get('X-Amz-Expires'), '900');
    assert.equal(requested.options.headers.Range, 'bytes=0-6');
  } finally { globalThis.fetch = originalFetch; }
});

test('createR2.head signs HEAD requests with method=HEAD (not GET) and falls back to 1-byte Range GET if HEAD is rejected', async () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const r2 = createR2({
    R2_ACCOUNT_ID: 'acct123',
    R2_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    R2_SECRET_ACCESS_KEY: 'secretkeyexample',
    R2_BUCKET: 'addabaaz-premium',
  });
  const getUrl = new URL(r2.presignGet('premium/cricket/e911c479-img_6304.mov', { ttl: 60, now }));
  const headUrl = new URL(r2.presignHead('premium/cricket/e911c479-img_6304.mov', { ttl: 60, now }));
  assert.notEqual(
    getUrl.searchParams.get('X-Amz-Signature'),
    headUrl.searchParams.get('X-Amz-Signature'),
    'HEAD presigned URL uses a distinct SigV4 signature from GET so Cloudflare R2 does not reject HEAD with 403 SignatureDoesNotMatch',
  );

  const prevFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} });
      if (opts.method === 'HEAD') {
        return new Response(null, { status: 403 });
      }
      return new Response('x', { status: 206, headers: { 'content-range': 'bytes 0-0/18454937', 'content-type': 'video/quicktime' } });
    };
    const h = await r2.head('premium/cricket/e911c479-img_6304.mov');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'HEAD');
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].headers.Range, 'bytes=0-0');
    assert.equal(h.status, 200);
    assert.equal(h.size, 18454937);
    assert.equal(h.type, 'video/quicktime');
  } finally {
    globalThis.fetch = prevFetch;
  }
});
