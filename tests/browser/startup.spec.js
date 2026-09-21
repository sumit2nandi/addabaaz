import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('admin opens directly without Google configuration, login or auth requests', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#editorShell')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: /sign in|sign out/i })).toHaveCount(0);
  expect(requests.some(url => /admin-auth|google-auth|accounts\.google\.com\/gsi/.test(url))).toBe(false);
});

for (const [route, status, dependency] of [
  ['/', '#siteStatus', 'site-loader.js'],
  ['/', '#siteStatus', 'copy-keys.js'],
  ['/admin.html', '#status', 'admin.js']
]) {
  test(`failed ${dependency} import produces a reload message instead of infinite loading`, async ({ page }) => {
    await page.route(`**/assets/js/${dependency}*`, request => request.fulfill({ status: 404, body: 'missing script' }));
    await page.goto(route);
    await expect(page.locator(status)).toContainText('could not load');
    await expect(page.locator('#loadRecovery')).toBeVisible();
    await expect(page.locator('#loadRecovery a')).toHaveText('reload this page');
  });
}

test('failed bootstrap script has an HTML error fallback', async ({ page }) => {
  await page.route('**/assets/js/page-bootstrap.js*', request => request.fulfill({ status: 404, body: 'missing script' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('startup script could not load');
  await expect(page.locator('#loadRecovery')).toBeVisible();
});

test('failed Excel library has an actionable error', async ({ page }) => {
  await page.route('**/assets/vendor/exceljs.min.js*', request => request.abort());
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('Excel reader could not be downloaded');
  await expect(page.locator('#loadRecovery')).toBeVisible();
});

test('missing template and missing interaction script are reported', async ({ page }) => {
  await page.route('**/components/about.html*', request => request.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('about template (HTTP 404)');
  await page.unroute('**/components/about.html*');
  await page.route('**/assets/js/site/hero.js*', request => request.abort());
  await page.reload();
  await expect(page.locator('#siteStatus')).toContainText('Unable to load the hero component');
  await expect(page.locator('#siteRoot')).toBeEmpty();
});

test('stalled workbook times out and a reload can recover', async ({ page }) => {
  await page.clock.install();
  let requested = false;
  await page.route('**/data/website.xlsx', () => { requested = true; });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requested).toBe(true);
  await page.clock.runFor(21000);
  await expect(page.locator('#siteStatus')).toContainText('timed out');
  await expect(page.locator('#loadRecovery')).toBeVisible();
  await page.unroute('**/data/website.xlsx');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page.locator('#siteStatus')).toHaveCount(0);
});

test('stalled script dependency times out rather than leaving the startup label', async ({ page }) => {
  await page.clock.install();
  let requested = false;
  await page.route('**/assets/js/copy-keys.js*', () => { requested = true; });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requested).toBe(true);
  await page.clock.runFor(26000);
  await expect(page.locator('#siteStatus')).toContainText('Loading took too long');
  await expect(page.locator('#loadRecovery')).toBeVisible();
});

test('slow external fonts and icons cannot block rendering', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', () => {});
  await page.route('https://cdnjs.cloudflare.com/**', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page.locator('#siteStatus')).toHaveCount(0);
});

test('an Excel library delay cannot race with workbook initialization', async ({ page }) => {
  let releaseLibrary;
  const hold = new Promise(resolve => { releaseLibrary = resolve; });
  await page.route('**/assets/vendor/exceljs.min.js*', async route => { await hold; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#siteStatus')).toContainText('Loading ADDABAAZ');
  releaseLibrary();
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page.locator('#siteStatus')).toHaveCount(0);
});

test('browser entrypoints and transitive imports request versioned assets', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  const assets = requests.filter(url => /\/assets\/.*\.(js|css)(\?|$)|\/components\/.*\.html/.test(url));
  expect(assets.length).toBeGreaterThan(15);
  for (const url of assets) expect(new URL(url).searchParams.get('v'), url).toMatch(/^[a-f0-9]{12}$/);
});
