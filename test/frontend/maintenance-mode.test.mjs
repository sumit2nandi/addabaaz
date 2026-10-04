// Maintenance mode: the switch, the page, and the wiring in all three shells.
//
// The behaviour is exercised in server/test/maintenance.test.js; these are the source pins that keep the
// pieces connected (a page that no longer polls /api/v1/status, a console button that PATCHes the wrong
// endpoint, or an app that ignores the API's 503 would all break the feature without failing that test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('the maintenance page is self-contained, branded and noindex', () => {
  const page = read('maintenance.html');
  assert.match(page, /<meta name="robots" content="noindex/, 'never indexed');
  assert.match(page, /We’ll be right back/, 'the headline');
  assert.match(page, /\{\{message\}\}/, 'the server fills the message in');
  assert.match(page, /\{\{until\}\}/, 'and the end of the window');
  assert.match(page, /\/api\/v1\/status/, 'it asks our own status endpoint');
  assert.match(page, /location\.reload\(\)/, 'and reloads itself the moment we are back');
  assert.match(page, /ADDA<\/b><i>BAAZ/, 'brand mark');
  // No external requests: the page must render when everything else is down.
  const external = [...page.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, [], 'no external scripts, styles or fonts');
  assert.match(page, /media\/icons\/icon-96\.png/, 'only our own icon');
  assert.doesNotMatch(page, /<link[^>]+stylesheet/, 'styles are inline');
});

test('the server serves the page for viewers and keeps the operator’s paths open', () => {
  const web = read('server/src/web.js');
  assert.match(web, /maintenancePage\(req, res, state\)/, 'pages are answered with the page');
  assert.match(web, /res\.status\(503\)/, 'with a real 503');
  assert.match(web, /'Retry-After'/, 'and a Retry-After');
  assert.match(web, /\{\{message\}\}/);
  assert.match(web, /app\.get\(\['\/maintenance', '\/maintenance\.html'\]/, '/maintenance is reachable for the preview');

  const svc = read('server/src/maintenance.js');
  for (const p of ['/health', '/status', '/admin', '/auth', '/payments\\/webhook', '/notifications\\/unsubscribe']) {
    assert.match(svc, new RegExp(p), `${p.replace(/\\\\/g, '')} is on the allow-list`);
  }
  assert.match(svc, /maintenance_enabled|MAINTENANCE_KEYS/, 'the switch lives in app_settings');
  assert.match(svc, /expired/, 'a window that has passed reopens the site by itself');

  const app = read('server/src/app.js');
  assert.match(app, /api\.use\(maintenance\.guard\(\)\);/);
  assert.match(app, /registerSystemRoutes\(api, \{[^}]*maintenance[^}]*\}\)/s);
  assert.match(app, /mountWebsite\(app, \{[^}]*maintenance[^}]*\}\)/s);
  // The guard must be *before* the routes it protects (a regression here silently disables the switch).
  assert.ok(app.indexOf('api.use(maintenance.guard());') < app.indexOf('registerSystemRoutes(api'), 'guard first');

  const admin = read('server/src/admin.js');
  assert.match(admin, /adminMaintenanceRoutes\(\{ router, maintenance, log/);
  assert.match(read('server/src/admin-maintenance.js'), /router\.patch\('\/maintenance'/);
  assert.match(read('server/src/routes/system.js'), /api\.get\('\/status'/);
});

test('the Admin console has a Maintenance page that drives the switch', () => {
  const main = read('admin/js/main.js');
  assert.match(main, /\['maintenance', 'Maintenance', 'power'\]/, 'it is in the sidebar');
  assert.match(main, /\[\/\^maintenance\$\/, \(\) => import\('\.\/views\/maintenance\.js'\)\]/, 'and routed');
  const view = read('admin/js/views/maintenance.js');
  assert.match(view, /api\.get\('\/maintenance'\)/, 'reads the switch');
  assert.match(view, /api\.patch\('\/maintenance', patch\)/, 'writes it');
  assert.match(view, /enabled: on/, 'the toggle flips it');
  assert.match(view, /localValue\(new Date\(Date\.now\(\) \+ Number\(b\.dataset\.mins\) \* 60_000\)\.toISOString\(\)\)/, 'quick “back by” presets');
  assert.match(view, /Preview the page/, 'a preview link');
  assert.match(view, /ctx\.stale\(\)/, 'and bails out when the page was left');
  const ui = read('admin/js/ui.js');
  assert.match(ui, /power: '<path/, 'the power icon exists');
  assert.match(ui, /warning: '<path/, 'and the warning icon');
});

test('the app shows the maintenance screen when the API says so, and reloads when we are back', () => {
  const api = read('app/js/data/api.js');
  assert.match(api, /data\.error\?\.code === 'maintenance'/, 'the API client spots the 503');
  assert.match(api, /new CustomEvent\('ab:maintenance'/, 'and announces it');
  const main = read('app/js/main.js');
  assert.match(main, /initMaintenanceWatch\(\{ apiBase: base === 'off' \? '' : base \}\)/, 'the app watches for it');
  const watcher = read('app/js/maintenance.js');
  assert.match(watcher, /addEventListener\('ab:maintenance'/, 'listens for the event');
  assert.match(watcher, /\/api\/v1\/status/, 'polls the status endpoint');
  assert.match(watcher, /location\.reload\(\)/, 'reloads when the site is back');
  assert.match(watcher, /We’ll be right back/);
  assert.match(read('app/css/styles.css'), /\.maintenance-screen/, 'and it is styled');
  // The page must never be precached as the app shell: an offline app has to keep working.
  const sw = read('sw.js');
  const precache = sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf('];', sw.indexOf('const PRECACHE')));
  assert.doesNotMatch(precache, /maintenance\.html/, 'the maintenance PAGE is not part of the app shell');
  assert.match(precache, /app\/js\/maintenance\.js/, 'but the in-app screen is: main.js imports it on every boot, even offline');
});

test('maintenance mode is documented', () => {
  assert.ok(exists('docs/MAINTENANCE.md'), 'docs/MAINTENANCE.md exists');
  const doc = read('docs/MAINTENANCE.md');
  assert.match(doc, /Admin → Maintenance/);
  assert.match(doc, /\/api\/v1\/status/);
  assert.match(read('README.md'), /docs\/MAINTENANCE\.md/);
});
