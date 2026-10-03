// Signed one-click endpoint for campaign email preferences; no interactive session is required.
import crypto from 'node:crypto';
import { wrap } from '../http.js';

export function registerUnsubscribeRoute(api, { db, unsubscribeSignature }) {
  const unsubSig = unsubscribeSignature;
  /* ---------- one-click unsubscribe from campaign e-mails (no sign-in needed: the link is signed) ---------- */
  // GET so it works straight from a mail client; the reply is a small page, never JSON.
  api.get('/notifications/unsubscribe', wrap(async (req, res) => {
    const id = String(req.query.u || ''), t = String(req.query.t || '');
    const ok = id && t && crypto.timingSafeEqual(Buffer.from(t.padEnd(64, '\u0000').slice(0, 64)), Buffer.from(unsubSig(id).padEnd(64, '\u0000').slice(0, 64)));
    if (ok) await db.adminUsers.setEmailOptOut(id, true).catch(() => {});
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADDABAAZ</title><body style="margin:0;font:16px/1.6 system-ui,sans-serif;background:#0b0b0d;color:#eee;display:grid;place-items:center;min-height:100vh;text-align:center"><div style="padding:24px"><h1 style="font-size:22px;margin:0 0 8px">${ok ? 'You are unsubscribed' : 'That link didn’t work'}</h1><p style="margin:0 0 20px;color:#aaa">${ok ? 'You will no longer receive announcement e-mails. Receipts and account e-mails are not affected.' : 'Please open the unsubscribe link from the e-mail again, or contact support.'}</p><a href="/" style="color:#e50914;font-weight:600;text-decoration:none">Back to ADDABAAZ</a></div></body>`);
  }));

}
