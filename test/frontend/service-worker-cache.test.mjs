import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

test('stale shell assets are refreshed before the service worker can be stopped', async () => {
  const handlers = Object.create(null);
  const assetUrl = 'https://site.test/app/css/styles.css';
  const staleResponse = { ok: true, type: 'basic', label: 'stale', clone() { return this; } };
  const freshResponse = { ok: true, type: 'basic', label: 'fresh', clone() { return this; } };
  const stored = new Map([[assetUrl, staleResponse]]);
  let cacheName = '';
  const keyOf = (request) => typeof request === 'string' ? request : request.url;
  const cache = {
    async match(request) { return stored.get(keyOf(request)) || null; },
    async put(request, response) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored.set(keyOf(request), response);
    },
  };
  const caches = {
    async open(name) { cacheName = name; return cache; },
    async match(request) { return stored.get(keyOf(request)) || null; },
  };
  const self = {
    addEventListener(name, callback) { handlers[name] = callback; },
    skipWaiting() { return Promise.resolve(); },
    clients: { claim() { return Promise.resolve(); }, matchAll() { return Promise.resolve([]); }, openWindow() {} },
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: async () => freshResponse,
    URL,
    location: { origin: 'https://site.test' },
  });

  let responsePromise;
  const backgroundWork = [];
  handlers.fetch({
    request: { method: 'GET', mode: 'cors', url: assetUrl },
    respondWith(promise) { responsePromise = promise; },
    waitUntil(promise) { backgroundWork.push(promise); },
  });

  const response = await responsePromise;
  assert.equal(response.label, 'stale', 'serve the cached asset immediately');
  assert.equal(backgroundWork.length, 1, 'keep the worker alive until stale-while-revalidate finishes');
  await Promise.all(backgroundWork);
  assert.equal(stored.get(assetUrl).label, 'fresh', 'replace the cached asset with the network response');
  assert.equal(cacheName, 'ab-shell-v2.18.0', 'the release creates a fresh shell cache for installed browsers');

  let fontResponsePromise;
  const fontBackgroundWork = [];
  handlers.fetch({
    request: { method: 'GET', mode: 'cors', url: 'https://fonts.gstatic.com/font.woff2' },
    respondWith(promise) { fontResponsePromise = promise; },
    waitUntil(promise) { fontBackgroundWork.push(promise); },
  });
  assert.equal((await fontResponsePromise).label, 'fresh', 'cross-origin font requests still use the refreshed shell cache');
  assert.equal(fontBackgroundWork.length, 1, 'font refreshes also extend the worker lifetime');
  await Promise.all(fontBackgroundWork);
});

// Regression: R2-backed catalog/video-thumbnail images used to have no dedicated rule, so they fell
// through to the app shell's stale-while-revalidate — which refetches from the network on every single
// request, even on a cache hit. Their names are content hashes (never reused for different bytes), so
// they belong with /media/ and /uploads/: cache-first, fetched from the network only once.
test('R2 catalog/video-thumbnail images (/r2-assets/) are cache-first, not re-fetched on every page load', async () => {
  const handlers = Object.create(null);
  const thumbUrl = 'https://site.test/r2-assets/video-thumbnails/0123456789abcdef01234567-hq.webp';
  let networkCalls = 0;
  const networkResponse = { ok: true, type: 'cors', label: 'from-network', clone() { return this; } };
  const stored = new Map();
  let cacheName = '';
  const keyOf = (request) => typeof request === 'string' ? request : request.url;
  const cache = {
    async match(request) { return stored.get(keyOf(request)) || null; },
    async put(request, response) { stored.set(keyOf(request), response); },
  };
  const caches = {
    async open(name) { cacheName = name; return cache; },
    async match(request) { return stored.get(keyOf(request)) || null; },
  };
  const self = {
    addEventListener(name, callback) { handlers[name] = callback; },
    skipWaiting() { return Promise.resolve(); },
    clients: { claim() { return Promise.resolve(); }, matchAll() { return Promise.resolve([]); }, openWindow() {} },
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: async () => { networkCalls++; return networkResponse; },
    URL,
    location: { origin: 'https://site.test' },
  });

  const request = () => new Promise((resolve) => {
    handlers.fetch({
      request: { method: 'GET', mode: 'no-cors', url: thumbUrl },
      respondWith(promise) { resolve(promise); },
      waitUntil() {},
    });
  });

  assert.equal((await request()).label, 'from-network', 'a cache miss still fetches the image');
  assert.equal(networkCalls, 1);
  assert.equal(cacheName.startsWith('ab-media-'), true, 'stored in the same cache as /media/ and /uploads/ artwork');

  assert.equal((await request()).label, 'from-network', 'the second load is served from the cache (same response object)');
  assert.equal(networkCalls, 1, 'cache-first: a hit never goes back to the network, unlike the shell\'s stale-while-revalidate');
});

