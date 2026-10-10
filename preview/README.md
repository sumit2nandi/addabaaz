# preview/ — the welcome e-mail, in a browser

An internal design-review page for the **welcome e-mail body**. It is not part of the web app: nothing links to
it, `/preview` answers `X-Robots-Tag: noindex, nofollow`, and `npm run build:www` copies an explicit list of
folders, so this one never reaches a viewer, a static host or either mobile app.

| Path | What it is |
| --- | --- |
| `/preview` | The harness: the e-mail at 600px, 390px and 320px, an images-off switch, and a Design ↔ Mailer-output switch. |
| `/preview/email.html` | **Generated.** `welcome-email.html` with the demo merge values filled in. |
| `/preview/email-shipped.html` | **Generated.** The document `server/src/welcome-email.js` actually returns for the same numbers. |
| `/preview/welcome-email.html` | **The source.** The same markup with `{{merge_fields}}`: what a reviewer tunes. |

Both generated files are derived, never edited:

```bash
npm run email:preview        # rewrite preview/email.html + email-shipped.html
npm run email:check          # CI does this; a stale preview fails
```

Served by `mountWebsite()` in `server/src/web.js`: the files are read from disk on every request with
`Cache-Control: no-store` — edit an HTML file, reload the tab, nothing to build. Locally:
`npm start` → <http://localhost:3000/preview>. Turn the whole area off with **`PREVIEW_PAGES=0`**; the paths
then 404 like any unknown file.

## The design

Dark, because that is the product: `#08080a` page, `#0e0e12` card, `#111116` panels, `#14141a` for the money —
the site's own ramp — with studio red (`#b80000`→`#d00000`, drawn as three solid cells because Outlook ignores
`linear-gradient`) and premium gold `#f5c518`, which is how the plans page marks value. Structure: masthead →
headline → the credit as a perforated ticket → the calls to action → three numbered titles with posters → four
things worth knowing → the referral strip → a Bengali sign-off → footer.

Written to the rules the other templates in `server/src/emails.js` follow: tables only, **every style inline**,
`<img>` with `alt` and explicit `width`/`height`, absolute URLs everywhere, no `<script>`, no inline event
handler, no external stylesheet, and `Rs.` instead of `₹`. The `<style>` block in `<head>` carries only the
520px media query; clients that strip it still get a correct (if single-width) layout.

**The phone rule:** at 520px and below the media query may resize, repad and hide — it may never *restack*.
A `display:block` (or `width:100%`) on a `<td>` breaks the row's box, so the panel's border wraps one cell while
the others overflow it, and a cell widened to 100% squeezes its neighbour into ten words per line. Both look
fine at 600px, which is how it slipped past review twice. So every section is built to survive both widths
without changing shape: the ticket's balance is a strip under the amount, the four facts are a hairline list, a
show card keeps its 68px poster beside the text. The one thing that does reflow is the pair of buttons, and they
are `<table>`s — a table shrink-wraps its content, so `display:block;width:100%` stretches the whole pill (fill
and border both live on the inner `<td>`, or one button spans the card and the other stays a short outline).
`server/test/preview-pages.test.js` enforces that invariant on the template and fails on any rule the query
leaves unused; `server/test/welcome-email.test.js` runs the same check on the markup the mailer builds.

## Where it is sent from

`server/src/welcome-email.js` exports `welcomeEmail(o)` → `{ subject, text, html }` (re-exported as
`mail.welcomeEmail`) and `welcomeStyle`, the phone rules above — **the same block, shared**, so what is reviewed
here is what is sent. `features.sendWelcome(user, { strict, creditPaise, balancePaise, inviteCode, referralPaise })`
calls it, and `POST /auth/signup` awaits that inside the usual `SIGNUP_EMAIL_WAIT_MS` budget.

Three things the harness cannot show, because they are data, not layout:

* **The confirmation link is this mail's primary button.** Sign-up used to send a `Confirm your email` note and
  let `promos.notifyCredit()` send a second note about the credit; now one letter carries both, and
  `onSignup({ mail: 'welcome' })` keeps promos quiet for that account. `/me/verify/resend` still sends the short
  template, so a letter that never arrived is recoverable.
* **Sections appear only when the numbers exist.** No credit (`PROMO_SIGNUP_CREDIT_INR=0`) → no ticket; no
  referral code → no strip; an address the provider already confirmed (Google, Facebook, Apple) → no
  confirmation link and *Start watching* moves up to primary. A mail must never promise `Rs. 0`.
* **Phone-only accounts are skipped** — their `…@phone.addabaaz.in` address is a placeholder, exactly as
  `notifyCredit()` already treats it.

Two client limits worth remembering before changing the artwork: **Outlook desktop cannot render WebP**, so
posters (`media/shows/*-sm.webp`) are decoration — every panel has a solid background, which is what the
*Images off* switch is for; and `Plus Jakarta Sans` / `Tiro Bangla` lead each font stack only because the app
ships them, falling back to Arial plus the system Bengali faces that mail clients actually have.

Then check the render in a real inbox (Litmus, Mail-Tester, or your own Gmail) before it goes to anyone.
