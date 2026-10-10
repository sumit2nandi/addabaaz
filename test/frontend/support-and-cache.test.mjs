// The Support page (viewer side + console side) and the "clear client caches" feature.
//
// Server behaviour is covered by server/test/support-tickets.test.js; this file pins the browser side:
// the page is reachable from the app, the console has a queue for it, and a cache purge reaches real
// clients (service worker + page) instead of only bumping a number somewhere.
// Run: node --test test/frontend/support-and-cache.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const routes = read('app/js/routes.js');
const shell = read('app/js/ui/shell.js');
const view = read('app/js/views/support.js');
const adminView = read('admin/js/views/support.js');
const adminMain = read('admin/js/main.js');
const adminCache = read('admin/js/views/cache.js');
const clientVersion = read('app/js/client-version.js');
const sw = read('sw.js');
const appMain = read('app/js/main.js');
const adapters = read('app/js/data/adapters.js');
const user = read('app/js/data/user.js');
const css = read('app/css/styles.css');
const migration = read('server/migrations/015_support_tickets.sql');
const cacheMigration = read('server/migrations/017_client_cache_and_campaign_media.sql');
const extra = read('server/src/admin-extra.js');
const web = read('server/src/web.js');

test('the Support page is reachable everywhere a stuck viewer looks', () => {
  assert.match(routes, /\['\/support', 'support'\]/, 'the router knows /support');
  assert.equal((shell.match(/<a class="menu-item" href="#\/support">/g) || []).length, 2,
    'both signed-in and guest profile menus link to Support after the desktop rail was simplified to mirror mobile');
  assert.match(shell, /support: 'studio'/, 'the nav highlights the right section');
  assert.doesNotMatch(read('app/js/views/account.js'), /#\/support/, 'the decluttered Account page links to it nowhere');
  assert.doesNotMatch(read('app/js/views/account-extra.js'), /supportBtn/, 'the settings list does not duplicate the profile-menu link');
  assert.match(css, /\.tk-msg\.admin \{/, 'the ticket conversation is styled');
  assert.match(css, /\.sup-ref \{/, 'so is the reference');
});

test('raising a ticket works signed out, signed in, and from a receipt e-mail', () => {
  assert.match(view, /export default async function support\(ctx\)/);
  assert.match(view, /export async function openTicket\(ctx, id, email\)/, 'one conversation view is shared');
  assert.match(view, /const CATEGORIES = \[/, 'the viewer picks a category');
  for (const id of ['signin', 'registration', 'payment', 'playback', 'content', 'account', 'other'])
    assert.match(view, new RegExp(`\\['${id}', `), `the ${id} category is offered`);
  assert.match(view, /u\.submitTicket\(\{/, 'the form posts through the data layer');
  assert.match(view, /platform: platform === 'web' \? 'web' : platform, appVersion: CONFIG\.version/, 'tickets carry the platform and version for reproducibility');
  assert.match(view, /write to us once you’re back online/, 'static-only mode explains itself instead of failing');
  assert.match(view, /if \(ctx\.query\.ticket\) openTicket\(ctx, ctx\.query\.ticket/, 'the receipt e-mail deep link opens the ticket');
  assert.match(view, /askLookup\(ctx\)/, 'guests can look a ticket up');
  assert.match(user, /submitTicket\(p\) \{ return \(this\.remote \|\| this\.local\)\.submitTicket\(p\); \}/, 'user.submitTicket exists');
  assert.match(user, /lookupTicket\(reference, email\)/, 'user.lookupTicket exists');
  assert.match(user, /ticket\(id, email\) \{ return \(this\.remote \|\| this\.local\)\.ticket\(id, email\); \}/, 'a signed-out guest can still open their ticket from the receipt e-mail');
  assert.match(adapters, /lookupTicket\(reference, email\)/, 'the adapter calls /support/lookup');
  assert.match(adapters, /\/support\/lookup/, 'the endpoint is wired');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS support_tickets/, 'and the tickets have a table');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS support_ticket_replies/, 'with their conversation');
});

test('the console answers tickets: queue, thread, reply, triage, delete', () => {
  assert.match(adminMain, /\['support', 'Support', 'chat'\]/, 'the admin sidebar has Support');
  assert.match(adminMain, /\/\^support\$\/, \(\) => import\('\.\/views\/support\.js'\)/, 'and a page for it');
  assert.match(adminView, /api\.get\(`\/tickets\?/, 'the queue is loaded from the admin API');
  for (const s of ['awaiting', 'pending', 'resolved', 'closed', 'all']) assert.ok(adminView.includes(`['${s}'`) || adminView.includes(`['${s}',`), `the ${s} tab exists`);
  assert.match(adminView, /api\.post\(`\/tickets\/\$\{t\.id\}\/replies`/, 'replies go to the admin endpoint');
  assert.match(adminView, /r\.emailed \? 'Reply sent and e-mailed to the viewer'/, 'the console says whether the answer was e-mailed');
  assert.match(adminView, /api\.patch\(`\/tickets\/\$\{t\.id\}`/, 'status/priority/note are triaged');
  assert.match(adminView, /api\.del\(`\/tickets\/\$\{t\.id\}`\)/, 'and a ticket can be deleted');
  assert.match(extra, /router\.get\('\/tickets'/, 'GET /admin/tickets exists');
  assert.match(extra, /router\.post\('\/tickets\/:id\/replies'/, 'POST /admin/tickets/:id/replies exists');
  assert.match(extra, /emailTemplates\.adminAnswered/, 'the reply uses the shared e-mail template');
  assert.match(read('server/src/db-extra.js'), /const tickets = \{/, 'db.tickets is a real data layer');
});

test('the client-cache button reaches real clients, not just the database', () => {
  assert.match(adminMain, /\['cache', 'Client cache', 'refresh'\]/, 'the admin sidebar has Client cache');
  assert.match(adminCache, /api\.post\('\/cache\/purge', \{ scope \}\)/, 'the button calls the purge endpoint');
  assert.match(adminCache, /Clear app files/, 'one option clears the app files');
  assert.match(adminCache, /Clear everything/, 'the other clears every cache');
  assert.match(adminCache, /Nobody is signed out/, 'the page states what is NOT affected');
  assert.match(extra, /router\.post\('\/cache\/purge'/, 'POST /admin/cache/purge exists');
  assert.match(extra, /db\.settings\.bump\('client_cache_version'\)/, 'it bumps the generation clients compare');
  assert.match(cacheMigration, /INSERT IGNORE INTO app_settings \(k, v\) VALUES \('client_cache_version', '1'\)/, 'the generation starts at 1');
  assert.match(read('server/src/routes/system.js'), /client-version/, 'GET /client-version publishes it');
  assert.match(read('server/src/routes/system.js'), /no-store/, 'and is never cached');

  // The page: check the version, then drop what was cached.
  assert.match(clientVersion, /api\/v1\/client-version/, 'the client asks for the current generation');
  assert.match(clientVersion, /export async function purgeClientCaches\(scope = 'assets'\)/, 'purging is a first-class action');
  assert.match(clientVersion, /scope === 'all' \? names : names\.filter\(\(n\) => n\.startsWith\('ab-'\)\)/, "'assets' clears this app's caches, 'all' clears the origin's");
  assert.match(clientVersion, /postMessage\(\{ type: 'ab:purge', scope: effective \}\)/, 'the service worker is told too');
  assert.match(clientVersion, /visibilitychange/, 'and the check runs when the app comes back to the foreground');
  assert.match(appMain, /initClientVersionWatch\(\{ apiBase: base === 'off' \? '' : base/, 'the app runs the watch');
  assert.match(appMain, /restart the app to load the latest version/, 'an open tab offers a restart instead of running stale code');

  // The service worker: the same check, on activation and on request, in its own caches.
  assert.match(sw, /async function syncClientVersion\(\)/, 'the worker checks the generation itself');
  assert.match(sw, /self\.addEventListener\('message'/, 'and answers messages from the page');
  assert.match(sw, /msg\.type === 'ab:check-version' \|\| msg\.type === 'ab:purge'/, 'both message types are handled');
  assert.match(sw, /type: 'ab:purged'/, 'pages are told when something was purged');
  assert.match(sw, /url\.pathname === p \|\| url\.pathname\.startsWith\(`\$\{p\}\/`\)/, 'the consoles are never cached by it');
});

test('the two management consoles are served as separate, uncached, framed-off pages', () => {
  assert.match(web, /app\.get\(\['\/content', '\/content\/'\], consoleHeaders/, 'the Content studio has its own entry point');
  assert.match(web, /'Cache-Control': 'no-store'/, 'the consoles are never cached');
  assert.match(web, /frame-ancestors 'none'/, 'and cannot be framed');
  assert.match(sw, /'\/admin', '\/content'/, 'the service worker leaves both alone');
  assert.match(fs.readFileSync(new URL('../../server/src/seo.js', import.meta.url), 'utf8'), /Disallow: \/content/, 'crawlers are told to stay out');
});
