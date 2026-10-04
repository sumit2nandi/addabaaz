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
API_BASE=https://api.addabaaz.in NATIVE_PUSH_ENABLED=true npm run build:www   # enable FCM only when the native Firebase config is installed
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

- **Android** (`.github/workflows/apk.yml`): every push to a working branch (`arena/**`) or `main`, every PR to `main`/`arena/ott`, and the **Run workflow** button build an installable debug APK.
  - **Easiest way to install it on a phone:** the rolling release <https://github.com/sumit2nandi/addabaaz/releases/tag/apk> always holds the APK of the newest successful build (`addabaaz-<commit>.apk`) — one tap, no zip to unpack. Android will ask you to allow installing from the browser; that is normal for a build that does not come from Google Play.
  - From a run: Actions → the APK run → **Artifacts** → `addabaaz-debug-apk` (a zip, kept 14 days) → `app-debug.apk`.
  - A manual run can point the app at another API: **Run workflow** → `api_base` (empty = production `https://addabaazott.onrender.com`).
  - Every build signs with the same pinned key (`mobile/keystores/ci-debug.p12`), so a fresh APK installs as an **update** over an older install instead of being refused (signature mismatch). The build prints the APK's SHA-1 — register it as a Google console **Android client** (below) so the native "Use your account for …" sign-in sheet works; until then, Google sign-in still works through the Custom Tab fallback.
  - A debug APK is for **testing**. Publishing to Google Play needs a **signed App Bundle** built from Android Studio with your own upload key — see *Store-readiness* below.
- **iOS** (`.github/workflows/ios.yml`): when `FIREBASE_IOS_PLIST` is set, each push produces `addabaaz-ios-simulator` (a zip with `App.app` for Xcode's Simulator). To also get an installable `addabaaz-ios-ipa`, set the four `APPLE_*` repository secrets listed in the workflow header (Development .p12 + password, provisioning profile for `in.addabaaz.app`, Team ID).

The manual toolchain above stays useful for day-to-day native debugging (`open:android` / `open:ios`).

## Configuration checklist

1. **`mobile/capacitor.config.json`** — `appId` (`in.addabaaz.app`, change if you own a different reverse-DNS id) and `server.hostname`. The app is served from `https://<hostname>` inside the WebView; pick a hostname you control that isn't used by a live site. YouTube's embedded player rejects `capacitor://` / `file://` origins (error 153), which is why `androidScheme`/`iosScheme` are `https`.
2. **API URL** — `API_BASE` in `build:www`. The API's `CORS_ORIGINS` must allow `https://<hostname>` (default `*` is fine because auth uses bearer tokens, not cookies).
3. **Google / Facebook sign-in** — **Google** shows the system account sheet (needs an **Android** OAuth client: package `in.addabaaz.app` + each signing key's SHA-1, *Native Google sign-in* below) and falls back to a Custom Tab + one-time ticket that needs no configuration (see [AUTH.md](AUTH.md#native-apps-android--ios)); **Facebook** uses the native `@capgo/capacitor-social-login` plugin (already in `mobile/package.json`) and needs its `strings.xml` / `Info.plist` + `AppDelegate` steps plus `FACEBOOK_CLIENT_TOKEN` on the server. Apple requires **Sign in with Apple** alongside third-party logins on iOS (guideline 4.8) — `POST /auth/apple` is implemented.
4. **Deep links** (optional) — custom scheme `addabaaz://show/shahid` is handled in `platform.js`. For universal/app links, host `apple-app-site-association` and `assetlinks.json` on your domain and add the associated domain in Xcode / intent-filter in `AndroidManifest.xml`.
5. **Push notifications** (Android app FCM push and browser Web Push) are implemented. The Android app uses `@capacitor-firebase/messaging`; after Android permission is granted, it registers for general broadcasts even when browsing as a guest. For phone-only setup, add the Firebase config files as GitHub Actions secrets—no local commands or committed native project are needed; see *Push notifications (no-laptop setup)* below.
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

## Native Google sign-in (sheet on Android + Custom Tab fallback)

**Android — the system sheet.** Tapping "Continue with Google" opens the Google
account picker ("Use your account for …", Credential Manager / Sign in with
Google — `GetSignInWithGoogleOption` through the `@capgo/capacitor-social-login`
plugin). The sheet returns the Google ID token, which is posted to
`POST /auth/google` exactly like the website button. Google only shows the
sheet when the build's signing key has an **Android OAuth client** in the
Google console (package `in.addabaaz.app` + SHA-1 — *Set up Google* step 4 in
[AUTH.md](AUTH.md#set-up-google)). Register **every** signing key you install
from:

| Build | Signing key | SHA-1 |
|---|---|---|
| GitHub Actions APKs (the `apk` release) | `mobile/keystores/ci-debug.p12` | `63:B5:79:5C:52:03:F1:34:87:E0:CC:1F:95:3C:0D:7F:22:65:24:2A` |
| Local Android Studio builds (pinned key) | `mobile/debug.keystore` | `FB:47:C5:A4:00:89:BB:39:7C:C3:F1:91:CE:A2:37:69:DB:37:47:70` |

The build log's *Show the APK signing certificate SHA-1* step prints the
authoritative value for that build (two SHA-1s = two Android clients, same
package name).

**Fallback — Custom Tab + one-time ticket (zero console setup).** Whenever the
sheet cannot run (Android OAuth client not yet created, no Google Play
services, plugin error) the app opens
`<API>/api/v1/auth/google/native-page` in a real Chrome Custom Tab
(@capacitor/browser). That same-origin page shows the very same Google
Identity Services button the website uses - the site origin is already an
authorized JavaScript origin, so this flow needs **no Google console change at
all** (no redirect URIs, no SHA-1, no client secret). The verified id_token
goes through the existing `POST /auth/google`, which mints a 2-minute
single-use ticket; the page deep-links `in.addabaaz.app://oauth?ticket=…` into
the app (MainActivity gets the scheme filter from `patch-android.mjs`), and
the app exchanges it at `POST /auth/ticket` for its own session.

**iOS** uses the Custom Tab flow (the sheet is Android-only here). Dismissing
the sheet is a quiet cancel — no error, and no push into the fallback. Google
is initialised per provider, so a broken Facebook/Apple config can never take
it down.

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

## Push notifications (no-laptop setup)

Admin → **Broadcast** sends app notifications through Firebase Cloud Messaging (FCM). Browser/PWA
notifications use the separate Web Push/VAPID configuration. The app code, token endpoint and FCM
sender are already implemented; GitHub Actions creates the ignored native projects and injects Firebase
client config from secrets, so no terminal or laptop is needed.

### Android (FCM)

1. In [Firebase Console](https://console.firebase.google.com/), create a project and add an Android app
   with package name **`in.addabaaz.app`** (from `mobile/capacitor.config.json`). Download its
   `google-services.json`.
2. In GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**, add
   **`FIREBASE_ANDROID_JSON`** and paste the complete contents of `google-services.json` (raw JSON; no
   base64 or command needed). The APK workflow checks the package name and installs the file during
   the cloud build. The secret stays out of the APK source and Git history.
3. In that same Firebase project, open Project settings → **Service accounts** and generate a private key.
   Add the full JSON as **`FCM_SERVICE_ACCOUNT`** in the API host's environment variables (for example,
   Render → Environment).
   Keep this server key private; do not put it in GitHub's client config or in the app. Restart the API.
4. From GitHub on your phone, open **Actions → APK → Run workflow**. Download the
   `addabaaz-debug-apk` artifact and install it. The workflow runs on this branch and handles the native
   build; no local build commands are needed.
5. Open the installed app and allow Android notifications; sign-in is not required for general app
   broadcasts. To verify delivery, use `/admin` → Dashboard → System status and **Broadcast → Send a
   test to me** from a signed-in administrator account. Guest tokens register anonymously; signing in
   links the device to the account, and Firebase token rotations are refreshed automatically.

### iOS (optional)

Add an iOS app in the same Firebase project with bundle ID **`in.addabaaz.app`**. Save the downloaded
`GoogleService-Info.plist` contents as the GitHub Actions secret **`FIREBASE_IOS_PLIST`**. The iOS workflow
adds it and the APNs entitlement to the generated Xcode app target; it skips iOS artifacts until this
secret is set. In Firebase Project settings → **Cloud Messaging**, upload an Apple **APNs authentication
key** and enter its Key ID and Apple Team ID; FCM needs that link to deliver to iPhones. Enable Push
Notifications for the app ID in the Apple Developer account and use a Development provisioning profile
with that capability for the signed build. iOS push must be tested on a real iPhone, not the simulator.
Installing an iPhone build also requires Apple Developer signing credentials; without those, the cloud
workflow can only produce its simulator artifact.

On Android, `@capacitor-firebase/messaging` requests OS notification permission and obtains an FCM
registration token. Connected guests register anonymously at `POST /api/v1/devices/guest`; signing in
links the installation to the account at `POST /api/v1/devices`. Signing out removes the account link and
returns to guest broadcasts unless notifications were switched off. Tapping a notification opens its
page. FCM-reported unregistered tokens are removed automatically, and idle tokens expire after 180 days.

A signed-in installation has the **same three notification switches as the website** in Account →
Notifications: *New episodes of shows I follow*, *When a Coming Soon title launches* and *Announcements &
offers* (all three on by default). They are stored on the device's row
in `push_devices` and read/written with `POST /api/v1/devices/status` and `PATCH /api/v1/devices/prefs`,
which identify the device by its FCM token — the same token-possession rule as the guest routes, so it
works before and after sign-in. A guest installation has no account to target episodes or launches with,
so it keeps the single on/off switch.

## Uninstalling really deletes the data

Android removes an app's private storage when it is uninstalled, and the app keeps nothing outside that
sandbox — no downloads folder, no shared storage. The one thing that could survive was Android's *backup
copy*: Capacitor's generated manifest ships `android:allowBackup="true"`, so the user's Google Drive
auto-backup (or a "copy apps & data" transfer to a new phone) owned a copy of the WebView storage — the
signed-in session token `ab.token` included — and a reinstall could restore it and come back signed in as
the previous account. `mobile/scripts/patch-android.mjs` now writes into the generated project:

* `android:allowBackup="false"` — this app is never included in cloud backups;
* `android:fullBackupContent="false"` — the same for API 23–30;
* `android:dataExtractionRules="@xml/data_extraction_rules"` plus `app/src/main/res/xml/data_extraction_rules.xml`,
  which excludes every domain (`root`, `file`, `database`, `sharedpref`, `external`) from both
  `<cloud-backup>` and `<device-transfer>` — since Android 12 `allowBackup="false"` on its own no longer
  stops phone-to-phone transfers.

So uninstall deletes the data with the install, and a **reinstall starts signed out**: the app opens in
guest mode and asks for sign-in as it did the first time. App updates are unaffected — none of this
touches data the phone already has, it only removes the backup and transfer paths.

Passing the phone on? Sign out first (**Account → Security → Sign out everywhere**): that ends the
session on the server, so even a restored copy of the storage cannot sign back in. On iOS the app
container is deleted on uninstall and a plain reinstall does not bring it back (only restoring a whole
device from an iCloud backup can), so the same advice applies before handing the phone over.
