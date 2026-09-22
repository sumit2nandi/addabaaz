# ADDABAAZ for iOS

Separate Capacitor 8 iPhone/iPad project in `/iOS`, with **Home only and no top menu**. Keeps shows/episodes, promos, featured looping/swipeable posters, upcoming/BTS galleries, safe-area layout, branded native/web splash, in-app Back and Safari View Controller YouTube fallback. There is no Android hardware-back/exit behavior.

The interface is packaged; **content and artwork load from Node/MySQL** on launch or Refresh content. A catalogue/workbook is not bundled. Offline launch shows recovery controls, not a stale snapshot. Content-only changes require no new app release.

## Preview and test

Clone the entire repository: frontend templates/interactions, shared API/build helpers and backend branding are build inputs. All iOS-specific dependencies/native files remain here. Start the real backend using the root README, then:

```sh
cd iOS
npm ci
npm run preview  # port 3002; /api and /media proxy to BACKEND_URL (default port 3000)
```

Install root/backend dependencies for tests. `npm test` runs Chromium interface tests with an isolated test API fixture. `npm run test:webkit` uses Playwright WebKit (`npx playwright install webkit` first). Neither is an actual device/WKWebView test. External requests are blocked in tests, so video URLs/navigation are checked, not live streaming.

## Build on macOS

Requires Node 22+, Xcode **26+**, command line tools, Swift Package Manager access and an iOS 15+ simulator/device. From this folder:

```sh
export API_BASE_URL=https://your-api-host.example  # use your deployed HTTPS backend
npm run sync
npm run open
# Unsigned simulator build:
npm run simulator
# build/simulator/Build/Products/Debug-iphonesimulator/App.app
```

API configuration is mandatory for native sync/build; empty, local and non-HTTPS origins are rejected. Backend CORS must allow `capacitor://app.addabaaz.in`, the virtual WKWebView origin (not the API hostname). No ATS cleartext exception, `server.url`, admin token or DB credentials belong in the app. The API host is public configuration.

The native project is `native/App/App.xcodeproj`. In Xcode select the App target and an available simulator. `.github/workflows/ios-build.yml` runs WebKit checks and, with repository variable **API_BASE_URL** configured, an unsigned simulator build. Its artifact is not an installable signed IPA. `npm run icons` regenerates the opaque App Store icon/native launch artwork from backend branding.

Changing content needs only a client refresh/relaunch. Changing UI or API origin needs sync/rebuild/distribution and an increased build/version. Generated `www`, copied assets and build products are ignored.

## Device/App Store release

Select your Apple team and signing/provisioning in Xcode; confirm bundle ID `in.addabaaz.app`, archive for a physical device and distribute through your account. Keep certificates, keys, profiles and passwords outside Git. Complete media rights, privacy/App Privacy declarations, SDK privacy-manifest review and store listing; approval is not guaranteed for a website-based app.

Verify real iPhone/iPad devices: cutouts/home-indicator safe areas, portrait/landscape, modal/back controls, fullscreen video/audio, offline/reconnect, background pause and external YouTube fallback. WKWebView's custom origin can affect inline YouTube referrer/embedding checks. Linux cannot compile Xcode projects or establish device behavior.
