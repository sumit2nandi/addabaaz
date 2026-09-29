# Android & iOS apps

The apps are the web app running inside a native WebView via **Capacitor 7** — a single code base, with native niceties (splash, status bar, hardware back button, share sheet, deep links). Nothing in `app/` is platform-specific; `app/js/platform.js` is the only file that talks to native APIs and it is a no-op in browsers.

## Prerequisites

| | Android | iOS |
|---|---|---|
| OS | Win / macOS / Linux | **macOS only** |
| Tools | Android Studio (SDK 35), JDK 21 | Xcode 16+, CocoaPods |
| Store account | Google Play Console ($25 once) | Apple Developer Program ($99/yr) |

## First-time setup

```bash
npm install                          # repo root
API_BASE=https://api.addabaaz.in npm run build:www   # leave API_BASE unset for local mode
cd mobile
npm install
npx cap add android
npx cap add ios                      # macOS
npm run assets                       # icons + splash from ../resources (icon-only.png, splash.png)
npm run sync
npm run open:android                 # or open:ios
```

Each later release: `npm run mobile:sync` from the repo root, then build/run from Android Studio / Xcode. `mobile/android` and `mobile/ios` are git-ignored by default — remove those lines from `.gitignore` if you want to commit the native projects (recommended once you add signing config / custom native code).

## Configuration checklist

1. **`mobile/capacitor.config.json`** — `appId` (`in.addabaaz.app`, change if you own a different reverse-DNS id) and `server.hostname`. The app is served from `https://<hostname>` inside the WebView; pick a hostname you control that isn't used by a live site. YouTube's embedded player rejects `capacitor://` / `file://` origins (error 153), which is why `androidScheme`/`iosScheme` are `https`.
2. **API URL** — `API_BASE` in `build:www`. The API's `CORS_ORIGINS` must allow `https://<hostname>` (default `*` is fine because auth uses bearer tokens, not cookies).
3. **Google / Facebook sign-in** — uses the native `@capgo/capacitor-social-login` plugin (already in `mobile/package.json`). Finish the native configuration described in [AUTH.md](AUTH.md#native-apps-android--ios) (Facebook Info.plist/strings.xml + AppDelegate, Google SHA-1 / URL scheme). Apple requires **Sign in with Apple** alongside third-party logins on iOS (guideline 4.8) — not implemented yet.
4. **Deep links** (optional) — custom scheme `addabaaz://show/shahid` is handled in `platform.js`. For universal/app links, host `apple-app-site-association` and `assetlinks.json` on your domain and add the associated domain in Xcode / intent-filter in `AndroidManifest.xml`.
5. **Push notifications** (for "Remind me") — add `@capacitor/push-notifications`, register the device token to a new `POST /api/v1/devices` endpoint, and have the server send a push when a title moves from `upcoming` to `shows` for every profile with a reminder (`library.reminders`). The reminder data is already collected.

## Store-readiness

- **Account deletion** is built in (`DELETE /api/v1/me`, Account → Delete account) — required by Apple 5.1.1(v) and Google Play.
- **Privacy policy URL** is required by both stores — add a page and link it in the footer/account screen. Declare: email + name (account), watch history (app functionality), no tracking.
- **Payments:** Apple and Google require **in-app purchase** (StoreKit / Play Billing) for digital subscriptions inside the apps, not Razorpay/Stripe. Keep `PREMIUM_ENABLED=false` for the first store release (everything is free today), or integrate RevenueCat (`@revenuecat/purchases-capacitor`) and verify receipts on the server before flipping `subscription` to active.
- **Content rating / target audience:** several titles are comedy with adult humour — answer the rating questionnaires accordingly.
- YouTube playback follows YouTube's embed terms; the apps must not mask or download YouTube streams. Self-hosted HLS (see `docs/CONTENT.md`) is the route to background audio, downloads and Chromecast/AirPlay.

## Going fully native later

The data contract is the REST API + `catalog.json` (see `openapi.yaml`), so a SwiftUI / Jetpack Compose / Flutter / React Native client can reuse the backend unchanged. The web app is already structured as *views → `User`/`Catalog` services → adapters*, which mirrors a typical native architecture.

## Troubleshooting

| Symptom | Fix |
|---|---|
| YouTube "Error 153 / video unavailable" in iOS | Make sure `iosScheme` is `https` and `server.hostname` is set, then `npx cap sync` |
| White screen after update | `npm run build:www` before `cap sync` (the apps embed `../www`) |
| Can't reach API from Android emulator | Use `https://` and a real hostname (cleartext is blocked); for local dev use `adb reverse` or a tunnel |
| Status bar overlaps header | Safe-area insets are handled in CSS; make sure `viewport-fit=cover` is in `index.html` (it is) |
