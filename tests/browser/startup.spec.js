import { test, expect } from '@playwright/test';
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
test('startup only requests API content, never the workbook or Excel library', async ({ page }) => {
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/'); await expect(page.locator('#siteSplash')).toHaveCount(0);
  expect(requests.some(url => url.includes('/api/v1/content'))).toBe(true);
  expect(requests.some(url => /\.xlsx|exceljs/.test(url))).toBe(false);
});
test('failed module import has a readable recovery message', async ({ page }) => {
  await page.route('**/assets/js/site-loader.js*', route => route.abort());
  await page.goto('/'); await expect(page.locator('#siteStatus')).toContainText('could not load');
  await expect(page.locator('#loadRecovery')).toBeVisible();
});
test('stalled API times out and reload can recover', async ({ page }) => {
  await page.clock.install();
  let requested = false;
  await page.route('**/api/v1/content*', () => { requested = true; });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requested).toBe(true);
  await page.clock.runFor(16000);
  await expect(page.locator('#siteStatus')).toContainText('too long');
  await page.unroute('**/api/v1/content*');
  await page.reload(); await expect(page.locator('#siteSplash')).toHaveCount(0);
});
test('contact submission saves through the backend and checks success', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#siteSplash')).toHaveCount(0);
  await page.getByText('Contact', { exact: true }).click();
  await page.locator('#name').fill('Visitor'); await page.locator('#email').fill('visitor@example.com');
  await page.locator('#message').fill('I would like to discuss a project.');
  await page.locator('#captchaAnswer').fill(await page.evaluate(() => captchaText));
  // A valid configured origin may include a trailing slash.
  await page.evaluate(() => { window.ADDABAAZ_API_BASE_URL = location.origin + '/'; });
  const response = page.waitForResponse('**/api/v1/inquiries');
  await page.locator('#submitBtn').click();
  expect((await response).status()).toBe(201);
  await expect(page.locator('#formStatus')).toContainText('inquiry was saved');
});
