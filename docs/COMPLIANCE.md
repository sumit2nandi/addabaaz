# Compliance notes (India) — read before launch

> **The Privacy Policy, Terms of Use and Refund Policy served at `/privacy`, `/terms`, `/refunds` are templates written by a developer, not a lawyer.** They describe what this software actually does, but you must have them reviewed against your real business (company name, grievance officer, jurisdiction, data processors) before you take money. Edit the text in `app/js/legal-text.js` (one file, shared by the site and the SEO renderer) and bump `LEGAL_UPDATED`.

## What the software does that the policies must match
- **Personal data stored:** name, email, phone number (only when the viewer signs in by SMS), salted password hash (scrypt), provider ids (Google/Facebook/Apple), profiles (name, colour, Kids flag), My List, reminders, watch progress, ratings, comments/reports, hashed parental PIN, device label + last-seen for the screens limit, push subscription (if enabled), payment records (plan, amount, GST details you enter, Razorpay ids — never card/UPI data), invoices, contact-form messages, error reports.
- **Third parties (processors):** Razorpay (payments), your SMTP provider, Cloudflare R2 (video/reel media, Broadcast photos, optional backups), Google/Facebook/Apple (sign-in), YouTube (embedded free videos), Google Analytics **only after consent**, Sentry only if you enable it. Add your hosting/database provider.
- **Cookies/storage:** essential local storage only (session, profile, settings, offline cache). The consent banner appears only when GA4 is configured; "Privacy choices" is always in the footer.
- **Deletion:** Account → Delete account erases the account, profiles, list, progress, ratings and comments immediately. Payment/invoice records are **retained** because GST law requires it — say so in your policy (the template does).
- **DPDP Act 2023** (India): you need a grievance contact, a way to withdraw consent (footer → Privacy choices) and a way to erase data (above). Children: the Kids profile is an app-level filter; if you knowingly serve under-18s you should read the DPDP rules on verifiable parental consent with your lawyer.

## GST
Invoices are GST-inclusive at 18% (SAC 998439) with gapless numbering and credit notes — see `docs/BILLING.md`. **Not included:** e-invoice/IRN generation (needed above the turnover threshold; requires a GST Suvidha Provider), GSTR-1/3B filing. The CSV register in Admin → Payments is meant to be handed to your accountant.

## App stores
- Apple requires **Sign in with Apple** next to Google/Facebook (implemented) and may require in-app purchase for digital subscriptions — the apps deliberately do not sell anything: no price, no checkout, no purchase link, no payment-provider name; the Plans page says "Plans are managed on the ADDABAAZ website". Buying happens on the website (Razorpay). Apple/Google may still object to a web-billed model, so check the current guidelines before submitting — see [PAYMENTS.md](PAYMENTS.md) for the exact wording and where it is enforced in code.
- A **phone number** may be used to sign in (SMS OTP, MSG91). It is personal data: it is stored verified and unique, only a hash of each one-time code is kept, and the code is never written to logs. DLT registration is required in India for the SMS itself ([MSG91.md](MSG91.md)).
- Both stores require a public privacy-policy URL (`https://your-site/privacy`) and account-deletion inside the app (Account → Delete account).

## Content
- **No DRM**: premium video is protected by login + paid plan + short-lived signed URLs, which stops casual sharing but not a determined person screen-recording or downloading a stream. Studio-grade DRM (Widevine/FairPlay) needs a DRM provider.
- **No offline downloads**: not offered for free YouTube videos (YouTube's terms forbid it) and not for premium (would need DRM).
