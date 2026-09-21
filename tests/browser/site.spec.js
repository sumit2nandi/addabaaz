import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { readWorkbook, writeWorkbook, PREVIEW_KEY } from '../../assets/js/workbook.js';
globalThis.ExcelJS = ExcelJS;
const original = await readWorkbook(await fs.readFile('data/website.xlsx'));

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
  await expect(page.locator('#upcomingGrid .upcoming-card')).toHaveCount(14);
  await page.locator('#upcomingGrid .upcoming-card').first().click();
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  expect(errors).toEqual([]);
});

test('admin edits, previews privately, downloads and reimports Excel', async ({ page, context }) => {
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#field-title').fill('পরিবর্তিত title — <img src=x onerror=alert(1)>');
  await page.locator('#field-description').fill('Updated description <script>window.injected = true</script>');
  await expect(page.locator('#saveState')).toContainText('Unsaved');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview changes' }).click();
  const preview = await popupPromise;
  await expect(preview.locator('#allShowsTrack .card')).toHaveCount(3);
  await expect(preview.locator('#siteStatus')).toContainText('LOCAL PREVIEW');
  const updatedCard = preview.locator('[data-show-key="shahid"]');
  await expect(updatedCard).toContainText('পরিবর্তিত title');
  await updatedCard.focus();
  await updatedCard.press('Enter');
  await expect(preview.locator('#modalContent h4')).toContainText('<img src=x onerror=alert(1)>');
  expect(await preview.evaluate(() => window.injected)).toBeUndefined();
  await expect(preview.locator('#modalContent script')).toHaveCount(0);
  const published = await context.newPage();
  await published.goto('/');
  await expect(published.locator('[data-show-key="shahid"]')).toContainText('শহীদ (Shahid)');
  await expect(published.locator('#siteStatus')).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('website.xlsx');
  const exported = await readWorkbook(await fs.readFile(await download.path()));
  expect(exported.Shows[0].title).toContain('পরিবর্তিত title');
  await page.locator('#fileInput').setInputFiles({ name: 'website.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await fs.readFile(await download.path()) });
  await expect(page.locator('#status')).toContainText('Workbook imported');
  await expect(page.locator('#field-title')).toHaveValue(/পরিবর্তিত title/);
});

test('CRUD, search and validation prevent invalid exports without losing edits', async ({ page }) => {
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#sheetNav').getByRole('button', { name: /^Team/ }).click();
  await page.getByRole('button', { name: '+ Add row' }).click();
  await page.getByRole('button', { name: 'Download Excel' }).click();
  await expect(page.locator('#status')).toContainText('name: required');
  await page.locator('#field-name').fill('Test member');
  await page.getByRole('button', { name: 'Move row up' }).click();
  await expect(page.locator('#recordTitle')).toHaveText('Editing row 10');
  await page.locator('#search').fill('Test member');
  await expect(page.locator('#rowList button')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#rowCount')).toHaveText('0 of 9 rows');
  await page.locator('#sheetNav').getByRole('button', { name: /^Shows/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Remove or reassign');
  await page.locator('#field-title').fill('Do not lose this edit');
  await page.locator('#fileInput').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
  await expect(page.locator('#status')).toContainText('Unable to read');
  await expect(page.locator('#field-title')).toHaveValue('Do not lose this edit');
});

test('a changed published workbook drives site content and settings', async ({ page }) => {
  const data = structuredClone(original);
  data.Shows[0].title = 'Workbook-driven show';
  data.Team[0].name = 'Workbook-driven team';
  data.Services[0].title = 'Workbook-driven service';
  data.Copy.find(row => row.key === 'site.title.text').value = 'Workbook-driven title';
  data.Upcoming[0].title = 'New featured release';
  data.Settings.find(row => row.key === 'btsHomeLimit').value = '2';
  const bytes = Buffer.from(await writeWorkbook(data));
  await page.route('**/data/website.xlsx', route => route.fulfill({ body: bytes }));
  await page.goto('/');
  await expect(page).toHaveTitle('Workbook-driven title');
  await expect(page.locator('[data-show-key="shahid"]')).toContainText('Workbook-driven show');
  await expect(page.locator('.team-name').first()).toHaveText('Workbook-driven team');
  await expect(page.locator('.service-card h4').first()).toHaveText('Workbook-driven service');
  await expect(page.locator('.featured-upcoming-badge')).toHaveText('New featured release');
  await expect(page.locator('#btsTrack .upcoming-card')).toHaveCount(2);
});

test('mobile admin and website have no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/admin.html', '/']) {
    await page.goto(route);
    await expect(page.locator(route.includes('admin') ? '#workspace' : '#heroContent')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByText('Contact', { exact: true }).click();
  await expect(page.locator('#contactTab')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('missing or malformed workbook is reported, not silently replaced', async ({ page }) => {
  await page.route('**/data/website.xlsx', route => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto('/');
  await expect(page.locator('#siteStatus')).toContainText('HTTP 404');
  await expect(page.locator('#siteRoot')).toBeEmpty();
  await page.goto('/admin.html');
  await expect(page.locator('#status')).toContainText('HTTP 404');
  await expect(page.locator('#downloadButton')).toBeDisabled();
  await expect(page.locator('#importButton')).toBeEnabled();
});

test('empty catalogues and unavailable promos fail gracefully', async ({ page }) => {
  const data = structuredClone(original);
  data.Shows = []; data.Episodes = []; data.Upcoming = []; data.BTS = [];
  data.Promos = [{ ...data.Promos[0], availability: 'unavailable' }];
  await page.addInitScript(({ key, data }) => {
    if (window === window.top && location.hostname === '127.0.0.1') localStorage.setItem(key, JSON.stringify(data));
  }, { key: PREVIEW_KEY, data });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html?preview=1');
  await expect(page.locator('#siteStatus')).toContainText('LOCAL PREVIEW');
  await expect(page.locator('#allShowsTrack .card')).toHaveCount(0);
  await expect(page.locator('#comingSoonSection')).toBeHidden();
  await page.locator('#promoRowsContainer .card').press('Enter');
  await expect(page.locator('#videoPlayerBox')).toContainText('VIDEO UNAVAILABLE');
  await expect(page.locator('#ytPlayerIframe')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('linked-file save writes Excel and detects external modifications', async ({ page }) => {
  // Browser file dialogs cannot be automated; exercise the File System Access contract.
  const source = [...await fs.readFile('data/website.xlsx')];
  await page.addInitScript(source => {
    window.testLocalFile = { bytes: source, modified: 1000, writes: 0 };
    window.showOpenFilePicker = async () => [{
      name: 'local.xlsx',
      getFile: async () => new File([new Uint8Array(window.testLocalFile.bytes)], 'local.xlsx', { lastModified: window.testLocalFile.modified }),
      requestPermission: async () => 'granted',
      createWritable: async () => ({
        write: async bytes => { window.testLocalFile.bytes = Array.from(new Uint8Array(bytes)); window.testLocalFile.writes++; },
        close: async () => { window.testLocalFile.modified++; },
        abort: async () => {}
      })
    }];
  }, source);
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Link local workbook', exact: true }).click();
  await expect(page.locator('#sourceName')).toHaveText('Linked: local.xlsx');
  await page.locator('#field-title').fill('Saved locally');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save to linked file', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Saved to the linked local Excel file');
  const saved = await readWorkbook(Buffer.from(await page.evaluate(() => window.testLocalFile.bytes)));
  expect(saved.Shows[0].title).toBe('Saved locally');
  await page.locator('#field-title').fill('Conflicting edit');
  await page.evaluate(() => { window.testLocalFile.modified++; });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Save to linked file', exact: true }).click();
  await expect(page.locator('#status')).toContainText('changed outside this editor');
  expect(await page.evaluate(() => window.testLocalFile.writes)).toBe(1);
});

async function loadFeaturedPreview(page, count = 3) {
  const data = structuredClone(original);
  data.Upcoming.forEach((row, i) => { row.featured = i < count ? 'yes' : 'no'; });
  data.Upcoming[1].title = 'Second featured <poster> & release';
  await page.addInitScript(({ key, data }) => {
    if (window === window.top && location.hostname === '127.0.0.1') localStorage.setItem(key, JSON.stringify(data));
  }, { key: PREVIEW_KEY, data });
  await page.goto('/index.html?preview=1');
  await expect(page.locator('#siteStatus')).toContainText('LOCAL PREVIEW');
}

test('featured posters support manual slides, keyboard and shared full-size popups', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadFeaturedPreview(page);
  const featured = page.locator('#featuredUpcomingContainer');
  const active = featured.locator('.featured-upcoming-card:visible');
  await expect(featured.locator('.featured-upcoming-card')).toHaveCount(3);
  await expect(active).toHaveCount(1);
  await featured.getByRole('button', { name: 'Next featured release', exact: true }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-1');
  await expect(active.locator('img')).toHaveAttribute('src', /POSTER%20\(1\)\.png$/);
  await expect(active.locator('.featured-upcoming-badge')).toHaveText('Second featured <poster> & release');
  await active.click();
  await expect(page.locator('#modalBackdrop')).toHaveClass(/show/);
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /POSTER%20\(1\)\.png$/);
  await expect(page.locator('#modalContent .poster-modal-caption')).toHaveText('Second featured <poster> & release');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalBackdrop')).not.toHaveClass(/show/);
  await featured.getByRole('button', { name: 'Show featured release 3:' }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  await active.focus();
  await page.keyboard.press('ArrowRight');
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-0');
  await expect(active).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png$/);
  await page.keyboard.press('Escape');
  await featured.getByRole('button', { name: 'Previous featured release', exact: true }).click();
  await expect(active).toHaveAttribute('id', 'featured-upcoming-slide-2');
  expect(errors).toEqual([]);
});

test('featured autoplay wraps, pauses on interaction and modal, and cleans up on rerender', async ({ page }) => {
  await page.clock.install();
  await loadFeaturedPreview(page);
  const featured = page.locator('#featuredUpcomingContainer');
  const counter = featured.locator('.featured-upcoming-counter');
  await page.mouse.move(0, 0);
  await page.evaluate(() => renderFeaturedUpcoming());
  await page.clock.runFor(5100);
  await expect(counter).toHaveText('2 / 3');
  await page.clock.runFor(5000);
  await expect(counter).toHaveText('3 / 3');
  await page.clock.runFor(5000);
  await expect(counter).toHaveText('1 / 3');

  await featured.locator('.featured-upcoming-carousel').dispatchEvent('mouseenter');
  await page.clock.runFor(11000);
  await expect(counter).toHaveText('1 / 3');
  await featured.locator('.featured-upcoming-carousel').dispatchEvent('mouseleave');
  await page.clock.runFor(5100);
  await expect(counter).toHaveText('2 / 3');

  await page.evaluate(() => openPosterModal('UpcomingReleases/Durga.png', 'Popup'));
  await page.clock.runFor(11000);
  await expect(counter).toHaveText('2 / 3');
  await page.evaluate(() => closeModal());
  await page.clock.runFor(5100);
  await expect(counter).toHaveText('3 / 3');

  await featured.getByRole('button', { name: 'Pause featured slideshow' }).focus();
  await page.clock.runFor(11000);
  await expect(counter).toHaveText('3 / 3');
  await page.keyboard.press('Enter');
  await page.evaluate(() => document.activeElement.blur());
  await page.mouse.move(0, 0);
  await page.clock.runFor(11000);
  await expect(counter).toHaveText('3 / 3');
  await expect(featured.getByRole('button', { name: 'Play featured slideshow' })).toBeVisible();

  await page.evaluate(() => { renderFeaturedUpcoming(); renderFeaturedUpcoming(); });
  await page.clock.runFor(5100);
  await expect(counter).toHaveText('2 / 3');
  await page.evaluate(() => openTab('aboutTab', null));
  await page.clock.runFor(11000);
  await expect(counter).toHaveText('2 / 3');
  await page.evaluate(() => openTab('homeTab', null));
  await page.clock.runFor(6000);
  await expect(counter).toHaveText('3 / 3');
});

test('zero and single featured items do not show slideshow controls', async ({ page }) => {
  await loadFeaturedPreview(page, 0);
  await expect(page.locator('.featured-upcoming-wrap')).toBeHidden();
  await expect(page.locator('.featured-upcoming-controls')).toHaveCount(0);
  await expect(page.locator('#comingSoonTrack .upcoming-card')).toHaveCount(10);
  await page.evaluate(() => { upcomingReleases[0].featured = 'yes'; renderFeaturedUpcoming(); });
  await expect(page.locator('.featured-upcoming-wrap')).toBeVisible();
  await expect(page.locator('.featured-upcoming-controls')).toHaveCount(0);
  const image = page.locator('.featured-upcoming-card');
  await image.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modalContent img')).toHaveAttribute('src', /Durga.png$/);
});

test('featured mobile layout and reduced-motion preference are respected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await loadFeaturedPreview(page);
  await page.clock.runFor(11000);
  await expect(page.locator('.featured-upcoming-counter')).toHaveText('1 / 3');
  await expect(page.getByRole('button', { name: 'Play featured slideshow' })).toBeVisible();
  await page.getByRole('button', { name: 'Next featured release', exact: true }).click();
  await expect(page.locator('.featured-upcoming-counter')).toHaveText('2 / 3');
  const image = page.locator('.featured-upcoming-card:visible img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('admin can export and import several featured upcoming items', async ({ page }) => {
  await page.goto('/admin.html');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#sheetNav').getByRole('button', { name: /^Upcoming/ }).click();
  await expect(page.locator('#sheetHelp')).toContainText('Multiple featured posters');
  await page.locator('#rowList button').nth(1).click();
  await page.locator('#field-featured').selectOption('yes');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  const bytes = await fs.readFile(await (await downloadPromise).path());
  const data = await readWorkbook(bytes);
  expect(data.Upcoming.filter(row => row.featured === 'yes')).toHaveLength(2);
  await page.locator('#fileInput').setInputFiles({ name: 'website.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  await expect(page.locator('#status')).toContainText('Workbook imported');
});
