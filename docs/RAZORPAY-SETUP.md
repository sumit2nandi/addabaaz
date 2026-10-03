# Razorpay, step by step — for someone who has never used a payment gateway

You will do this once (about an hour of clicking, spread over a day or two while Razorpay checks your papers).
Nothing here needs programming: you copy two long strings out of the Razorpay website and paste them into Render,
then press a few buttons in a dashboard.

**Where money is collected:** the **website** (`https://addabaazott.onrender.com`). The Android/iOS apps never
sell anything — a viewer buys on the website and signs in with the same account in the app
(why: [PAYMENTS.md](PAYMENTS.md)).

**What Razorpay is:** an Indian payment gateway. It shows the payment page (UPI, cards, netbanking, wallets),
takes the money, pays it into your bank account, and tells your website "this customer paid". Your website then
unlocks the plan and creates the GST invoice. Card and UPI details never touch your server.

**What it costs:** check Razorpay's current pricing page before you set prices — typically a small percentage per
successful transaction (UPI is free below ₹2,000; from 15 Oct 2026 NPCI charges merchants 0.4% on UPI above
₹2,000). Nothing is charged for setting up the account or for test payments.

---

## Before you start (10 minutes of thinking)

| | |
|---|---|
| **Which business?** | Razorpay asks whether you are a sole proprietor / company / LLP. Your **PAN** (personal for proprietor, company PAN otherwise) must match what you sign up with. Decide now; changing it later is paperwork. |
| **Bank account** | A bank account in the same name — this is where the money is paid out. |
| **Mobile + email** | Use ones you check often: Razorpay sends OTPs and KYC questions there. |
| **The website must look complete** | Their reviewer opens your site and looks for **About**, **Contact**, **Prices**, **Privacy**, **Terms** and a **Refund/Cancellation** policy. Yours are live: `/about`, `/contact`, `/plans`, `/privacy`, `/terms`, `/refunds`. |
| **Keep this page open** | You will need: Render dashboard (your website's settings) and the Razorpay dashboard (your money settings). |

> If you later move from `addabaazott.onrender.com` to `addabaaz.in`, tell Razorpay the new address
> (Settings → Business details) and update `PUBLIC_SITE_URL`, `CORS_ORIGINS` and the webhook URL in Render.

---

## Part 1 — Create the account *(5 min)*

- [ ] Go to **https://razorpay.com** → **Sign Up**.
- [ ] Enter your business email, a password, and the mobile number that will be the account's registered number.
- [ ] Verify the email (link) and the phone (OTP).
- [ ] You land in the dashboard **in Test Mode**. Nothing you do in test mode moves real money — you can
      experiment freely.

## Part 2 — Copy your test keys *(3 min)*

- [ ] Razorpay dashboard → **Settings** (gear, bottom-left) → **API Keys**.
- [ ] Click **Generate Test Key** (if keys already exist, use **Reveal** to see them).
- [ ] You get two values:
      **Key ID** `rzp_test_XXXXXXXX` and **Key Secret** (a long string).
- [ ] Save both in a password manager or a note — the secret behaves like a password. Never put them in
      WhatsApp, a screenshot, or the app.

## Part 3 — Paste them into your website *(5 min)*

Your website is the Render service `addabaazott` (site + API in one app).

- [ ] Render → your service → **Environment** → **Add Environment Variable**, add these four:

| Key | Value |
|---|---|
| `RAZORPAY_KEY_ID` | the `rzp_test_…` Key ID |
| `RAZORPAY_KEY_SECRET` | the Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | a long random string **you invent** (40+ letters/numbers) — you will paste the same string into Razorpay in Part 4 |
| `PUBLIC_SITE_URL` | `https://addabaazott.onrender.com` |

- [ ] While you are there, make sure these are also set (they were in the setup guide):
      `TRUST_PROXY=1` and `CORS_ORIGINS=https://addabaazott.onrender.com,https://app.addabaaz.in`.
- [ ] **Save** → Render redeploys by itself (about 2 minutes).
- [ ] Check it worked: open **https://addabaazott.onrender.com/api/v1/plans** in a browser. Find the
      `"payments"` part — it must say `"provider":"razorpay"` and show your `rzp_test_…` key ID.
      If it says `mock` or `none`, the variables did not reach the service (usually a typo in the name, or they
      were added to a different service) — fix and save again.
- [ ] Optional, on a computer with the project: `npm run razorpay:check` prints the same verdict plus the exact
      webhook URL to use.

## Part 4 — Tell Razorpay where to report payments *(5 min)*

This is the **webhook**: Razorpay's phone call to your server saying "this payment succeeded". Without it, a buyer
who closes the browser before returning is paid but not unlocked.

- [ ] Razorpay dashboard → **Settings** → **Webhooks** → **Add New Webhook**.
- [ ] **Webhook URL**: `https://addabaazott.onrender.com/api/v1/payments/webhook`
- [ ] **Secret**: the exact string you put in `RAZORPAY_WEBHOOK_SECRET`.
- [ ] **Active events** — tick these five:
      `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`.
- [ ] Save. (In the webhook's page you can later see every delivery and resend a failed one.)

> Webhooks belong to one mode: the one you just made works in **test** mode. When you go live (Part 7) you must
> add the same webhook again in **live** mode.

## Part 5 — Buy your own plan with fake money *(10 min)*

- [ ] Open **https://addabaazott.onrender.com** → sign in → **Plans** → choose the monthly plan.
- [ ] Fill the Checkout dialog (state for GST, coupon if you want) → **Pay**.
- [ ] On the Razorpay page use a **test** payment method — Razorpay's docs page *Test cards* lists the card
      numbers; in test mode a real card will not work, and UPI shows a simulated screen where you simply choose
      success or failure.
- [ ] Expected result: you come back to the site, a green **"You're in!"**, the plan shows as active, and premium
      titles play.
- [ ] Admin console (https://addabaazott.onrender.com/admin → **Payments**): the payment is there with its
      invoice. Open it and check the PDF; the numbering looks like `AB/2627/000001`.
- [ ] **Test the unhappy paths too** — this is what test mode is for:
      - make a payment that **fails** → the order stays open, nothing is unlocked, you get the "payment didn't go
        through" email (if email is configured);
      - **refund** the successful one from `/admin → Payments → refund` → a credit note appears against the
        invoice and access is removed.
- [ ] In the **app**: sign in with the same account → the premium title plays. That is the whole
      "pay on the website, watch in the app" model working.

## Part 6 — KYC: let Razorpay keep real money *(1–3 days, mostly waiting)*

- [ ] Razorpay dashboard → **Account activation** (or the KYC banner) → fill business details.
- [ ] Documents, by business type — have scans ready:
      - **Sole proprietor:** personal PAN; a business-existence proof (GST certificate, Shops & Establishments
        certificate, trade licence or Udyam registration); your address proof (Aadhaar/Passport/DL); bank proof
        (cancelled cheque or last 3 months' statement or the account's first page).
      - **Private Limited / LLP:** certificate of incorporation, company PAN, authorised signatory's PAN + ID,
        bank proof.
- [ ] **Website details:** enter `https://addabaazott.onrender.com`. They check that the site is live, shows what
      you sell and at what price, and has the policy pages (yours do).
- [ ] If a form asks about mobile apps: your apps are free viewers for the website; **purchases happen on the
      website**, not inside the app.
- [ ] Submit and wait (usually 24–48 hours after they accept the documents). They may ask questions in the
      dashboard — answer there, and don't change your business details mid-review.

## Part 7 — Go live *(15 min, after KYC is approved)*

- [ ] Razorpay dashboard → switch the toggle to **Live Mode** → **Settings → API Keys → Generate Live Key**.
- [ ] Copy the `rzp_live_…` Key ID and its secret.
- [ ] Render → Environment → **replace** `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with the live values
      (keep `RAZORPAY_WEBHOOK_SECRET` the same) → Save → wait for the redeploy.
- [ ] Razorpay in **live** mode → **Settings → Webhooks → Add New Webhook** → same URL, same secret, same five
      events. (Easy to forget — it is a separate list from test mode.)
- [ ] Open `/api/v1/plans` again: it must now show the `rzp_live_…` key ID.
- [ ] Buy one real plan yourself (₹99), check the invoice and that premium unlocked, then refund it from
      `/admin → Payments`. Your money comes back in 5–7 working days. This one paid test is worth it — it proves
      the live keys, the live webhook and the invoice all work before a real customer arrives.
- [ ] On the project computer: `npm run razorpay:check` → it should say live keys and warn you if anything is
      still on test.

## Part 8 — Running it afterwards

| When | What to do |
|---|---|
| **Money** | Razorpay dashboard → Transactions/Payouts. Payouts reach your bank on Razorpay's settlement cycle (usually T+2). Compare the settlement report with `/admin → Payments` at month end. |
| **A customer wants a refund** | `/admin → Payments` → refund (full or partial). The credit note and the email happen automatically. |
| **An accountant asks for records** | `/admin → Payments` exports a CSV register; invoices are PDFs. |
| **You are GST-registered** | Set `GSTIN`, `GST_LEGAL_NAME`, `BUSINESS_ADDRESS` in Render so receipts become proper tax invoices. |
| **Failure you did not cause** | Razorpay dashboard → Webhooks → delivery log: a red delivery is the usual reason a paid plan did not activate. Resend it after fixing the cause. |
| **Someone paid but has no plan** | First check the webhook delivery log. As a stop-gap, `/admin → Users → (their account) → Give free access…` grants the same number of days (no payment, no invoice) — note it in the audit log and fix the root cause. |

## Part 9 — When something looks wrong

| What you see | What it means | Fix |
|---|---|---|
| Checkout says *"Payments aren't available right now"*, API answers `501 payments_not_configured` | the server has no keys | Part 3 again; make sure the variables are on the **service that runs the site**, then redeploy |
| *"The payment provider rejected the request"* | wrong key pair, or the account is not activated | regenerate the keys, paste both again; finish KYC |
| Money left the customer but the plan never activated | the buyer closed the tab **and** the webhook is missing or failing | add the webhook (Part 4); check its delivery log; meanwhile grant the days from `/admin → Users` |
| Razorpay's webhook log shows `400 invalid_signature` | `RAZORPAY_WEBHOOK_SECRET` and the secret in the webhook differ | paste the same string in both places, save, resend the failed delivery |
| The test card is declined | real cards do not work in test mode | use the test cards from Razorpay's docs |
| Checkout does not open on your phone | an ad-blocker or a privacy browser blocked `checkout.razorpay.com` | try a normal browser/network |
| A log line warns *"Production is running TEST keys"* | test keys are live on the production site | Part 7 |
| Someone asks why they cannot buy inside the app | by design | the app is a player; buying is on the website ([PAYMENTS.md](PAYMENTS.md)) |
| A plan stopped working earlier than expected | plans are prepaid **passes** (30 / 365 days), no auto-renewal | the viewer buys again on the website; the new days are added to the end |

## Part 10 — What is deliberately not included

- **Auto-renewing subscriptions** (no UPI AutoPay / card mandates): every plan is a prepaid pass, so there is
  nothing to cancel and no failed-renewal support load. `docs/PREMIUM.md` explains the choice.
- **In-app purchase**: Apple and Google would take 10–30% and require their billing; the apps therefore do not
  sell (see `docs/PAYMENTS.md` for when that changes, e.g. Google's programme reaching India by Sep 2027).
- **Self-service refund requests** in the app: refunds are handled from the admin console / by email.

*Related reading: `docs/PAYMENTS.md` (where selling is allowed), `docs/BILLING.md` (invoices, coupons, refunds),
`docs/PREMIUM.md` (which videos require a plan), `SETUP.md` §8.5 (the short version).*
