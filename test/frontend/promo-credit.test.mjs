// Promotional credit & referrals — source pins for the browser and console sides.
//
// The rules live in server/src/promos.js and are tested in server/test/promos.test.js (no database needed).
// This file pins the wiring people actually touch: the welcome/referral offer being configurable, the invite
// code travelling with sign-up, the "use my credit" box at checkout, the Account → Refer & earn card and the
// Admin → Promotions console.
// Run: node --test test/frontend/promo-credit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const exists = (p) => fs.existsSync(new URL('../../' + p, import.meta.url));
const plans = read('app/js/views/plans.js');
const account = read('app/js/views/account-extra.js');
const auth = read('app/js/views/auth.js');
const user = read('app/js/data/user.js');
const adapters = read('app/js/data/adapters.js');
const adminMain = read('admin/js/main.js');
const adminPromos = read('admin/js/views/promos.js');
const promo = read('server/src/promos.js');
const billing = read('server/src/billing.js');
const env = read('.env.example');

test('the offer is ₹100 for a new account and ₹100 for each side of a referral, all configurable', () => {
  assert.match(promo, /signupPaise: int\(env\.PROMO_SIGNUP_CREDIT_INR, 100\) \* 100/, 'the welcome bonus defaults to ₹100');
  assert.match(promo, /referralPaise: int\(env\.PROMO_REFERRAL_CREDIT_INR, 100\) \* 100/, 'the referral bonus defaults to ₹100 each');
  assert.match(promo, /hold: \['signup', 'verified', 'payment'\]/, 'when the inviter is paid is a rule, not a constant');
  assert.match(promo, /PROMO_CREDIT_EXPIRY_DAYS, 0/, 'credit never expires unless asked');
  assert.match(promo, /PROMO_MAX_REFERRALS_PER_USER, 50/, 'and one account can only earn so much');
  for (const key of ['PROMO_ENABLED', 'PROMO_SIGNUP_CREDIT_INR', 'PROMO_REFERRAL_CREDIT_INR', 'PROMO_REFERRAL_HOLD']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), `${key} is documented in .env.example`);
  }
  assert.ok(exists('docs/PROMOS.md'), 'the operator guide exists');
  assert.ok(exists('server/migrations/018_credits_referrals.sql'), 'the migration exists');
  const sql = read('server/migrations/018_credits_referrals.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_credit/, 'the credit ledger table');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS referrals/, 'the referrals table');
});

test('an invite link carries the code through sign-up, whichever method is used', () => {
  assert.match(auth, /const ref = String\(ctx\.query\.ref \|\| ''\)\.toUpperCase\(\)/, 'the sign-up page reads ?ref=');
  assert.match(auth, /Invite code <b>\$\{ref\}<\/b> will be applied/, 'and tells the viewer it will be applied');
  assert.match(auth, /body\.ref = ref/, 'the email sign-up sends it');
  assert.match(auth, /u\.requestOtp\(`\$\{country\}\$\{phone\.replace\(\/\\D\/g, ''\)\}`, ref\)/, 'the SMS flow sends it when the code is requested');
  assert.match(auth, /u\.signInOtp\(`\$\{country\}\$\{phoneSent\.replace\(\/\\D\/g, ''\)\}`, code, name \|\| undefined, ref\)/, 'and again when the code is verified');
  assert.match(adapters, /requestOtp\(phone, ref = ''\)/, 'the adapter passes it on');
  assert.match(auth, /u\.signInSocial\(provider, cred, ref\)/, 'Google/Facebook/Apple sign-up carries it too');
  assert.match(read('server/src/routes/auth.js'), /bonus = await promos\.onSignup\(\{ user: fresh, code: opts\.ref \}\)/, 'and the server applies it for a new social account');
  assert.match(read('server/src/routes/auth.js'), /ref = '' \} = req\.body/, 'the server accepts it at sign-up');
  assert.match(read('server/src/routes/otp.js'), /code: req\.body\?\.ref/, 'and at phone verification');
  assert.match(promo, /export const referralLink = \(siteUrl, code\) =>/, 'the share link is built in one place');
});

test('checkout shows the balance and only spends it when the viewer asks', () => {
  assert.match(plans, /const c = await u\.credits\(\)/, 'the plans page reads the viewer’s credit');
  assert.match(plans, /You have <b>\$\{inr\(creditPaise\)\}<\/b> of ADDABAAZ credit/, 'and shows it');
  assert.match(plans, /name="usec"/, 'the checkout dialog has a use-my-credit box');
  assert.match(plans, /Use my \$\{inr\(creditPaise\)\} ADDABAAZ credit on this order/, 'labelled with the amount');
  assert.match(plans, /wantsCredit = useCredit && creditPaise > 0/, 'ticked by default, but only when there is credit');
  assert.match(plans, /Activate for free/, 'a fully covered plan is free, not “Pay ₹0”');
  assert.ok(read('server/src/routes/billing.js').includes('useCredit: req.body?.useCredit === true'), 'the server spends credit only when asked');
  assert.match(adapters, /\.\.\.\(useCredit \? \{ useCredit: true \} : \{\}\)/, 'the adapter forwards the flag');
  assert.match(billing, /const creditPaise = useCredit && q\.finalPaise > 0 \? await creditFor/, 'billing applies it');
  assert.match(billing, /const provider = creditPaise > 0 \? 'credit' : 'coupon'/, 'and grants the plan with no gateway order');
  assert.match(read('server/src/routes/billing.js'), /useCredit: req\.body\?\.useCredit === true/, 'the checkout route is opt-in');
});

test('Account → Refer & earn shows the code, the balance and the people who joined', () => {
  assert.match(account, /wireReferral\(root\)/, 'the account page wires the section');
  assert.match(account, /<div id="referSlot"><\/div>/, 'and has a place for it');
  assert.match(account, /Refer &amp; earn/, 'named plainly');
  assert.match(account, /Your invite code/, 'the code is shown');
  assert.match(account, /data-copy="\$\{code\}"/, 'with a copy button');
  assert.match(account, /Have a friend’s invite code\?/, 'and a box to add someone else’s code');
  assert.match(account, /u\.redeemInvite\(code\)/, 'which reaches the API');
  assert.match(account, /held by an order that was not completed/, 'credit held by an unfinished order is explained');
  assert.match(user, /promos\(\) \{ return \(this\.remote \|\| this\.local\)\.promo\(\); \}/, 'user.promos');
  assert.match(user, /credits\(\) \{ return \(this\.remote \|\| this\.local\)\.credits\(\); \}/, 'user.credits');
  assert.match(adapters, /promo\(\) \{ return this\.api\.get\('\/promo'\); \}/, 'GET /promo');
  assert.match(adapters, /credits\(\) \{ return this\.api\.get\('\/credits'\); \}/, 'GET /credits');
  assert.match(adapters, /redeemInvite\(code\) \{ return this\.api\.post\('\/promo\/redeem'/, 'POST /promo/redeem');
  assert.match(adapters, /async credits\(\) \{ throw new ApiError\(400, 'Credit and invites need a connection/, 'local mode says so instead of pretending');
});

test('Admin → Promotions runs the offer, the ledger and the referral list', () => {
  assert.match(adminMain, /\['promos', 'Promotions', 'gift'\]/, 'it has a sidebar entry');
  assert.ok(adminMain.includes("[/^promos$/, () => import('./views/promos.js')]"), 'and a route');
  assert.ok(exists('admin/js/views/promos.js'), 'the page module exists');
  assert.match(adminPromos, /api\.patch\('\/promos'/, 'saving the offer');
  assert.match(adminPromos, /api\.post\('\/credits\/grant'/, 'goodwill credit');
  assert.match(adminPromos, /api\.post\(`\/credits\/\$\{b\.dataset\.revoke\}\/revoke`/, 'removing an untouched grant');
  assert.match(adminPromos, /api\.post\(`\/referrals\/\$\{b\.dataset\.void\}\/void`/, 'cancelling a referral');
  assert.match(adminPromos, /Credit expires after \(days, 0 = never\)/, 'the expiry is editable, not hard-coded');
  const admin = read('server/src/admin.js');
  assert.match(admin, /if \(promos\) adminPromoRoutes\(\{ router, db, promos, log \}\)/, 'the API is mounted only when promotions exist');
  assert.match(read('server/src/app.js'), /registerPromoRoutes\(api, \{ db, promos, userFromRequest, rate \}\)/, 'the viewer routes are public-safe');
});

test('promotions are cleaned up by the background job and never break an unconfigured server', () => {
  assert.match(read('server/src/jobs.js'), /out\.promos = await promos\.runMaintenance\(\)/, 'expiry + abandoned-order sweeps');
  assert.match(promo, /export function createPromos\(\{ db, config = promosConfigFromEnv\(\), mailer = null, siteUrl = '', log = console \}\)/, 'the service takes its dependencies');
  assert.match(promo, /if \(!s\.enabled\) \{ out\.skipped = 'disabled'; return out; \}/, 'a disabled offer grants nothing');
  assert.match(promo, /catch \(e\) \{\s*log\.error\?\.\('\[promos\] signup bonus failed:'/, 'and a failure never stops a sign-up');
  assert.match(promo, /if \(\(await db\.referrals\.countForInviter\(inviter\.id\)\) >= s\.maxReferrals\)/, 'the referral cap is enforced');
  assert.match(promo, />= s\.maxReferrals\) \{ out\.skipped = 'inviter_limit'/, 'and visible as a reason');
  assert.match(billing, /promos && payment\.creditAppliedPaise > 0/, 'a refund returns the credit that bought the plan');
  assert.match(read('server/src/features.js'), /promos\.qualify\(u, \{ reason: 'verified' \}\)/, 'confirming an e-mail releases a held reward');
});

test('the plan notice reads properly on a phone', () => {
  const css = read('app/css/styles.css');
  const rule = css.match(/^\.notice \{[^}]*\}$/m)?.[0] || '';
  assert.match(rule, /align-items: flex-start/, 'the icon sits with the first line instead of the middle of a wrapped block');
  assert.match(rule, /overflow-wrap: anywhere/, 'long words cannot push the box out of shape');
  assert.match(css, /\.notice > svg, \.notice > \.i \{ flex: 0 0 auto;/, 'the icon never shrinks to a sliver');
  assert.match(css, /@media \(max-width: 520px\) \{ \.notice \{ font-size: 13\.5px/, 'slightly smaller type on phones');
  assert.match(css, /\.notice b \{ font-weight: 700; white-space: nowrap; \}/, 'the date stays on one line');
});
