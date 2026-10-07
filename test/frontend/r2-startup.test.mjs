import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { prepareHtml5Player } from '../../app/js/players/html5.js';

test('HLS engine warming skips MP4/native HLS and shares the script request', async () => {
  const { document, window } = parseHTML('<html><head></head><body></body></html>');
  globalThis.document = document; globalThis.window = window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Safari/605' } });
  await prepareHtml5Player({ type: 'r2', key: 'video.mp4' });
  assert.equal(document.querySelectorAll('script').length, 0);
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const el = create(tag); if (tag === 'video') el.canPlayType = () => 'maybe'; return el; };
  await prepareHtml5Player({ type: 'r2', key: 'master.m3u8' });
  assert.equal(document.querySelectorAll('script').length, 0);
  globalThis.navigator.userAgent = 'Chrome/130';
  const first = prepareHtml5Player({ type: 'r2', format: 'hls' });
  const second = prepareHtml5Player({ type: 'hls' });
  assert.equal(first, second);
  assert.equal(document.querySelectorAll('script').length, 1);
  window.Hls = {};
  document.querySelector('script').onload();
  await first;
});
