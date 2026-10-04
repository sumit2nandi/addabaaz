# Phone sign-in with SMS OTP (MSG91)

ADDABAAZ signs viewers in with a **mobile number and a one-time code** whenever an SMS provider is
configured. This is the primary register/sign-in method; email + password and Google/Facebook stay
available as alternatives, and **nothing breaks while MSG91 is not configured**:

| State | What viewers see |
| --- | --- |
| `MSG91_AUTH_KEY` **and** `MSG91_OTP_TEMPLATE_ID` set | “Mobile number” is the first tab on the sign-in page; a 6-digit code arrives by SMS |
| Not configured, `NODE_ENV != production` | The same flow, but no SMS is sent: the code is printed in the server log (`[sms:dev] OTP for 9198… is 123456`) so the flow can be demoed and tested |
| Not configured, production | The OTP tab is hidden (`GET /api/v1/auth/providers` reports `otp: false`); the page shows email + password and the social buttons as before. The OTP endpoints answer `503 sms_not_configured` if called directly |

How it works, in one line: **ADDABAAZ generates the code, sends it through MSG91, and verifies it itself.**
Only a SHA-256 hash of the code is stored (`phone_otps.code_hash`), so a database leak cannot be used to
sign in, and the SMS provider never decides who is authenticated.

---

## 1. What you need before starting (India)

1. **A registered business entity** — MSG91 needs your GST/PAN details.
2. **DLT registration** (TRAI rules). Every transactional SMS must be sent from a registered *entity*, a
   registered *sender/header*, and an *approved template*. Register once, on any DLT portal (SmartPing,
   Jio, Airtel, Vodafone Idea…):
   - **Entity registration** — ₹5,000–5,900 + GST, usually approved in a day.
   - **Sender ID / Header** — 6 characters, e.g. `ADDABZ`. Transactional (OTP) headers are approved fastest.
   - **SMS template** — the exact wording of the message, with a variable for the code. Approval takes
     about 24–48 hours. The text must match what MSG91 sends, character for character.
3. **MSG91 account** with some credit (OTP SMS is roughly ₹0.15–0.25 each; prices change, check your plan).

> If you are only testing, MSG91 lets you send OTPs to a few whitelisted numbers without DLT. Add your own
> number under MSG91 → OTP → Settings while the DLT paperwork is in progress.

## 2. Create the OTP template in MSG91

1. Sign in to <https://control.msg91.com>.
2. **OTP → Templates → Add template.**
3. Keep the wording identical to your DLT-approved template, e.g.

   ```
   ##OTP## is your ADDABAAZ verification code. It is valid for 10 minutes. Do not share it with anyone.
   ```

   The variable must be written exactly `##OTP##` — that is the placeholder MSG91 fills from our API call.
4. Choose **SMS** as the channel (Voice/WhatsApp/Email are possible later, see §6).
5. Save and copy the **Template ID** (a 24-character hex string).

## 3. Copy the API credentials

1. **MSG91 → Settings → API → Auth Key** → copy it.
2. You now have three values:

   | Where | Environment variable |
   | --- | --- |
   | Auth Key | `MSG91_AUTH_KEY` |
   | Template ID | `MSG91_OTP_TEMPLATE_ID` |
   | Sender/Header (6 chars, optional for OTP templates) | `MSG91_SENDER_ID` |

## 4. Configure the server

Add to `.env` (see `.env.example`) and restart:

```ini
MSG91_AUTH_KEY=387000AbCdEf1234567890xy
MSG91_OTP_TEMPLATE_ID=6471a1b2c3d4e5f6a7b8c9d0
MSG91_SENDER_ID=ADDABZ
MSG91_COUNTRY_CODE=91
```

Then verify. The quickest check is the console itself: **Admin → Dashboard → System status** now has an
**SMS sign-in (MSG91)** row that says which variables are present — never their values — and an
orange row appears under **Finish setting up** while it is missing. When MSG91 is connected, the row grows a
**Send test SMS…** button: it asks for a number and sends the same kind of 6-digit code viewers get
(standard SMS charges apply, nothing is stored, and the sign-in flow is not touched).

```bash
# 1. The sign-in page should now offer the mobile-number tab
curl -s https://addabaaz.in/api/v1/auth/providers | grep -o '"otp":[a-z]*'

# 2. Watch the server log while this runs (never share the code):
curl -s -X POST https://addabaaz.in/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"9812345678"}'
# → {"ok":true}   and an SMS should arrive on the number
```

If `otp` is still `false`, the server did not read both variables — check `MSG91_AUTH_KEY` **and**
`MSG91_OTP_TEMPLATE_ID` are present (only one of the two logs a warning at boot: *“MSG91 is half-configured”*).

## 5. What the server does (and the limits it enforces)

| Step | Endpoint | Notes |
| --- | --- | --- |
| Ask for a code | `POST /api/v1/auth/otp/request` `{ phone }` | 202 `{ ok: true }`. `400 invalid_phone`, `429 otp_cooldown` (one SMS per number per minute), `429 otp_flood` (max 5 per number per hour), `503 sms_not_configured` |
| Verify | `POST /api/v1/auth/otp/verify` `{ phone, code, name? }` | Returns `{ token, user, profiles, isNew, phoneSignIn: true }`. `400 invalid_code` / `otp_expired` / `otp_invalid`, `429 otp_locked` (5 wrong tries burn the code) |
| Who offers it | `GET /api/v1/auth/providers` | `{ password, otp, otpCountryCode, google, facebook, apple }` |

* Codes are 6 digits, valid 10 minutes, and consumed on first successful use.
* Changing the number, wrong codes and resends are all rate-limited per IP as well (`authLimit`).
* The first successful verify **creates the account** (sign-in and sign-up are the same flow). Such an
  account gets a reserved, non-routable address `<number>@phone.addabaaz.in` because `users.email` is
  `NOT NULL`; nothing is ever mailed there, and the viewer can add a real address later from Account.
* A verified phone counts as a verified identity (the same as clicking an email confirmation link), so
  commenting and buying a plan are not blocked for phone-only accounts.
* MSG91 failures surface as `502 sms_auth_failed` (bad key) or `502 sms_send_failed` (template/number), and
  the sign-in page shows the message with the email form one tap away.

## 6. Optional extras

* **Voice OTP** (falls back to a call when the SMS does not arrive): ask MSG91 for the voice channel on your
  template, then send with `channel`/`retrytype=voice` — the current integration uses SMS only.
* **WhatsApp OTP** needs an approved WhatsApp business template and MSG91's WhatsApp endpoints. The code
  change is small (a second `send()` implementation in `server/src/sms.js`), but the approval process is
  the slow part; SMS first is the pragmatic choice in India.
* **Resend**: the app's “Resend code” button simply calls `/auth/otp/request` again after the 60-second
  cooldown, so no separate retry endpoint is needed.

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Invalid Authkey` (HTTP 200, `type: "error"`) | Wrong/rotated `MSG91_AUTH_KEY`. The server logs `MSG91 rejected the OTP request (code 201)`. |
| `template not found` / template name error | The template was deleted or from another account. Copy the Template ID again. |
| SMS never arrives but the API says success | DLT template still pending, or the wording differs from the approved template. Check MSG91 → Reports → SMS. |
| `otp` is `false` in `/auth/providers` | Only one of the two variables is set, or the server was not restarted. Admin → Dashboard → System status names the missing one. |
| The row says “not set up for real SMS” | That is a development server: the code is printed in the log instead (`[sms:dev] OTP for … is …`). Add both variables to send real texts. |
| Code arrives but “isn’t right” | The viewer typed an old code; each request issues a new one and invalidates the previous. |
| Too many codes | Per number: 1/min, 5/hour. Per IP: `authLimit`. Wait, or use email. |

## 8. Cost expectations

* One-time: DLT entity registration (~₹5,000–5,900 + GST).
* Per SMS: roughly ₹0.15–0.25 (transactional route), so 1,000 sign-ins ≈ ₹150–250.
* A failed verify (wrong code) costs nothing — the SMS was already paid for, but no extra message is sent.
