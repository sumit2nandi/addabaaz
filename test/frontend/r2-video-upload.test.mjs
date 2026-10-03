// Tests for iPhone (.mov) R2 video uploads, automatic video duration derivation, and clear error reporting
// across the admin console, server API, and watch page.
// Run: node --test test/frontend/r2-video-upload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { videoKey } from '../../server/src/uploads.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('videoKey accepts iPhone .mov recordings and mobile MIME fallbacks while rejecting unsafe files', () => {
  const mov = videoKey('IMG_6304.MOV', 'Cricket');
  assert.ok(mov, 'iPhone .MOV file is accepted');
  assert.match(mov.key, /^premium\/cricket\/[0-9a-f]{8}-img_6304\.mov$/);
  assert.equal(mov.contentType, 'video/quicktime');
  assert.equal(mov.format, 'mp4');

  const noExtMov = videoKey('trimmed-video', 'Cricket', 'video/quicktime; codecs="avc1"');
  assert.ok(noExtMov, 'extensionless mobile blob with video/quicktime MIME is accepted');
  assert.match(noExtMov.key, /^premium\/cricket\/[0-9a-f]{8}-trimmed-video\.mov$/);
  assert.equal(noExtMov.contentType, 'video/quicktime');

  const gp = videoKey('clip.3gp', 'Show');
  assert.ok(gp);
  assert.equal(gp.contentType, 'video/3gpp');

  assert.equal(videoKey('malware.exe', 'Show', 'video/mp4'), null, 'disallowed extension is rejected even with video MIME');
  assert.equal(videoKey('trick.mov.html', 'Show'), null);
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

test('admin content view, server admin routes, and watch page wire R2 verification and detailed errors', () => {
  const contentView = read('admin/js/views/content.js');
  const adminServer = read('server/src/admin.js');
  const appServer = read('server/src/app.js');
  const watchView = read('app/js/views/watch.js');

  assert.match(contentView, /video\/quicktime.*\.mov/, 'file picker accepts iPhone .mov videos');
  assert.match(contentView, /probeVideoDuration\(f\)/, 'duration is automatically derived from the selected video file');
  assert.match(contentView, /✖ Upload failed: \$\{msg\}/, 'upload failures remain visible inline in the modal');
  assert.match(adminServer, /verifyR2Source/, 'admin catalog save verifies the R2 object exists when r2.head is present');
  assert.match(adminServer, /r2_object_missing/, 'missing R2 objects produce a clear 400 error on save');
  assert.match(appServer, /video_file_missing/, 'stream endpoint reports missing R2 video files clearly');
  assert.match(watchView, /\(e instanceof ApiError \|\| e\?\.friendly\) \? e\.message : undefined/, 'watch page displays specific API error messages');
});
