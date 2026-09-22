import { test, expect } from '@playwright/test';
import { original } from '../support/fixture.js';
import { publicPayload } from '../../backend/src/content.js';
const apiBody = tables => JSON.stringify(publicPayload({ tables, revision: 1, updatedAt: '2026-09-22T00:00:00.000Z' }));

test.beforeEach(async ({ context }) => {
  // Keep tests deterministic without live YouTube, Google Fonts or form submissions.
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') route.continue();
    else route.abort();
  });
});

test('loads original site, all tabs, modals, galleries and playback', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(page).toHaveTitle('ADDABAAZ — Film & Ad Production House');
  await expect(page.locator('#promoRowsContainer .card')).toHaveCount(158);
  await expect(page.locator('#comingSoonTrack .upcoming-card')).toHaveCount(10);
  await expect(page.locator('#btsTrack .upcoming-card')).toHaveCount(10);
  await page.getByText('About', { exact: true }).click();
  await expect(page.locator('#aboutTab')).toBeVisible();
  await expect(page.locator('.team-card')).toHaveCount(9);
  await expect(page.locator('.mission-list li')).toHaveCount(10);
  await page.getByText('Services', { exact: true }).click();
  await expect(page.locator('#servicesTab')).toBeVisible();
  await expect(page.locator('.service-card')).toHaveCount(6);
  await page.getByText('Contact', { exact: true }).click();
  await expect(page.locator('a[href="mailto:office@addabaaz.in"]')).toHaveText('office@addabaaz.in');
  await expect(page.locator('#captchaCanvas')).toBeVisible();
  await page.getByText('Home', { exact: true }).click();
  await page.locator('#heroContent').getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await page.locator('#modalContent').getByRole('button', { name: 'Play First Episode' }).click();
  await expect(page.locator('#playerTab')).toBeVisible();
  await expect(page.locator('#ytPlayerIframe')).toHaveAttribute('src', /youtube.com\/embed\//);
  await expect(page.locator('#episodesTrack .ep-card')).toHaveCount(16);
  await page.goBack();
  await expect(page.locator('#homeTab')).toBeVisible();
  await page.getByRole('button', { name: 'Show All Upcoming Releases' }).click();
  await expect(page.locator('#upcomingTab')).toBeVisible();
  await expect(page.locator('#upcomingGrid .upcoming-card')).toHaveCount(original.Upcoming.length);
  await page.locator('#upcomingGrid .upcoming-card').first().click();
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  expect(errors).toEqual([]);
});



test('a changed backend content drives site content and settings', async ({ page }) => {
  const data = structuredClone(original);
  data.Shows[0].title = 'Workbook-driven show';
  data.Team[0].name = 'Workbook-driven team';
  data.Services[0].title = 'Workbook-driven service';
  data.Copy.find(row => row.key === 'site.title.text').value = 'Workbook-driven title';
  data.Upcoming[0].title = 'New featured release';
  data.Settings.find(row => row.key === 'btsHomeLimit').value = '2';
  const bytes = apiBody(data);
  await page.route('**/api/v1/content*', route => route.fulfill({ body: bytes }));
  await page.goto('/');
  await expect(page).toHaveTitle('Workbook-driven title');
  await expect(page.locator('[data-show-key="shahid"]')).toContainText('Workbook-driven show');
  await expect(page.locator('.team-name').first()).toHaveText('Workbook-driven team');
  await expect(page.locator('.service-card h4').first()).toHaveText('Workbook-driven service');
  await expect(page.locator('#featured-upcoming-slide-0 .featured-upcoming-badge')).toHaveText('New featured release');
  await expect(page.locator('#btsTrack .upcoming-card')).toHaveCount(2);
});

test('mobile website have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/']) {
    await page.goto(route);
    await expect(page.locator(route.includes('admin') ? '#workspace' : '#heroContent')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByText('Contact', { exact: true }).click();
  await expect(page.locator('#contactTab')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('unavailable API is reported, not silently replaced', async ({ page }) => {
  await page.route('**/api/v1/content*', route => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('HTTP 404');
  await expect(page.locator('#siteRoot')).toBeEmpty();
});

test('empty catalogues and unavailable promos fail gracefully', async ({ page }) => {
  const data = structuredClone(original);
  data.Shows = []; data.Episodes = []; data.Upcoming = []; data.BTS = [];
  data.Promos = [{ ...data.Promos[0], availability: 'unavailable' }];
  await page.route('**/api/v1/content*', route => route.fulfill({ body: apiBody(data) }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html?preview=1');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(0);
  await expect(page.locator('#comingSoonSection')).toBeHidden();
  await page.locator('#promoRowsContainer .card').press('Enter');
  await expect(page.locator('#videoPlayerBox')).toContainText('VIDEO UNAVAILABLE');
  await expect(page.locator('#ytPlayerIframe')).toHaveCount(0);
  expect(errors).toEqual([]);
});


async function loadFeaturedPreview(page, count = 3) {
  const data = structuredClone(original);
  data.Upcoming.forEach((row, i) => { row.featured = i < count ? 'yes' : 'no'; });
  data.Upcoming[1].title = 'Second featured <poster> & release';
  await page.route('**/api/v1/content*', route => route.fulfill({ body: apiBody(data) }));
  await page.goto('/index.html?preview=1');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
}

test('featured posters have banner dots, keyboard navigation and shared popups without transport buttons', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadFeaturedPreview(page);
  const featured = page.locator('#featuredUpcomingContainer');
  const active = featured.locator('.featured-upcoming-card.active');
  await expect(featured.locator('.featured-upcoming-card')).toHaveCount(3);
  await expect(active).toHaveCount(1);
  await expect(featured.getByRole('button', { name: /^(Previous|Next|Pause|Play) featured/ })).toHaveCount(0);
  await featured.getByRole('button', { name: 'Show featured release 2:' }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await expect(active.locator('img')).toHaveAttribute('src', /POSTER%20\(1\)\.png$/);
  await expect(active.locator('.featured-upcoming-badge')).toHaveText('Second featured <poster> & release');
  await active.click();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /POSTER%20\(1\)\.png$/);
  await expect(page.locator('#modalContent .poster-modal-caption')).toHaveText('Second featured <poster> & release');
  await page.keyboard.press('Escape');
  await featured.getByRole('button', { name: 'Show featured release 3:' }).click();
  await active.focus();
  await page.keyboard.press('ArrowRight');
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-0');
  await expect(active).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png$/);
  await page.keyboard.press('Escape');
  await active.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  await expect(featured.locator('.featured-upcoming-card:not(.active)').first()).toHaveAttribute('inert', '');
  await expect(featured.locator('.featured-upcoming-card:not(.active)').first()).toHaveAttribute('aria-hidden', 'true');
  expect(errors).toEqual([]);
});

test('featured autoplay loops continuously after the last dot and while hovered', async ({ page }) => {
  await page.clock.install();
  await loadFeaturedPreview(page);
  const featured = page.locator('#featuredUpcomingContainer');
  const active = featured.locator('.featured-upcoming-card.active');
  await page.mouse.move(0, 0);
  await page.evaluate(() => renderFeaturedUpcoming());
  for (const next of [1, 2, 0, 1, 2, 0]) {
    await page.clock.runFor(5100);
    await expect(active).toHaveAttribute('id', `featured-upcoming-slide-${next}`);
  }
  // Selecting the final dot with a pointer must not leave autoplay paused by focus.
  await featured.getByRole('button', { name: 'Show featured release 3:' }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  await page.clock.runFor(5100);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-0');
  await featured.hover();
  await page.clock.runFor(5100);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');

  await page.evaluate(() => openPosterModal('UpcomingReleases/Durga.png', 'Popup'));
  await page.clock.runFor(11000);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await page.evaluate(() => closeModal());
  await page.clock.runFor(5100);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  await page.evaluate(() => { renderFeaturedUpcoming(); renderFeaturedUpcoming(); });
  await page.clock.runFor(5100);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await page.evaluate(() => openTab('aboutTab', null));
  await page.clock.runFor(11000);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await page.evaluate(() => openTab('homeTab', null));
  await page.clock.runFor(6000);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
});

async function dragFeatured(page, direction = -1) {
  const stage = page.locator('.featured-upcoming-slides');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x - direction * 80, y);
  await page.mouse.down();
  await page.mouse.move(x + direction * 80, y, { steps: 8 });
  await page.mouse.up();
}

test('mouse dragging wraps in both directions without opening a popup, then autoplay resumes', async ({ page }) => {
  await page.clock.install();
  await loadFeaturedPreview(page);
  const active = page.locator('.featured-upcoming-card.active');
  await dragFeatured(page, 1); // first -> last
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  await dragFeatured(page, -1); // last -> first
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-0');
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  await page.clock.runFor(5100);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await active.click();
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /POSTER%20\(1\)\.png$/);
});

test('featured posters crossfade with the same timing as the banner, not display swaps', async ({ page }) => {
  await loadFeaturedPreview(page);
  const next = page.locator('#featured-upcoming-slide-1');
  const previous = page.locator('#featured-upcoming-slide-0');
  await expect(next).toHaveCSS('opacity', '0');
  await expect(next).toHaveCSS('transition-duration', '0.9s');
  await page.getByRole('button', { name: 'Show featured release 2:' }).click();
  await expect(next).toHaveClass(/active/);
  await page.waitForFunction(() => {
    const current = Number(getComputedStyle(document.getElementById('featured-upcoming-slide-1')).opacity);
    const old = Number(getComputedStyle(document.getElementById('featured-upcoming-slide-0')).opacity);
    return current > 0 && current < 1 && old > 0 && old < 1;
  });
  await expect(previous).toHaveCSS('display', 'block');
  await expect(next).toHaveCSS('opacity', '1');
  await expect(previous).toHaveCSS('opacity', '0');
});

test('zero and single featured items do not show slideshow dots', async ({ page }) => {
  await loadFeaturedPreview(page, 0);
  await expect(page.locator('.featured-upcoming-wrap')).toBeHidden();
  await expect(page.locator('.featured-upcoming-dots')).toHaveCount(0);
  await expect(page.locator('#comingSoonTrack .upcoming-card')).toHaveCount(10);
  await page.evaluate(() => { upcomingReleases[0].featured = 'yes'; renderFeaturedUpcoming(); });
  await expect(page.locator('.featured-upcoming-wrap')).toBeVisible();
  await expect(page.locator('.featured-upcoming-dots')).toHaveCount(0);
  const image = page.locator('.featured-upcoming-card.active');
  await image.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png$/);
});

test('featured mobile layout and reduced-motion preference are respected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await loadFeaturedPreview(page);
  const active = page.locator('.featured-upcoming-card.active');
  await page.clock.runFor(11000);
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-0');
  await page.getByRole('button', { name: 'Show featured release 2:' }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await expect(active).toHaveCSS('transition-duration', '0s');
  await expect(active.locator('img')).toHaveCSS('object-fit', 'contain');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe('touch featured carousel', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('touch swipes wrap without a popup; taps still open the current poster', async ({ page }) => {
    await loadFeaturedPreview(page);
    const stage = page.locator('.featured-upcoming-slides');
    const active = page.locator('.featured-upcoming-card.active');
    await stage.scrollIntoViewIfNeeded();
    await active.tap();
    await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
    await page.evaluate(() => closeModal());
    await expect(page.locator('#modalBackdrop')).toBeHidden();
    await expect(stage).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    const box = await stage.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    for (const [direction, result] of [[1, 2], [-1, 0]]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - direction * 70, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + direction * 70, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(active).toHaveAttribute('id', `featured-upcoming-slide-${result}`);
      await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
    }
    await expect(active).toHaveCSS('opacity', '1');
    await active.tap();
    await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png$/);
  });
});


test('promo posters use lazy images and retain their hover preview artwork', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#siteSplash')).toHaveCount(0);
  const images = page.locator('#promoRowsContainer .poster img');
  await expect(images).toHaveCount(158);
  expect(await images.evaluateAll(nodes => nodes.every(node => node.loading === 'lazy' && node.decoding === 'async'))).toBe(true);
  const card = page.locator('#promoRowsContainer .card').first();
  const src = await card.locator('img').getAttribute('src');
  await card.scrollIntoViewIfNeeded();
  // Let the entrance transition finish before hover; scrolling dismisses previews.
  await expect(page.locator('#promoRowsContainer .animate-row').first()).toHaveCSS('opacity', '1');
  await card.hover();
  await expect(page.locator('#cardPreview')).toHaveClass(/show/);
  await expect(page.locator('#cardPreview .card-preview-video')).toHaveCSS('background-image', `url("${src}")`);
});

test('optimized branding does not override custom workbook logo paths', async ({ page }) => {
  const tables = structuredClone(original);
  for (const row of tables.Copy) {
    if (row.value === 'images/addabaaz-logo.png') row.value = 'images/Sumit.png';
  }
  const writeBytes = apiBody(tables);
  await page.route('**/api/v1/content*', route => route.fulfill({ body: Buffer.from(writeBytes) }));
  await page.goto('/');
  await expect(page.locator('img.logo')).toHaveAttribute('src', /\/media\/images\/Sumit.png$/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /\/media\/images\/Sumit.png$/);
});
