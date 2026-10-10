// Transactional e-mail templates (receipts, refunds, password reset ...). Each function takes the data it needs
// and returns `{ subject, text, html }`; mailer.js sends them. To change wording, edit the text here.
import { rupees } from './gst.js';

// The welcome mail is its own module because it is the only message here that ships a designed layout rather than
// a table of fields; re-exported so callers keep importing `mail` and nothing else. It is also the confirmation
// mail for a new address — see sendWelcome in features.js and the note at the top of welcome-email.js.
export { welcomeEmail } from './welcome-email.js';

// HTML-escapes user-provided text so names or reasons can never inject markup.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Formats a date the way Indian customers expect, in IST (e.g. 30 Sep 2026).
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
// Money for e-mail text. Plain "Rs." is used instead of the rupee symbol for maximum client compatibility.
const inr = (paise) => `Rs. ${rupees(paise)}`;

/** Every email is { subject, text, html }. Plain-text first; the HTML is the same content in a simple, client-safe layout. */
export function layout({ subject, paragraphs, button, footer, footerHtml = null, image = null, imageAlt = '' }) {
  const text = [...paragraphs, button ? `${button.label}: ${button.url}` : null, footer].filter(Boolean).join('\n\n');
  // An optional picture at the top of the message (broadcast e-mails). Plain <img>: mail clients strip
  // everything else, and the URL is escaped so a crafted path cannot break out of the attribute.
  const hero = image ? `<img src="${esc(image)}" alt="${esc(imageAlt || subject)}" style="width:100%;max-width:512px;height:auto;border-radius:8px;display:block;margin:0 0 16px" />` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#050505;padding:18px 24px;font-size:20px;font-weight:700;letter-spacing:1px;color:#fff">ADDA<span style="color:#e50914">BAAZ</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
${hero}
<h1 style="font-size:20px;margin:0 0 14px">${esc(subject)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ''}
${footerHtml || footer ? `<p style="margin:18px 0 0;color:#666;font-size:12.5px">${footerHtml || esc(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// Greeting with the first name only.
const hello = (name) => `Hi ${String(name || '').split(' ')[0] || 'there'},`;
// Footer line pointing to support (only if a support address is configured).
const help = (o) => (o.supportEmail ? `Questions? Reply to this email or write to ${o.supportEmail}.` : '');

// ---- Payment e-mails ----
// Sent after a successful payment; the invoice PDF is attached by billing.js.
export function receiptEmail(o) {
  const tax = o.invoice.doc.title === 'TAX INVOICE';
  return layout({
    subject: `Your ADDABAAZ Premium ${tax ? 'invoice' : 'receipt'} ${o.invoice.number}`,
    paragraphs: [
      hello(o.name),
      // A credit-only order has nothing "received" — say what actually happened.
      o.creditPaise && !o.amountPaise
        ? `ADDABAAZ credit covered the full ${inr(o.creditPaise)} — ${o.planName} is active and premium videos are unlocked until ${day(o.validUntil)}. No payment was needed.`
        : `Thank you! We received ${inr(o.amountPaise)} for ${o.planName}. Premium videos are unlocked until ${day(o.validUntil)}.`,
      `${tax ? 'Tax invoice' : 'Receipt'} ${o.invoice.number} is attached as a PDF. You can also download it any time from Account → Billing & invoices.`,
      o.discountPaise ? `Coupon ${o.couponCode} saved you ${inr(o.discountPaise)}.` : null,
      o.creditPaise && o.amountPaise ? `ADDABAAZ credit covered ${inr(o.creditPaise)} of this order.` : null,
    ].filter(Boolean),
    button: { label: 'Start watching', url: o.siteUrl },
    footer: help(o),
  });
}

// Sent when a 100%-off coupon unlocks access without payment.
export function accessGrantedEmail(o) {
  return layout({
    subject: 'Your ADDABAAZ Premium access is active',
    paragraphs: [hello(o.name), `Coupon ${o.couponCode} unlocked ${o.planName} for you — no payment was needed. Premium videos are available until ${day(o.validUntil)}.`],
    button: { label: 'Start watching', url: o.siteUrl }, footer: help(o),
  });
}

// Sent when a refund has been processed (with the credit note attached).
export function refundEmail(o) {
  const full = o.fullRefund;
  return layout({
    subject: `Your ADDABAAZ refund of ${inr(o.amountPaise)} has been processed`,
    paragraphs: [
      hello(o.name),
      `We have refunded ${inr(o.amountPaise)} to your original payment method. Banks usually take 5–7 working days to show it.`,
      o.creditNote ? `Credit note ${o.creditNote.number} for this refund is attached.` : null,
      o.accessRevoked ? (full ? 'Your ADDABAAZ Premium access for that payment has ended.' : 'The plan time bought with that payment has been removed from your account.') : 'Your ADDABAAZ Premium access is unchanged.',
      o.reason ? `Reason noted: ${o.reason}` : null,
    ].filter(Boolean),
    footer: help(o),
  });
}

// Sent when the payment gateway reports a failed attempt.
export function paymentFailedEmail(o) {
  return layout({
    subject: 'Your ADDABAAZ payment didn’t go through',
    paragraphs: [hello(o.name), `Your payment for ${o.planName} could not be completed${o.reason ? ` (${o.reason})` : ''}. No plan was activated. If money left your account, the bank will reverse it automatically, usually within 5–7 working days.`, 'You can try again with the same or a different payment method.'],
    button: { label: 'Try again', url: o.retryUrl }, footer: help(o),
  });
}

// Reminder a few days before a prepaid plan ends.
export function expiringEmail(o) {
  return layout({
    subject: `Your ADDABAAZ Premium ends on ${day(o.expiresAt)}`,
    paragraphs: [hello(o.name), `Your ${o.planName} plan ends on ${day(o.expiresAt)}. After that, premium videos will be locked again. Plans don’t renew automatically — renew any time and the new time is added after your current plan ends.`],
    button: { label: 'Renew now', url: o.renewUrl }, footer: help(o),
  });
}

/* ---------- account emails ---------- */
export function resetPasswordEmail(o) {
  return layout({
    subject: 'Reset your ADDABAAZ password',
    paragraphs: [hello(o.name), 'We received a request to reset your password. The link below works for 1 hour and can be used once.', 'If you didn’t ask for this, ignore this email — your password stays the same.'],
    button: { label: 'Choose a new password', url: o.url }, footer: help(o),
  });
}
// Account confirmation link.
export function verifyEmailEmail(o) {
  return layout({
    subject: 'Confirm your email for ADDABAAZ',
    paragraphs: [hello(o.name), 'Please confirm this is your email address. The link works for 3 days.'],
    button: { label: 'Confirm my email', url: o.url }, footer: help(o),
  });
}
// Sent to a new contact address for a phone-only account; the address is not saved on the account until confirmed.
export function phoneAccountEmailVerification(o) {
  return layout({
    subject: 'Confirm the email for your ADDABAAZ account',
    paragraphs: [hello(o.name), 'You asked to use this email address for your ADDABAAZ account. Confirm it within 1 hour. Your current email stays active until you confirm the new one.', 'If you didn’t make this request, ignore this email — the address will not be added.'],
    button: { label: 'Confirm this email', url: o.url }, footer: help(o),
  });
}
// Security notice after a password change.
export function passwordChangedEmail(o) {
  return layout({
    subject: 'Your ADDABAAZ password was changed',
    paragraphs: [hello(o.name), 'Your password was just changed and you were signed out of your other devices.', 'If this wasn’t you, reset your password now and contact us.'],
    button: { label: 'Reset password', url: `${o.siteUrl}/forgot` }, footer: help(o),
  });
}
// ---- Refund requests ----
// To the support inbox: a customer asked for a refund.
export function refundRequestEmail(o) {
  return layout({
    subject: `Refund request from ${o.email}`,
    paragraphs: [`${o.email} asked for a refund of ${inr(o.amountPaise)} (${o.planName}, paid ${day(o.paidAt)}).`, o.reason ? `Reason: ${o.reason}` : 'No reason given.', 'Review it in the admin console → Payments → Refund requests.'],
    button: { label: 'Open admin console', url: `${o.siteUrl}/admin/#/refunds` },
  });
}
// To the customer: the request was declined.
export function refundDeclinedEmail(o) {
  return layout({
    subject: 'About your ADDABAAZ refund request',
    paragraphs: [hello(o.name), `We reviewed your refund request for ${o.planName} and can’t refund this payment.`, o.note ? `Note from our team: ${o.note}` : null, 'Your plan and access are unchanged.'].filter(Boolean), footer: help(o),
  });
}
// To the customer: we got your request.
export function refundRequestReceivedEmail(o) {
  return layout({
    subject: 'We received your refund request',
    paragraphs: [hello(o.name), `We have your refund request for ${o.planName} (${inr(o.amountPaise)}). We’ll review it and email you the outcome, usually within 2 working days.`], footer: help(o),
  });
}

// ---- Admin broadcast campaign (Admin → Notifications → Email) ----
// The subject and body come from the admin composer; `body` is plain text where blank lines start
// new paragraphs. Every campaign email carries an unsubscribe link (required for bulk mail and
// honoured by the audience queries), while transactional mail above never does.
export function campaignEmail(o) {
  const paragraphs = [hello(o.name), ...String(o.body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)];
  const line = 'You are receiving this because you have an ADDABAAZ account.';
  const footer = [o.unsubscribeUrl ? `${line} Unsubscribe from announcement emails: ${o.unsubscribeUrl}` : line, help(o)].filter(Boolean).join(' ');
  // The HTML version gets a clickable one-click unsubscribe link; the text version the bare URL (mail clients linkify it).
  const footerHtml = esc([line, help(o)].filter(Boolean).join(' ')) + (o.unsubscribeUrl ? ` <a href="${esc(o.unsubscribeUrl)}" style="color:#666">Unsubscribe</a>` : '');
  return layout({ subject: o.subject, paragraphs, footer, footerHtml, image: o.image || null, imageAlt: o.imageAlt || '', button: o.button?.url ? { label: o.button.label || 'Open ADDABAAZ', url: o.button.url } : (o.siteUrl ? { label: 'Open ADDABAAZ', url: o.siteUrl } : null) });
}

export function resetParentalPinEmail(o) {
  return layout({ subject: 'Reset your ADDABAAZ parental PIN',
    paragraphs: [hello(o.name), 'Use this single-use link to choose a new parental PIN. It expires in 15 minutes.', 'If you did not request this, ignore this email. Your current PIN stays unchanged.'],
    button: { label: 'Reset parental PIN', url: o.url }, footer: help(o),
  });
}
