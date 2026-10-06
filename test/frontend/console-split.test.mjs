// The two management consoles — Admin (/admin/) and the Content studio (/content/) — plus the mobile
// behaviour both must keep, and the Broadcast preview/image composer.
// Run: node --test test/frontend/console-split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const consoleJs = read('admin/js/console.js');
const adminMain = read('admin/js/main.js');
const adminHtml = read('admin/index.html');
const studioMain = read('content/js/main.js');
const studioHtml = read('content/index.html');
const studioOverview = read('admin/js/views/content-overview.js');
const adminCss = read('admin/admin.css');
const broadcast = read('admin/js/views/notifications.js');
const appCss = read('app/css/styles.css');
const extra = read('server/src/admin-extra.js');
const campaigns = read('server/src/campaigns.js');
const emails = read('server/src/emails.js');
const push = read('server/src/push.js');
const fcm = read('server/src/fcm.js');
const web = read('server/src/web.js');
const mobile = read('content/js/main.js');

test('the Admin console includes the CMS while the focused Content Studio remains available', () => {
  // One shared shell, two entry points with their own sidebars.
  assert.match(consoleJs, /export function startConsole\(\{ nav, routes, name = 'Admin'/, 'the shell is shared');
  assert.match(consoleJs, /switchTo \? html`<a class="btn sm block" id="switchConsole"/, 'each console links to the other');
  assert.match(adminMain, /import \{ startConsole \} from '\.\/console\.js'/, 'the admin entry point uses it');
  assert.match(studioMain, /import \{ startConsole \} from '\/admin\/js\/console\.js'/, 'so does the studio');
  // Admin keeps its business pages and now exposes the complete CMS in its Content group.
  for (const page of ['users', 'payments', 'refunds', 'coupons', 'support', 'messages', 'comments', 'analytics', 'notifications', 'cache', 'errors', 'audit'])
    assert.ok(adminMain.includes(`'${page}'`), `the admin sidebar still has ${page}`);
  assert.match(adminMain, /\['catalog', 'Content overview', 'dashboard'\]/, 'the catalog overview is available in Admin');
  for (const page of ['shows', 'videos', 'upcoming', 'top', 'studio']) assert.ok(adminMain.includes(`'${page}'`), `Admin includes ${page}`);
  assert.ok(adminMain.includes("import('./views/content-overview.js')"), 'Admin loads the content overview');
  assert.ok(adminMain.includes("import('./views/content.js')"), 'Admin reuses the catalog management pages');
  assert.ok(adminMain.includes("import('./views/studio.js')"), 'Admin includes Studio & team');
  assert.match(studioMain, /const ROUTES = \[/, 'the studio has its own routes');
  for (const page of ['shows', 'videos', 'upcoming', 'top', 'studio']) assert.ok(studioMain.includes(`'${page}'`), `the studio has ${page}`);
  assert.equal(studioMain.includes("'gallery'"), false, 'and the photo gallery is hidden (docs/CONTENT.md)');
  assert.match(studioMain, /import\('\/admin\/js\/views\/content\.js'\)/, 'it reuses the content page modules');
  assert.match(studioMain, /name: 'Content'/, 'the studio names itself in the sign-in card and sidebar');
  assert.match(read('admin/js/views/content.js'), /export default async function content\(root, \[section\], ctx\)/, 'the content page still takes its section');
  assert.match(studioOverview, /api\.get\('\/catalog'\)/, 'the studio overview reads the catalog');
  assert.match(studioOverview, /Needs attention/, 'and flags titles that cannot be published yet');
  // Both pages are locked down and never cached by the browser or the service worker.
  assert.match(adminHtml, /<script type="module" src="\/admin\/js\/main\.js"><\/script>/);
  assert.match(studioHtml, /<script type="module" src="\/content\/js\/main\.js"><\/script>/);
  assert.match(studioHtml, /<link rel="stylesheet" href="\/admin\/admin\.css">/, 'the studio shares the console stylesheet');
  assert.match(read('sw.js'), /'\/admin', '\/content'/, 'the service worker skips both');
});

test('the Content Studio page can resolve its shared view-count formatter', async () => {
  // Importing the route reproduces browser ESM linking: a missing named export in ui.js must fail here,
  // before the Shows & seasons page can load.
  const [content, ui] = await Promise.all([
    import('../../admin/js/views/content.js'),
    import('../../admin/js/ui.js'),
  ]);
  assert.equal(typeof content.default, 'function');
  assert.equal(ui.fmtViews(1250), '1.3K');
  assert.equal(ui.fmtViews(1_200_000), '1.2M');
});

test('the Content Studio overview renders its warning icon as SVG, not escaped text', async () => {
  const { default: renderOverview } = await import('../../admin/js/views/content-overview.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    shows: [], upcoming: [],
    videos: [{ id: 'incomplete', title: 'Incomplete episode', kind: 'episode' }],
  }), { headers: { 'content-type': 'application/json' } });
  const root = { innerHTML: '' };
  try {
    await renderOverview(root, [], { stale: () => false });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(root.innerHTML, /<h2><svg class="i"[^>]*>[\s\S]*?<\/svg> Needs attention<\/h2>/);
  assert.doesNotMatch(root.innerHTML, /&lt;svg/);
});

test('both consoles are usable on a phone', () => {
  // Sidebar becomes a drawer, top bar appears — the behaviour both consoles inherit.
  assert.match(adminCss, /@media \(max-width: 860px\) \{\n  \.layout \{ display: block; \}/, 'the sidebar turns into a drawer');
  assert.match(consoleJs, /menu\.onclick = \(\) => toggle\(!layout\.classList\.contains\('nav-open'\)\)/, 'with a menu button in the top bar');
  assert.match(consoleJs, /side\.addEventListener\('click', \(e\) => \{ if \(e\.target\.closest\('a\[data-nav\]'\)\) toggle\(false\); \}\)/, 'and it closes after a tap');
  // Phone-specific rules.
  assert.match(adminCss, /@media \(max-width: 640px\) \{[\s\S]*?input, select, textarea \{ font-size: 16px; \}/, 'fields are 16px so iOS does not zoom the page');
  assert.match(adminCss, /dialog\.modal, dialog\.modal\.wide \{ width: 100vw; max-width: none; height: 100dvh;/, 'dialogs fill a phone screen');
  assert.match(adminCss, /\.tabs \{ display: flex; flex-wrap: wrap;/, 'tab strips wrap instead of scrolling sideways');
  assert.match(adminCss, /\.stats, \.tiles \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'stat tiles stay two-up, then one-up');
  assert.match(adminCss, /@media \(max-width: 420px\) \{ \.stats, \.tiles \{ grid-template-columns: 1fr; \} \}/, 'and go single column on small phones');
  assert.match(adminCss, /\.row\.end \.btn, \.row\.wrap \.btn \{ flex: 1 1 auto; justify-content: center; \}/, 'action buttons become full-width and thumb-sized');
  assert.match(adminCss, /\.card\.flush \{ min-width: 0; padding: 0; overflow-x: clip; \}/, 'wide tables are contained without a horizontal scroll area');
  assert.match(adminCss, /main#main \{ overflow-x: clip; \}/, 'the page itself never scrolls sideways');
  // The views that matter on the road: the ticket queue and its thread.
  assert.match(adminCss, /\.tk \{ cursor: pointer; \}/, 'ticket cards are tappable');
  assert.match(adminCss, /\.tk-thread \{[\s\S]*?overflow-x: clip; overflow-y: auto;/, 'the conversation scrolls vertically only');
});

test('a broadcast can be previewed, and images go out with it', () => {
  // Console: preview rendered by the server, images uploaded through the shared image control.
  assert.match(broadcast, /api\.post\('\/notifications\/preview'/, 'the composer asks the server for a preview');
  assert.match(broadcast, /imageField\(/, 'both channels offer an optional image');
  assert.match(broadcast, /wireImages\(form\)/, 'the image control uploads and previews');
  assert.match(broadcast, /imageUrl: form\.imageUrl \? form\.imageUrl\.value\.trim\(\) : ''/, 'the image is part of the payload');
  assert.match(broadcast, /Nothing has been sent/, 'the preview says nothing left the server');
  assert.match(broadcast, /srcdoc="\$\{m\.html \|\| ''\}"/, 'the e-mail preview shows the real HTML, sandboxed');
  assert.match(broadcast, /push-img/, 'the push preview shows the picture');
  assert.match(broadcast, /schedulePreview/, 'the preview follows what is being typed');
  // Server: the same builders the sender uses, and the image reaches push + e-mail.
  assert.match(extra, /router\.post\('\/notifications\/preview'/, 'POST /admin/notifications/preview exists');
  assert.match(extra, /notificationPayload\(\{ title, body, url, image: imageUrl \? absoluteUrl\(imageUrl\) : null \}\)/, 'the push preview uses the sender’s payload builder');
  assert.match(extra, /export function normalizeImage\(/, 'only https:// or upload paths are accepted as images');
  assert.match(extra, /const imageUrl = normalizeImage\(b\.imageUrl\)/, 'send and test both normalise it');
  assert.match(push, /export function notificationPayload\(\{ title, body, url, image, tag \}/, 'the payload builder carries the image');
  assert.match(campaigns, /image: absoluteImage\(campaign\.imageUrl, siteUrl\),   \/\/ devices load the picture themselves/, 'the campaign passes it to push');
  assert.match(campaigns, /image: absoluteImage\(campaign\.imageUrl, siteUrl\), imageAlt: campaign\.imageAlt/, 'and to e-mail');
  assert.match(campaigns, /const absoluteImage = \(image, siteUrl = ''\)/, 'relative upload paths become absolute before sending');
  assert.match(emails, /image\s*\?|image \? html`<img/, 'the e-mail layout renders the optional hero image');
  assert.match(fcm, /\.\.\.\(m\.image \? \{ image: m\.image \} : \{\}\)/, 'FCM turns it into a rich notification');
  assert.match(read('sw.js'), /image: d\.image \|\| undefined/, 'and the service worker shows it in the browser notification');
  assert.match(read('server/migrations/017_client_cache_and_campaign_media.sql'), /ADD COLUMN image_url VARCHAR\(500\)/, 'the image is stored with the campaign');
});

test('the native build never offers a purchase (store policy)', () => {
  const plans = read('app/js/views/plans.js');
  assert.match(plans, /const canBuy = !isNative && payments\.provider !== 'none'/, 'buying is impossible in the apps');
  assert.match(plans, /This app does not offer purchases or payment links/, 'the app clearly says that purchases are unavailable');
  assert.match(plans, /Memberships and payments are managed separately on the ADDABAAZ website/, 'the app neutrally explains where an existing membership is managed');
  assert.match(plans, /No purchase can be started or completed in this app/, 'the native footer cannot be mistaken for an in-app checkout');
  assert.match(plans, /!isNative \? html`<div class="price">/, 'native plan cards do not advertise prices');
  assert.match(plans, /!isNative && creditPaise > 0/, 'native screens do not advertise checkout credit');
  assert.equal(/Razorpay<\/a>/.test(plans.replace(/\$\{isNative[\s\S]*?\}/, '')), false, 'the provider name is kept out of the native copy');
  assert.match(read('docs/PAYMENTS.md'), /store-policy|Google Play Payments and App Store guideline 3\.1\.1/, 'the reasoning is documented');
  assert.match(mobile, /startConsole/, 'the studio boots through the shared shell (no purchase UI anywhere in it)');
});

test('the consoles cross-link, and the site itself is untouched by the split', () => {
  assert.match(adminMain, /href: '\/content\/', label: 'Content studio'/, 'the admin links to the studio');
  assert.match(studioMain, /href: '\/admin\/', label: 'Admin console'/, 'the studio links back');
  assert.match(web, /express\.static\(path\.join\(ROOT, 'content'\)/, 'and the server serves both folders');
  assert.match(web, /app\.use\('\/admin', consoleHeaders, express\.static\(path\.join\(ROOT, 'admin'\)/, 'the admin folder is still served from the source tree');
  // The viewer-facing app keeps its own navigation: no admin links leak into it.
  const shell = read('app/js/ui/shell.js');
  assert.equal(/\/admin\/|\/content\//.test(shell), false, 'the site shell never links to the consoles');
  const appRoutes = read('app/js/routes.js');
  assert.equal(/'\/admin'|'\/content'/.test(appRoutes), false, 'nor does its router');
  assert.match(appCss, /\.tk-msg/, 'the viewer-side support styles live in the site stylesheet');
});
