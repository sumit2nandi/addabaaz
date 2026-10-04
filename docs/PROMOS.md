# Promotional credit and referrals

ADDABAAZ can run two offers out of the box:

| Offer | Who gets it | Default |
| --- | --- | --- |
| **Welcome bonus** | every brand-new account, once | **₹100** |
| **Referral** | the inviter **and** the invited friend | **₹100 each** |

Credit is not cash. It can only be spent on a plan (never withdrawn, transferred or refunded to a card), so
the most anyone can do with a ₹100 bonus is watch a ₹99 month for free — and it is recorded on the order,
the invoice and the ledger. Change the amounts, the timing and the caps from **`.env`** or live from
**Admin → Promotions**; switch the whole thing off with one setting without touching code.

Everything below is implemented in `server/src/promos.js` (rules), `server/src/routes/promos.js` (viewer
API), `server/src/admin-promos.js` (console API), `server/migrations/018_credits_referrals.sql` (storage) and
`admin/js/views/promos.js` + `app/js/views/{plans,account-extra}.js` (UI).

---

## 1. How it works

```
sign-up ──► welcome bonus            ₹100 available immediately
    │
    └─ with an invite code ──► invited friend   ₹100 available immediately
                           └─► inviter         ₹100  on hold until the friend qualifies
                                                      (signup / verified / payment — configurable)
checkout ──► "use my credit" box (ticked by default)
             credit comes off the price, the rest goes to Razorpay
             price fully covered ──► plan activated with no payment at all
payment settled  ──► the credit is spent for good (recorded on the order as `credit_applied_paise`)
order abandoned  ──► the held credit is returned automatically (within a day)
refund processed ──► the credit spent on that order comes back
```

* **Qualifying** means the invited friend confirmed their identity — by default their e-mail or phone. With
  `PROMO_REFERRAL_HOLD=payment` the inviter is only paid after the friend buys their first plan; with
  `signup` both sides are paid the moment the friend creates the account.
* **Spending** happens only against plans and only when the buyer asks for it: the plans page shows the
  balance, pre-ticks “use my credit” and sends `useCredit: true`. Nothing is spent behind anyone’s back, and
  credit never takes an order below ₹1, so Razorpay can still open the order.
* **Returning**: a spend is written as a `pending` movement until its payment is settled. Abandoned orders
  are swept by the minute-ly job (`jobs.js` → `promos.runMaintenance()`), which also expires stale grants.

### Abuse controls

| Control | Why | Setting |
| --- | --- | --- |
| One welcome bonus per account, ever | stops re-signups paying out twice | — |
| One referral per account (`referrals.invitee_id` is unique) | nobody can be “referred” twice | — |
| No self-referral, no disabled inviters, no unknown codes | obvious farming | — |
| Rewards one account may earn | caps throwaway-account farming | `PROMO_MAX_REFERRALS_PER_USER=50` |
| Inviter paid only after the friend qualifies | the friend must be a real person | `PROMO_REFERRAL_HOLD=verified` |
| Optional expiry on every grant | old bonuses don’t pile up | `PROMO_CREDIT_EXPIRY_DAYS=0` |
| A code can be added only for a few days after signup | keeps “add a code later” honest | `PROMO_REDEEM_DAYS=7` |
| Amounts capped in the console (₹1,000 per offer, ₹10,000 per goodwill grant) | a typo cannot give away the store | — |

The ledger is **append-only**: `user_credit` keeps one row per movement (`signup`, `referral_join`,
`referral_invite`, `admin`, `spend`, `refund`), each grant carries how much of it is left
(`remaining_paise`), and a spend walks the grants oldest-expiry-first inside one transaction with
`SELECT … FOR UPDATE`. Two tabs checking out at the same time cannot spend the same paise twice.

---

## 2. Configuration

### Environment (`.env`)

```ini
PROMO_ENABLED=true               # false = no welcome/referral bonus (credit already granted still works)
PROMO_SIGNUP_CREDIT_INR=100      # welcome bonus, whole rupees (0 = none)
PROMO_REFERRAL_CREDIT_INR=100    # paid to the inviter AND the invited friend
PROMO_REFERRAL_HOLD=verified     # signup | verified | payment
PROMO_MAX_REFERRALS_PER_USER=50
PROMO_CREDIT_EXPIRY_DAYS=0       # 0 = never expires
PROMO_REDEEM_DAYS=7              # how long after signup a friend’s code can still be added
```

These are the *defaults*. They are read at boot; a value stored in `app_settings` (written by the console)
wins, so day-to-day changes need no redeploy and no restart.

### Admin → Promotions

* **The offer** — on/off, welcome bonus (₹), referral bonus (₹), when the inviter is paid, the per-account
  reward cap, expiry and the redeem window. Saving writes `app_settings` and applies to the next sign-up or
  code, immediately.
* **Headline numbers** — credit outstanding (and in how many accounts), granted all time by kind, spent on
  plans, expired, and referral counts.
* **Credit ledger** — every movement across all accounts, filterable by kind and by account/reason, with a
  **Remove** button for a grant that has not been touched yet (a mistake, a fraud report).
* **Give credit** — goodwill credit for one account; the viewer is e-mailed and the action is audited.
* **Referrals** — who invited whom, its state (`waiting` / `rewarded` / `cancelled`) and a **Cancel** action
  that also removes rewards still untouched.

The user page (**Admin → Users → a person**) shows that account’s balance, code, who they invited, who
invited them and their credit history, with the same “add credit” and “remove unspent” actions.

---

## 3. Viewer experience

* **Sign-up** — hashes from a friend’s link look like `https://addabaaz.in/#/signup?ref=AB12CD34`. The page
  shows “Invite code AB12CD34 will be applied”, and the code rides along with *whichever* method is used
  (e-mail or the SMS code). Codes also work in the sign-in form when the account is being created.
* **Plans** — “You have ₹100 of ADDABAAZ credit”, and the checkout dialog has a ticked-by-default
  “Use my ₹100 ADDABAAZ credit on this order” box. The total updates to the amount that will actually be
  charged; a fully covered plan reads “Activate for free”.
* **Account → Refer & earn** — balance (and what is on hold), the viewer’s code and link with Copy/Share
  buttons, the friends who joined with their reward state, a box to add a friend’s code (for a few days after
  signing up) and a short credit history.
* **E-mails** — a welcome/invite-bonus mail when credit lands, a “your reward is ready” mail when a referral
  completes, and a receipt that names the credit when it paid part of an order. Phone-only accounts
  (`…@phone.addabaaz.in`) are never mailed.

Credit appears on the invoice/receipt document too (`ADDABAAZ credit −₹100`), and the payment row keeps
`credit_applied_paise` so the books always balance.

---

## 4. HTTP API

Viewer (`/api/v1`, session optional where noted):

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/promo` | the running offer; signed in, also `viewer` (balance, code, invites) |
| `GET` | `/credits` | the viewer’s balance + ledger (needs a session) |
| `POST` | `/promo/redeem` | `{ code }` — add a friend’s code after signing up (once, inside the window) |
| `GET` | `/promo/link` | `{ code, link, share }` for the invite buttons |

Checkout: `POST /payments/quote` and `POST /payments/checkout` accept `useCredit: true`; the response gains
`creditPaise` / `payablePaise`, and `provider: 'credit'` when credit covered the whole price.

Admin (`/api/v1/admin`, admin session or `ADMIN_TOKEN`):

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/promos` | offer, numbers, top referrers, recent activity |
| `PATCH` | `/promos` | change the offer (amounts in paise) |
| `GET` | `/credits?kind=&user=&q=` | the ledger |
| `POST` | `/credits/grant` | `{ user, amountPaise \| amountINR, reason }` |
| `POST` | `/credits/:id/revoke` | remove an untouched grant |
| `GET` | `/credits/user/:id` | one account’s credit + referrals |
| `GET` | `/referrals?status=` | who invited whom |
| `POST` | `/referrals/:id/void` | cancel a referral and remove untouched rewards |

---

## 5. Switching it off / troubleshooting

* **Off**: `PROMO_ENABLED=false`, or `PROMO_SIGNUP_CREDIT_INR=0` for just the welcome bonus, or untick
  “Promotions are on” in the console. New sign-ups grant nothing; credit already in an account stays
  spendable; the plans page simply shows no credit line.
* **A viewer says their credit “vanished”**: check `/admin → Promotions → Credit ledger` filtered by their
  account. A `spend` with status `pending` is held by an order that has not been paid; it is returned by the
  next maintenance run (within a day) or immediately when the order is settled/cancelled.
* **A referral reward is “missing”**: the inviter’s grant is `pending` until the friend qualifies — see the
  hold rule. Ask the friend to confirm their e-mail/phone (Account → Confirm your email) or, with
  `hold=payment`, to buy their first plan.
* **The welcome bonus did not appear** for an account created before the offer existed: that is by design
  (one grant per account, ever). Use **Give credit** to make it up to them.
* **Migration**: `018_credits_referrals.sql` adds `users.referral_code`, the `user_credit` and `referrals`
  tables and `payments.credit_applied_paise`. `021_repair_credit_ledger_amount.sql` repairs older `user_credit`
  tables that are missing `amount_paise`; the startup schema check also repairs it if drift appears after a repair
  was recorded. A missing amount is added idempotently and any remaining grant balance is preserved. Migrations
  and the schema check run automatically at boot unless `DB_MIGRATE=false`.
* **Tests**: `node --test server/test/promos.test.js` (no database needed).
