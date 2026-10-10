/**
 * The welcome e-mail, sent to a new account (see `sendWelcome` in features.js).
 *
 * It is the ONLY mail a new address receives, and for an email sign-up it carries the confirmation link. It is
 * deliberately short and transactional: one heading, one sentence, one button, the expiry rule and a footer.
 * Image-heavy promotional layouts were moved to spam folders, so the letter now has no images, no show cards,
 * no referral block and no social links. A link to the site is never needed to read it.
 *
 * `verifyUrl` is empty for an address the provider already confirmed (Google/Facebook/Apple sign-in); the letter
 * then becomes a plain welcome with a "Start watching" button. The credit line appears only when there is credit.
 *
 * Tables, inline styles, no script, no external CSS beyond the phone media query, and `Rs.` rather than `₹` (the
 * format the rest of the mailers use). Values are escaped.
 */
import { rupees } from './gst.js';

// Same escaping rule as emails.js: nothing a user typed ever reaches the mail as markup.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trimEnd = (s) => String(s || '').replace(/\/+$/, '');
// An offer is read as an amount, not a bill: "Rs. 100", never "Rs. 100.00".
const inr = (paise) => `Rs. ${rupees(paise).replace(/\.00$/, '')}`;

const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const MUTED = '#9a9aa6';
const ADDRESS = 'ADDABAAZ · 162/B, 283 Lake Gardens, Kolkata, West Bengal 700045, India';
const DEFAULT_SUPPORT = 'office@addabaaz.in';

/* The phone layout, shared with the preview harness: preview/welcome-email.html carries this exact block, and
 * welcome-email.test.js fails when the two drift. Only resizing and repadding here; no cell is restacked. */
export const welcomeStyle = `/* The one <style> block in this mail, shared verbatim with preview/welcome-email.html. */
  @media only screen and (max-width:520px){
    .pad{padding-left:18px !important;padding-right:18px !important}
    .h1{font-size:24px !important;line-height:1.2 !important}
    .cta{display:block !important;width:100% !important}
    .cta a{display:block !important}
  }`;

/**
 * @param {object} o
 * @param {string} o.name            the account's display name (first word only in the greeting)
 * @param {string} [o.siteUrl]       PUBLIC_SITE_URL — the “Start watching” link is absolute from here
 * @param {number} [o.creditPaise]   the new-account credit this sign-up earned; 0 hides the credit line
 * @param {string} [o.verifyUrl]     the one-time /verify?token=… link; present ⇒ the button confirms the address
 * @param {string} [o.supportEmail]  SUPPORT_EMAIL
 */
export function welcomeEmail({ name = '', siteUrl = '', creditPaise = 0, verifyUrl = '', supportEmail = '' } = {}) {
  const site = trimEnd(siteUrl);
  const needVerify = !!verifyUrl;
  const hasCredit = creditPaise > 0;
  const support = supportEmail || DEFAULT_SUPPORT;
  const hello = `Hi ${String(name || '').split(/\s+/)[0] || 'there'},`;

  const subject = needVerify ? 'Confirm your ADDABAAZ account' : 'Welcome to ADDABAAZ';
  const heading = needVerify ? 'Confirm your email' : 'Welcome to ADDABAAZ';
  const lead = needVerify
    ? 'Confirm your email address to finish creating your ADDABAAZ account.'
    : 'Your ADDABAAZ account is ready. Watch series, stand-up, podcasts and reels made in our Kolkata studio.';
  const credit = hasCredit
    ? `Your ${inr(creditPaise)} new-account credit is already in your account. It comes off the price of any plan at checkout.`
    : '';
  const note = needVerify
    ? 'This link works once and expires in three days. Until you confirm, buying a plan is blocked.'
    : '';
  const action = needVerify ? 'Confirm my email' : 'Start watching';
  const actionUrl = needVerify ? verifyUrl : `${site}/#/`;
  const preheader = needVerify ? 'One tap confirms your email address.' : 'Your ADDABAAZ account is ready.';

  const paragraphs = [hello, lead, credit, note].filter(Boolean);
  const text = [subject, ...paragraphs, `${action}: ${actionUrl}`,
    `Questions? Reply to this email or write to ${support}.`, ADDRESS].join('\n\n');

  const para = (t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#d6d6de">${esc(t)}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(subject)}</title>
<style type="text/css">${welcomeStyle}</style>
</head>
<body style="margin:0;padding:0;background:#08080a;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08080a" style="background:#08080a;width:100%">
<tr><td align="center" style="padding:24px 12px 36px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0e0e12" style="width:100%;max-width:600px;background:#0e0e12;border-radius:16px">
  <tr><td class="pad" style="padding:22px 28px 20px;font-family:${FONT};font-size:20px;font-weight:bold;letter-spacing:3px;line-height:1;color:#ffffff">ADDA<span style="color:#d00000">BAAZ</span></td></tr>
  <tr><td class="pad" style="padding:8px 28px 0">
    <h1 class="h1" style="margin:0;font-family:${FONT};font-size:28px;font-weight:bold;line-height:1.15;color:#ffffff">${esc(heading)}</h1>
  </td></tr>
  <tr><td class="pad" style="padding:18px 28px 0">
    ${paragraphs.map((t) => para(t)).join('\n    ')}
  </td></tr>
  <tr><td class="pad" style="padding:8px 28px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" class="cta" style="border-radius:999px">
      <tr><td align="center" bgcolor="#d00000" style="padding:0;background:#d00000;border-radius:999px">
        <a href="${esc(actionUrl)}" style="display:inline-block;padding:14px 30px;font-size:14.5px;font-family:${FONT};font-weight:bold;letter-spacing:.3px;color:#ffffff;text-decoration:none">${esc(action)}</a>
      </td></tr>
    </table>
    <div style="clear:both;line-height:0;font-size:0">&nbsp;</div>
  </td></tr>
  <tr><td class="pad" style="padding:26px 28px 28px;border-top:1px solid rgba(255,255,255,.07)">
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED}">Questions? Reply to this email or write to <a href="mailto:${esc(support)}" style="color:#ffffff;text-decoration:underline">${esc(support)}</a>.</p>
    <p style="margin:14px 0 0;font-size:11.5px;line-height:1.6;color:#6f6f7c">${esc(ADDRESS)}</p>
    <p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:#5c5c68">You are receiving this because you just created an ADDABAAZ account. This is an account message, not marketing.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
