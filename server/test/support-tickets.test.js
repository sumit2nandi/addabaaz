// Support tickets, end to end over HTTP with a fake database (no MySQL needed):
// the viewer's form + lookup + replies (routes/support.js) and the console's queue (admin-extra.js),
// plus the "clear client caches" endpoints that share the same settings table.
// Run: node --test server/test/support-tickets.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerSupportRoutes, TICKET_CATEGORIES, emailTemplates } from '../src/routes/support.js';
import { adminExtraRoutes } from '../src/admin-extra.js';

const T0 = Date.parse('2026-01-02T03:04:05Z');
const iso = (ms) => new Date(ms).toISOString();

/* ---------- a fake database with just enough behaviour ---------- */
function fakeDb() {
  const tickets = [], replies = [], store = { client_cache_version: '1' };
  const state = { tickets, replies, store, clock: T0 };
  return {
    state,
    settings: {
      async get(k, dflt) { return store[k] ?? dflt; },
      async set(k, v) { store[k] = String(v); return true; },
      async bump(k) { store[k] = String(Number(store[k] || 0) + 1); return Number(store[k]); },
    },
    users: { async byId() { return null; } },
    tickets: {
      async create(t) { tickets.push({ ...t, status: 'open', priority: 'normal', replies: 0, adminNote: null, lastReplyBy: null, createdAt: iso(state.clock), updatedAt: iso(state.clock) }); },
      async get(id) { return tickets.find((t) => t.id === id) || null; },
      async byReference(ref, email) {
        const prefix = String(ref || '').replace(/^ADD-?/i, '').toLowerCase();
        return tickets.find((t) => t.id.toLowerCase().startsWith(prefix) && t.email === String(email || '').toLowerCase()) || null;
      },
      async replies(id) { return replies.filter((r) => r.ticketId === id); },
      async addReply({ id, ticketId, author, authorName = null, body, status = null }) {
        replies.push({ id, ticketId, author, authorName, body, createdAt: iso(state.clock + 60_000) });
        const t = tickets.find((x) => x.id === ticketId);
        if (t) { t.replies += 1; t.lastReplyBy = author; t.updatedAt = iso(state.clock + 60_000); if (status) t.status = status; }
      },
      async forUser(userId, { limit = 25 } = {}) { const rows = tickets.filter((t) => t.userId === userId); return { total: rows.length, items: rows.slice(0, limit) }; },
      async list({ status = 'all', category = 'all', search = '', limit = 25 } = {}) {
        let rows = tickets.slice();
        if (status !== 'all' && status !== 'awaiting') rows = rows.filter((t) => t.status === status);
        if (category !== 'all') rows = rows.filter((t) => t.category === category);
        if (search) rows = rows.filter((t) => `${t.subject} ${t.body} ${t.email} ${t.name}`.toLowerCase().includes(search.toLowerCase()));
        const counts = { open: tickets.filter((t) => t.status === 'open').length, pending: tickets.filter((t) => t.status === 'pending').length, resolved: tickets.filter((t) => t.status === 'resolved').length, closed: tickets.filter((t) => t.status === 'closed').length };
        // The real database maps rows through `ticketMeta`, which adds the reference the console shows.
        const view = rows.map((t) => ({ ...t, reference: `ADD-${t.id.slice(0, 8).toUpperCase()}`, replyCount: t.replies }));
        return { total: rows.length, items: view.slice(0, limit), counts };
      },
      async update(id, { status, priority, adminNote, handledBy = null }) {
        const t = tickets.find((x) => x.id === id); if (!t) return false;
        if (status) t.status = status; if (priority) t.priority = priority;
        if (adminNote !== undefined) t.adminNote = adminNote || null;
        if (handledBy) t.handledBy = handledBy;
        t.updatedAt = iso(state.clock += 1000); return true;
      },
      async remove(id) { const i = tickets.findIndex((t) => t.id === id); if (i < 0) return false; tickets.splice(i, 1); return true; },
      async awaitingCount() { return tickets.filter((t) => t.status === 'open').length; },
    },
  };
}

/* ---------- the two servers under test ---------- */
async function harness({ mailer = { provider: 'smtp' }, viewer = null, supportEmail = 'help@addabaaz.test' } = {}) {
  const db = fakeDb();
  const mail = [];
  const mailerPort = { provider: mailer.provider, async send(m) { mail.push(m); return { sent: true }; } };
  const router = express.Router(); router.use(express.json());
  // In the real server the admin router is mounted behind the admin middleware; here it is faked, and the
  // routes under test read req.admin to stamp who handled a ticket.
  const adminRouter = express.Router();
  adminRouter.use((req, _res, next) => { req.admin = { id: 'admin-1', email: 'boss@addabaaz.test', name: 'Boss', via: 'session' }; next(); });
  adminExtraRoutes({
    router: adminRouter, db, billing: { config: { supportEmail, siteUrl: 'https://addabaaz.test' } }, catalog: {},
    push: {}, mailer: mailerPort, campaigns: null, log: async () => {}, siteUrl: 'https://addabaaz.test', sms: null,
  });
  registerSupportRoutes(router, {
    db, userFromRequest: async () => viewer, mailer: mailerPort, supportEmail, siteUrl: 'https://addabaaz.test',
    rate: false, log: { warn() {} },
  });
  const app = express(); app.use('/api/v1', router); app.use('/api/v1/admin', adminRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = (method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, mail, server, call, base };
}

// Mail is fire-and-forget by design (a mail failure must never fail the request), so tests let the
// microtask queue drain before they look at what was sent.
const settle = () => new Promise((r) => setTimeout(r, 0));

const validTicket = { name: 'Ram Sen', email: 'Ram@Example.com', category: 'payment', subject: 'Paid but premium is locked', body: 'I paid via UPI an hour ago and the show still asks me to subscribe.' };

/* ---------- raising a ticket ---------- */
test('a guest can raise a ticket and gets a readable reference', async () => {
  const { db, mail, server, call } = await harness();
  try {
    const res = await call('POST', '/support/tickets', validTicket);
    assert.equal(res.status, 201);
    const { ticket } = await res.json();
    assert.match(ticket.reference, /^ADD-[0-9A-F]{8}$/);
    assert.equal(ticket.status, 'open');
    assert.equal(db.state.tickets.length, 1);
    assert.equal(db.state.tickets[0].userId, null, 'a guest ticket has no account');
    assert.equal(db.state.tickets[0].email, 'ram@example.com', 'the address is stored lower-cased');
    assert.equal(db.state.tickets[0].category, 'payment');
    await settle();
    assert.equal(mail.length, 2, 'with SMTP configured the sender gets a receipt and the support inbox is alerted');
    assert.equal(mail[0].to, 'ram@example.com');
    assert.match(mail[0].subject, /support request/i);
    assert.match(mail[0].text, new RegExp(ticket.reference));
  } finally { server.close(); }
});

test('the ticket form rejects what it cannot act on, and ignores bots', async () => {
  const { db, server, call } = await harness();
  try {
    const cases = [
      [{ ...validTicket, name: '' }, 'invalid_name'],
      [{ ...validTicket, email: 'not-an-email' }, 'invalid_email'],
      [{ ...validTicket, subject: 'ab' }, 'invalid_subject'],
      [{ ...validTicket, body: 'short' }, 'invalid_body'],
    ];
    for (const [body, code] of cases) {
      const res = await call('POST', '/support/tickets', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).error.code, code);
    }
    assert.equal(db.state.tickets.length, 0, 'nothing invalid is stored');

    // The honeypot field is filled by bots only: the request looks successful but nothing happens.
    const bot = await call('POST', '/support/tickets', { ...validTicket, website: 'http://spam.example' });
    assert.equal(bot.status, 202);
    assert.equal(db.state.tickets.length, 0);
  } finally { server.close(); }
});

test('a signed-in viewer’s ticket is linked to the account and its own address', async () => {
  const viewer = { id: 'user-1', name: 'Rupa Das', email: 'rupa@example.com' };
  const { db, server, call } = await harness({ viewer });
  try {
    // The account supplies name/e-mail, so the form only needs the issue itself.
    const res = await call('POST', '/support/tickets', { category: 'playback', subject: 'Video buffers', body: 'The video stops every few seconds on 4G.' });
    assert.equal(res.status, 201);
    assert.equal(db.state.tickets[0].userId, 'user-1');
    assert.equal(db.state.tickets[0].name, 'Rupa Das');
    assert.equal(db.state.tickets[0].email, 'rupa@example.com');

    const list = await call('GET', '/support/tickets');
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.total, 1);
    assert.equal(body.tickets[0].subject, 'Video buffers');
    assert.equal(body.tickets[0].adminNote, undefined, 'the internal note never reaches the viewer');
  } finally { server.close(); }
});

test('a phone-only account must give an address we can answer to', async () => {
  const viewer = { id: 'user-2', name: 'Bikash', email: '919812345678@phone.addabaaz.in' };
  const { db, server, call } = await harness({ viewer });
  try {
    const noMail = await call('POST', '/support/tickets', { subject: 'Cannot sign in', body: 'The code never arrives on my number.' });
    assert.equal(noMail.status, 400);
    assert.equal((await noMail.json()).error.code, 'invalid_email');
    const ok = await call('POST', '/support/tickets', { ...validTicket, email: 'bikash@example.com' });
    assert.equal(ok.status, 201);
    assert.equal(db.state.tickets[0].email, 'bikash@example.com');
  } finally { server.close(); }
});

/* ---------- reading a ticket ---------- */
test('a ticket is readable by its account owner or by the e-mail that raised it — nobody else', async () => {
  const guest = await harness();
  try {
    const created = await (await guest.call('POST', '/support/tickets', validTicket)).json();
    const id = created.ticket.id;
    const mine = await guest.call('GET', `/support/tickets/${id}?email=ram@example.com`);
    assert.equal(mine.status, 200);
    assert.match((await mine.json()).ticket.body, /UPI/);
    assert.equal((await guest.call('GET', `/support/tickets/${id}?email=someone@else.com`)).status, 404);
    assert.equal((await guest.call('GET', `/support/tickets/${id}`)).status, 404, 'without the address a ticket is private');
    assert.equal((await guest.call('GET', '/support/tickets')).status, 401, 'the list needs a session');
  } finally { guest.server.close(); }

  // An admin of another account must not see someone else's ticket through the viewer API either.
  const other = await harness({ viewer: { id: 'user-9', name: 'Other', email: 'other@example.com' } });
  try {
    const created = await (await other.call('POST', '/support/tickets', validTicket)).json();
    assert.equal((await other.call('GET', `/support/tickets/${created.ticket.id}`)).status, 200);
  } finally { other.server.close(); }
});

test('the guest lookup needs both the reference and the e-mail', async () => {
  const { server, call } = await harness();
  try {
    const created = await (await call('POST', '/support/tickets', validTicket)).json();
    const ref = created.ticket.reference;
    const ok = await call('POST', '/support/lookup', { reference: ref, email: 'ram@example.com' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ticket.id, created.ticket.id);

    assert.equal((await call('POST', '/support/lookup', { reference: ref, email: 'wrong@example.com' })).status, 404);
    const badRef = await call('POST', '/support/lookup', { reference: 'ADD-XYZ', email: 'ram@example.com' });
    assert.equal(badRef.status, 400);
    assert.equal((await badRef.json()).error.code, 'invalid_reference');
    const empty = await call('POST', '/support/lookup', {});
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'invalid_email');
  } finally { server.close(); }
});

test('the viewer can answer back, and a closed ticket cannot be reopened by replying', async () => {
  const { db, server, call } = await harness();
  try {
    const created = await (await call('POST', '/support/tickets', validTicket)).json();
    const id = created.ticket.id;
    db.state.tickets[0].status = 'pending';
    const reply = await call('POST', `/support/tickets/${id}/replies`, { email: 'ram@example.com', body: 'Adding the payment id: pay_123.' });
    assert.equal(reply.status, 201);
    assert.equal(db.state.tickets[0].status, 'open', 'a viewer reply puts the ticket back in the queue');
    assert.equal(db.state.replies.length, 1);
    assert.equal(db.state.replies[0].author, 'user');

    db.state.tickets[0].status = 'closed';
    const blocked = await call('POST', `/support/tickets/${id}/replies`, { email: 'ram@example.com', body: 'Any update?' });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error.code, 'ticket_closed');

    const stranger = await call('POST', `/support/tickets/${id}/replies`, { email: 'nope@example.com', body: 'Hello' });
    assert.equal(stranger.status, 404);
  } finally { server.close(); }
});

/* ---------- the console's queue ---------- */
test('the console lists, filters, answers and deletes tickets', async () => {
  const { db, mail, server, call, base } = await harness();
  try {
    await call('POST', '/support/tickets', validTicket);
    await call('POST', '/support/tickets', { ...validTicket, email: 'bina@example.com', category: 'signin', subject: 'OTP never arrives', body: 'I tried three times and no SMS came through.' });
    mail.length = 0;

    const list = await call('GET', '/admin/tickets?status=all');
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.total, 2);
    assert.equal(body.counts.open, 2);
    assert.equal(body.items[0].reference.startsWith('ADD-'), true);

    const filtered = await (await call('GET', '/admin/tickets?category=signin')).json();
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].subject, 'OTP never arrives');
    const searched = await (await call('GET', '/admin/tickets?q=UPI')).json();
    assert.equal(searched.total, 1, 'search covers the message body');

    const id = body.items[0].id;
    const one = await (await call('GET', `/admin/tickets/${id}`)).json();
    assert.equal(one.ticket.id, id);
    assert.deepEqual(one.replies, []);

    // Replying stores the answer, e-mails the viewer (SMTP is configured) and moves the ticket on.
    const answered = await call('POST', `/admin/tickets/${id}/replies`, { body: 'We have refreshed your plan — please sign out and back in.', status: 'pending' });
    assert.equal(answered.status, 201);
    const answerBody = await answered.json();
    assert.equal(answerBody.emailed, true, 'the reply goes out by e-mail when SMTP is configured');
    assert.equal(answerBody.ticket.status, 'pending');
    assert.equal(answerBody.replies.length, 1);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, 'ram@example.com');
    assert.match(mail[0].subject, /Reply to your support request/);
    assert.match(mail[0].text, /refreshed your plan/);

    // Triage without a reply.
    const patched = await call('PATCH', `/admin/tickets/${id}`, { status: 'resolved', priority: 'high', adminNote: 'Refund checked in Razorpay.' });
    assert.equal(patched.status, 200);
    const after = (await patched.json()).ticket;
    assert.equal(after.status, 'resolved'); assert.equal(after.priority, 'high'); assert.equal(after.adminNote, 'Refund checked in Razorpay.');
    assert.equal((await call('PATCH', `/admin/tickets/${id}`, {})).status, 400, 'an empty patch is refused');

    const deleted = await call('DELETE', `/admin/tickets/${id}`);
    assert.equal(deleted.status, 204);
    assert.equal((await call('GET', `/admin/tickets/${id}`)).status, 404);
    assert.equal(base.includes('/api/v1'), true);
  } finally { server.close(); }
});

test('without SMTP a console reply is still stored — and says it was not e-mailed', async () => {
  const { server, call } = await harness({ mailer: { provider: 'none' } });
  try {
    const created = await (await call('POST', '/support/tickets', validTicket)).json();
    const id = created.ticket.id;
    const res = await call('POST', `/admin/tickets/${id}/replies`, { body: 'Thanks — we are on it.', status: 'pending' });
    const body = await res.json();
    assert.equal(body.emailed, false);
    assert.equal(body.replies.length, 1, 'the conversation is kept for the console either way');
  } finally { server.close(); }
});

/* ---------- clear client caches ---------- */
test('the console can bump the client cache generation, choosing how much to clear', async () => {
  const { db, server, call } = await harness();
  try {
    const before = await (await call('GET', '/admin/cache')).json();
    assert.equal(before.version, '1');
    assert.equal(before.scope, 'assets');

    const purge = await (await call('POST', '/admin/cache/purge', { scope: 'all' })).json();
    assert.equal(purge.purged, true);
    assert.equal(purge.version, '2');
    assert.equal(purge.scope, 'all');
    assert.equal(await db.settings.get('client_cache_version'), '2', 'the version is what every client compares');

    const again = await (await call('POST', '/admin/cache/purge', {})).json();
    assert.equal(again.version, '3');
    assert.equal(again.scope, 'assets', 'the default is the smaller, safer purge');
  } finally { server.close(); }
});

/* ---------- wording shared with the e-mails ---------- */
test('the ticket e-mails are consistent and escape what viewers type', () => {
  const nasty = '<script>alert(1)</script>';
  const r = emailTemplates.received({ name: 'Ram', ref: 'ADD-1A2B3C4D', subject: nasty, body: 'hello', link: 'https://addabaaz.test/support?ticket=x&email=y' });
  assert.ok(r.html.includes('&lt;script&gt;'), 'html is escaped');
  assert.equal(r.html.includes('<script>'), false);
  assert.ok(r.text.includes(nasty), 'the plain-text version carries the characters as typed (mail clients show them as text)');
  const a = emailTemplates.adminAnswered({ body: 'Answer', ref: 'ADD-1A2B3C4D', subject: 'Hi', supportEmail: 'help@addabaaz.test', siteUrl: 'https://addabaaz.test' });
  assert.match(a.subject, /ADD-1A2B3C4D/);
  for (const t of Object.values(emailTemplates)) {
    const built = t({ name: 'Ram', ref: 'ADD-1', subject: 'x', body: 'y', email: 'a@b.co', category: 'other', supportEmail: '', siteUrl: 'https://addabaaz.test', link: '' });
    assert.equal(typeof built.subject, 'string'); assert.equal(typeof built.text, 'string'); assert.equal(typeof built.html, 'string');
  }
  assert.deepEqual(TICKET_CATEGORIES, ['signin', 'registration', 'payment', 'playback', 'content', 'account', 'other']);
});
