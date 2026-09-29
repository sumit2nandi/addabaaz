# Accounts & sign-in

## Who needs to sign in?

**Only viewers of premium titles.** Browsing, searching and watching free (YouTube) content never asks for an account. Premium additionally needs an **active paid plan** (see [PREMIUM.md](PREMIUM.md#payments-razorpay)) — signing in alone is not enough. A video with `"access": "premium"` in `data/catalog.json` shows a gold **Premium** badge everywhere; opening it while signed out shows a *Sign in to watch* screen (with Sign in / Create account), and after signing in the viewer lands straight back on the video. The API enforces this too — `POST /api/v1/videos/:id/stream` answers `401 login_required` without a valid session, so hiding the UI can't be bypassed. See [PREMIUM.md](PREMIUM.md).

Accounts also give viewers My List / Continue Watching sync across devices and multiple profiles.

## Ways to sign in

| Method | Notes |
|---|---|
| **Email + password** | `POST /auth/signup`, `POST /auth/login`. Passwords are stored as scrypt hashes. |
| **Google** | Web: Google Identity Services button. Apps: native Google sign-in. The API verifies the Google **ID token** (RS256 signature against Google's published keys, issuer, audience, expiry). |
| **Facebook** | Web: Facebook JS SDK popup. Apps: native Facebook SDK. The API verifies the **access token** with Facebook's `debug_token` (must be valid *and issued to your app*), then reads the profile. |

All three end the same way: the API returns its own session token (`Authorization: Bearer …`, 30 days). The client never sends profile data the server would trust — only the provider credential.

Account rules:
- A provider account is identified by its stable id (`auth_identities.provider + subject`), never by email.
- First social sign-in with an email that **already belongs to a password account links to it** (same verified email ⇒ same person). Google must report `email_verified`; Facebook only returns confirmed emails. Unverified or missing emails are refused (`email_unverified` / `email_required`).
- Social-only accounts have no password (`hasPassword: false`). Signing up by email with such an address explains to use Google/Facebook.
- A brand-new social account inherits the guest My List/progress from that device, just like email sign-up.
- Deleting the account (Account → Delete account, `DELETE /me`) removes identities too.

## Set up Google

1. [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* → **OAuth consent screen** (External; app name ADDABAAZ, support email, add your domain) → publish.
2. *Credentials* → **Create OAuth client ID** → *Web application*. Add **Authorized JavaScript origins**: `https://addabaaz.in` (and `http://localhost:3000` for development). No redirect URI is needed for the button flow.
3. Put the client id in `GOOGLE_CLIENT_ID` on the server. That's all for the website.
4. For the apps, also create an **Android** client (package `in.addabaaz.app` + your signing SHA-1) and an **iOS** client (bundle id `in.addabaaz.app`). Set `GOOGLE_IOS_CLIENT_ID` to the iOS client id and add the Android one to `GOOGLE_EXTRA_CLIENT_IDS`, so their ID tokens are accepted. The native plugin still authenticates through the *web* client id (`webClientId`), which the API hands to the app.

## Set up Facebook

1. [developers.facebook.com](https://developers.facebook.com/) → *Create app* → use case **Authenticate and request data from users with Facebook Login** (type *Consumer*).
2. *Facebook Login → Settings*: add **Valid OAuth Redirect URIs** / allowed domains for `https://addabaaz.in`; enable *Login with the JavaScript SDK* and list `https://addabaaz.in` under **Allowed Domains for the JavaScript SDK**.
3. *App settings → Basic*: copy **App ID** → `FACEBOOK_APP_ID`, **App Secret** → `FACEBOOK_APP_SECRET` (server only), add a privacy-policy URL and a data-deletion URL/instructions, choose a category, then switch the app to **Live** (in Development mode only app roles/test users can sign in).
4. Permissions `public_profile` and `email` work without App Review.
5. Apps: copy *Settings → Advanced → Client token* → `FACEBOOK_CLIENT_TOKEN`; follow the plugin's Android/iOS steps (below).

Restart the server: `GET /api/v1/auth/providers` now lists `google` / `facebook`, and the buttons appear automatically on the Sign in / Create account pages. Nothing to change in the website code or `app/env.js`. A provider without credentials simply doesn't show.

## Native apps (Android / iOS)

Google and Facebook block or break their web flows inside app WebViews, so the apps use native SDKs through [`@capgo/capacitor-social-login`](https://github.com/Cap-go/capacitor-social-login) (already a dependency in `mobile/package.json`, Capacitor 7 line). `app/js/social.js` calls it when running natively, initialising it from the ids returned by `/auth/providers`.

Per the plugin docs you still need to do the native configuration once after `npx cap add android|ios`: Facebook `strings.xml` / `Info.plist` entries and the `AppDelegate` snippet, the Google Android SHA-1 / iOS URL scheme, then `npm run mobile:sync`. **This native path could not be exercised in the development environment (no Android/iOS toolchain) — test it on real devices before release.**

**App Store rule 4.8:** an iOS app that offers Google/Facebook login must also offer an equivalent privacy-preserving option — in practice **Sign in with Apple**. It's not implemented yet; the plugin supports it and the API would get a third `/auth/apple` verifier of the same shape as the Google one.

## API summary

| Endpoint | Purpose |
|---|---|
| `GET /auth/providers` | `{ password, google?: {clientId, iosClientId?}, facebook?: {appId, version, clientToken?} }` |
| `POST /auth/google` `{ idToken }` | → `{ token, user, profiles, isNew }` |
| `POST /auth/facebook` `{ accessToken }` | → `{ token, user, profiles, isNew }` |
| `GET /me` | adds `providers: ['google', …]` and `hasPassword` |

Errors: `401 invalid_credential` (bad/expired/foreign token), `400 email_required | email_unverified`, `501 provider_not_configured`, `503 provider_unavailable` (Google/Facebook unreachable).
