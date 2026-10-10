# preview/ — the welcome e-mail, in a browser

An internal design-review page for the **welcome e-mail body**. It is not part of the web app: nothing links to
it, `/preview` answers `X-Robots-Tag: noindex, nofollow`, and `npm run build:www` copies an explicit list of
folders, so this one never reaches a viewer, a static host or either mobile app.

| Path | What it is |
| --- | --- |
| `/preview` | The harness: the e-mail in a 600px frame, a 402px phone frame, an images-off switch, and a link to the template. |
| `/preview/email.html` | **Generated.** The body with the demo merge values filled in — what a subscriber sees. |
| `/preview/welcome-email.html` | **The source.** The same markup with `{{merge_fields}}`: this is what goes into the mailer. |

`email.html` is derived, never edited: change `welcome-email.html`, then

```bash
npm run email:preview        # rewrite preview/email.html
```

`server/test/preview-pages.test.js` asserts the two are in step, so a stale preview fails CI.

Served by `mountWebsite()` in `server/src/web.js`: the files are read from disk on every request with
`Cache-Control: no-store` — edit an HTML file, reload the tab, nothing to build. Locally:
`npm start` → <http://localhost:3000/preview>. Turn the whole area off with **`PREVIEW_PAGES=0`**; the paths
then 404 like any unknown file.

## The design

Dark, because that is the product: `#08080a` page, `#0e0e12` card, `#111116` panels, `#14141a` for the money —
the site's own ramp — with studio red (`#b80000`→`#d00000`, drawn as three solid cells because Outlook ignores
`linear-gradient`) and premium gold `#f5c518`, which is how the plans page marks value. Structure: masthead →
headline → the Rs. 100 credit as a perforated ticket → one primary CTA → three numbered titles with posters →
four feature cards → the referral strip → a Bengali sign-off → footer.

Written to the rules the existing templates follow: tables only, **every style inline**, `<img>` with `alt` and
explicit `width`/`height`, absolute URLs everywhere, no `<script>`, no inline event handler, no external
stylesheet. The `<style>` block in `<head>` carries only the 520px media query; clients that strip it still get
a correct (if single-width) layout.

## Turning it into a real template

1. Add `welcomeEmail(o)` to `server/src/emails.js`, next to `receiptEmail()`. Escape anything user-provided with
   the module's `esc()` — the same contract the other mails use, `{ subject, text, html }`.
2. Money stays `Rs. 100`, not `₹100`: that choice is deliberate in `emails.js` ("plain Rs. for maximum client
   compatibility"). `{{credit_rupees}}` / `{{balance_rupees}}` come from the credit ledger, `{{invite_code}}`
   from `referrals`, `{{site_url}}` from `PUBLIC_SITE_URL`, `{{support_email}}` from `SUPPORT_EMAIL`.
3. Trigger it after sign-up — `routes/auth.js` and `routes/otp.js` where `promos.onSignup()` runs, or by
   extending `notifyCredit()` in `server/src/promos.js`. Skip placeholder addresses (`…@phone.addabaaz.in`)
   exactly as `notifyCredit()` does today.
4. Posters are `media/shows/*-sm.webp`, and **Outlook desktop cannot render WebP** — export a mail copy per show
   (or point `{{media_url}}` at a CDN that serves JPEG). Nothing depends on the images: every panel has a solid
   background, which is what the harness's *Images off* switch is for.
5. Fonts: `Plus Jakarta Sans` and `Tiro Bangla` lead each stack because the app ships them; each element falls
   back to Arial plus the system Bengali faces (`Noto Sans Bengali`, `Nirmala UI`, `Bangla Sangam MN`), which is
   what mail clients actually use.

Then check the render in a real inbox (Litmus, Mail-Tester, or your own Gmail) before it goes to anyone.
