import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`loading uses a centered logo and dimmed overlay at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route('**/data/website.xlsx', async route => { await hold; await route.continue(); });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const splash = page.locator('#siteSplash');
    await expect(splash).toBeVisible();
    await expect(page.locator('.splash-logo')).toBeVisible();
    await expect(page.locator('#siteStatus')).toHaveCSS('clip-path', 'inset(50%)');
    await expect(splash).toHaveCSS('position', 'fixed');
    await expect(splash).toHaveCSS('backdrop-filter', 'blur(7px)');
    await expect(page.locator('#siteRoot')).toHaveAttribute('inert', '');
    await expect(page.locator('#siteRoot')).toHaveAttribute('aria-busy', 'true');
    const box = await page.locator('.splash-brand').boundingBox();
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    release();
    await expect(splash).toHaveCount(0);
    await expect(page.locator('#siteRoot')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#siteRoot')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('body')).not.toHaveClass(/site-loading/);
  });
}

test('logo animates away only after all application scripts have initialized', async ({ page }) => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/assets/js/site/app.js*', async route => { requested = true; await hold; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('#siteSplash')).not.toHaveClass(/is-leaving/);
  await expect(page.locator('#siteRoot .topbar')).toHaveCount(1); // the page exists behind the veil
  await page.evaluate(() => {
    document.querySelector('.splash-brand').addEventListener('animationstart', event => {
      if (event.animationName === 'splash-depart') window.splashExit = {
        animation: event.animationName,
        leaving: document.getElementById('siteSplash').classList.contains('is-leaving'),
        readyCards: document.querySelectorAll('#allShowsTrack .card').length
      };
    });
  });
  release();
  await expect.poll(() => page.evaluate(() => window.splashExit)).toEqual({ animation: 'splash-depart', leaving: true, readyCards: 3 });
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  await expect(page.locator('#siteStatus')).toHaveCount(0);
});

test('startup errors keep a readable recovery screen rather than animating away', async ({ page }) => {
  await page.route('**/data/website.xlsx', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(page.locator('#siteSplash')).toHaveClass(/has-error/);
  await expect(page.locator('#siteSplash')).not.toHaveClass(/is-leaving/);
  await expect(page.locator('#siteStatus')).toContainText('HTTP 404');
  await expect(page.locator('#siteStatus')).toHaveCSS('clip-path', 'none');
  await expect(page.locator('.splash-brand')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#loadRecovery a')).toBeVisible();
});

test('missing logo falls back to the brand name without blocking the page', async ({ page }) => {
  await page.route('**/images/addabaaz-logo.png', route => route.abort());
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/data/website.xlsx', async route => { await hold; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.splash-wordmark')).toBeVisible();
  await expect(page.locator('.splash-wordmark')).toHaveText('ADDABAAZ');
  await expect(page.locator('.splash-logo')).toBeHidden();
  release();
  await expect(page.locator('#siteSplash')).toHaveCount(0);
});

test('reduced-motion skips logo animation and releases the page', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  await page.route('**/data/website.xlsx', async route => { await hold; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.splash-brand')).toHaveCSS('animation-name', 'none');
  release();
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  await expect(page.locator('#siteRoot')).not.toHaveAttribute('inert', '');
});

test('animation fallback releases the page even if splash styles are unavailable', async ({ page }) => {
  await page.route('**/assets/css/splash.css*', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  await expect(page.locator('#siteRoot')).not.toHaveAttribute('inert', '');
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });
  test('the splash does not obscure the enable-JavaScript message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#siteSplash')).toBeHidden();
    await expect(page.locator('noscript')).toBeVisible();
    expect(await page.locator('noscript').evaluate(node => node.textContent)).toContain('Please enable JavaScript');
    await expect(page.locator('body')).toHaveCSS('overflow', 'auto');
  });
});
