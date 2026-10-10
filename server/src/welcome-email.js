/**
 * The welcome e-mail, sent to a new account (see `sendWelcome` in features.js and docs/PROMOS.md).
 *
 * It is the ONLY mail a new address receives: the confirmation link lives in this message, so sign-up does not
 * produce a "confirm your email" note and a separate "welcome" note. `verifyUrl` is empty for an address the
 * provider already confirmed (Google/Facebook/Apple sign-in), and the credit/referral sections appear only when
 * the numbers exist — a server with `PROMO_ENABLED=false` sends the same letter without the ticket, never a
 * ticket promising Rs. 0.
 *
 * The layout is the design reviewed at /preview (preview/welcome-email.html, see preview/README.md): tables,
 * every style inline, no external CSS beyond the phone media query, no script, and `Rs.` rather than `₹`
 * because that is the format the rest of the mailers use for client compatibility. Values are escaped.
 */
import { rupees } from './gst.js';

// Same escaping rule as emails.js: nothing a user typed ever reaches the mail as markup.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trimEnd = (s) => String(s || '').replace(/\/+$/, '');
// An offer is read as an amount, not a bill: "Rs. 100", never "Rs. 100.00". The one number in this letter that
// IS a ledger line — the balance strip — uses the repo's shared money format instead, so it matches the receipts
// and the Account page. Both spell rupees out: that is the format every template in emails.js uses.
const inr = (paise) => `Rs. ${rupees(paise).replace(/\.00$/, '')}`;
const ledger = (paise) => `Rs. ${rupees(paise)}`;

const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const BENGALI = "'Tiro Bangla','Noto Serif Bengali','Noto Sans Bengali',Arial,sans-serif";
const MUTED = '#9a9aa6';
const LABEL = 'margin:0;font-size:9.5px;font-weight:bold;letter-spacing:1.9px;text-transform:uppercase;line-height:1';

/* The phone layout, shared with the preview harness: preview/welcome-email.html carries this exact block, and
 * welcome-email.test.js fails when the two drift — these rules are the difference between an email that fits a
 * phone and one that spills (see preview/README.md). Everything that must survive a client stripping <style> is
 * inline in the markup below instead. */
export const welcomeStyle = `/* The one <style> block in this mail, and the one source of the phone rules: server/src/welcome-email.js
     exports it verbatim for the letters it builds, so what a reviewer checks here is what a subscriber gets.
     Only the phone layout lives here — everything that must survive a client stripping <style> is inline. */
  @media only screen and (max-width:520px){
    /* One rule for the whole file: at phone width no <td> changes its display type and none takes width:100%.
       A block-level cell inside a table row breaks that row's box - the panel border wraps one cell while the
       others overflow it - and a cell widened to 100% squeezes the stacked neighbour beside it to ten words a
       line. Both looked fine at 600px, which is why the preview has a phone button. Sections are therefore
       built so they never need restacking: a strip sits under its panel instead of beside it, and a row whose
       two halves do different jobs is laid out side-by-side. Only the buttons reflow, and they are tables.
       server/test/preview-pages.test.js and server/test/welcome-email.test.js fail on any td-coupled
       display or width rule, and the block is shared with the mailer (see below). */
    .pad{padding-left:18px !important;padding-right:18px !important}
    .h1{font-size:26px !important;line-height:1.15 !important;letter-spacing:-.5px !important}
    .lede{font-size:15px !important}
    .figure{font-size:32px !important}
    /* The buttons are the one thing that does reflow, and they are <table>s: a table shrink-wraps its
       content, so making it block-level and full-width stretches the pill without touching its cells. */
    .cta{display:block !important;width:100% !important}
    .cta a{display:block !important}
    .ctaGhost{margin-left:0 !important;margin-top:10px !important}
    /* Show cards keep their 68px poster beside the text at every width — only the numbers shrink. */
    .cardThumb{width:68px !important;padding:12px 0 12px 12px !important}
    .cardThumb img{width:68px !important;height:auto !important}
    .cardText{padding:13px 10px 14px 13px !important}
    .cardTitle{font-size:17px !important;line-height:1.3 !important}
    .kicker{letter-spacing:1.5px !important;white-space:nowrap !important}
    .hide{display:none !important}
  }
`;

/** A dark panel is drawn even when its poster cannot (Outlook desktop has no WebP): colour first, image on top. */
const showCard = ({ show, title, kind, copy, bengali = false, siteUrl, mediaUrl }) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111116;border:1px solid rgba(255,255,255,.07);border-radius:16px">
      <tr>
        <td class="cardThumb" width="104" valign="top" style="width:104px;padding:14px 0 14px 14px">
          <a href="${esc(`${siteUrl}/#/show/${show}`)}" style="text-decoration:none"><img src="${esc(`${mediaUrl}/media/shows/${show}-sm.webp`)}" width="80" height="107" alt="${esc(title)}" style="display:block;width:80px;height:auto;border:0;border-radius:10px;background:#1a1a20"></a>
        </td>
        <td class="cardText" valign="top" style="padding:16px 12px 16px 16px">
          <p class="kicker" style="${LABEL}color:#f5c518">${esc(kind)}</p>
          <p class="cardTitle" style="margin:9px 0 0;font-family:${esc(bengali ? BENGALI : FONT)};font-size:19px;font-weight:bold;line-height:1.25;color:#ffffff"><a href="${esc(`${siteUrl}/#/show/${show}`)}" style="color:#ffffff;text-decoration:none">${esc(title)}</a></p>
          <p style="margin:7px 0 0;font-size:13px;line-height:1.6;color:${MUTED}">${esc(copy)}</p>
        </td>
        <td class="hide" valign="middle" width="54" align="right" style="width:54px;padding-right:16px">
          <a href="${esc(`${siteUrl}/#/show/${show}`)}" style="font-size:12.5px;font-weight:bold;color:#d00000;text-decoration:none">Watch&nbsp;›</a>
        </td>
      </tr>
    </table>`;

/**
 * @param {object} o
 * @param {string} o.name            the account's display name (first word only in the greeting)
 * @param {string} [o.siteUrl]       PUBLIC_SITE_URL — every link and poster is absolute from here
 * @param {string} [o.mediaUrl]      a CDN origin for /media, when the mail should not hot-link the site
 * @param {number} [o.creditPaise]   what this sign-up just earned (welcome + invite); 0 hides the ticket
 * @param {number} [o.balancePaise]  the account's spendable balance, quoted on the ticket's strip
 * @param {string} [o.verifyUrl]     the one-time /verify?token=… link; present ⇒ the primary button confirms
 * @param {string} [o.inviteCode]    this account's referral code; present ⇒ the "pass it on" strip
 * @param {number} [o.referralPaise] what a confirmed friend pays both sides (`promos.offer()`); 0 keeps the
 *                                   strip but stops quoting an amount the server has switched off
 * @param {string} [o.supportEmail]  SUPPORT_EMAIL
 */
export function welcomeEmail({ name = '', siteUrl = '', mediaUrl = '', creditPaise = 0, balancePaise = 0, verifyUrl = '', inviteCode = '', referralPaise = 0, supportEmail = '' } = {}) {
  const site = trimEnd(siteUrl), media = trimEnd(mediaUrl) || site;
  const needVerify = !!verifyUrl;
  const hasCredit = creditPaise > 0;
  // Money always comes from the caller's numbers — never a hard-coded "Rs. 100", which is how a mail ends up
  // promising an offer an admin has already turned down.
  const reward = referralPaise > 0 ? inr(referralPaise) : '';
  const hello = `Hi ${String(name || '').split(/\s+/)[0] || 'there'},`;
  const subject = hasCredit ? `Welcome to ADDABAAZ — ${inr(creditPaise)} is in your account` : 'Welcome to ADDABAAZ — your account is ready';
  const preheader = needVerify
    ? `${hasCredit ? `${inr(creditPaise)} of credit is waiting, and ` : ''}one tap confirms this address.`
    : `${hasCredit ? `${inr(creditPaise)} of ADDABAAZ credit is already in your account` : 'Series, stand-up and reels from our Kolkata studio'}.`;

  // ---- plain text: the same letter, in reading order (this is what a screen reader and a text client see) ----
  const paragraphs = [
    hello,
    'Your ADDABAAZ account is open — series, stand-up, podcasts and reels made in our Kolkata studio, streaming '
      + 'on your phone, your laptop or the television. No app store, no download, nothing else to sign up for.',
    hasCredit
      ? `${inr(creditPaise)} of ADDABAAZ credit has been added to your account.${balancePaise ? ` Balance: ${inr(balancePaise)}.` : ''} `
        + 'It comes straight off the price of any plan at checkout and stays in your account until you spend it.'
      : null,
    needVerify
      ? 'One step first: confirm this is your address. The link below works once and expires in three days — '
        + 'until it is used, buying a plan stays blocked.'
      : null,
    'Start with these three:',
    '· শহীদ (series) — Khudiram Bose, Jatindra Nath Das, Pritilata, Bina Das: one story in every episode.',
    '· Laugh Bite (stand-up) — Subhadip Ghosh, Vaskar Manna, Pramit Mitra and Anmitra Sarkar.',
    '· ফালতু কথা (podcast) — গল্প নাই, যুক্তি নাই, শুধু ফালতু কথা।',
    'Good to know: Continue Watching picks up where you stopped on any device; My List saves a title and '
      + 'Coming Soon reminders tell you the day it lands; every viewer can have their own profile, with a '
      + 'PIN-locked kids profile; and the site installs as an app from the browser.',
    inviteCode
      ? `Your invite code is ${inviteCode} — ${reward
          ? `${reward} for the friend you send it to and ${reward} for you, once they confirm their account.`
          : 'credit for the friend you send it to, and for you, once they confirm their account.'}`
        + ` Your link: ${site}/#/signup?ref=${inviteCode}`
      : null,
    'গল্প আমাদের আড্ডা থেকেই শুরু হয় — stories start at the adda. Tell us when one lands, and when it doesn’t.',
    'The ADDABAAZ team, Kolkata',
  ].filter(Boolean);
  // The links the reader may need to copy by hand. When there is no confirmation step the button list already
  // starts with watching, so it is not repeated here.
  const links = [
    needVerify ? `Confirm my email: ${verifyUrl}` : null,
    `Start watching: ${site}/#/`,
    `Plans & pricing: ${site}/#/plans`,
    inviteCode ? `Refer & earn: ${site}/#/account` : null,
  ].filter(Boolean);
  const text = [subject, ...paragraphs, '', ...links].join('\n\n')
    + `\n\nADDABAAZ · 162/B, 283 Lake Gardens, Kolkata, West Bengal 700045, India`
    + (supportEmail ? `\nQuestions? Reply to this email or write to ${supportEmail}.` : '');

  // ---- HTML ----
  /* Each pill is its own `<table>` with `align="left"`, so two sit side by side and, at phone width, stretch to
     the card. The fill AND the border live on the pill's own `<td>`: style them apart (fill on the table, border
     on the cell) and a stretched table paints a full-width button with a short outline around its words. */
  const button = (label, url, { primary = true } = {}) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" class="cta${primary ? '' : ' ctaGhost'}" style="${primary ? '' : 'margin-left:10px;'}border-radius:999px">
      <tr><td align="center" ${primary ? 'bgcolor="#d00000" style="padding:0;background:#d00000;' : 'bgcolor="#111116" style="padding:0;background:#111116;border:1px solid rgba(255,255,255,.14);'}border-radius:999px">
        <a href="${esc(url)}" style="display:inline-block;padding:${primary ? '14px 30px;font-size:14.5px' : '13px 24px;font-size:14px'};font-family:${FONT};font-weight:bold;letter-spacing:.3px;color:${primary ? '#ffffff' : '#d6d6de'};text-decoration:none">${esc(label)}</a>
      </td></tr>
    </table>`;

  const ticket = hasCredit ? `
  <!-- The credit ticket: the balance strip sits under the amount at every width, so nothing restacks on a phone. -->
  <tr><td class="pad" style="padding:28px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#14141a" style="background:#14141a;border:1px solid rgba(245,197,24,.26);border-radius:16px">
      <tr><td style="padding:20px 20px 18px">
        <p style="${LABEL}color:#f5c518">New-account credit</p>
        <p class="figure" style="margin:12px 0 0;font-family:${FONT};font-size:38px;font-weight:bold;line-height:1;letter-spacing:-1px;color:#ffffff">${inr(creditPaise)}</p>
        <p style="margin:12px 0 0;font-size:13.5px;line-height:1.65;color:${MUTED}">
          It comes straight off the price of any plan at checkout, and it stays in your account until you spend
          it. Nothing to activate, no card to add first.
        </p>
      </td></tr>${balancePaise ? `
      <tr><td bgcolor="#1a1a22" style="background:#1a1a22;border-top:1px dashed rgba(245,197,24,.3);border-radius:0 0 16px 16px;padding:13px 20px 14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle"><p style="${LABEL}color:#7d7d8a">Balance</p><p style="margin:6px 0 0;font-size:11px;line-height:1.4;color:#6f6f7c">Account › Credit</p></td>
          <td valign="middle" align="right"><p style="margin:0;font-family:${FONT};font-size:21px;font-weight:bold;line-height:1;letter-spacing:-.4px;color:#f5c518">${ledger(balancePaise)}</p></td>
        </tr></table>
      </td></tr>` : ''}
    </table>
  </td></tr>` : '';

  const referral = inviteCode ? `
  <tr><td class="pad" style="padding:34px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#161208" style="background:#161208;border:1px dashed rgba(245,197,24,.34);border-radius:16px">
      <tr><td style="padding:20px 22px 22px">
        <p style="${LABEL}color:#f5c518">Pass it on</p>
        <p style="margin:11px 0 0;font-family:${FONT};font-size:20px;font-weight:bold;line-height:1.3;letter-spacing:-.3px;color:#ffffff">${reward ? `${reward} for them.<br>${reward} for you.` : 'Credit for them,<br>credit for you.'}</p>
        <p style="margin:11px 0 0;font-size:13.5px;line-height:1.65;color:${MUTED}">
          Share your code — ${reward ? `both balances go up by ${reward} the moment your friend confirms their `
            + 'account, ' : 'credit lands on both sides the moment your friend confirms their account, '}so the
          offer stays honest for everyone.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#0b0b0d" style="background:#0b0b0d;border:1px solid rgba(245,197,24,.3);border-radius:10px;padding:10px 16px;font-family:${FONT};font-size:14px;font-weight:bold;letter-spacing:3.4px;color:#f5c518">${esc(inviteCode)}</td>
            <td style="padding-left:14px"><a href="${esc(`${site}/#/account`)}" style="font-size:13.5px;font-weight:bold;color:#ffffff;text-decoration:underline">Open Refer &amp; earn</a></td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>` : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">
<title>${esc(subject)}</title>
<style type="text/css">${welcomeStyle}</style>
</head>
<body style="margin:0;padding:0;background:#08080a;font-family:${FONT};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0">${esc(preheader)}&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08080a" style="background:#08080a;width:100%">
<tr><td align="center" style="padding:26px 12px 40px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0e0e12" style="width:100%;max-width:600px;background:#0e0e12;border:1px solid rgba(255,255,255,.07);border-radius:20px">

  <tr><td bgcolor="#050505" class="pad" style="background:#050505;padding:20px 28px 18px;border-radius:20px 20px 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="font-family:${FONT};font-size:21px;font-weight:bold;letter-spacing:3.2px;line-height:1;color:#ffffff">ADDA<span style="color:#d00000">BAAZ</span></td>
      <td valign="middle" align="right" class="hide" style="font-size:9px;font-weight:bold;letter-spacing:2.4px;text-transform:uppercase;line-height:1;color:#6f6f7c">Stories beyond the screen</td>
    </tr></table>
  </td></tr>
  <tr>
    <td bgcolor="#8f0000" height="2" style="background:#8f0000;width:34%;font-size:0;line-height:0">&nbsp;</td>
    <td bgcolor="#b80000" height="2" style="background:#b80000;width:33%;font-size:0;line-height:0">&nbsp;</td>
    <td bgcolor="#d00000" height="2" style="background:#d00000;width:33%;font-size:0;line-height:0">&nbsp;</td>
  </tr>

  <tr><td class="pad" style="padding:26px 28px 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" width="8" bgcolor="#d00000" style="width:8px;background:#d00000;border-radius:999px;font-size:0;line-height:0;height:8px">&nbsp;</td>
      <td valign="middle" style="padding-left:9px;${LABEL}color:#8d8d99">স্বাগতম · your account is ready</td>
    </tr></table>
    <h1 class="h1" style="margin:14px 0 0;font-family:${FONT};font-size:34px;font-weight:bold;line-height:1.08;letter-spacing:-.8px;color:#ffffff">
      Bengali originals,<br>from our adda to&nbsp;your&nbsp;screen.
    </h1>
    <p class="lede" style="margin:16px 0 0;font-size:15.5px;line-height:1.7;color:#a3a3b0">
      ${esc(hello)} this is the whole of ADDABAAZ in one place — series, stand-up, podcasts and reels made in our
      Kolkata studio, on your phone, your laptop or the television. ${hasCredit
        ? `We have put ${inr(creditPaise)} of credit in your account to start you off.`
        : 'Nothing to download and nothing else to sign up for.'}
    </p>
  </td></tr>
${ticket}
  <tr><td class="pad" style="padding:26px 28px 0">
    ${needVerify
      ? button('Confirm\u00a0my\u00a0email', verifyUrl) + button('Start\u00a0watching', `${site}/#/`, { primary: false })
      : button('Start\u00a0watching', `${site}/#/`) + button('Plans\u00a0&\u00a0pricing', `${site}/#/plans`, { primary: false })}
    <div style="clear:both;line-height:0;font-size:0">&nbsp;</div>
    <p style="margin:14px 0 0;font-size:12.5px;line-height:1.6;color:${MUTED}">
      ${needVerify
        ? 'The link above works once and expires in three days. Until it is used, buying a plan stays blocked — '
          + 'watching is open right now.'
        : 'This address was already confirmed by your provider, so everything is open — no extra step.'}
    </p>
  </td></tr>

  <tr><td class="pad" style="padding:38px 28px 0">
    <p style="margin:0;font-family:${FONT};font-size:19px;font-weight:bold;letter-spacing:-.3px;line-height:1.2;color:#ffffff">Start with these three</p>
  </td></tr>
  <tr><td class="pad" style="padding:16px 28px 0">
${['01 · Series', '02 · Stand-up', '03 · Podcast'].map((kind, i) => {
  const s = [
    { show: 'shahid', title: 'শহীদ', bengali: true, copy: 'Khudiram Bose, Jatindra Nath Das, Pritilata, Bina Das — one story in every episode.' },
    { show: 'laugh-bite', title: 'Laugh Bite', copy: 'Subhadip Ghosh, Vaskar Manna, Pramit Mitra and Anmitra Sarkar — local jokes, local trains, local chaos.' },
    { show: 'faltu-kotha', title: 'ফালতু কথা', bengali: true, copy: 'গল্প নাই, যুক্তি নাই — শুধু ফালতু কথা. Unfiltered and occasionally unhinged.' },
  ][i];
  return showCard({ ...s, kind, siteUrl: site, mediaUrl: media });
}).join('\n    <div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>\n')}
  </td></tr>

  <tr><td class="pad" style="padding:38px 28px 0">
    <p style="margin:0;font-family:${FONT};font-size:19px;font-weight:bold;letter-spacing:-.3px;line-height:1.2;color:#ffffff">Four things worth knowing</p>
  </td></tr>
  <tr><td class="pad" style="padding:6px 28px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${[
  ['Continue watching', 'Stop mid-episode on the phone, finish it on the laptop — we keep the timestamp and autoplay hands you the next one.'],
  ['My List &amp; reminders', 'Save anything for later. On a Coming Soon title, tap Remind me and we tell you the day it lands.'],
  ['Who’s watching?', 'A profile each, with its own list — and a PIN-locked kids profile whenever you want one.'],
  ['Installs itself', 'Open it in the browser and choose Add to Home screen — it becomes an app on Android, iOS and desktop.'],
].map(([label, copy], i) => `      <tr><td style="padding:15px 0 16px;${i ? 'border-top:1px solid rgba(255,255,255,.06);' : ''}">
        <p style="${LABEL}color:#d00000">${label}</p>
        <p style="margin:8px 0 0;font-size:13.5px;line-height:1.62;color:${MUTED}">${copy}</p>
      </td></tr>`).join('\n')}
    </table>
  </td></tr>
${referral}
  <tr><td class="pad" style="padding:34px 28px 34px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="2" bgcolor="#d00000" style="width:2px;background:#d00000;font-size:0;line-height:0">&nbsp;</td>
      <td valign="top" style="padding-left:16px">
        <p style="margin:0;font-family:${BENGALI};font-size:16px;line-height:1.8;color:#e6e6ec">গল্প আমাদের আড্ডা থেকেই শুরু হয়। ভালো লাগলে শোনো, না লাগলে বলো — আমরা শুনছি।</p>
        <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#7d7d8a">Stories start at the adda. Tell us when one lands — and when it doesn’t. — <span style="color:#c8c8d2;font-weight:bold">The ADDABAAZ team, Kolkata</span></p>
      </td>
    </tr></table>
  </td></tr>

  <tr><td bgcolor="#050505" class="pad" style="background:#050505;border-top:1px solid rgba(255,255,255,.07);padding:24px 28px 26px;border-radius:0 0 20px 20px">
    <p style="margin:0;font-size:12.5px;line-height:1.7;color:#8d8d99">
      Trouble signing in, with a plan or a payment? Reply to this mail or write to
      <a href="mailto:${esc(supportEmail || 'office@addabaaz.in')}" style="color:#ffffff;text-decoration:underline">${esc(supportEmail || 'office@addabaaz.in')}</a>
      — a real person answers. You can also raise a ticket under <a href="${esc(`${site}/#/support`)}" style="color:#ffffff;text-decoration:underline">Support</a>.
    </p>
    <p style="margin:18px 0 0;line-height:1">
      ${[['Instagram', 'https://www.instagram.com/addabaazdeep'], ['Facebook', 'https://www.facebook.com/ADDABAAZDEEP'], ['YouTube', 'https://www.youtube.com/@ADDABAAZ01'], ['Reels', `${site}/#/reels`]]
        .map(([l, u]) => `<a href="${esc(u)}" style="display:inline-block;margin:0 6px 8px 0;padding:7px 13px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background-color:#111116;font-size:9.5px;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase;color:#c2c2cc;text-decoration:none">${l}</a>`).join('')}
    </p>
    <p style="margin:20px 0 0;font-size:11.5px;line-height:1.7;color:#6f6f7c">
      ADDABAAZ · 162/B, 283 Lake Gardens, Kolkata, West Bengal 700045, India ·
      <a href="${esc(`${site}/#/privacy`)}" style="color:#9a9aa6;text-decoration:underline">Privacy</a> ·
      <a href="${esc(`${site}/#/terms`)}" style="color:#9a9aa6;text-decoration:underline">Terms</a> ·
      <a href="${esc(`${site}/#/refunds`)}" style="color:#9a9aa6;text-decoration:underline">Refunds</a> ·
      <a href="${esc(`${site}/#/account`)}" style="color:#9a9aa6;text-decoration:underline">Email preferences</a>
    </p>
    <p style="margin:9px 0 0;font-size:11px;line-height:1.6;color:#5c5c68">
      You’re getting this because you just created an ADDABAAZ account${needVerify ? ' — that is why it carries a confirmation link' : ''}.
      Receipts and security notices will keep arriving at this address; those are not marketing and cannot be turned off.
    </p>
  </td></tr>

</table>
<p style="margin:20px 0 0;font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;color:#4a4a55;text-align:center">ADDABAAZ · stories beyond the screen · Kolkata</p>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
