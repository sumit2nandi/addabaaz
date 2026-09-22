# ADDABAAZ for Android

Capacitor 8 Android application with **Home-only content and no top menu**. Shows/episodes, promos, featured looping/swipeable posters, upcoming/BTS galleries, branded splash, in-app Back, hardware Back, fullscreen video and the external YouTube fallback are preserved.

The UI is packaged locally, but the **catalogue and artwork load from the Node/MySQL backend** on launch or Refresh content. No workbook/content snapshot is packaged. Offline launch shows a retry screen, not stale data. YouTube requires internet and can impose embedding/referrer restrictions.

## Preview and test

Clone the whole repository; UI templates/interactions live in `../frontend`, API/build helpers in `../shared`, and icon source in `../backend/media`. Android-specific files/dependencies remain here. Run the backend following the root README, then:

```sh
cd android
npm ci
npm run preview  # port 3001; /api and /media proxy to BACKEND_URL (default port 3000)
```

For tests, install root and backend dependencies too. `npm test` builds and runs Chromium interface tests using a separate test API fixture, not your database. Playwright can use `CHROMIUM_PATH` for an existing browser. Actual Android device behavior is not established by browser tests.

## Build a native app

Requires Node 22+, JDK 21, Android SDK Platform 36/Build Tools 36.0.0 and current Android Studio. Minimum Android API 24; WebView 109+.

```sh
# From android/. Replace the example with your deployed HTTPS origin.
export API_BASE_URL=https://your-api-host.example
npm run sync
npm run open
# Or a terminal debug build:
npm run debug
# native/app/build/outputs/apk/debug/app-debug.apk
```

Native sync/build refuses an empty or non-HTTPS API URL. Do not use a developer localhost URL, Capacitor `server.url`, admin token or DB credentials. The backend must allow `https://app.addabaaz.in` in CORS. This is the virtual Android WebView origin, not the API address. Cleartext/mixed content remains disabled.

For Windows use the equivalent environment setting, `npm run sync`, then `native/gradlew.bat assembleDebug`. Keep SDK paths in ignored `native/local.properties`. `npm run icons` regenerates branding after changing the source logo.

GitHub Actions workflow `.github/workflows/android-build.yml` runs tests; native build steps run only when repository variable **API_BASE_URL** is set. Then it can upload a debug APK. No production signing key is included. A test build is not a Play Store release.

Content changes in MySQL need no new APK; users refresh/relaunch. Changing UI or API origin requires sync/rebuild/distribution, with increased `versionCode`/`versionName` in `native/app/build.gradle`. `www`, copied native web assets and build outputs are generated/ignored.

Before release test real devices for Back, rotation/cutouts, fullscreen, offline launch/recovery, background/resume and actual YouTube playback. Build/sign your release AAB with keys outside Git. Confirm `in.addabaaz.app`, complete media-rights/privacy/Data Safety/store requirements and never commit signing secrets. No new permissions for camera, microphone, location, contacts or storage are introduced.
