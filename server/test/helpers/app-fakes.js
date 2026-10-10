// In-memory collaborators for tests that want to BUILD the real app (`createApp`, `createAdminRouter`)
// without MySQL. Routes are registered but almost never called, so the fakes only have to answer the few
// reads that happen while the object graph is being assembled.
import { createCatalogStore } from '../../src/catalog.js';

// A real, in-memory `app_settings` table: the maintenance switch and the promo offer are read back through
// it, so tests can flip them the way an operator would (and see the change immediately).
export function settingsStore(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  return {
    map,
    api: {
      async all() { return Object.fromEntries(map); },
      async get(k, dflt = null) { return map.has(k) ? map.get(k) : dflt; },
      async set(k, v) { map.set(k, String(v).slice(0, 255)); },
      async bump(k) { const next = String(Date.now()); map.set(k, next); return next; },
    },
  };
}

/** The whole `db` facade, faked. Returns the object plus handles the tests care about. */
export function fakeDeps({ settings = {} } = {}) {
  const noop = async () => ({});
  const table = new Map();
  const store = settingsStore(settings);
  const db = {
    __settings: store.map,
    pool: { getConnection: async () => ({ query: noop, release() {} }) },
    ping: async () => true,
    settings: store.api,
    users: {
      byId: async () => null, byEmail: async () => null, byEmailNorm: async () => null,
      list: async () => ({ items: [], total: 0 }), count: async () => 0, isAdmin: async () => false,
    },
    profiles: { list: async () => [], byId: async () => null },
    subscriptions: { get: async () => ({ planId: 'free', status: 'active', expiresAt: null }), extend: noop, dueForReminder: async () => [] },
    payments: {
      create: async (p) => ({ ...p, status: 'created' }), byId: async () => null, listRecent: async () => ({ items: [], total: 0 }),
      countAll: async () => 0, listForUser: async () => [], openOrder: async () => null, setBilling: noop, settle: async () => ({ applied: false, invoice: null }),
    },
    coupons: { list: async () => ({ items: [], total: 0 }), get: async () => null },
    invoices: { register: async () => [], byId: async () => null },
    refunds: { listPending: async () => [], forPayment: async () => [] },
    refundRequests: { list: async () => ({ items: [], total: 0 }) },
    contacts: { list: async () => ({ items: [], total: 0 }) },
    tickets: { list: async () => ({ items: [], total: 0, counts: {} }) },
    audit: { add: async () => {}, list: async () => ({ items: [], total: 0 }) },
    errors: { add: async () => {}, list: async () => ({ items: [], total: 0 }), prune: async () => {} },
    adminUsers: { list: async () => ({ users: [], total: 0 }), get: async () => null },
    adminStats: { dashboard: async () => ({}) },
    catalog: {
      async seed() { return true; },
      async version() { return 1; },
      async snapshot() { return { catalog: { shows: [], videos: [], upcoming: [], gallery: [], homePosters: {} }, studio: null }; },
    },
    catalogStore: { get: async () => ({ catalog: { shows: [], videos: [], upcoming: [], gallery: [] }, version: 1 }) },
    uploads: { get: async () => null },
    devices: { purge: async () => {} },
    push: { pruneSent: async () => {}, audience: async () => [] },
    campaigns: { prune: async () => {}, list: async () => ({ items: [], total: 0 }) },
    playback: { purge: async () => {} },
    playStats: {},
    credits: { balance: async () => ({ availablePaise: 0, pendingPaise: 0 }), add: async () => ({}) },
    referrals: { countFor: async () => 0 },
  };
  const mailer = { provider: 'none', send: async () => ({ sent: false }) };
  const payments = { provider: 'none', keyId: '', createOrder: async () => ({ orderId: 'o', amountPaise: 0, currency: 'INR' }) };
  const sms = { configured: false, provider: 'none', countryCode: '91' };
  const secret = 'x'.repeat(40);
  return { db, mailer, payments, sms, secret, table };
}

/** The catalog store the app expects (MySQL-backed in production). */
export function fakeCatalog(db, catalogPath = '/tmp/addabaaz-test-catalog.json') {
  return createCatalogStore({ db, catalogPath, studioPath: '/tmp/addabaaz-test-studio.json' });
}
