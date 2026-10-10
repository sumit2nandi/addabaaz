# preview/ — welcome e-mail, in a browser

An internal design-review page for the **welcome e-mail body**. It is not part of the web app: nothing links to
it, `/preview` sends `X-Robots-Tag: noindex, nofollow`, and `npm run build:www` leaves the folder out of the
static bundle, so it never reaches a viewer or the mobile apps.

| URL | What it shows |
| --- | --- |
| `/preview` | The harness: the e-mail in a 600px frame, a 390px phone frame, images-off mode, and a link to the raw template. |
| `/preview/email.html` | The body with demo merge values filled in — what a subscriber sees. |
| `/preview/template.html` | The same markup with `{{merge_fields}}` — the thing to copy into the mailer. |

Served by `mountWebsite()` in `server/src/web.js` (files read from disk per request, so editing a file and
reloading is the whole workflow). Switch the area off with **`PREVIEW_PAGES=0`**; it then 404s like any unknown
path. Locally: `npm start` → <http://localhost:3000/preview>.

## Turning it into a real template

`template.html` is written to the contract the other mails already use (`{ subject, text, html }`):

1. Add `welcomeEmail(o)` to `server/src/emails.js`. It uses the same escaping (`esc`) and the same
   "Rs. 100" money format as the receipts — the rupee symbol is deliberately avoided there for client
   compatibility. `{{support_email}}` → `o.supportEmail`, `{{site_url}}` → `o.siteUrl` (`PUBLIC_SITE_URL`),
   `{{credit_rupees}}` / `{{balance_rupees}}` from the credit ledger, `{{invite_code}}` from `user_credit`/
   `referrals`.
2. Send it after sign-up. `server/src/promos.js` already mails the new-account credit (`notifyCredit`); either
   extend that body or call `welcomeEmail` from `routes/auth.js` + `routes/otp.js` where `onSignup()` runs, so
   phone-only accounts (`…@phone.addabaaz.in`) are skipped exactly as they are today.
3. Keep the safety rules the folder's markup already follows: tables only, **every style inline**, no
   `<div>` layout, no external CSS (the `<style>` block is only the mobile media query — inline it into the
   `<head>` when sending), `alt` on every image, and absolute URLs for links and images.
4. Posters are `media/shows/*-sm.webp`. Outlook desktop cannot render WebP: export a 136×188 PNG/JPEG pair per
   show for mail, or accept the fallback — every dark card carries a solid background colour, so the layout
   holds with the artwork missing (that is what "Images off" is for).
5. Test the render before sending: Litmus/mail-tester, or `node --test server/test/*` for the code path once a
   `welcomeEmail` exists (see `server/test/promos.test.js` for the mail-shape assertions).

Fonts: `Plus Jakarta Sans` and `Tiro Bangla` are first in every stack because the app ships them; every element
falls back to Arial (and to the system Bengali faces — `Noto Sans Bengali`, `Nirmala UI`, `Bangla Sangam MN`),
which is what mail clients actually use.
