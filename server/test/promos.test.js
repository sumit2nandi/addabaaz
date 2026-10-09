// Promotional credit and referrals: the welcome bonus, referral rewards (both sides), holds and release
// rules, spending at checkout, expiry/return of abandoned orders and the admin controls.
//
// Everything here runs against an in-memory fake of the data layer, so no MySQL is needed: the fake behaves
// like db-extra.js (append-only ledger, one row per movement, remaining_paise decreasing on a spend).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPromos, promosConfigFromEnv, allocateFifo, newReferralCode, normalizeReferralCode, isValidReferralCode, referralLink } from '../src/promos.js';
import { fakeCreditDb } from './helpers/credit-db.js';
import { extraDb } from '../src/db-extra.js';

const HOUR = 3600_000;
// Every test uses its own database (and its own promotion service) so nothing leaks between them.
const fakeDb = fakeCreditDb;

const sent = [];
const mailer = { provider: 'smtp', async send(m) { sent.push(m); return { sent: true }; } };
// `build(db, { config: { …overrides } })` — environment defaults with a few values changed.
const build = (db, { config = {}, ...extra } = {}) => createPromos({ db, config: { ...promosConfigFromEnv({}), ...config }, mailer, siteUrl: 'https://addabaaz.in', ...extra });

/* ---------------------------------------------------------------- codes and helpers */

test('referral codes are readable, validated and shareable', () => {
  const code = newReferralCode();
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.ok(!/[IO01]/.test(code), 'ambiguous letters are never used');
  assert.equal(normalizeReferralCode(' add-AB12 '), 'ADDAB12');       // decoration is stripped
  assert.equal(normalizeReferralCode('https://addabaaz.in/#/signup?ref=ab12cd'), 'HTTPSADDABAAZINREFAB12CD'.slice(0, 12));
  assert.equal(normalizeReferralCode('abcd'), 'ABCD');
  assert.ok(isValidReferralCode('AB12CD'));
  assert.ok(!isValidReferralCode('AB'), 'too short');
  assert.equal(referralLink('https://addabaaz.in/', 'AB12CD'), 'https://addabaaz.in/#/signup?ref=AB12CD');
  assert.equal(referralLink('', 'AB12CD'), '');
});

test('allocation spends the grant that expires first', () => {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString(), later = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const grants = [
    { id: 'b', remainingPaise: 5000, status: 'available', expiresAt: later, createdAt: new Date().toISOString() },
    { id: 'a', remainingPaise: 5000, status: 'available', expiresAt: soon, createdAt: new Date().toISOString() },
    { id: 'x', remainingPaise: 5000, status: 'pending', expiresAt: null, createdAt: new Date().toISOString() },
    { id: 'e', remainingPaise: 5000, status: 'available', expiresAt: new Date(Date.now() - HOUR).toISOString(), createdAt: new Date().toISOString() },
  ];
  const r = allocateFifo(grants, 6000);
  assert.deepEqual(r.allocations, [{ id: 'a', take: 5000 }, { id: 'b', take: 1000 }]);
  assert.equal(r.appliedPaise, 6000);
  assert.equal(allocateFifo(grants, 99999).appliedPaise, 10000, 'never more than the spendable balance');
});

/* ---------------------------------------------------------------- the welcome bonus */

test('a new account gets the welcome bonus once — ₹100 by default', async () => {
  const db = fakeDb(); const promos = build(db);
  const u = db.addUser('u1');
  const first = await promos.onSignup({ user: u });
  assert.equal(first.welcomePaise, 10000);
  assert.equal(await db.credits.balance('u1'), 10000);
  const again = await promos.onSignup({ user: u });
  assert.equal(again.welcomePaise, 0, 'signing up twice never pays twice');
  assert.equal(await db.credits.balance('u1'), 10000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /1|ADDABAAZ/);
});

test('the offer can be switched off, shrunk or extended without touching code', async () => {
  const db = fakeDb();
  const off = build(db, { config: { enabled: false, signupPaise: 10000 } });
  assert.equal((await off.onSignup({ user: db.addUser('a') })).welcomePaise, 0);
  assert.equal(await db.credits.balance('a'), 0);

  const db3 = fakeDb(); const p3 = build(db3, { config: { signupPaise: 2500 } });
  assert.equal((await p3.onSignup({ user: db3.addUser('b') })).welcomePaise, 2500, 'the amount is configurable');

  // …and an administrator can change it at runtime, with no redeploy.
  const db4 = fakeDb(); const p4 = build(db4);
  assert.equal((await p4.updateSettings({ signupPaise: 5100 })).signupPaise, 5100);
  assert.equal((await p4.onSignup({ user: db4.addUser('c') })).welcomePaise, 5100);
  await assert.rejects(() => p4.updateSettings({ signupPaise: -5 }), /between 0 and/);
  await assert.rejects(() => p4.updateSettings({ hold: 'whenever' }), /signup, verified or payment/);
});

/* ---------------------------------------------------------------- referrals */

test('a referral pays the invited friend at once and holds the inviter’s reward until they qualify', async () => {
  const db = fakeDb(); const promos = build(db);
  const inviter = db.addUser('inv', { name: 'Asha' }); await promos.ensureCode(inviter);
  const friend = db.addUser('fr', { name: 'Ravi' });
  const out = await promos.onSignup({ user: friend, code: inviter.referralCode });
  assert.equal(out.welcomePaise, 10000, 'the new account keeps the welcome bonus');
  assert.equal(out.inviteePaise, 10000, 'the referred friend is paid immediately');
  assert.equal(out.inviterPaise, 10000, 'the inviter is rewarded…');
  assert.equal(out.hold, 'verified', '…but on hold until the friend confirms their account');
  assert.equal(await db.credits.balance('fr'), 20000, 'friend: welcome + invite = ₹200');
  assert.equal(await db.credits.balance('inv'), 0);
  assert.equal((await db.credits.summary('inv')).pendingPaise, 10000);
  assert.equal((await db.referrals.byInvitee('fr')).status, 'pending');

  const done = await promos.qualify(friend, { reason: 'verified' });
  assert.equal(done.releasedPaise, 10000);
  assert.equal(await db.credits.balance('inv'), 10000);
  assert.equal((await db.referrals.byInvitee('fr')).status, 'completed');
  assert.match(sent.at(-1).text, /Asha|reward|bonus/);
});

test('the hold rule is configurable: signup pays instantly, payment waits for a purchase', async () => {
  const dbA = fakeDb(); const a = build(dbA, { config: { hold: 'signup' } });
  const invA = dbA.addUser('i1'); await a.ensureCode(invA);
  await a.onSignup({ user: dbA.addUser('f1'), code: invA.referralCode });
  assert.equal(await dbA.credits.balance('i1'), 10000, 'hold=signup pays the inviter immediately');
  assert.equal((await dbA.referrals.byInvitee('f1')).status, 'completed');

  const dbB = fakeDb(); const b = build(dbB, { config: { hold: 'payment' } });
  const invB = dbB.addUser('i2'); await b.ensureCode(invB);
  const friend = dbB.addUser('f2');
  await b.onSignup({ user: friend, code: invB.referralCode });
  await b.qualify(friend, { reason: 'verified' });
  assert.equal(await dbB.credits.balance('i2'), 0, 'verifying is not enough when the hold is "payment"');
  await b.qualify(friend, { reason: 'payment' });
  assert.equal(await dbB.credits.balance('i2'), 10000, 'the first payment releases it');
});

test('referrals cannot be farmed: no self-referral, no double referral, no unknown code, capped per inviter', async () => {
  const db = fakeDb(); const promos = build(db, { config: { maxReferrals: 1 } });
  const inv = db.addUser('inv'); const code = await promos.ensureCode(inv);

  assert.equal((await promos.onSignup({ user: inv, code })).skipped, 'self');
  assert.equal((await promos.onSignup({ user: db.addUser('x'), code: 'ZZZZZZZZ' })).skipped, 'unknown_code');
  assert.equal((await promos.onSignup({ user: db.addUser('a'), code })).inviteePaise, 10000);
  assert.equal((await promos.onSignup({ user: db.addUser('b'), code })).skipped, 'inviter_limit', 'the cap stops bonus farming');

  const db2 = fakeDb(); const p2 = build(db2);
  const inv2 = db2.addUser('i'); const c2 = await p2.ensureCode(inv2);
  const f = db2.addUser('f');
  await p2.onSignup({ user: f, code: c2 });
  assert.equal((await p2.onSignup({ user: f, code: c2 })).skipped, 'already_referred');
});

test('an invite code can still be added for a few days after signing up', async () => {
  const db = fakeDb(); const promos = build(db, { config: { redeemDays: 7 } });
  const inv = db.addUser('inv'); const code = await promos.ensureCode(inv);
  const late = db.addUser('late', { createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  assert.equal(await promos.canRedeem(late), true);
  const out = await promos.redeem({ user: late, code });
  assert.equal(out.inviteePaise, 10000);
  assert.equal(await db.credits.balance('late'), 10000);
  await assert.rejects(() => promos.redeem({ user: late, code }), /already invited/);

  const tooLate = db.addUser('old', { createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  assert.equal(await promos.canRedeem(tooLate), false);
  await assert.rejects(() => promos.redeem({ user: tooLate, code }), /couldn’t find|already|days of signing up/);
  await assert.rejects(() => promos.redeem({ user: tooLate, code: 'nope' }), /invite code/i);
});

test('with the promotion switched off nothing is granted and nothing is spendable', async () => {
  const db = fakeDb(); const promos = build(db, { config: { enabled: false } });
  const inv = db.addUser('inv'); await db.users.setReferralCode('inv', 'ABCD1234');
  const out = await promos.onSignup({ user: db.addUser('f'), code: 'ABCD1234' });
  assert.equal(out.skipped, 'disabled');
  assert.equal(await db.credits.balance('f'), 0);
  assert.equal((await promos.summary(db.addUser('g'))).creditPaise, 0);
  await assert.rejects(() => promos.redeem({ user: db.addUser('h'), code: 'ABCD1234' }), /no referral offer/);
  assert.equal(await promos.quoteTax('f', 9900), 0, 'credit quotes are 0 while the offer is off');
});

/* ---------------------------------------------------------------- spending */

test('credit is spent at checkout, held until the payment is settled, and returned if it is abandoned', async () => {
  const db = fakeDb(); const promos = build(db);
  const u = db.addUser('u'); await promos.onSignup({ user: u });
  assert.equal(await promos.quoteTax('u', 9900), 9900, 'a ₹99 plan is fully covered by ₹100 credit');
  assert.equal(await promos.quoteTax('u', 10050), 9950, 'one rupee is kept back so the gateway order is valid');
  assert.equal(await promos.quoteTax('u', 500), 500);

  const held = await promos.spendForOrder({ userId: 'u', amountPaise: 9900, paymentId: 'p1' });
  assert.equal(held.appliedPaise, 9900);
  assert.equal(await db.credits.balance('u'), 100, 'held credit is no longer spendable');
  assert.equal((await db.credits.pendingSpend('payment', 'p1')).amountPaise, 9900);

  assert.equal(await promos.releaseOrder('p1'), 9900, 'an abandoned order gives the credit back');
  assert.equal(await db.credits.balance('u'), 10000);
  const ledger = (await db.credits.ledger('u')).items;
  assert.equal(ledger[0].kind, 'refund');
  assert.equal(ledger.find((r) => r.kind === 'spend').status, 'void');

  const paid = await promos.spendForOrder({ userId: 'u', amountPaise: 9900, paymentId: 'p2' });
  assert.ok(paid.spendId);
  assert.equal(await promos.finaliseOrder('p2'), 1, 'settling the payment makes the spend final');
  assert.equal(await db.credits.balance('u'), 100);
  assert.equal(await promos.releaseOrder('p2'), 0, 'a paid order can never be un-spent');
});

test('maintenance expires stale credit and returns what abandoned orders were holding', async () => {
  const db = fakeDb(); const promos = build(db);
  const u = db.addUser('u'); await promos.onSignup({ user: u });
  const old = await db.credits.add({ userId: 'u', kind: 'admin', amountPaise: 5000, expiresAt: new Date(Date.now() - HOUR).toISOString() });
  assert.equal(await db.credits.balance('u'), 10000, 'expired credit is not spendable');
  const spend = await promos.spendForOrder({ userId: 'u', amountPaise: 4000, paymentId: 'gone' });
  assert.ok(spend.appliedPaise);
  db.state.credit.find((c) => c.id === spend.spendId).createdAt = new Date(Date.now() - 30 * HOUR).toISOString();

  const out = await promos.runMaintenance();
  assert.equal(out.expiredPaise, 5000);
  assert.equal(out.staleOrders, 1);
  assert.equal(out.returnedPaise, 4000);
  assert.equal(await db.credits.balance('u'), 10000, 'the whole bonus is back in the wallet');
  assert.equal(old.status, 'expired');
});

test('a refund hands the credit spent on that order back to the buyer', async () => {
  const db = fakeDb(); const promos = build(db);
  await promos.onSignup({ user: db.addUser('u') });
  await promos.spendForOrder({ userId: 'u', amountPaise: 9900, paymentId: 'p1' });
  await promos.finaliseOrder('p1');
  assert.equal(await db.credits.balance('u'), 100);
  await promos.refundOrderCredit({ userId: 'u', paymentId: 'p1', amountPaise: 9900 });
  assert.equal(await db.credits.balance('u'), 10000);
});

/* ---------------------------------------------------------------- viewer + admin views */

test('the viewer’s summary carries the balance, the ledger, their code and the people they invited', async () => {
  const db = fakeDb(); const promos = build(db);
  const inviter = db.addUser('inv', { name: 'Asha' });
  await promos.onSignup({ user: inviter });
  const friend = db.addUser('fr', { name: 'Ravi', email: 'ravi@example.com' });
  await promos.onSignup({ user: friend, code: await promos.ensureCode(inviter) });
  const view = await promos.summary(await db.users.byId('inv'));
  assert.equal(view.creditPaise, 10000);
  assert.equal(view.pendingPaise, 10000);
  assert.equal(view.code, inviter.referralCode);
  assert.equal(view.link, `https://addabaaz.in/#/signup?ref=${inviter.referralCode}`);
  assert.equal(view.invited.total, 1);
  assert.equal(view.invited.activeTotal, 1);
  assert.equal(view.invited.completed, 0);
  assert.equal(view.invited.pending, 1);
  assert.equal(view.invited.earnedPaise, 0);
  assert.equal(view.invited.items[0].name, 'Ravi');
  assert.equal(view.invited.items[0].email, 'ra••@example.com', 'the invited friend’s address is masked');
  assert.equal(view.referredBy, null);
  assert.ok(view.ledger.some((r) => r.label === 'Welcome bonus'));
  assert.equal(view.offer.referralPaise, 10000);

  await promos.qualify(friend, { reason: 'verified' });
  const completedView = await promos.summary(await db.users.byId('inv'));
  assert.equal(completedView.invited.total, 1);
  assert.equal(completedView.invited.activeTotal, 1);
  assert.equal(completedView.invited.completed, 1);
  assert.equal(completedView.invited.pending, 0);
  assert.equal(completedView.invited.earnedPaise, 10000, 'all-time earnings count completed inviter rewards');
});

test('the inviter query returns all-time referral counts and earned credit separately from the current page', async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('LEFT JOIN users u ON u.id = r.invitee_id')) return [{
      id: 'ref-1', inviter_id: 'inv', invitee_id: 'friend', code: 'AB12CD34', status: 'completed', bonus_paise: 10000,
      created_at: new Date('2026-01-01T00:00:00Z'), completed_at: new Date('2026-01-02T00:00:00Z'), invitee_email: 'friend@example.com', invitee_name: 'Friend',
    }];
    if (sql.includes('SELECT COUNT(*) AS total')) return [{ total: '3', active_total: '2', completed: '1', pending: '1', earned_paise: '10000' }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const db = extraDb({ q, tx: async (fn) => fn({ query: q }), iso: (value) => value ? new Date(value).toISOString() : null });
  const page = await db.referrals.forInviter('inv', { limit: 1, offset: 1 });
  assert.equal(page.total, 3, 'the existing total still includes cancelled rows for admin consumers');
  assert.equal(page.activeTotal, 2);
  assert.equal(page.completed, 1);
  assert.equal(page.pending, 1);
  assert.equal(page.earnedPaise, 10000);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].inviteeName, 'Friend');
  assert.equal(calls.length, 2, 'one paged activity query and one aggregate query run together');
  assert.match(calls[0].sql, /LIMIT \? OFFSET \?/);
  assert.match(calls[1].sql, /SUM\(CASE WHEN status <> 'void' THEN 1 ELSE 0 END\) AS active_total/, 'the viewer can count active invites without changing the existing total');
});

test('administrators can see the numbers, grant goodwill credit and revoke an untouched grant', async () => {
  const db = fakeDb(); const promos = build(db);
  const u = db.addUser('u'); await promos.onSignup({ user: u });
  const grant = await promos.grantManual({ userId: 'u', amountPaise: 50000, reason: 'Sorry about the outage', actor: 'admin@addabaaz.in' });
  assert.equal(grant.amountPaise, 50000);
  assert.equal(await db.credits.balance('u'), 60000);
  assert.equal(sent.at(-1).to, 'u@example.com');
  await assert.rejects(() => promos.grantManual({ userId: 'u', amountPaise: 0 }), /how much credit/);
  await assert.rejects(() => promos.grantManual({ userId: 'u', amountPaise: 5000000 }), /₹10,000/);

  assert.equal(await db.credits.revoke(grant.id), 50000);
  assert.equal(await db.credits.balance('u'), 10000);
  assert.equal(await db.credits.revoke(grant.id), 0, 'revoking twice does nothing');

  const overview = await promos.overview();
  assert.equal(overview.config.signupPaise, 10000);
  assert.equal(overview.config.defaults.signupPaise, 10000);
  assert.ok(overview.stats.accounts >= 1);
});

test('credit never leaves by e-mail for phone-only accounts', async () => {
  const db = fakeDb(); const promos = build(db);
  sent.length = 0;
  const phone = db.addUser('ph', { email: '9812345678@phone.addabaaz.in' });
  await promos.onSignup({ user: phone });
  assert.equal(sent.length, 0, 'a placeholder address is never mailed');
});

// Sign-up awaits the bonuses, so a promo mail must never wait on the mail transport: a hanging SMTP server
// would otherwise freeze the sign-up screen exactly like the verification mail used to. The send is dispatched
// (handed to the transport) but not awaited; the race guard fails fast instead of hanging if it ever is again.
test('promo mails are dispatched without waiting for SMTP — a hanging provider cannot stall a sign-up', async () => {
  const db = fakeDb();
  const hanging = { provider: 'smtp', send: () => new Promise(() => {}) };   // a transport that never answers
  const promos = createPromos({ db, config: promosConfigFromEnv({}), mailer: hanging, siteUrl: 'https://addabaaz.in' });
  const u = db.addUser('slow');
  let timer;
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('onSignup waited for the mail transport')), 1000); });
  timer.unref?.();
  try {
    const out = await Promise.race([promos.onSignup({ user: u }), guard]);
    assert.equal(out.welcomePaise, 10000, 'the welcome bonus is granted');
  } finally { clearTimeout(timer); }
  assert.equal(await db.credits.balance('slow'), 10000, 'the credit is in the account even though the mail never finished');
});

test('config comes from the environment and defaults to the ₹100 offer', () => {
  const c = promosConfigFromEnv({});
  assert.deepEqual([c.signupPaise, c.referralPaise, c.hold], [10000, 10000, 'verified']);
  const custom = promosConfigFromEnv({ PROMO_SIGNUP_CREDIT_INR: '50', PROMO_REFERRAL_CREDIT_INR: '250', PROMO_REFERRAL_HOLD: 'payment', PROMO_ENABLED: 'false', PROMO_CREDIT_EXPIRY_DAYS: '90' });
  assert.deepEqual([custom.signupPaise, custom.referralPaise, custom.hold, custom.enabled, custom.expiryDays], [5000, 25000, 'payment', false, 90]);
  assert.equal(promosConfigFromEnv({ PROMO_REFERRAL_HOLD: 'nonsense' }).hold, 'verified', 'an unknown rule falls back to the safe default');
});

test('pending credit lookup never mixes a plain column with SUM (MySQL ONLY_FULL_GROUP_BY rejects it)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/db-extra.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /SELECT id, COALESCE\(SUM\(-amount_paise\)/);
});
