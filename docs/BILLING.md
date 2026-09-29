# Billing: GST invoices, coupons, refunds and payment emails

Everything here sits on top of the Razorpay purchase flow in [PREMIUM.md](PREMIUM.md#payments-razorpay). Code: `server/src/{billing,gst,invoice-pdf,mailer,emails,db-billing}.js`, migration `004_billing.sql`, admin API under `/api/v1/admin`.

> **Not legal or tax advice.** The invoice layout follows the GST rules for a supplier of online services (rule 46, SAC 998439, 18%, place of supply, credit notes under section 34), but have your CA check the output before you go live — especially your SAC/rate, whether you are required to register, and how you report B2C supplies.

## 1. GST invoices

Every successful payment produces a numbered PDF, in the same database transaction that grants the plan (so a paid plan without an invoice cannot exist).

| Setting (server env) | Meaning |
|---|---|
| `GSTIN` | Your 15-character GST number (validated incl. checksum at startup). **Set** → *TAX INVOICE* with tax lines. **Unset** → plain *PAYMENT RECEIPT*, no tax (use this if you are not GST-registered). |
| `GST_LEGAL_NAME`, `BUSINESS_ADDRESS` | Printed under "Sold by" (use `\n` for line breaks) |
| `BUSINESS_STATE` | Only needed without a GSTIN (with one, the state comes from its first two digits) |
| `GST_SAC` (`998439`), `GST_RATE` (`18`) | Service code and rate. **Prices are GST-inclusive:** ₹99 stays ₹99; the tax is carved out of it (₹83.90 + ₹15.10 GST) |
| `INVOICE_PREFIX` (`AB`) | 1–4 letters/digits. Numbers look like `AB/2627/000001`: prefix / financial year / running number — 16 characters, the legal maximum |
| `INVOICE_FOOTER`, `SUPPORT_EMAIL` | Optional footer line / contact address |

- **Intra-state** (buyer's state = your state) → CGST 9% + SGST 9%. **Inter-state** → IGST 18%.
- **Place of supply.** Checkout asks the buyer for their state (dropdown). A buyer who enters a valid **GSTIN** (and business name) gets the invoice in the business's name, with the place of supply taken from the GSTIN.
- **Numbering** is gapless and restarts every financial year (1 Apr–31 Mar, IST). Counters are row-locked, so simultaneous payments get consecutive numbers (there is a test for that).
- **Discounts.** With a coupon, GST is computed on what was actually paid; the invoice shows list price and coupon.
- **Free grants** (100%-off coupons) charge nothing and produce no invoice.
- Buyers download invoices in **Account → Billing & invoices** (`GET /api/v1/invoices/:id/pdf`, owner only), can have them emailed again, and get the PDF attached to the receipt email.
- **Retention.** Invoices and credit notes are kept for the statutory period even if the buyer deletes their account: the link to the user is cut (`user_id → NULL`) but the name, email, GSTIN and state printed on the document stay in the row. Say so in your privacy policy.
- **Not built:** e-invoicing (IRN/QR) — only needed above the turnover threshold that applies to you; filing returns; TCS under section 52 (if you sell through a marketplace); HSN/SAC-wise summaries. Use the CSV export below for your returns.

### Sales register (for GSTR-1 / your accountant)

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://api.addabaaz.in/api/v1/admin/invoices.csv?from=2026-04-01&to=2026-04-30" -o april.csv
```
One row per invoice and credit note (credit notes negative): document, number, date (IST), customer, GSTIN, place of supply, taxable value, CGST, SGST, IGST, total. `from`/`to` are IST dates, inclusive; the default is the current month.

## 2. Coupons

Managed through the admin API (below). Codes are upper-case (`[A-Z0-9_-]`, 3–30 characters) and matched case-insensitively.

| Field | |
|---|---|
| `kind` + `value` | `percent` 1–100, or `flat` in **paise** (min 100) |
| `planIds` | limit to plans, e.g. `["plus-yearly"]` (omit = all) |
| `maxRedemptions` | total uses across all users (omit = unlimited) |
| `perUserLimit` | uses per account (default 1) |
| `startsAt`, `expiresAt` | ISO dates |
| `active` | switch off with `PATCH` any time |

Rules worth knowing:
- The discount never exceeds the price, and a charge can't fall below **₹1** (Razorpay's minimum) — anything that would is rounded up to ₹1 unless it is 100% off.
- **100% off = free access**, no Razorpay order, no invoice; the buyer still gets a confirmation email. The plan is a normal (non-demo) plan for the coupon's period.
- A redemption is *reserved* when the Razorpay order is created and released after 30 minutes if unpaid, so a "first 100 buyers" coupon can't be oversold by parallel checkouts (limits are re-checked under a row lock). Reopening checkout for the same purchase reuses the open order instead of creating another.
- The buyer sees the reason if a code fails ("expired", "already used", "doesn't apply to this plan"…), and the price updates live before paying.
- Coupons apply to Razorpay purchases. The demo provider ignores them.
- The discount fields of an existing coupon can't be edited (only `active`, dates, limits, description) so old invoices stay explainable; create a new code instead.

## 3. Refunds

Refund from the admin API (or from the Razorpay dashboard — both are handled):

```
# what has this customer paid?
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/payments?email=asha@example.com"
# refund the rest of a payment (or send "amountPaise": 3000 for a partial refund)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"Duplicate purchase"}' "$API/admin/payments/<payment id>/refund"
```

What happens:
1. The API asks Razorpay to refund (`speed: normal`, original payment method, 5–7 working days) and records the refund. Refunds can never exceed what was paid.
2. When Razorpay confirms (`refund.processed` webhook — or immediately if the API answers "processed") a **credit note** (`CN/2627/000001`) is issued against the original invoice with the tax reversed proportionally (the last one takes the exact remainder, so credit notes always add up to the invoice), and the buyer gets an email with the PDF attached.
3. **Access.** A refund that brings the total to the full amount removes the days that payment bought (renewals from other payments are kept). A partial refund leaves access alone unless you send `"revokeAccess": true`. If a refund later **fails**, the time is given back.
4. Refunds made in the Razorpay dashboard arrive by webhook and go through the same steps; ones for payments we don't know, or larger than the payment, are ignored.

Webhook events to enable in Razorpay (besides `payment.captured`): **`refund.created`, `refund.processed`, `refund.failed`, `payment.failed`**.

There is no self-service "request a refund" button; publish your refund policy (the store apps and Razorpay both expect one) and handle requests by email. Note that Razorpay's refund window and any fee treatment are set by Razorpay — check their current terms.

## 4. Emails

| Email | When |
|---|---|
| Receipt / tax invoice (PDF attached) | payment verified |
| Access confirmation | 100%-off coupon redeemed |
| Refund processed (credit note attached) | refund reaches *processed* |
| Payment didn't go through | Razorpay `payment.failed` (once per order; the order stays open for a retry) |
| Plan ends soon | `EXPIRY_REMINDER_DAYS` (default 3) before a paid plan ends — once per expiry date; hourly job, safe with several instances |

Configure any SMTP provider (Amazon SES, Brevo, Mailgun, Postmark, Gmail app-password…):
```
SMTP_URL=smtps://username:password@smtp.example.com:465
MAIL_FROM="ADDABAAZ <billing@addabaaz.in>"
PUBLIC_SITE_URL=https://addabaaz.in          # links in emails
```
Emails are best-effort: a failing mail server never blocks or fails a payment (errors are logged). Without `SMTP_URL` nothing is sent — messages are only logged in development, and production prints a startup warning. Use a sending domain with SPF/DKIM or the receipts will land in spam.

## 5. Admin API

Set `ADMIN_TOKEN` (**24+ random characters**, e.g. `openssl rand -hex 24`) to switch it on; without it `/admin/*` answers 404. Send `Authorization: Bearer <token>`. It is a single shared secret meant for you, curl and scripts (rate-limited, compared in constant time) — keep it out of the web app, and put the API behind HTTPS. There is no admin web UI yet.

| | |
|---|---|
| `GET /admin/payments?email=&limit=` | recent payments with their invoices and refunds |
| `POST /admin/payments/:id/refund` | `{ amountPaise?, reason?, revokeAccess? }` |
| `GET /admin/coupons` · `POST /admin/coupons` · `PATCH /admin/coupons/:code` | list (with redemption counts) / create / update |
| `GET /admin/invoices.csv?from=&to=` | sales register |
| `GET /admin/invoices/:id/pdf` | any invoice |

Create a coupon:
```
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" "$API/admin/coupons" \
  -d '{"code":"LAUNCH50","kind":"percent","value":50,"description":"Launch offer","planIds":["plus-yearly"],"maxRedemptions":200,"expiresAt":"2026-12-31T18:29:59Z"}'
```

## Testing checklist before going live
1. Razorpay **test mode**: buy with a test card/UPI, check the invoice PDF (numbers, GSTIN, place of supply) and the email.
2. Buy from a different state and with a GSTIN — IGST vs CGST+SGST.
3. Redeem a coupon; try an expired one.
4. Refund partially, then fully; confirm the credit notes, the emails and that access ends.
5. Send the webhook events from the Razorpay dashboard's "test webhook" tool.
6. Ask your CA to review one invoice and one credit note.

Automated coverage (`npm test`): GST maths and numbering (`gst.test.js`), and the whole flow against MySQL with a faked Razorpay API and a fake mail transport (`billing.test.js`) — including concurrency (numbering, last coupon redemption, reminder claims). Nothing here has been run against the real Razorpay or a real mail server.
