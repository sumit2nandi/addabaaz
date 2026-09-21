import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const content = JSON.parse(await fs.readFile('www/content.json', 'utf8'));
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
async function open(page) {
  await page.goto('/');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
}

test('home feed works without a top menu, non-home sections or Excel requests', async ({ page }) => {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await open(page);
  await expect(page.locator('.topbar, .nav, #aboutTab, #servicesTab, #contactTab, #editorShell')).toHaveCount(0);
  await expect(page.locator('#appBack')).toBeHidden();
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page.locator('#promoRowsContainer .card')).toHaveCount(content.runtime.promoVideos.length);
  await expect(page.locator('#featuredUpcomingContainer .featured-upcoming-card')).toHaveCount(content.runtime.upcomingReleases.filter(row => row.featured === 'yes').length);
  expect(requests.some(url => /\.xlsx|exceljs|admin\.html|contact\.html/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('show details, episode playback and in-app back work', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('#heroContent').getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await page.locator('#modalContent').getByRole('button', { name: 'Play First Episode' }).tap();
  await expect(page.locator('#playerTab')).toHaveClass(/active/);
  await expect(page.locator('#ytPlayerIframe')).toHaveAttribute('src', /youtube\.com\/embed\//);
  await expect(page.locator('.watch-external')).toHaveAttribute('href', /^https:\/\/www.youtube.com\/watch\?v=/);
  await expect(page.locator('#episodesTrack .ep-card')).toHaveCount(16);
  await page.getByRole('button', { name: 'Back to home' }).tap();
  await expect(page.locator('#homeTab')).toHaveClass(/active/);
  await expect(page.locator('#ytPlayerIframe')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('home galleries and posters remain accessible without a navigation menu', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Show All Upcoming Releases' }).tap();
  await expect(page.locator('#upcomingTab')).toHaveClass(/active/);
  await expect(page.locator('#upcomingGrid .upcoming-card')).toHaveCount(content.runtime.upcomingReleases.length);
  await page.locator('#upcomingGrid .upcoming-card').first().tap();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /^media\/.*\.webp$/);
  await page.locator('.animated-close-btn').tap();
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  await page.getByRole('button', { name: 'Back to home' }).tap();
  await expect(page.locator('#homeTab')).toHaveClass(/active/);
});

test('offline status is explicit and local artwork is bundled', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await open(page);
  await expect(page.locator('#connectionStatus')).toBeVisible();
  await expect(page.locator('#connectionStatus')).toContainText('connect to watch videos');
  expect(await page.locator('.featured-upcoming-card.active img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

test('missing bundled content shows retry instead of an endless splash', async ({ page }) => {
  await page.route('**/content.json', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('catalogue is missing');
  await expect(page.locator('#loadRecovery')).toBeVisible();
  await expect(page.locator('#siteRoot')).toHaveAttribute('inert', '');
});

test('app does not autoplay network video in the hero feed', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await page.clock.runFor(5000);
  await expect(page.locator('#heroIframe')).toHaveCount(0);
  await expect(page.locator('#heroContent h1')).not.toBeEmpty();
});

test('landscape and narrow layouts keep content inside the viewport', async ({ page }) => {
  await open(page);
  for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('distribution is allowlisted and contains no private editing files', async ({ request }) => {
  for (const name of ['admin.html', 'data/website.xlsx', 'assets/vendor/exceljs.min.js', 'components/contact.html']) {
    expect((await request.get(`/${name}`)).status()).toBe(404);
  }
  expect(content.runtime).not.toHaveProperty('FORM_CONFIG');
  expect(Object.keys(content.copy).some(key => /^(contact|about|services)\./.test(key))).toBe(false);
});

test('touch controls change the featured poster without opening it', async ({ page }) => {
  await open(page);
  const stage = page.locator('.featured-upcoming-slides');
  await stage.scrollIntoViewIfNeeded();
  await expect(page.locator('#comingSoonSection')).toHaveCSS('opacity', '1');
  const first = await page.locator('.featured-upcoming-card.active').getAttribute('id');
  await stage.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 280, clientY: 200, isPrimary: true, button: 0 });
  await stage.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 200, isPrimary: true, button: 0 });
  await expect(page.locator('.featured-upcoming-card.active')).not.toHaveAttribute('id', first);
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
});
