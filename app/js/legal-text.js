/* Privacy Policy, Terms of Use and Refund Policy — plain data (no DOM), shared by the browser view and the server's crawlable HTML.
 * This is a good-faith template based on current application behavior, not legal advice. Have a lawyer review it before launch.
 * Names, address and contact e-mail come from the studio profile (data/studio.json / admin console). */
// Date shown as "Last updated"; change it whenever the text changes.
export const LEGAL_UPDATED = '2026-10-06';
// URL -> document id.
export const LEGAL_PAGES = { '/privacy': 'privacy', '/terms': 'terms', '/refunds': 'refunds' };

// Business address from the studio profile, with a default.
const ADDRESS = (st) => (st.address || []).join(', ') || 'Kolkata, West Bengal, India';

// Builds one legal document as { title, intro, sections: [[heading, [paragraphs]]] }, filled with the studio's name, e-mail and address.
export function legalDoc(slug, { studio = {}, refundDays = 7 } = {}) {
  const name = studio.name || 'ADDABAAZ', email = studio.email || 'office@addabaaz.in', address = ADDRESS(studio);
  const contact = `Privacy and grievance contact: ${email}. Postal contact: ${address}.`;
  const docs = {
    privacy: {
      title: 'Privacy Policy',
      intro: `${name} (“we”, “us”) operates the ${name} website and apps. This policy explains the personal data the service processes, why it is used, which providers receive it, how long it is kept, and how to ask us to delete it.`,
      sections: [
        ['Data we process', [
          'Account and sign-in: your name, email address, phone number if you use SMS sign-in, a salted password hash (not your password), and the provider identifier and basic profile information needed when you choose Google, Facebook or Apple sign-in. An SMS-only account keeps an internal placeholder email derived from the verified number until you add and confirm a contact email in Account. During confirmation we store the pending address and a hash of a one-time link token; the link expires after one hour, the pending row is deleted on confirmation or delivery failure, and an unconfirmed row is purged one day after expiry. The request time is recorded for a one-minute resend limit and cleared after one day. The placeholder is not replaced before you confirm; when changing an existing confirmed address, the current address remains active until the replacement is confirmed.',
          'Profiles and viewing: profile names, colours and Kids-profile settings; My List, reminders, ratings and watch progress. A parental PIN is stored as a hash. Playback protection records a device identifier and label, the video being watched, and recent activity so the service can enforce the simultaneous-stream limit.',
          'Phone verification: when you request an SMS code, we process the normalized phone number, a hash of the one-time code, attempt/expiry timestamps and verification status. The six-digit code is sent to MSG91 for delivery; we do not store the code itself. MSG91 and mobile-network providers may process the number and message for delivery under their own terms.',
          'Support and contact: support tickets can include your name, email, optional phone number, issue category, subject, message, app version, platform, device details and replies. The website contact form can include your name, email, optional phone number and message. If the app is running without its API, the contact form sends those fields to the configured Google Forms endpoint instead of our database.',
          'Billing: our database stores the plan, amount, currency, payment status and Razorpay order/payment identifiers. An invoice or credit-note snapshot can include the buyer name and email, optional GSTIN, state, tax amounts and payment reference. New SMS-only-account invoices omit the internal placeholder as a buyer email; older invoice snapshots are not rewritten. Receipts, refund notices and emailed documents are not sent to that placeholder. Until you confirm a contact email, documents can be downloaded and refund status is shown in Billing; once confirmed, eligible account and billing emails can be sent there. Razorpay processes checkout and payment information; we do not store card numbers, UPI credentials or bank-account credentials.',
          'Devices, diagnostics and notifications: if enabled, browser push subscriptions or app push tokens and notification preferences; technical error reports may include an account identifier, URL, browser/device details, error text and stack trace. We also keep aggregate play counts and watch-time totals that are not tied to a profile.',
          'Local-only use: when the app has no API connection, guest profiles, lists, progress, ratings and preferences may be stored in that browser or app installation. They are not uploaded to an ADDABAAZ account in local mode and remain on the device until cleared or the app is removed.',
        ]],
        ['How we use it', [
          'To create and secure accounts, verify email addresses or phone numbers, provide profiles and viewing features, and enforce the plan and simultaneous-screen limits.',
          'To process payments, issue invoices and credit notes, respond to support/contact requests, prevent abuse, troubleshoot errors, and keep service and delivery records.',
          'To send requested service messages and notifications. Optional Google Analytics is used only after you accept analytics consent; first-party play counts and watch-time totals are used to understand service usage.',
        ]],
        ['Service providers and sharing', [
          'Depending on the feature and deployment, data is processed by Razorpay (checkout and payments), MSG91 (SMS verification), the configured email/SMTP provider (confirmation links are sent to the contact address you submit; billing/account mail is sent only after the address is confirmed), the hosting/database provider, and Cloudflare R2 (private video/reel media and broadcast images).',
          'If you choose social sign-in, Google, Facebook or Apple processes the sign-in. YouTube/Google may receive connection and playback information when a YouTube player or thumbnail is loaded. Firebase Cloud Messaging delivers app push notifications. Google Analytics is loaded only after consent.',
          'When the site has no API connection, its contact-form fallback uses Google Forms. Google receives the submitted form fields and may process request/device data under its own terms. If the server’s optional contact webhook is configured, the same submission is also sent to the operator-selected endpoint (for example, a Slack, Zapier or Apps Script integration). Support/contact notifications and webhook copies may remain with their recipients and providers under their own retention terms.',
          'We may disclose information when required by law or to protect the service and its users. We do not sell personal data. Provider names and processing locations can change with deployment configuration; each provider handles data under its own privacy and retention terms.',
        ]],
        ['Cookies and device storage', [
          'The app uses local storage and session storage for essential items such as the sign-in session, active profile, settings, local-mode library and consent choice. The service worker may cache application files and artwork. Browser storage is kept on your device and can be cleared through its settings.',
          'Google Analytics is off until you accept the consent banner; you can withdraw that choice in Privacy choices in the footer. YouTube embeds and other providers may use their own cookies or similar technologies when their content is loaded.',
        ]],
        ['Retention and account deletion', [
          'You can delete a signed-in account from the Delete account page linked in the footer. If you cannot sign in, use the instructions at /delete-account. After a verified request, we delete the account, sign-in identities, profiles, ratings, My List, reminders, watch progress, subscription, credits/referrals, linked push registrations, pending contact-email tokens/addresses, phone OTP history for the account number, linked diagnostics, refund requests, playback/notification records, and support-ticket conversations/replies linked by account ID, account email or verified phone number. Contact-form records in our database matching the account email or verified phone number are also removed.',
          'Payment, refund, invoice and credit-note records are retained with their account link removed. Billing snapshots can still contain the buyer name, email, optional GSTIN, state, amounts, provider payment/refund references, tax details and a credit-note reason. The application has no automatic purge for these billing records; they are retained for accounting/compliance purposes and may be deleted only when the applicable retention requirements permit. Razorpay may separately retain its own transaction records.',
          'Completed broadcast delivery records are retained for up to 365 days after the campaign completes. On account deletion we clear the recipient name, email, destination, account link and delivery error; we also replace the account-linked delivery digest with a fresh random key, while keeping campaign counts/status and the delivery row. The campaign creator email is cleared if it matches the deleted account.',
          'Backups can contain a pre-deletion copy and are not rewritten when an account is deleted. The application backup script keeps the newest 14 local backup files by default when it runs; copies in the separate R2 backup bucket and hosting/database snapshots follow their separately configured retention and are not pruned by account deletion. Backup encryption is enabled only when the operator configures it.',
          'Other application schedules are: support tickets up to 365 days after their last activity; contact messages in our database up to 365 days after submission; error reports up to 30 days; playback-session rows up to 90 days after activity; SMS-code hashes until one day after code expiry (codes expire after 10 minutes); pending contact-email links expire after one hour, unconfirmed address/token rows are purged one day after expiry, and email-change request timestamps are cleared one day after the request; and inactive app push tokens up to 180 days. Browser push subscriptions remain until you unsubscribe, the endpoint is removed after repeated delivery failures, or your account is deleted. These schedules run automatically. Account deletion removes linked records sooner where described above.',
          'Append-only administrator audit records do not have an automatic expiry. They can retain an administrator email, action details/metadata, target account email or UUID, and IP address for security/accountability; older audit entries may include a target email. A contact-form submission sent to Google Forms or a configured contact-webhook endpoint, email copies, provider logs, or local-only data on your device is outside the account database deletion and may require a separate request or device/provider action; third-party retention follows the recipient/provider’s terms.',
        ]],
        ['Your choices and requests', [
          'You can manage profile details and preferences in the app, manage notification settings, withdraw optional analytics consent, and contact us to request access to or correction/deletion of personal data. Deleting an account cannot be undone; retained billing records are described above.',
          `For a privacy request or grievance, email ${email} from the account address where possible, or write to ${address}. Do not send your password, one-time code, full payment-card details or UPI PIN. We may ask for reasonable information to verify a request and aim to acknowledge it within 7 days.`,
        ]],
        ['Children', [
          'An adult should create and manage an ADDABAAZ account. A Kids profile is a child-friendly content filter inside an adult’s account; it is not a separate child account and does not create a separate login. The filter runs in the app and is not a security boundary. If you believe a child’s information was submitted without appropriate authorization, contact us so we can review it.',
        ]],
        ['Security and changes', [
          'We use HTTPS, password hashing, revocable sessions and restricted, audited administrator access. No online system is perfectly secure. We may update this policy when the service or its providers change; the date at the top shows the latest revision.',
          contact,
        ]],
      ],
    },
    terms: {
      title: 'Terms of Use',
      intro: `These terms are an agreement between you and ${name} for the use of our website, apps and videos. By using ${name} you accept them.`,
      sections: [
        ['Your account', [
          'You must give accurate details and keep your password safe. You are responsible for activity under your account. Sharing an account outside your household, or using bots or scrapers, is not allowed.',
          'Premium plans allow a limited number of screens to stream at the same time; extra devices are refused until another stops. An adult should create and manage an account; Kids profiles are parent-managed viewing filters.',
          'You can delete your account on the Delete account page or, if you cannot sign in, follow the external instructions at /delete-account. The Privacy Policy explains what is deleted and which billing or audit records may remain.',
        ]],
        ['Free and premium content', [
          'Most episodes, reels and trailers are free and need no account. Premium titles need you to be signed in and to hold an active paid plan.',
          'Plans are prepaid for a fixed period (for example 30 or 365 days) and do not renew automatically; we remind you before they end. Prices are in Indian rupees and include GST. See the Plans page for current prices.',
          'Streaming is for your personal, non-commercial viewing only. You may not download, record, copy, redistribute or publicly show our videos, or try to get around access controls.',
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
      intro: `We want you to be happy with ${name} Premium. This policy explains when and how you can get your money back.`,
      sections: [
        ['Cancelling', [
          'Plans are prepaid and never renew automatically, so there is nothing to cancel and you will not be charged again unless you buy another plan. Your access continues until the end of the period you paid for.',
        ]],
        [`Refunds within ${refundDays} days`, [
          `If you are not satisfied, you can ask for a refund of a purchase within ${refundDays} days of paying. Open Account → Billing & invoices, choose the payment and press “Request a refund”. Tell us why — it helps us improve.`,
          `Requests after ${refundDays} days are considered only where the law requires it, for example if a title you bought was withdrawn or the service was unavailable for a long period.`,
        ]],
        ['How it works', [
          'We review requests within 2 working days. If your account has a confirmed contact email, we email you the decision; otherwise, check Billing & invoices for the status. Approved refunds go back to the original payment method through Razorpay and normally reach you in 5–7 working days, depending on your bank.',
          'A full refund ends the days that purchase gave you. A GST credit note appears in Billing & invoices; it can be downloaded there and emailed to you after you confirm a contact email.',
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
