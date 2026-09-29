import nodemailer from 'nodemailer';

/**
 * Outgoing email over SMTP (any provider: Amazon SES, Brevo, Mailgun, Postmark, Gmail app password…).
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465     MAIL_FROM="ADDABAAZ <billing@addabaaz.in>"
 * Without SMTP_URL nothing is sent: the message is logged in development and skipped (with a startup warning) in production.
 * Tests inject `transport` (anything with sendMail()).
 */
export function createMailer({ url = '', from = 'ADDABAAZ <no-reply@localhost>', transport = null, log = console } = {}) {
  const t = transport || (url ? nodemailer.createTransport(url) : null);
  return {
    provider: t ? 'smtp' : 'none', from,
    /** @returns {Promise<{sent:boolean}>} — rejects if the SMTP server refuses; callers treat email as best-effort. */
    async send({ to, subject, text, html, attachments = [] }) {
      if (!to) return { sent: false };
      if (!t) { if (process.env.NODE_ENV !== 'production') log.log(`[mail:dev] to=${to} subject="${subject}" attachments=${attachments.map((a) => a.filename).join(',') || '-'}`); return { sent: false }; }
      await t.sendMail({ from, to, subject, text, html, attachments });
      return { sent: true };
    },
  };
}

export const mailerFromEnv = (env = process.env) => createMailer({ url: env.SMTP_URL || '', from: env.MAIL_FROM || 'ADDABAAZ <no-reply@localhost>' });
