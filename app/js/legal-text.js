/* Privacy Policy, Terms of Use and Refund Policy — plain data (no DOM), shared by the browser view and the server's crawlable HTML.
 * This is a good-faith TEMPLATE written for the way this app works. It is not legal advice: have a lawyer review and adjust it
 * before you go live (see docs/COMPLIANCE.md). Names, address and e-mail come from the studio profile (data/studio.json / admin console). */
// Date shown as "Last updated"; change it whenever the text changes.
export const LEGAL_UPDATED = '2026-09-29';
// URL -> document id.
export const LEGAL_PAGES = { '/privacy': 'privacy', '/terms': 'terms', '/refunds': 'refunds' };

// Business address from the studio profile, with a default.
const ADDRESS = (st) => (st.address || []).join(', ') || 'Kolkata, West Bengal, India';

// Builds one legal document as { title, intro, sections: [[heading, [paragraphs]]] }, filled with the studio's name, e-mail and address.
export function legalDoc(slug, { studio = {}, refundDays = 7 } = {}) {
  const name = studio.name || 'ADDABAAZ', email = studio.email || 'office@addabaaz.in', address = ADDRESS(studio);
  const contact = `Write to us at ${email} or at ${address}.`;
  const docs = {
    privacy: {
      title: 'Privacy Policy',
      intro: `${name} (“we”, “us”) runs the ${name} website and apps. This policy explains what personal data we collect, why, who receives it and what choices you have. It follows the principles of India’s Digital Personal Data Protection Act, 2023.`,
      sections: [
        ['What we collect', [
          'Account: your name, email address and a salted, hashed password (we never store your password itself). If you sign in with Google, Facebook or Apple we receive your name, email address and that provider’s user id — nothing else.',
          'Profiles and library: profile names, colours and Kids-profile flag, your My List, reminders, ratings, watch progress, and — if you set one — a hashed parental PIN.',
          'Comments you post, and reports you file about other comments.',
          'Payments: which plan you bought, the amount, GST details you enter (state, optional GSTIN and business name) and the Razorpay order and payment ids. Card, UPI and bank details are entered on Razorpay’s pages and never reach our servers.',
          'Devices and usage: a random device id, a device label such as “Android · Chrome”, the time each device last watched (to enforce the limit on simultaneous screens), and anonymous play counts and watch time per video. Basic server logs (IP address, browser, pages) and error reports help us keep the service running.',
          'Notifications: if you turn them on, your browser’s push subscription.',
        ]],
        ['Why we use it', [
          'To create and secure your account, show your library on every device, and let you watch premium titles you have paid for.',
          'To process payments, issue GST invoices and credit notes, send receipts and refund emails, and keep the records the law requires.',
          'To send service messages (verification, password reset, receipts, plan-expiry reminders) and — only if you opt in — notifications about new episodes and announcements.',
          'To moderate comments, prevent abuse and fraud, fix errors and understand which titles people watch.',
        ]],
        ['Who receives it', [
          'Service providers acting for us: Razorpay (payments), Cloudflare (hosting premium video in R2), our email delivery provider, and our hosting and database providers.',
          'Google, Facebook and Apple, if you choose to sign in with them. YouTube, whose player shows most of our free videos, may set its own cookies and collect data under Google’s policy when you press play.',
          'Google Analytics, only if you accept optional analytics in the cookie notice.',
          'Authorities, when the law requires it. We do not sell your personal data.',
        ]],
        ['Cookies and local storage', [
          'We use your browser’s local storage to keep you signed in, remember your profile and settings, and cache the app for offline use. These are essential and need no consent.',
          'Optional analytics are off unless you accept them in the notice at the bottom of the page. You can change your mind at any time from Account → Privacy choices.',
        ]],
        ['How long we keep it', [
          'Your account data is kept until you delete your account (Account → Delete account), which erases your profiles, list, progress, ratings and comments.',
          'Invoices and credit notes are kept, detached from your account, for as long as Indian tax law requires. Server logs and error reports are kept for about 30 days; playback-session records for a few minutes.',
        ]],
        ['Your rights', [
          'You can see and correct your details in Account, download your invoices in Billing, delete your account at any time, withdraw consent for notifications and analytics, and ask us for a copy of your data or to fix or erase it.',
          `To exercise a right or raise a concern, ${contact} We aim to reply within 7 days.`,
        ]],
        ['Children', [
          'Kids profiles live inside a parent’s or guardian’s account. Only an adult should create an account. Kids profiles show only titles we have rated for children, cannot post comments, and can be protected with a parental PIN. We do not knowingly collect data from a child without a parent’s consent; if you believe we have, contact us and we will delete it.',
        ]],
        ['Security', [
          'Traffic is encrypted with HTTPS, passwords are hashed, sign-in tokens can be revoked (“Sign out everywhere”), and access to admin tools is restricted and logged. No system is perfectly secure; if a breach affects you we will tell you and the authorities as the law requires.',
        ]],
        ['Changes and contact', [`We will post changes on this page and update the date above. ${contact}`]],
      ],
    },
    terms: {
      title: 'Terms of Use',
      intro: `These terms are an agreement between you and ${name} for the use of our website, apps and videos. By using ${name} you accept them.`,
      sections: [
        ['Your account', [
          'You must give accurate details and keep your password safe. You are responsible for what happens under your account. Sharing an account outside your household, or using bots or scrapers, is not allowed.',
          'Premium plans allow a limited number of screens to stream at the same time; extra devices are refused until another stops.',
        ]],
        ['Free and premium content', [
          'Most episodes, reels and trailers are free and need no account. Premium titles need you to be signed in and to hold an active paid plan.',
          'Plans are prepaid for a fixed period (for example 30 or 365 days) and do not renew automatically; we remind you before they end. Prices are in Indian rupees and include GST. See the Plans page for current prices.',
          'Streaming is for your personal, non-commercial viewing only. You may not download, record, copy, redistribute or publicly show our videos, or try to get around access controls.',
        ]],
        ['Community rules', [
          'Comments must be respectful. No hate, harassment, threats, spam, adverts, personal information or unlawful content, and no links. We may hide or remove comments and suspend accounts that break these rules; comments reported by several viewers are hidden until a moderator reviews them.',
          'You keep ownership of what you write and give us a free licence to show it on the service.',
        ]],
        ['Our content', [
          `The videos, images, logos and text on ${name} belong to us or our licensors and are protected by copyright and trademark law. Nothing in these terms transfers any rights to you.`,
        ]],
        ['Availability and changes', [
          'We work to keep the service running but do not promise it will be uninterrupted or error-free. We may add, change or remove titles and features. Where we withdraw a paid title you were entitled to, we will, at your request, refund the unused part of your plan.',
        ]],
        ['Suspension and ending', [
          'You can stop using the service and delete your account at any time. We may suspend or end accounts that break these terms or the law. Refunds are handled under the Refund Policy.',
        ]],
        ['Liability', [
          'To the extent the law allows, the service is provided “as is”, and our total liability for a claim is limited to the amount you paid us in the 12 months before it. Nothing here limits liability that cannot be limited by law or your rights as a consumer.',
        ]],
        ['Governing law and contact', [
          `These terms are governed by the laws of India and the courts at Kolkata, West Bengal have jurisdiction, subject to any consumer rights you have to sue elsewhere. ${contact}`,
        ]],
      ],
    },
    refunds: {
      title: 'Refund & Cancellation Policy',
      intro: `We want you to be happy with ${name} Plus. This policy explains when and how you can get your money back.`,
      sections: [
        ['Cancelling', [
          'Plans are prepaid and never renew automatically, so there is nothing to cancel and you will not be charged again unless you buy another plan. Your access continues until the end of the period you paid for.',
        ]],
        [`Refunds within ${refundDays} days`, [
          `If you are not satisfied, you can ask for a refund of a purchase within ${refundDays} days of paying. Open Account → Billing & invoices, choose the payment and press “Request a refund”. Tell us why — it helps us improve.`,
          `Requests after ${refundDays} days are considered only where the law requires it, for example if a title you bought was withdrawn or the service was unavailable for a long period.`,
        ]],
        ['How it works', [
          'We review requests within 2 working days and email you the decision. Approved refunds go back to the original payment method through Razorpay and normally reach you in 5–7 working days, depending on your bank.',
          'A full refund ends the days that purchase gave you. A GST credit note for the refund is emailed to you and appears in Billing & invoices.',
        ]],
        ['Failed and duplicate payments', [
          'If money left your account but you did not get your plan, or you were charged twice, write to us with the payment reference — we will fix it or refund the extra charge in full. Amounts debited for failed payments are usually returned automatically by your bank within a few working days.',
        ]],
        ['Coupons', [
          'If you paid with a coupon, we refund what you actually paid. Coupons on refunded purchases are not re-issued.',
        ]],
        ['Contact', [contact]],
      ],
    },
  };
  return docs[slug] || null;
}
