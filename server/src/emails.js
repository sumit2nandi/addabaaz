import { rupees } from './gst.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const inr = (paise) => `Rs. ${rupees(paise)}`;

/** Every email is { subject, text, html }. Plain-text first; the HTML is the same content in a simple, client-safe layout. */
function layout({ subject, paragraphs, button, footer }) {
  const text = [...paragraphs, button ? `${button.label}: ${button.url}` : null, footer].filter(Boolean).join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#050505;padding:18px 24px;font-size:20px;font-weight:700;letter-spacing:1px;color:#fff">ADDA<span style="color:#e50914">BAAZ</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 14px">${esc(subject)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ''}
${footer ? `<p style="margin:18px 0 0;color:#666;font-size:12.5px">${esc(footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

const hello = (name) => `Hi ${String(name || '').split(' ')[0] || 'there'},`;
const help = (o) => (o.supportEmail ? `Questions? Reply to this email or write to ${o.supportEmail}.` : '');

export function receiptEmail(o) {
  const tax = o.invoice.doc.title === 'TAX INVOICE';
  return layout({
    subject: `Your ADDABAAZ Plus ${tax ? 'invoice' : 'receipt'} ${o.invoice.number}`,
    paragraphs: [
      hello(o.name),
      `Thank you! We received ${inr(o.amountPaise)} for ${o.planName}. Premium videos are unlocked until ${day(o.validUntil)}.`,
      `${tax ? 'Tax invoice' : 'Receipt'} ${o.invoice.number} is attached as a PDF. You can also download it any time from Account → Billing & invoices.`,
      o.discountPaise ? `Coupon ${o.couponCode} saved you ${inr(o.discountPaise)}.` : null,
    ].filter(Boolean),
    button: { label: 'Start watching', url: o.siteUrl },
    footer: help(o),
  });
}

export function accessGrantedEmail(o) {
  return layout({
    subject: 'Your ADDABAAZ Plus access is active',
    paragraphs: [hello(o.name), `Coupon ${o.couponCode} unlocked ${o.planName} for you — no payment was needed. Premium videos are available until ${day(o.validUntil)}.`],
    button: { label: 'Start watching', url: o.siteUrl }, footer: help(o),
  });
}

export function refundEmail(o) {
  const full = o.fullRefund;
  return layout({
    subject: `Your ADDABAAZ refund of ${inr(o.amountPaise)} has been processed`,
    paragraphs: [
      hello(o.name),
      `We have refunded ${inr(o.amountPaise)} to your original payment method. Banks usually take 5–7 working days to show it.`,
      o.creditNote ? `Credit note ${o.creditNote.number} for this refund is attached.` : null,
      o.accessRevoked ? (full ? 'Your ADDABAAZ Plus access for that payment has ended.' : 'The plan time bought with that payment has been removed from your account.') : 'Your ADDABAAZ Plus access is unchanged.',
      o.reason ? `Reason noted: ${o.reason}` : null,
    ].filter(Boolean),
    footer: help(o),
  });
}

export function paymentFailedEmail(o) {
  return layout({
    subject: 'Your ADDABAAZ payment didn’t go through',
    paragraphs: [hello(o.name), `Your payment for ${o.planName} could not be completed${o.reason ? ` (${o.reason})` : ''}. No plan was activated. If money left your account, the bank will reverse it automatically, usually within 5–7 working days.`, 'You can try again with the same or a different payment method.'],
    button: { label: 'Try again', url: o.retryUrl }, footer: help(o),
  });
}

export function expiringEmail(o) {
  return layout({
    subject: `Your ADDABAAZ Plus ends on ${day(o.expiresAt)}`,
    paragraphs: [hello(o.name), `Your ${o.planName} plan ends on ${day(o.expiresAt)}. After that, premium videos will be locked again. Plans don’t renew automatically — renew any time and the new time is added after your current plan ends.`],
    button: { label: 'Renew now', url: o.renewUrl }, footer: help(o),
  });
}
