// Public contact endpoint. Spam protection and persistence are kept behind injected dependencies.
import crypto from 'node:crypto';
import { bad, wrap, rateLimit, withTimeout } from '../http.js';

export function registerContactRoutes(api, { db, rate, contactWebhook = '', logger = console }) {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Public contact form: rate limited (5 per 10 min), with a hidden `website` field as a spam trap (bots fill it in).
  api.post('/contact', rate ? rateLimit('contact', 5, 10 * 60_000) : (_q, _s, n) => n(), wrap(async (req, res) => {
    const { name = '', email = '', phone = '', message = '', website = '' } = req.body || {};
    if (website) return res.status(202).json({ ok: true });          // honeypot
    if (!String(name).trim() || !EMAIL.test(String(email).trim()) || !String(message).trim()) throw bad('Name, a valid email and a message are required.');
    if (String(message).length > 5000 || String(name).length > 100 || String(phone).length > 40 || String(email).length > 254) throw bad('One of the fields is too long.');
    const entry = { id: crypto.randomUUID(), name: String(name).trim(), email: String(email).trim(), phone: String(phone).trim(), message: String(message).trim(), at: new Date().toISOString() };
    await db.contacts.add(entry);
    // Fire-and-forget, but with a request budget: a webhook host that accepts the connection and never
    // answers would otherwise keep one socket per submission open until the process runs out.
    if (contactWebhook) fetch(contactWebhook, withTimeout({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })).catch((e) => logger.warn('[contact] webhook failed:', e));
    res.status(202).json({ ok: true });
  }));

}
