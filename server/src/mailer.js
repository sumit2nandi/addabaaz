import nodemailer from 'nodemailer';

/**
 * Outgoing email over SMTP (any provider: Amazon SES, Brevo, Mailgun, Postmark, Gmail app password…).
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465     MAIL_FROM="ADDABAAZ <billing@addabaaz.in>"
 * Without SMTP_URL nothing is sent: the message is logged in development and skipped (with a startup warning) in production.
 * Tests inject `transport` (anything with sendMail()).
 */
// `transport` is anything with `sendMail()`: a real nodemailer SMTP transport, or a fake in tests.
export function createMailer({ url = '', from = 'ADDABAAZ <no-reply@localhost>', transport = null, log = console } = {}) {
  const t = transport || (url ? nodemailer.createTransport({ url, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 }) : null);
  return {
    provider: t ? 'smtp' : 'none', from,
    /** @returns {Promise<{sent:boolean}>} — rejects if the SMTP server refuses; callers treat email as best-effort. */
    // In development with no SMTP the message is printed to the console instead of being sent.
    async send({ to, subject, text, html, attachments = [] }) {
      if (!to) return { sent: false };
      if (!t) { if (process.env.NODE_ENV !== 'production') log.log(`[mail:dev] to=${to} subject="${subject}" attachments=${attachments.map((a) => a.filename).join(',') || '-'}`); return { sent: false }; }
      const info = await t.sendMail({ from, to, subject, text, html, attachments });
      // SMTP can resolve while rejecting a recipient (for example when other addresses in a message were accepted).
      // Campaigns send one address at a time, so surface that as an individual failure instead of a false success.
      if (info?.rejected?.length || (Array.isArray(info?.accepted) && info.accepted.length === 0)) {
        throw Object.assign(new Error('The SMTP server rejected this recipient.'), { code: 'smtp_recipient_rejected' });
      }
      return { sent: true };
    },
  };
}

// Builds the mailer from SMTP_URL / MAIL_FROM.
export const mailerFromEnv = (env = process.env, { log = console } = {}) => createMailer({ url: env.SMTP_URL || '', from: env.MAIL_FROM || 'ADDABAAZ <no-reply@localhost>', log });
