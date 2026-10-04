// SMS sign-in in the admin console: the System status row (server/src/admin.js + smsHealthCheck) and the
// "Send test SMS" diagnostic (POST /admin/sms/test). Pure — no database, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smsHealthCheck } from '../src/sms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the System status row says exactly what is missing', () => {
  // Nothing set, on the live server: this is the row the operator has been looking for.
  const none = smsHealthCheck({ NODE_ENV: 'production' }, 'none');
  assert.equal(none.ok, false);
  assert.equal(none.level, 'warn', 'a missing SMS setup is a warning, so it appears in "Finish setting up"');
  assert.match(none.detail, /MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are not set/);
  assert.match(none.detail, /docs\/MSG91\.md/);

  // Half configured — the most confusing state, and the one that used to be silent.
  const half = smsHealthCheck({ NODE_ENV: 'production', MSG91_AUTH_KEY: 'abc' }, 'none');
  assert.equal(half.ok, false);
  assert.match(half.detail, /only MSG91_AUTH_KEY is set/);
  const other = smsHealthCheck({ NODE_ENV: 'production', MSG91_OTP_TEMPLATE_ID: 'tpl' }, 'none');
  assert.match(other.detail, /only MSG91_OTP_TEMPLATE_ID is set/);

  // Working, and development, states.
  const on = smsHealthCheck({ NODE_ENV: 'production', MSG91_AUTH_KEY: 'abc', MSG91_OTP_TEMPLATE_ID: 'tpl' }, 'msg91');
  assert.equal(on.ok, true);
  assert.equal(on.level, 'ok');
  assert.match(on.detail, /Send test SMS/);
  const dev = smsHealthCheck({ NODE_ENV: 'development' }, 'console');
  assert.equal(dev.level, 'info', 'the development stand-in is not a setup problem');
  assert.match(dev.detail, /printed in the server log/);
  // Values are never echoed back — only which variables exist.
  for (const env of [{ MSG91_AUTH_KEY: 'super-secret', MSG91_OTP_TEMPLATE_ID: 'tpl' }, { NODE_ENV: 'production', MSG91_AUTH_KEY: 'super-secret' }]) {
    assert.doesNotMatch(smsHealthCheck(env, 'none').detail, /super-secret/);
  }
});

test('the checklist carries the SMS row and the server can send a test code', () => {
  const admin = read('server/src/admin.js');
  assert.match(admin, /import \{ smsHealthCheck \} from '\.\/sms\.js';/);
  assert.match(admin, /const c = smsHealthCheck\(env, sms\?\.provider \|\| 'none'\)/, 'the row is built from the live provider');
  assert.match(admin, /item\('sms', 'SMS sign-in \(MSG91\)', c\.ok, c\.detail, c\.level\)/, "and appears in /health as 'sms'");
  // It sits with the other delivery channels, right after e-mail.
  assert.ok(admin.indexOf("item('mail'") < admin.indexOf("item('sms',"), 'the SMS row follows the e-mail row');

  const extra = read('server/src/admin-extra.js');
  assert.match(extra, /router\.post\('\/sms\/test'/, 'POST /admin/sms/test exists');
  assert.match(extra, /if \(sms\?\.provider !== 'msg91'\) throw new HttpError\(503, 'sms_not_configured'/, 'and refuses politely when MSG91 is not configured');
  assert.match(extra, /normalizePhone\(req\.body\?\.to, sms\.countryCode\)/, 'the number is normalised before use');
  assert.match(extra, /generateOtp\(6\)/, 'a real 6-digit code is generated');
  assert.match(extra, /await log\(req, 'sms\.test', maskPhone\(phone\)\)/, 'the audit log gets the masked number only');
  assert.doesNotMatch(extra, /log\(req, 'sms\.test', phone\)/, 'never the full number');
  assert.match(extra, /req\.admin\.via !== 'session'/, 'only a signed-in administrator may send one');
});

test('the dashboard offers the test and keeps the row visible', () => {
  const view = read('admin/js/views/dashboard.js');
  assert.match(view, /const smsConfigured = health\.checks\.find\(\(c\) => c\.id === 'sms'\)\?\.ok;/, 'the button follows the check');
  assert.match(view, /id="smsTest">Send test SMS…</, 'and lives next to the e-mail test');
  assert.match(view, /api\.post\('\/sms\/test', \{ to \}\)/, 'it posts the number the operator types');
  assert.match(view, /toast\(`Test SMS sent to \$\{r\.to\}`\)/, 'and reports the masked number back');
  // The row itself is rendered for every check, so a not-yet-configured SMS shows up in the list.
  assert.match(view, /health\.checks\.map\(\(c\) => html`<li class="\$\{c\.level\}">/, 'every check is listed, ok or not');
});
