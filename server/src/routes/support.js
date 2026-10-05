// Support tickets: the public Support page (app/js/views/support.js) and Admin → Support.
//
//   POST /support/tickets            raise a ticket (works signed out too — the app asks an email when it has no account)
//   GET  /support/tickets            the signed-in viewer's own tickets
//   GET  /support/tickets/:id        one ticket + the conversation (only its owner, or the email that raised it)
//   POST /support/tickets/:id/replies  the viewer answers back (reopens a resolved ticket)
//
// A ticket is linked to the account when the sender is signed in; guests identify themselves with name +
// email and get the reference by e-mail (when SMTP is configured — nothing breaks without it). The
// support address is notified about every new ticket and every viewer reply.
//
// Ticket replies from the console live in admin-extra.js (Admin → Support).
import crypto from 'node:crypto';
import { HttpError, bad, wrap, rateLimit } from '../http.js';

// The categories the page offers; the same ids are used for the console's filter tabs.
export const TICKET_CATEGORIES = ['signin', 'registration', 'payment', 'playback', 'content', 'account', 'other'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// A reference people can quote: the ticket id is a UUID, so the first block is short enough to read out.
const reference = (id) => `ADD-${String(id).slice(0, 8).toUpperCase()}`;

/**
 * @param {object} api  the /api/v1 router (registered before the auth middleware)
 * @param {object} o
 * @param {object} o.db
 * @param {Function} o.userFromRequest   resolves the session when there is one (never throws)
 * @param {object} o.mailer              SMTP mailer (a no-op when unconfigured)
 * @param {string} o.supportEmail        where new-ticket notifications go
 * @param {string} o.siteUrl
 * @param {boolean} o.rate
 */
export function registerSupportRoutes(api, { db, userFromRequest, mailer, email, supportEmail = '', siteUrl = '', rate = true, log = console }) {
  // Rate limit: 8 new tickets per 10 minutes per IP, plus the honeypot below.
  const ticketLimit = rate ? rateLimit('support', 8, 10 * 60_000) : (_q, _s, n) => n();
  const canMail = () => mailer?.provider === 'smtp';
  // Notifications are fire-and-forget: a mail failure must never fail the request that raised the ticket.
  const notify = (to, built, note) => {
    if (!to || !canMail() || !built) return;
    mailer.send({ to, ...built }).catch((e) => log.warn?.(`[support] mail failed${e.code ? ` (${e.code})` : ''} — ${note}:`, e));
  };
  // The signed-in user, or null for a guest — never throws (a bad/expired token simply means "guest").
  const me = async (req) => (userFromRequest ? await userFromRequest(req).catch((e) => { log.warn?.('[support] could not resolve the optional viewer session:', e); return null; }) : null);

  /* ---------- raise a ticket ---------- */
  api.post('/support/tickets', ticketLimit, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(202).json({ ok: true });                    // honeypot: bots fill hidden fields
    const account = await me(req);
    const name = String(b.name || account?.name || '').trim();
    const email = String(b.email || (account && !/^[^@]+@phone\.addabaaz\.in$/i.test(account.email) ? account.email : '') || '').trim().toLowerCase();
    const phone = String(b.phone || account?.phone || '').trim().slice(0, 24);
    const category = TICKET_CATEGORIES.includes(b.category) ? b.category : 'other';
    const subject = String(b.subject || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const body = String(b.body || '').replace(/\u0000/g, '').trim().slice(0, 5000);
    if (!name || name.length > 80) throw bad('Please tell us your name.', 'invalid_name');
    if (!EMAIL.test(email) || email.length > 254) throw bad('Please enter an email address we can reply to.', 'invalid_email');
    if (!subject || subject.length < 3) throw bad('Please give your issue a short subject.', 'invalid_subject');
    if (!body || body.length < 10) throw bad('Please describe the issue in a little more detail (at least 10 characters).', 'invalid_body');
    const id = crypto.randomUUID();
    const ticket = {
      id, userId: account?.id || null, name, email, phone: phone || null, category, subject, body,
      appVersion: String(b.appVersion || '').slice(0, 40) || null,
      platform: String(b.platform || '').slice(0, 40) || null,
      device: String(b.device || req.get('user-agent') || '').slice(0, 120) || null,
    };
    await db.tickets.create(ticket);
    const ref = reference(id);
    if (email) notify(email, emailTemplates.received({ name, ref, subject, body, supportEmail, siteUrl, link: siteUrl ? `${siteUrl}/support?ticket=${id}&email=${encodeURIComponent(email)}` : '' }), `ticket ${ref} receipt`);
    if (supportEmail) notify(supportEmail, emailTemplates.adminNew({ name, email, category, subject, body, ref, id, siteUrl }), `ticket ${ref} alert`);
    res.status(201).json({ ticket: { id, reference: ref, subject, status: 'open', createdAt: new Date().toISOString() } });
  }));

  /* ---------- the viewer's own tickets ---------- */
  api.get('/support/tickets', wrap(async (req, res) => {
    const account = await me(req);
    if (!account) throw new HttpError(401, 'unauthorized', 'Please sign in to see your support tickets.');
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { total, items } = await db.tickets.forUser(account.id, { limit, offset });
    res.json({ total, tickets: items.map(summary) });
  }));

  api.get('/support/tickets/:id', wrap(async (req, res) => {
    const account = await me(req);
    const ticket = await db.tickets.get(String(req.params.id));
    if (!ticket) throw new HttpError(404, 'not_found', 'We couldn’t find that support ticket.');
    const owner = account && ticket.userId === account.id;
    // A guest who raised a ticket can still read it with the e-mail that was used (the reference is not a secret).
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!owner && !(email && email === ticket.email)) throw new HttpError(404, 'not_found', 'We couldn’t find that support ticket.');
    const replies = await db.tickets.replies(ticket.id);
    res.json({ ticket: { ...summary(ticket), body: ticket.body, reference: reference(ticket.id) }, replies: replies.map((r) => ({ id: r.id, author: r.author, authorName: r.authorName, body: r.body, createdAt: r.createdAt })) });
  }));

  /* ---------- guest lookup: reference + e-mail ---------- */
  // A guest has no session, so the ticket is found from the short reference we mailed ("ADD-1A2B3C4D")
  // together with the same e-mail address. Both must match, so a guessed reference is useless.
  api.post('/support/lookup', ticketLimit, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const reference = String(req.body?.reference || '').trim();
    if (!EMAIL.test(email)) throw bad('Enter the e-mail address you used.', 'invalid_email');
    // The reference is what the receipt e-mail shows: ADD-1A2B3C4D (case-insensitive, the dash optional —
    // people retype it by hand).
    if (!/^(?:add-?)?[0-9a-f]{8}$/i.test(reference)) throw bad('Enter the reference from our e-mail (it looks like ADD-1A2B3C4D).', 'invalid_reference');
    const ticket = await db.tickets.byReference(reference, email);
    if (!ticket) throw new HttpError(404, 'not_found', 'We couldn’t find a ticket with that reference and e-mail. Check both and try again.');
    res.json({ ticket: { ...summary(ticket), body: ticket.body } });
  }));

  /* ---------- the viewer answers back ---------- */
  api.post('/support/tickets/:id/replies', ticketLimit, wrap(async (req, res) => {
    const account = await me(req);
    const ticket = await db.tickets.get(String(req.params.id));
    if (!ticket) throw new HttpError(404, 'not_found', 'We couldn’t find that support ticket.');
    const owner = account && ticket.userId === account.id;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!owner && !(email && email === ticket.email)) throw new HttpError(404, 'not_found', 'We couldn’t find that support ticket.');
    if (ticket.status === 'closed') throw new HttpError(409, 'ticket_closed', 'This ticket is closed. Please raise a new one if the issue is back.');
    const body = String(req.body?.body || '').replace(/\u0000/g, '').trim().slice(0, 4000);
    if (body.length < 2) throw bad('Please write a message.', 'invalid_body');
    await db.tickets.addReply({ id: crypto.randomUUID(), ticketId: ticket.id, author: 'user', authorName: ticket.name, body, status: ticket.status === 'pending' ? 'open' : null });
    if (supportEmail) notify(supportEmail, emailTemplates.adminReply({ name: ticket.name, email: ticket.email, subject: ticket.subject, body, ref: reference(ticket.id), id: ticket.id }), `ticket ${reference(ticket.id)} viewer reply`);
    res.status(201).json({ ok: true });
  }));
}

// What a list row shows (never the internal note).
const summary = (t) => ({
  id: t.id, reference: `ADD-${String(t.id).slice(0, 8).toUpperCase()}`, category: t.category, subject: t.subject,
  status: t.status, priority: t.priority, replies: t.replies, lastReplyBy: t.lastReplyBy,
  createdAt: t.createdAt, updatedAt: t.updatedAt,
});

/** The ticket e-mails (kept here so both the viewer and the console send the same wording). */
export const emailTemplates = {
  received: (o) => ({
    subject: `We’ve got your support request (${o.ref})`,
    text: [`Hi ${String(o.name).split(' ')[0] || 'there'},`, `Thanks for writing in about “${o.subject}”. Your reference is ${o.ref}.`,
      'Our team replies to support requests from this address — usually within one working day.',
      o.link ? `Follow the conversation: ${o.link}` : null,
      o.supportEmail ? `You can also reply to this email or write to ${o.supportEmail}.` : 'You can reply to this email to add anything.'].filter(Boolean).join('\n\n'),
    html: shell(`Hi ${esc(String(o.name).split(' ')[0] || 'there')},`,
      `Thanks for writing in about <b>${esc(o.subject)}</b>. Your reference is <b>${esc(o.ref)}</b>.`,
      'Our team replies to support requests from this address — usually within one working day.',
      o.link ? `<a href="${esc(o.link)}">Follow the conversation</a> (or open Support and use ${esc(o.ref)} with this e-mail address).` : '',
      o.supportEmail ? `You can also reply to this e-mail or write to ${esc(o.supportEmail)}.` : 'You can reply to this e-mail to add anything.'),
  }),
  adminNew: (o) => ({
    subject: `[Support] ${o.subject} (${o.ref})`,
    text: [`New support ticket ${o.ref}`, `From: ${o.name} <${o.email}>`, `Category: ${o.category}`, '', o.body,
      o.siteUrl ? `Open the console: ${o.siteUrl}/admin/#/support` : ''].filter(Boolean).join('\n'),
    html: shell(`New support ticket <b>${esc(o.ref)}</b>`,
      `From <b>${esc(o.name)}</b> &lt;${esc(o.email)}&gt;<br>Category: <b>${esc(o.category)}</b>`,
      esc(o.body).replace(/\n/g, '<br>'),
      o.siteUrl ? `<a href="${esc(o.siteUrl)}/admin/#/support">Open Admin → Support</a>` : ''),
  }),
  adminReply: (o) => ({
    subject: `[Support] ${o.ref} — the viewer replied`,
    text: [`${o.name} <${o.email}> added to ticket ${o.ref} (“${o.subject}”):`, '', o.body].join('\n'),
    html: shell(`${esc(o.name)} replied to <b>${esc(o.ref)}</b> (“${esc(o.subject)}”)`, esc(o.body).replace(/\n/g, '<br>'), ''),
  }),
  adminAnswered: (o) => ({
    subject: `Reply to your support request (${o.ref}): ${o.subject}`,
    text: [o.body, '', o.supportEmail ? `Reply to this e-mail or write to ${o.supportEmail} for anything else.` : 'Reply to this e-mail for anything else.'].join('\n'),
    html: shell(`${esc(o.body).replace(/\n/g, '<br>')}`, `Your reference is <b>${esc(o.ref)}</b>.`,
      o.supportEmail ? `Reply to this e-mail or write to ${esc(o.supportEmail)}.` : 'Reply to this e-mail for anything else.'),
  }),
};

// A minimal, client-safe HTML shell (same look as the transactional e-mails in emails.js).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shell = (...paragraphs) => `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#050505;padding:18px 24px;font-size:20px;font-weight:700;letter-spacing:1px;color:#fff">ADDA<span style="color:#e50914">BAAZ</span> <span style="font-size:12px;color:#bbb">Support</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${paragraphs.filter(Boolean).map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('')}</td></tr>
</table></td></tr></table></body></html>`;
