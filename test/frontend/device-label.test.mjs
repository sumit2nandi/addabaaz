// The "Your devices" list must show a name people recognise. Many Androids expose only a bare
// model code ("EB2101") — no Device plugin in the app shell, and UA-CH's `model` carries no
// manufacturer — so brandedModel() restores the brand for recognisable code prefixes.
// Run: node --test test/frontend/device-label.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// api.js expects a browser; give it just enough globals to import.
if (!globalThis.window) globalThis.window = {};
if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { brandedModel } = await import('../../app/js/data/api.js');

test('bare Android model codes get their brand back', () => {
  assert.equal(brandedModel('EB2101'), 'OnePlus EB2101');     // Nord CE 5G — the reported bug
  assert.equal(brandedModel('LE2121'), 'OnePlus LE2121');
  assert.equal(brandedModel('PHB110'), 'OnePlus PHB110');
  assert.equal(brandedModel('SM-M326B'), 'Samsung SM-M326B');
  assert.equal(brandedModel('RMX3081'), 'Realme RMX3081');
  assert.equal(brandedModel('CPH2381'), 'OPPO CPH2381');
  assert.equal(brandedModel('V2027'), 'Vivo V2027');
  assert.equal(brandedModel('I2012'), 'Vivo I2012');
  assert.equal(brandedModel('XT2137'), 'Motorola XT2137');
  assert.equal(brandedModel('M2101K6G'), 'Xiaomi M2101K6G');
  assert.equal(brandedModel('2201117TI'), 'Xiaomi 2201117TI');
  assert.equal(brandedModel('A063'), 'Nothing A063');
});

test('already-readable names and unknown codes pass through untouched', () => {
  assert.equal(brandedModel('OnePlus LE2121'), 'OnePlus LE2121'); // Device plugin already named it
  assert.equal(brandedModel('Pixel 7'), 'Pixel 7');               // UA-CH gives Pixels a real name
  assert.equal(brandedModel('K'), 'K');                           // generic/unknown stays as-is
  assert.equal(brandedModel(''), '');
  assert.equal(brandedModel(null), '');
});

test('the resolved model flows into every label the server stores', () => {
  const api = read('app/js/data/api.js');
  assert.match(api, /brandedModel\(deviceModel\(\)\); if \(m\) return `\$\{m\} · app`/,
    'the native label upgrades even a bare code cached by an older build');
  assert.match(api, /\/Android\/.test\(ua\) \? \(brandedModel\(deviceModel\(\)\) \|\| 'Android'\)/,
    'Android browsers show the model too, not just "Android"');
  assert.match(api, /'X-Device-Label': deviceLabel\(\)/,
    'every API call carries the label, so the stored one heals on the next heartbeat');
  const extras = read('app/js/views/account-extra.js');
  assert.match(extras, /d\.streamLimit > 0 \? html`<p class="muted">Your plan allows/,
    'the screens-at-once sentence never renders without its number');
});
