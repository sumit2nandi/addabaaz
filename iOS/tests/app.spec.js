import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

import { original } from '../../tests/support/fixture.js';
import { publicPayload } from '../../backend/src/content.js';
const content = publicPayload({ tables: original, revision: 1, updatedAt: '2026-09-22T00:00:00.000Z' }, 'home');
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
  expect(requests.some(url => url.includes('/api/v1/content?view=home'))).toBe(true);
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
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /\/media\/UpcomingReleases\//);
  await page.locator('.animated-close-btn').tap();
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  await page.getByRole('button', { name: 'Back to home' }).tap();
  await expect(page.locator('#homeTab')).toHaveClass(/active/);
});

test('offline status is explicit', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await open(page);
  await expect(page.locator('#connectionStatus')).toBeVisible();
  await expect(page.locator('#connectionStatus')).toContainText('Reconnect to load the latest content');
  expect(await page.locator('.featured-upcoming-card.active img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

test('unavailable API shows retry instead of bundled stale content', async ({ page }) => {
  await page.route('**/api/v1/content*', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('HTTP 404');
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
  for (const name of ['content.json', 'admin.html', 'data/website.xlsx', 'assets/vendor/exceljs.min.js', 'components/contact.html']) {
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

test('iPad layout keeps the home feed usable without adding a menu', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await open(page);
  await expect(page.locator('.nav, .topbar')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#heroContent').getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await page.locator('.animated-close-btn').tap();
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
});

test('cutout and home-indicator safe-area padding is respected', async ({ page }) => {
  await open(page);
  await page.addStyleTag({ content: ':root { --safe-area-inset-top: 44px; --safe-area-inset-bottom: 34px; }' });
  await expect(page.locator('body')).toHaveCSS('padding-top', '44px');
  await expect(page.locator('body')).toHaveCSS('padding-bottom', '34px');
});

test('the iOS project has no Android platform dependency or exit behavior', async () => {
  const config = JSON.parse(await fs.readFile('capacitor.config.json', 'utf8'));
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const entry = await fs.readFile('web/app.js', 'utf8');
  expect(config.ios.path).toBe('native');
  expect(config.server.iosScheme).toBe('capacitor');
  expect(config.server).not.toHaveProperty('url');
  expect(config).not.toHaveProperty('android');
  expect(pkg.dependencies).toHaveProperty('@capacitor/ios');
  expect(pkg.dependencies).not.toHaveProperty('@capacitor/android');
  expect(entry).not.toMatch(/backButton|exitApp/);
});

test('refresh loads an updated backend revision without rebuilding the app', async ({ page, request }) => {
  const headers = { Authorization: 'Bearer test-only-ephemeral-admin-token-not-for-production' };
  const state = await (await request.get('http://127.0.0.1:3000/api/v1/admin/content', { headers })).json();
  const changed = structuredClone(state.tables);
  changed.Copy.find(row => row.key === 'home.h3.text').value = 'Fresh backend content বাংলা';
  await open(page);
  const response = await request.put('http://127.0.0.1:3000/api/v1/admin/content', {
    headers: { ...headers, 'If-Match': `"${state.revision}"` }, data: { tables: changed }
  });
  expect(response.status()).toBe(200);
  try {
    await page.getByRole('button', { name: 'Refresh content' }).tap();
    await expect(page.locator('[data-copy="home.h3.text"]')).toHaveText('Fresh backend content বাংলা');
  } finally {
    const update = await response.json();
    await request.put('http://127.0.0.1:3000/api/v1/admin/content', {
      headers: { ...headers, 'If-Match': `"${update.revision}"` }, data: { tables: state.tables }
    });
  }
});
