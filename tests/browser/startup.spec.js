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
  // Module preloads can start before the async bootstrap installs its deadline.
  await expect(page.locator('script[src*="exceljs.min.js"]')).toHaveCount(1);
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

for (const path of ['/', '/admin.html']) {
  test(`${path} downloads content before Excel is ready but never parses it early`, async ({ page }) => {
    const finished = [], errors = [];
    let libraryRequests = 0, release;
    const hold = new Promise(resolve => { release = resolve; });
    page.on('requestfinished', request => finished.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = function(url, options) {
        if (String(url).includes('website.xlsx')) window.workbookCacheMode = options?.cache;
        return original.call(this, url, options);
      };
    });
    await page.route('**/assets/vendor/exceljs.min.js*', async route => {
      libraryRequests++;
      await hold;
      await route.continue();
    });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => finished.some(url => url.endsWith('/data/website.xlsx'))).toBe(true);
    expect(await page.evaluate(() => window.workbookCacheMode)).toBe('no-store');
    expect(await page.evaluate(() => typeof window.ExcelJS)).toBe('undefined');
    if (path === '/') {
      await expect.poll(() => finished.some(url => url.includes('/components/navigation.html'))).toBe(true);
      await expect.poll(() => finished.some(url => url.includes('/assets/js/site/app.js'))).toBe(true);
      await expect(page.locator('#siteRoot')).toBeEmpty();
      await expect(page.locator('#siteSplash')).toBeVisible();
      // Early scripts must tolerate keyboard input before templates are inserted.
      await page.keyboard.press('Escape');
    } else {
      await expect(page.locator('#importButton')).toBeDisabled();
    }
    release();
    if (path === '/') await expect(page.locator('#siteSplash')).toHaveCount(0);
    else await expect(page.locator('#workspace')).toBeVisible();
    expect(libraryRequests).toBe(1); // Preload and script must share one download.
    expect(errors).toEqual([]);
  });
}

test('built-in branding never fetches the megabyte original logo', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  await expect(page.locator('img.logo')).toHaveAttribute('src', 'images/addabaaz-logo-small.webp');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'images/addabaaz-icon.png');
  expect(requests.some(url => url.includes('/images/addabaaz-logo.png'))).toBe(false);
});

test('admin workbook recovery cannot enable import before the reader is available', async ({ page }) => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/vendor/exceljs.min.js*', async route => { await hold; await route.continue(); });
  await page.route('**/data/website.xlsx', route => route.fulfill({ status: 404, body: 'missing workbook' }));
  const response = page.waitForResponse('**/data/website.xlsx');
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  await response;
  await expect(page.locator('#importButton')).toBeDisabled();
  release();
  await expect(page.locator('#status')).toContainText('HTTP 404');
  await expect(page.locator('#importButton')).toBeEnabled();
  await expect(page.locator('#loadRecovery')).toBeVisible();
});
