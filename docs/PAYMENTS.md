# Collecting money: website vs the Android/iOS apps

*Read the last section before you rely on this: store rules changed three times in 2025–2026 and the dates below
matter. **Verified against Apple's, Google's and Razorpay's own documentation on 3 October 2026.***

**Short answer.**

- **Website — yes, today.** Razorpay Checkout is already wired end to end (`docs/PREMIUM.md#payments-razorpay`,
  `server/src/payments.js`, `app/js/payments.js`). It needs a Razorpay account with **live keys** and the webhook.
- **Apps — not with Razorpay while the rules stand, and this is a store-policy question, not a Razorpay one.**
  Apple and Google both require *their* billing for digital subscriptions sold **inside** an app. ADDABAAZ is built
  as a **consumption-only** app (Apple calls it a **reader app**): people sign in and watch what they paid for on
  the website. That model is allowed on both stores today and is what the code does (`canBuy = !isNative` in
  `app/js/views/plans.js`).
- Selling inside the apps is possible, but only through the store programmes below (or store billing). Razorpay-only
  in-app selling becomes possible on Google Play as Google's 2026 billing-choice programme reaches each country —
  **India is in the last wave, by 30 September 2027**. Apple has no such programme in India.

| Where | Collect with Razorpay? | Status today |
|---|---|---|
| **Website / PWA** (any browser) | ✅ **Yes** | Implemented: order → Checkout → HMAC verify → webhook → invoice/refund |
| **Android app** (Google Play, India) | ⚠️ Only through a store programme | Consumption-only now (allowed). In-app Razorpay **alongside** Play Billing = Google *User Choice Billing*, fee −4%; own-billing/web-link programmes arrive in India by 30 Sep 2027 |
| **iOS app** (App Store, India) | ❌ Not for in-app selling | Reader-app model: watch-only + optional "manage account" link. In-app selling needs StoreKit IAP |
| **APK you distribute yourself** (not via Play) | ✅ Yes | No store policy applies — but don't ship that build to Play by accident |

## 1. Website — works today

```
Plans page → POST /api/v1/payments/checkout   API creates a Razorpay order + a `payments` row
           → Razorpay Checkout (UPI / cards / netbanking / wallets)
           → POST /api/v1/payments/verify     HMAC_SHA256(orderId|paymentId, KEY_SECRET) → plan activated
Razorpay   → POST /api/v1/payments/webhook    same activation if the buyer closed the tab (signed, idempotent)
```

To turn it on: Razorpay account → **KYC** → *Settings → API Keys* (start with `rzp_test_…`) →
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` → *Settings → Webhooks* to
`https://<your-domain>/api/v1/payments/webhook` with `payment.captured`, `payment.failed`, `refund.created`,
`refund.processed`, `refund.failed` → `RAZORPAY_WEBHOOK_SECRET`. Keep Razorpay's **automatic capture** on.

Verify the setup before you touch prices (no money moves):

```bash
node --env-file=.env scripts/razorpay-check.mjs           # credentials + which provider the server picks
node --env-file=.env scripts/razorpay-check.mjs --order   # also creates a ₹1 (unpaid) order to prove creation works
```

Behaviour without keys: **development** shows a labelled demo checkout; **production** has *no* checkout at all
(`501 payments_not_configured`) unless you deliberately set `ALLOW_MOCK_PAYMENTS=true` (staging only — anyone can
grant themselves a plan).

Two things to confirm on the live site: the API must actually answer at
`https://<your-domain>/api/v1/plans` (the site and API are one Node deployment — `SETUP.md` §10), and
`checkout.razorpay.com` must be reachable (it is already in the CSP allow-list in
`server/src/middleware/security.js`).

## 2. Android (Google Play)

**The default rule.** Google Play's billing system is required for in-app purchases of digital goods and services —
that explicitly includes *"subscription services (such as fitness, game, dating, education, music, **video**, or
other content subscription services)"*.

**What is allowed without any programme (all countries):**

- **Consumption-only apps.** Google's words: *"Google Play allows any app to be consumption-only, even if it is part
  of a paid service. For example, a user could log in when the app opens and access content paid for somewhere
  else."* The app must not sell anything inside the app.
- **No steering.** *"Within an app, developers may not lead users to a payment method other than Google Play's
  billing system… This includes directly linking to a webpage that could lead to an alternate payment method or
  using language that encourages a user to purchase the digital item outside of the app."* Outside the app
  (e-mail, website, social) you are free to talk about pricing.

**Programmes that do allow in-app payment choice:**

| Programme | What it allows | Where / when | Google's cut |
|---|---|---|---|
| **User Choice Billing** (UCB) | Your own billing **alongside** Play Billing, behind Google's choice screen (user picks). Needs Google's UCB APIs. | **India** and South Korea (all apps), plus non-game apps in several other countries | Standard service fee **minus 4%** (e.g. 11% instead of 15%) |
| **2026 billing choice** (*"A new era for choice and openness"*) | Your own billing **alongside** Play Billing, or link users out to your website, with a choice screen you can style | US / UK / EEA from **30 Jun 2026** · Australia **30 Sep 2026** · Japan & South Korea **31 Dec 2026** · **everywhere else, incl. India, by 30 Sep 2027** | Service fee (10% for subscriptions) **+ 5% billing fee only if you use Play Billing**; using your own checkout or a web link drops the 5% |
| **US external content links / alternative billing** | Link out for purchases; if you enrolled, transaction reporting + service fees are due since **1 Oct 2026** | US only | Per program |

So in India, *today*, the only way to take payment inside the Play build is UCB — Razorpay **next to** Play Billing,
with the user choosing, and Google still taking a reduced service fee. If you don't want to pay any store fee,
stay consumption-only until the 2026 programme lands in India (by 30 Sep 2027).

## 3. iOS (App Store)

**The default rule (3.1.1).** Digital content and subscriptions sold in the app must use **in-app purchase**.
Razorpay cannot be the payment method for an in-app purchase.

**The reader-app model (guideline 3.1.3(a)) fits a video service exactly.** Apple: *"Reader apps are apps that
provide one or more of the following digital content types — magazines, newspapers, books, audio, music, or **video**
— as the primary functionality of the app."* Readers may let people **sign in and access content bought outside**
the app, and may **not** encourage any other purchase method inside the app.

If you want a link to your site, apply for the **External Link Account Entitlement**, available *"in any country or
region where the App Store is available"* (**India included**). Its conditions are strict:

- one link, formatted as a **standard blue underlined link containing the domain name**;
- **no pricing** anywhere in the link or its wording (acceptable: *"go to example.com to create or manage your
  account"*); it opens in the **default browser**, not a WebView;
- shown **once per page**, same message every time;
- the app must **not offer in-app purchases** on iOS/iPadOS/tvOS while using the entitlement;
- no link out at all from the App Store **metadata**.

Region variations (things you may hear about and must not apply globally):

- **US storefront** — since the May 2025 *Epic v. Apple* ruling, no entitlement is needed for buttons/links/CTAs
  to external purchase, and Apple may not commission out-of-app purchases.
- **EU** — since **1 Oct 2026** reader apps may *promote* out-of-app offers **without** an actionable link, on a
  separate page from the account link, using the StoreKit External Purchases/Offers entitlement.
- **Japan / South Korea / Netherlands** have their own alternative-payment regimes (Japan's MSCA from Dec 2025).

If in-app selling on iOS matters to you, the compliant route is **StoreKit IAP** — e.g. RevenueCat
(`@revenuecat/purchases-capacitor`) with your server verifying the receipt before extending the plan
(see `docs/MOBILE.md`).

## 4. If you ever sell inside the Android app: use Razorpay's native SDK, not the WebView

The current native build never opens Checkout, so nothing is broken today. But **do not** "just enable" the web
flow inside the Capacitor WebView — Razorpay's own documentation says WebView checkout is *"problematic"* and
*"not recommended"* (popup blocking, download-based methods fail, and UPI Intent needs extra native wiring).

The UPI part is the blocker:

- Razorpay: UPI Intent is supported on **mWeb** and **in a WebView only with extra deep-link handling**; the native
  SDKs handle it out of the box.
- **NPCI deprecated the UPI Collect flow (typing a VPA / approving a request) for Android apps effective
  28 February 2026** — on Android, UPI must go through the **Intent** flow, which launches the user's UPI app and
  returns to your app. Android's WebView cannot do that without native `intent://`/`upi://` plumbing
  (`AndroidManifest` queries + intent filters); iOS apps and mobile web are exempt.

Practical consequence: opening `checkout.js` inside the app WebView would at best show cards/netbanking and would
very likely show **no UPI at all** on Android — i.e. no payment method most Indian viewers actually use. If you go
in-app, integrate the native SDK (`com.razorpay:checkout` on Android; the Razorpay pod on iOS — or a Capacitor
plugin wrapping them) and keep the server contract exactly as it is: create order → SDK returns
`razorpay_order_id` / `razorpay_payment_id` / `razorpay_signature` → `POST /api/v1/payments/verify`. The webhook,
invoices, coupons and refunds are unchanged.

## 5. Razorpay onboarding (India) — what you need

1. **Account + KYC.** Live mode unlocks after KYC (Razorpay quotes 24–48 h once documents are accepted).
   Documents depend on the entity — company/LLP: incorporation certificate + company PAN + authorised-signatory
   PAN/ID; proprietorship: business existence proof (GST/VAT/Shops & Establishments/Trade licence) + PAN + a
   current-account statement/cancelled cheque. **Test mode works while KYC is in progress**, so integration and
   testing are not blocked.
2. **Website or app review.** Razorpay checks the storefront you will charge on: a working site with **About,
   Privacy Policy, Terms & Conditions, Refund/Cancellation Policy and contact details** (the repo's legal pages
   and `docs/COMPLIANCE.md` cover this), or the app listing for app-only businesses.
3. **Keys + webhook** exactly as in §1, then one real test-mode payment, one invoice PDF and one refund in
   `/admin`.
4. **GST.** Optional but recommended: set `GSTIN` and friends so buyers get tax invoices (`docs/BILLING.md`).
5. **Check it:** `npm run razorpay:check`.

## 6. What each route costs (verify before you price)

| Route | Cost per ₹99 / ₹799 sale |
|---|---|
| **Website, Razorpay card/netbanking/wallet** | Razorpay's standard rate (typically ~2%: ≈ ₹2 / ₹16) |
| **Website, Razorpay UPI** | Zero MDR has applied to UPI; **NPCI's framework from 15 October 2026 adds a merchant-paid 0.4% MDR on person-to-merchant UPI above ₹2,000** (capped ₹300) — below ₹2,000 stays free, so the ₹99 plan is unaffected and the ₹799 plan pays ≈ ₹3.20 |
| **Play, User Choice Billing (India)** | Google's service fee minus 4% (e.g. 11% at the 15% tier) **plus** Razorpay's ~2% |
| **Play, 2026 programme (India, by Sep 2027)** | Service fee (10% for subscriptions) + Razorpay's ~2%, no 5% billing fee when you don't use Play Billing |
| **Play, Play Billing** | 10% service + 5% billing fee for auto-renewing subscriptions in US/UK/EEA (from 30 Jun 2026); the previous 15% (≤ $1M/yr) / 30% tiers still apply in markets that the 2026 programme has not reached |
| **App Store, StoreKit IAP** | 15% (Small Business Programme) – 30% |
| **Own APK, Razorpay** | Razorpay's rate only |

The website is by far the cheapest place to sell — which is exactly why the apps are consumption-only.

## 7. What the apps show (review-safe since this build)

A native build (Capacitor) is consumption-only on **every** premium surface — no price, no "See plans"/"Subscribe"
wording, no link to a purchase:

| Surface | In the apps | On the website |
|---|---|---|
| Premium lock wall — watch (`watch.js`) and reels (`reels.js`) | "ADDABAAZ Plus exclusive" + how the account unlocks it, "Back to home" | "See plans" → `#/plans?next=…` |
| Plans page (`plans.js`) | "Your plan": active/expired state, billing link | Plans, ₹ prices, coupon, GST fields, Razorpay checkout |
| Billing empty state (`billing.js`) | explains invoices appear after subscribing | "See plans" button |
| Account → Subscription row (`account.js`) | a plain statement (no link) | links to the plans page |
| Profile menu (`shell.js`) | labelled "Your plan" | "Plans" |

One shared sentence holds the app wording (`nativePlanText` / `nativePlanNotice()` in `app/js/ui/components.js`).

Guarded by tests: `test/frontend/watch-plan-wall.test.mjs` renders the app and fails if any of that leaks a
plans link, a ₹ price or checkout wording; `test/frontend/plan-purchase-web.test.mjs` proves the browser still
sells (prices, Razorpay note, buy button, return link).

Still yours to keep true:

- Don't add "subscribe on our website", a price, a URL or a QR code to the app for non-US storefronts. Promoting
  the website **outside** the app (e-mail, WhatsApp, social, the site itself) is allowed and is where your
  marketing belongs.
- On iOS, if you apply for the External Link Account Entitlement, the one allowed link must be the plain
  account-management link of §3 — no prices, one per page, opening in the browser.
- If you also ship a self-distributed APK, keep that a **build flag**, not a runtime guess, so the Play build can
  never show payment UI.

## 8. Recommendation

1. **Launch the website** with Razorpay live keys — cheapest, fully implemented, and it's the only surface where a
   plan can be *bought*.
2. **Keep the apps consumption-only** exactly as built (sign-in unlocks a plan bought on the web). Optionally hide
   in-app prices as in §7 for a quieter App Review.
3. **If you want in-app revenue next:** Android UCB in India is available now (pay Google's reduced fee, integrate
   Google's UCB APIs + Razorpay native SDK). For iOS, add StoreKit IAP via RevenueCat with server-side receipt
   verification.
4. **Re-check in ~Sept 2027:** Google's 2026 billing-choice programme reaches India, which is the first time you
   could sell in-app with your own checkout (and no Play Billing billing fee) without Google Play Billing sitting
   next to it.

## 9. Sources (re-read before submitting)

- Google Play — [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
  (consumption-only, anti-steering, UCB in India), [US policy update](https://support.google.com/googleplay/android-developer/answer/15582165)
  (external links/alternative billing; transaction reporting from 1 Oct 2026)
- Google — [A new era for choice and openness](https://android-developers.googleblog.com/2026/03/a-new-era-for-choice-and-openness.html)
  (March 2026 billing choice, fee split, rollout through 30 Sep 2027)
- Apple — [Distributing "reader" apps with a link to your website](https://developer.apple.com/support/reader-apps/)
  (entitlement rules, any App Store country, EU change from 1 Oct 2026) and the
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) §3.1.1, §3.1.3(a)
- Razorpay — [WebView checkout: why it's problematic](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/webview/),
  [UPI Intent](https://razorpay.com/docs/payments/payment-methods/upi/upi-intent/) (WebView needs deep-link handling),
  [Google Pay custom integration](https://razorpay.com/docs/payments/payment-methods/upi/google-pay/custom-integration/)
  (NPCI: UPI Collect deprecated for Android apps from 28 Feb 2026), [Quickstart](https://razorpay.com/docs/payments/quickstart/)
  (test mode during KYC)
- NPCI/RBI — UPI MDR framework effective 15 October 2026: 0.4% on person-to-merchant UPI above ₹2,000 (merchant-paid,
  capped ₹300); transactions up to ₹2,000 stay zero-MDR.
