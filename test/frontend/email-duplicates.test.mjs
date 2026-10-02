// One address = one account, and what to do about the accounts that already broke that rule.
//
// `users.email` has a UNIQUE index, but it cannot see characters that look like nothing: a pasted
// zero-width space, a soft hyphen or a full-width ＠ make a different string and therefore a second
// account for what everyone sees as one address. These pins keep the three parts of the fix in place:
// normalization at every entry point, the duplicate report + merge in the admin console, and one
// e-mail per address in a broadcast.
// Run: node --test test/frontend/email-duplicates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const norm = read('server/src/email-address.js');
const app = read('server/src/app.js');
const db = read('server/src/db.js');
const dbAdmin = read('server/src/db-admin.js');
const admin = read('server/src/admin.js');
const features = read('server/src/features.js');
const campaigns = read('server/src/campaigns.js');
const usersView = read('admin/js/views/users.js');
const migration = read('server/migrations/012_email_norm.sql');
const index = read('server/src/index.js');

test('one normalizer is the only definition of "the same address"', () => {
  assert.match(norm, /export function normalizeEmail\(/, 'the normalizer exists');
  assert.match(norm, /\.normalize\('NFKC'\)/, 'full-width look-alikes fold');
  assert.match(norm, /INVISIBLE = \/\[\\u00AD\\u034F/, 'invisible characters are listed');
  assert.match(norm, /\.replace\(\/\\s\+\/g, ''\)/, 'a pasted space is an artefact, not a second address');
  assert.match(norm, /export const emailKey/, 'the comparison key');
  assert.match(norm, /export function visibleEmail/, 'the admin report can show why two rows look identical');
  // Every entry point uses it — signup, sign-in, social sign-in, password reset, the admin CLI.
  assert.match(app, /const norm = normalizeEmail\(email\)/, 'signup normalizes before storing/comparing');
  assert.match(app, /db\.users\.byEmailNorm\(normalizeEmail\(email\)\.email\)/, 'sign-in compares normalized addresses');
  assert.match(app, /const norm = normalizeEmail\(claims\.email\)/, 'social sign-in normalizes the provider address');
  assert.match(features, /db\.users\.byEmailNorm\(normalizeEmail\(email\)\.email\)/, 'password reset finds the account either way');
  assert.match(read('server/src/admin-cli.js'), /normalizeEmail\(e\)\.email/, 'grant/revoke admin works with either form');
  // And the database refuses a second account even for two requests racing each other.
  assert.match(db, /byEmailNorm\(norm\)/, 'lookup by normalized address');
  assert.match(db, /INSERT INTO users \(id, email, email_norm, name, password_hash\)/, 'inserts store the normalized address');
  assert.match(migration, /CREATE UNIQUE INDEX uq_users_email_norm ON users \(email_norm\)/, 'the unique index behind it');
  assert.match(index, /renormalizeEmails\(\)/, 'stored addresses are normalized once per boot');
});

test('the admin console reports look-alike duplicates and merges them into one account', () => {
  assert.match(admin, /router\.get\('\/users\/duplicates'/, 'the report endpoint');
  assert.match(admin, /router\.post\('\/users\/merge'/, 'the merge endpoint');
  // The report must be registered before `/users/:id`, or the path is read as a user id.
  assert.ok(admin.indexOf("router.get('/users/duplicates'") < admin.indexOf("router.get('/users/:id'"), 'route order');
  assert.match(admin, /emailVisible: visibleEmail\(u\.email\)/, 'the stored address is shown with markers');
  assert.match(admin, /log\(req, 'user\.merge'/, 'merges are audited');
  assert.match(dbAdmin, /async scanEmailGroups\(/, 'grouping uses the normalized address, not SQL alone');
  assert.match(dbAdmin, /async mergeUsers\(keepId, removeId\)/, 'the merge itself');
  assert.match(dbAdmin, /if \(a !== b\) throw new HttpError\(409, 'not_duplicates'/, 'only real duplicates can be merged');
  // Everything that belongs to a person moves; the extra account is deleted last.
  for (const table of ['profiles', 'auth_identities', 'payments', 'invoices', 'refund_requests', 'comments', 'push_subscriptions', 'push_devices', 'error_log']) {
    assert.ok(dbAdmin.includes(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`), `${table} moves over`);
  }
  assert.match(dbAdmin, /DELETE FROM users WHERE id = \?', \[removeId\]/, 'the duplicate account is removed');
  // Console UI: a notice on Users, a merge dialog, and the list refreshes afterwards.
  assert.match(usersView, /api\.get\('\/users\/duplicates'\)/);
  assert.match(usersView, /api\.post\('\/users\/merge', \{ keepId: keep\.id, removeId: other\.id \}\)/);
  assert.match(usersView, /accounts share one e-mail address/);
  assert.match(usersView, /data-keep="\$\{u\.id\}"/, 'the admin picks which account survives');
});

test('a broadcast sends one message per address (duplicates cannot receive it twice)', () => {
  assert.match(campaigns, /const seen = new Set\(\)/, 'addresses already sent to are remembered');
  assert.match(campaigns, /if \(seen\.has\(address\)\) \{ skipped\+\+; continue; \}/, 'the second account row is skipped');
  assert.match(campaigns, /const address = emailKey\(u\.email\)/, 'compared by normalized address');
});
