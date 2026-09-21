import { test, expect } from '@playwright/test';
import { mockGoogle } from './google-mock.js';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('unconfigured login stays locked and never starts the editor', async ({ page, context }) => {
  await mockGoogle(context, { config: { clientId: '', allowedEmails: [] } });
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/admin.html');
  await expect(page.locator('#authStatus')).toContainText('Google sign-in is not configured');
  await expect(page.locator('#editorShell')).toBeHidden();
  expect(requests.some(url => /\/admin\.js|website\.xlsx/.test(url))).toBe(false);
});

test('Google sign-in unlocks allowed accounts and sign-out locks the page again', async ({ page, context }) => {
  await mockGoogle(context, { autoSignIn: false });
  await page.goto('/admin.html');
  await expect(page.locator('#editorShell')).toBeHidden();
  await page.locator('#googleSignIn').getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#signedInEmail')).toHaveText('editor@example.test');
  const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]);
  expect(stored.join('')).not.toContain('credential');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#editorShell')).toBeHidden();
  await expect(page.locator('#loginPanel')).toBeVisible();
});

test('unlisted accounts cannot load editor code or workbook', async ({ page, context }) => {
  await mockGoogle(context, { claims: { email: 'stranger@example.test' } });
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/admin.html');
  await expect(page.locator('#authStatus')).toContainText('not permitted');
  await expect(page.locator('#editorShell')).toBeHidden();
  expect(requests.some(url => /\/admin\.js|website\.xlsx/.test(url))).toBe(false);
});

test('blocked Google script gives an actionable error instead of unlocking', async ({ page, context }) => {
  await mockGoogle(context, { failScript: true });
  await page.goto('/admin.html');
  await expect(page.locator('#authStatus')).toContainText('could not load');
  await expect(page.locator('#editorShell')).toBeHidden();
});

test('session expiry locks the UI while retaining unsaved edits in memory', async ({ page, context }) => {
  await mockGoogle(context, { claims: { exp: Math.floor(Date.now() / 1000) + 30 } });
  await page.clock.install();
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#field-title').fill('Retained unsaved title');
  await page.clock.runFor(31000);
  await expect(page.locator('#editorShell')).toBeHidden();
  await expect(page.locator('#authStatus')).toContainText('expired');
  await expect(page.locator('#field-title')).toHaveValue('Retained unsaved title');
});

test('browser entrypoints and transitive imports request versioned assets', async ({ page, context }) => {
  await mockGoogle(context);
  const requests = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  const assets = requests.filter(url => /\/assets\/.*\.(js|css)(\?|$)|\/components\/.*\.html/.test(url));
  expect(assets.length).toBeGreaterThan(15);
  for (const url of assets) expect(new URL(url).searchParams.get('v'), url).toMatch(/^[a-f0-9]{12}$/);
});
