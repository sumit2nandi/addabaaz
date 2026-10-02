# Android & iOS apps

The apps are the web app running inside a native WebView via **Capacitor 7** — a single code base, with native niceties (splash, status bar, hardware back button, share sheet, deep links). Nothing in `app/` is platform-specific; `app/js/platform.js` is the only file that talks to native APIs and it is a no-op in browsers.

## Prerequisites

| | Android | iOS |
|---|---|---|
| OS | Win / macOS / Linux | **macOS only** |
| Tools | Android Studio (SDK 36), JDK 21 | Xcode 16+, CocoaPods |
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

## Cloud builds (no laptop)

GitHub Actions builds both apps from this branch — no local toolchain needed:

- **Android** (`.github/workflows/apk.yml`): every push produces an installable debug APK — Actions run → Artifacts → `addabaaz-debug-apk`. It signs with the pinned `mobile/debug.keystore`, so the Google SHA-1 allowlisting (see [AUTH.md](AUTH.md)) never goes stale.
- **iOS** (`.github/workflows/ios.yml`): every push produces `addabaaz-ios-simulator` (a zip with `App.app` for Xcode's Simulator). To also get an installable `addabaaz-ios-ipa`, set the four `APPLE_*` repository secrets listed in the workflow header (Development .p12 + password, provisioning profile for `in.addabaaz.app`, Team ID).

The manual toolchain above stays useful for day-to-day native debugging (`open:android` / `open:ios`).

## Configuration checklist

1. **`mobile/capacitor.config.json`** — `appId` (`in.addabaaz.app`, change if you own a different reverse-DNS id) and `server.hostname`. The app is served from `https://<hostname>` inside the WebView; pick a hostname you control that isn't used by a live site. YouTube's embedded player rejects `capacitor://` / `file://` origins (error 153), which is why `androidScheme`/`iosScheme` are `https`.
2. **API URL** — `API_BASE` in `build:www`. The API's `CORS_ORIGINS` must allow `https://<hostname>` (default `*` is fine because auth uses bearer tokens, not cookies).
3. **Google / Facebook sign-in** — uses the native `@capgo/capacitor-social-login` plugin (already in `mobile/package.json`). Finish the native configuration described in [AUTH.md](AUTH.md#native-apps-android--ios) (Facebook Info.plist/strings.xml + AppDelegate, Google SHA-1 / URL scheme). Apple requires **Sign in with Apple** alongside third-party logins on iOS (guideline 4.8) — not implemented yet.
4. **Deep links** (optional) — custom scheme `addabaaz://show/shahid` is handled in `platform.js`. For universal/app links, host `apple-app-site-association` and `assetlinks.json` on your domain and add the associated domain in Xcode / intent-filter in `AndroidManifest.xml`.
5. **Push notifications** (for "Remind me") — add `@capacitor/push-notifications`, register the device token to a new `POST /api/v1/devices` endpoint, and have the server send a push when a title moves from `upcoming` to `shows` for every profile with a reminder (`library.reminders`). The reminder data is already collected.
6. **Orientation (Android)** — the app is locked to portrait: turning the phone never switches it to landscape, and playback does not unlock anything. `mobile/scripts/patch-android.mjs` (run by `npm run add:android` and `npm run sync`, so every CI build gets it) adds `android:screenOrientation="portrait"` to `MainActivity` in the generated `AndroidManifest.xml`. To allow rotation again, remove the `patch('app/src/main/AndroidManifest.xml', …)` call at the end of that script. Platform note: apps targeting API 36 can be rotated by Android 16 itself on tablets and foldables (screens ≥ 600 dp wide) regardless of this setting; phones always honour it. iOS is not affected by this setting.
7. **Full screen (Android, YouTube-app behaviour)** — the video's own fullscreen button is the only way into full screen and the only place the screen turns. `mobile/scripts/patch-android.mjs` installs `FullscreenClient` (see `mobile/scripts/android-fullscreen.mjs`) in the generated `MainActivity`: Capacitor's own `WebChromeClient` cancels Android's custom-view fullscreen, which left the video growing inside the page with the white system-bar/window strips around it. The client accepts that view — video alone on black, edge to edge, status **and** navigation bars hidden. While it is up the screen **follows the phone**: the client switches the activity to `SCREEN_ORIENTATION_FULL_SENSOR`, so the video is portrait while the phone is held upright, turns landscape when the phone is turned and back again — in both directions, and even when the device's own auto-rotate switch is off. The page (`app/js/orientation.js`) deliberately sets no orientation on the way in (Capacitor's `unlock()` maps to `UNSPECIFIED`, which obeys the auto-rotate switch, and any `lock()` would pin the screen again); it only locks the app back to portrait when full screen ends. Back leaves full screen instead of the app. The running theme (`AppTheme.NoActionBar`, which does not inherit from `AppTheme`) is patched to the brand dark with light system-bar icons, so no white bar can show in the app either.

## Store-readiness

- **Account deletion** is built in (`DELETE /api/v1/me`, Account → Delete account) — required by Apple 5.1.1(v) and Google Play.
- **Privacy policy URL** is required by both stores — add a page and link it in the footer/account screen. Declare: email + name (account), watch history (app functionality), no tracking.
- **Payments:** Apple and Google require **in-app purchase** (StoreKit / Play Billing) for digital subscriptions inside the apps, not Razorpay/Stripe. The apps therefore **don't sell plans**: the Plans screen and the locked-video wall show a note that plans are managed on the website (no purchase button and no link to it, to stay clear of the anti-steering rules). A viewer who paid on the website and signs in with the same account gets premium unlocked (access is decided by the API from the account's plan). Whether that “reader-style” model is accepted for your app is Apple's/Google's call at review — if you want in-app purchase instead, integrate RevenueCat (`@revenuecat/purchases-capacitor`) and have the server verify receipts before calling `subscriptions.extend`.
- **Content rating / target audience:** several titles are comedy with adult humour — answer the rating questionnaires accordingly.
- YouTube playback follows YouTube's embed terms; the apps must not mask or download YouTube streams. Self-hosted HLS (see `docs/CONTENT.md`) is the route to background audio, downloads and Chromecast/AirPlay.

## Going fully native later

The data contract is the REST API + `catalog.json` (see `openapi.yaml`), so a SwiftUI / Jetpack Compose / Flutter / React Native client can reuse the backend unchanged. The web app is already structured as *views → `User`/`Catalog` services → adapters*, which mirrors a typical native architecture.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gradle error: `androidx.browser:browser:1.9.0 requires Android Gradle plugin 8.9.1 or higher` / `compile against version 36 or later` | The generated Android project is older than the libraries. Run `npm run android:patch` in `mobile/` (it raises the Android Gradle Plugin to 8.9.1 and compileSdk/targetSdk to 36 - it also runs on every `npm run sync`), install **Android 16 (API 36)** in Android Studio → SDK Manager, then File → Sync Project with Gradle Files. API 36 is also what Google Play requires for new apps and updates since 31 Aug 2026. |
| YouTube "Error 153 / video unavailable" in iOS | Make sure `iosScheme` is `https` and `server.hostname` is set, then `npx cap sync` |
| White screen after update | `npm run build:www` before `cap sync` (the apps embed `../www`) |
| Can't reach API from Android emulator | Use `https://` and a real hostname (cleartext is blocked); for local dev use `adb reverse` or a tunnel |
| Status bar overlaps header | Safe-area insets are handled in CSS; make sure `viewport-fit=cover` is in `index.html` (it is) |

## Native Google sign-in (Custom Tab + one-time ticket, zero console setup)

Google refuses sign-in inside WebViews, and the native Google SDK needs every
build keystore's SHA-1 registered in the Google Cloud console - impossible for
cloud CI debug builds. Instead the app opens
`<API>/api/v1/auth/google/native-page` in a real Chrome Custom Tab
(@capacitor/browser). That same-origin page shows the very same Google
Identity Services button the website uses - the site origin is already an
authorized JavaScript origin, so **no Google console change is needed** (no
redirect URIs, no SHA-1, no client secret). The verified id_token goes through
the existing `POST /auth/google`, which mints a 2-minute single-use ticket;
the page deep-links `in.addabaaz.app://oauth?ticket=…` into the app
(MainActivity gets the scheme filter from `patch-android.mjs`), and the app
exchanges it at `POST /auth/ticket` for its own session.

## App identity

- The installed app is named **Addabaaz** (`capacitor.config.json` appName,
  re-asserted on `strings.xml` by `patch-android.mjs`).
- Launcher/install icons are the website logo (`mobile/android-icons/`,
  stamped over the stock Capacitor icons on every sync; regenerate with
  `bash mobile/scripts/gen-launcher-icons.sh`).
- The Android 12+ system splash shows the dark logo artwork
  (`windowSplashScreenAnimatedIcon` = the splash drawable), so launching never
  shows white squares around the logo.

## Stable debug signing (APK updates install over old ones)

Every CI runner used to generate its own throwaway debug keystore, so Android
treated each new APK as a different developer and refused the update
("Something went wrong. App not installed."). `mobile/keystores/ci-debug.p12`
is one shared DEBUG key (public by design - it signs nothing sensitive);
`patch-android.mjs` copies it into the app module and points the `debug`
build type at it (`android-gradle.mjs`). New APKs now install as ordinary
updates. Users who installed an APK from BEFORE this change must uninstall
once.
