// Wiring smoke test for the composition roots — no database required.
//
// Both `createAdminRouter()` and `createApp()` build a large object graph from injected collaborators. A
// missing import (or a collaborator that was renamed) only shows up when the router is actually constructed,
// which previously meant CI with MySQL caught it rather than the local test run. This test constructs both
// with fakes and checks that the promotion routes are really registered, so a mistake like "adminPromoRoutes
// is not defined" fails here first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminRouter } from '../src/admin.js';
import { createApp } from '../src/app.js';
import { createPromos, promosConfigFromEnv } from '../src/promos.js';
import { createBilling, billingConfigFromEnv } from '../src/billing.js';
import { fakeCreditDb } from './helpers/credit-db.js';

/* ---------------------------------------------------------------- fakes */

// Everything the two factories touch while they are being built (routes are only registered, not called).
function fakeDeps({ withPromos = true } = {}) {
  const db = fakeCreditDb();
  const noop = async () => ({});
  const table = new Map();
  Object.assign(db, {
    pool: { getConnection: async () => ({ query: noop, release() {} }) },
    users: { ...db.users, byEmailNorm: async () => null, byEmail: async () => null, list: async () => [], count: async () => 0 },
    profiles: { list: async () => [], byId: async () => null },
    subscriptions: { get: async () => ({ planId: 'free', status: 'active', expiresAt: null }), dueForReminder: async () => [] },
    payments: { listRecent: async () => ({ items: [], total: 0 }), countAll: async () => 0, listForUser: async () => [], openOrder: async () => null, byId: async () => null },
    coupons: { list: async () => ({ items: [], total: 0 }) },
    invoices: { register: async () => [], byId: async () => null },
    refunds: { listPending: async () => [], forPayment: async () => [] },
    refundRequests: { list: async () => ({ items: [], total: 0 }) },
    contacts: { list: async () => ({ items: [], total: 0 }) },
    tickets: { list: async () => ({ items: [], total: 0, counts: {} }) },
    audit: { add: async () => {}, list: async () => ({ items: [], total: 0 }) },
    errors: { add: async () => {}, list: async () => ({ items: [], total: 0 }), prune: async () => {} },
    settings: { all: async () => ({}), set: async () => {} },
    adminUsers: { list: async () => ({ users: [], total: 0 }), get: async () => null },
    adminStats: { dashboard: async () => ({}) },
    catalogStore: { get: async () => ({ catalog: { shows: [], videos: [], upcoming: [], gallery: [] }, version: 1 }) },
    devices: { purge: async () => {} },
    push: { pruneSent: async () => {}, audience: async () => [] },
    campaigns: { prune: async () => {}, list: async () => ({ items: [], total: 0 }) },
    playback: { purge: async () => {} },
    playStats: {},
  });
  const mailer = { provider: 'none', send: async () => ({ sent: false }) };
  const payments = { provider: 'none', keyId: '', createOrder: async () => ({ orderId: 'o', amountPaise: 0, currency: 'INR' }) };
  const catalog = {
    get: async () => ({ catalog: { shows: [], videos: [], upcoming: [], gallery: [] }, version: 1 }),
    exists: () => false, video: async () => null, episodes: () => [],
  };
  const secret = 'x'.repeat(40);
  const promos = withPromos ? createPromos({ db, config: promosConfigFromEnv({}), mailer, siteUrl: 'https://addabaaz.in' }) : null;
  const billing = createBilling({ db, payments, mailer, config: billingConfigFromEnv({ PUBLIC_SITE_URL: 'https://addabaaz.in' }), promos, log: { error() {}, warn() {} } });
  return { db, billing, catalog, payments, mailer, promos, secret, paymentsTable: table };
}

const pathsOf = (router) => router.stack
  .flatMap((layer) => {
    if (layer.route) return [layer.route.path];
    const nested = layer.handle?.stack;
    return nested ? nested.filter((l) => l.route).map((l) => l.route.path) : [];
  });

/* ---------------------------------------------------------------- tests */

test('the admin router builds and registers the promotions API when a promos collaborator is given', () => {
  const { db, billing, catalog, payments, mailer, promos, secret } = fakeDeps();
  const router = createAdminRouter({
    db, billing, catalog, youtubeFeed: null, r2: { configured: false }, payments, mailer, push: null, campaigns: null,
    unsubscribeUrlFor: null, social: null, adminToken: '', secret, sessionHours: 12, uploadDir: '/tmp', mediaDir: '/tmp',
    rate: false, sms: null, promos, siteUrl: 'https://addabaaz.in', env: {},
  });
  const paths = pathsOf(router);
  for (const p of ['/promos', '/credits', '/credits/grant', '/credits/:id/revoke', '/credits/user/:id', '/referrals', '/referrals/:id/void']) {
    assert.ok(paths.includes(p), `the admin router registers ${p}`);
  }
  assert.ok(paths.includes('/tickets'), 'and the support routes it always had');
});

test('without a promos collaborator the section is simply absent (an unconfigured server never breaks)', () => {
  const { db, billing, catalog, payments, mailer, secret } = fakeDeps({ withPromos: false });
  const router = createAdminRouter({
    db, billing, catalog, youtubeFeed: null, r2: { configured: false }, payments, mailer, push: null, campaigns: null,
    unsubscribeUrlFor: null, social: null, adminToken: '', secret, sessionHours: 12, uploadDir: '/tmp', mediaDir: '/tmp',
    rate: false, sms: null, promos: null, siteUrl: 'https://addabaaz.in', env: {},
  });
  const paths = pathsOf(router);
  assert.ok(!paths.includes('/promos'), 'no promotions routes');
  assert.ok(paths.includes('/tickets'), 'the rest of the console still works');
});

test('createApp builds, mounts the viewer promotion routes and shares one promos instance', () => {
  const { db, billing, payments, mailer, promos, secret } = fakeDeps();
  const app = createApp({
    db, jwtSecret: secret, serveStatic: false, payments, sms: { configured: false, provider: 'none', countryCode: '91' },
    mailer, billing, promos, uploadDir: '/tmp', rate: false, catalogPath: '/tmp/none-catalog.json',
  });
  assert.ok(app, 'the app was built');
  const apiPaths = app._router.stack.filter((l) => l.name === 'router').flatMap((l) => pathsOf(l.handle));
  for (const p of ['/promo', '/credits', '/promo/redeem', '/promo/link']) assert.ok(apiPaths.includes(p), `the viewer API exposes ${p}`);
  assert.equal(app.locals.promos, promos, 'the same instance is used by the routes, billing and the jobs');
});

test('the viewer promotion endpoints really answer (public offer; balance and codes need a session)', async () => {
  const { db, payments, mailer, secret, promos, billing } = fakeDeps();
  const app = createApp({
    db, jwtSecret: secret, serveStatic: false, payments, sms: { configured: false, provider: 'none', countryCode: '91' },
    mailer, billing, promos, uploadDir: '/tmp', rate: false, catalogPath: '/tmp/none-catalog.json',
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const offer = await fetch(`${base}/promo`);
    assert.equal(offer.status, 200);
    const body = await offer.json();
    assert.equal(body.offer.enabled, true);
    assert.equal(body.offer.signupPaise, 10000, 'the ₹100 welcome bonus is on');
    assert.equal(body.offer.referralPaise, 10000, 'and so is the ₹100 referral');
    assert.equal(body.viewer, null, 'a signed-out visitor sees only the offer');

    assert.equal((await fetch(`${base}/credits`)).status, 401, 'the balance needs a session');
    assert.equal((await fetch(`${base}/promo/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'AB12CD34' }) })).status, 401, 'so does redeeming a code');
  } finally { server.close(); }
});

test('createApp builds its own promos + billing when they are not injected', () => {
  const { db, payments, mailer, secret } = fakeDeps();
  const app = createApp({
    db, jwtSecret: secret, serveStatic: false, payments, sms: { configured: false, provider: 'none', countryCode: '91' },
    mailer, uploadDir: '/tmp', rate: false, catalogPath: '/tmp/none-catalog.json',
  });
  assert.ok(app.locals.promos, 'a promos service exists');
  assert.equal(app.locals.billing.config.siteUrl, 'https://addabaaz.in', 'billing was created too');
});
