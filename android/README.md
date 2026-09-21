# ADDABAAZ for Android

A Capacitor 8 Android application built from the existing home content. This is a native Android project with a bundled HTML/CSS/JS interface, not a remotely hosted website URL. The original website and editor remain separate and unchanged in scope.

## Folder layout

All Android-specific project files live in this directory:

```text
android/
  capacitor.config.json
  package.json, package-lock.json  Separate app dependencies and commands
  web/                            Home-only interface and native integration
  scripts/                        Content build and icon generators
  tests/, playwright.config.js    Mobile browser tests
  native/                         Android Studio / Gradle project
  www/                            Generated web bundle (ignored)
```

The build reads the existing website's workbook, components, shared interactions and images from the repository root; it does not modify them. Clone the **whole repository**, not just this folder. The only Android-related file outside this directory is `.github/workflows/android-build.yml`, because GitHub requires workflows at that location.

**Run the commands below from this directory (`cd android` from the repository root).**

## What is included

- Home hero, all shows and episodes, featured upcoming slideshow, upcoming/BTS rails, and promos/reels.
- No top navigation, About, Services, Contact, or admin page.
- Show details and video player; “Show all” gallery screens opened from Home. An in-screen Back button returns to Home. Android Back closes fullscreen video, then an open modal, navigates back through detail screens, or exits from Home.
- Branded launcher icon, native splash and animated logo reveal; light system-bar icons on a dark background, safe-area support and touch-friendly rails.
- Local catalogue and optimized local artwork work without internet. YouTube videos and remote thumbnails require internet; an offline banner explains this. No background hero video is auto-downloaded in the app.
- A YouTube fallback link for videos unavailable for embedding. Fullscreen is handled by `MainActivity`; backgrounding sends a pause command to the player.

## Preview without Android Studio

```sh
npm ci
npm run preview
```

Open the displayed port **3001**. Use a phone viewport in your browser. This preview tests the web interface, not Android hardware Back, system bars, fullscreen or native lifecycle behavior.

## Build/install an Android APK

Requirements: Node **22+**, JDK **21**, Android Studio with SDK Platform **36** and Build Tools **36.0.0**, and internet access to download Gradle/Maven dependencies. The app targets Android 16 / API 36 and supports Android 7 / API 24 onward with a current Android System WebView (109+).

```sh
npm ci
npm run sync
npm run open
```

In Android Studio, wait for Gradle sync, then choose an emulator/device and **Run**. To build a sideloadable debug APK from a terminal:

```sh
# Set JAVA_HOME and ANDROID_HOME to your installed JDK 21 and Android SDK.
npm run debug
# Output: native/app/build/outputs/apk/debug/app-debug.apk
adb install -r native/app/build/outputs/apk/debug/app-debug.apk
```

On Windows, run `npm run sync`, then `cd native` and `gradlew.bat assembleDebug` instead. `native/local.properties` may contain your SDK location; it is intentionally ignored.

### GitHub build alternative

After these files are pushed, **Actions → Android debug APK** builds an APK and uploads the `addabaaz-android-debug` artifact. Download and unzip it to get `app-debug.apk`. The workflow runs on relevant pushes; manual **Run workflow** is available once the workflow exists on the repository's default branch. This is a debug build for testing, not a signed Play Store release. Different CI runners may generate different debug signing keys, so you may need to uninstall a previous CI debug build before installing another.

No APK has been compiled or device-tested in the development sandbox: it has no Java/Android SDK, and the SDK/JDK download hosts were inaccessible. The native build workflow is provided but has not been executed here.

## Updating content

Excel remains the source during development, **not a runtime download by the app**:

1. Edit and validate `../data/website.xlsx` using the existing local editor/workflow.
2. Upload any referenced local images into the repository.
3. Run `npm run sync`, rebuild and distribute the APK.
4. For published app updates, increase `versionCode` and `versionName` in `native/app/build.gradle`.

The installed app contains a snapshot. A website-only workbook update does **not** refresh already installed apps. Live catalogue updates would need a separately published public JSON endpoint with versioning and offline fallback; that is not configured here.

`www/` and Android's copied assets/build outputs are generated and ignored. `scripts/build-mobile.mjs` validates Excel, includes only home/detail templates and public display data, optimizes local media to WebP (max 1440px), and bundles the shared interactions. External media must use HTTPS; gallery files must be local. Run `npm run icons` if the original brand artwork changes.

## Security and privacy

- The APK payload excludes `admin.html`, the workbook, ExcelJS, form configuration and non-home content. Only allowlisted app files are copied, never the repository root.
- **Bundled display content is public and extractable from an APK.** Do not put secrets in it.
- This does not protect or remove the workbook/admin from the existing website or a public GitHub repository. Those need a separate hosting/access-control change.
- The Capacitor hostname `app.addabaaz.in` is a virtual HTTPS origin used to serve packaged assets inside the WebView, **not a backend or a required DNS server**. Never replace this with a development server URL in a release build.
- No camera, microphone, contacts, location or storage permission is requested by this application. Only internet access and network-state access are declared. Remote top-level links open outside the trusted application origin.
- YouTube may apply region, age, sign-in, referrer or embedding restrictions. Test actual videos on a device; browser tests intercept external requests and do not prove live playback.

## Before a production release

1. Run `npm test` here for the app. From the repository root, run `npm ci`, `npm test` and `npm run test:browser` for the website.
2. With a device/emulator connected, run `cd native && ./gradlew connectedDebugAndroidTest` for native packaging checks. Test Android hardware/gesture Back, rotation, cutouts/system bars, fullscreen, background pause/resume, offline start and YouTube playback on real devices.
3. Confirm the application ID `in.addabaaz.app` before publishing; it cannot be changed for updates to an existing Play Store listing.
4. Use Android Studio **Generate Signed Bundle / APK** for your release AAB. Keep signing keys and passwords outside Git; do not use a debug APK as a production release.
5. Complete your Play Store listing, privacy policy/data-safety declarations (including embedded YouTube), media rights and current store requirements. No store submission or approval is included.
