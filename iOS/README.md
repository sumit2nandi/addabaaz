# ADDABAAZ for iOS

A separate **iPhone and iPad** application using Capacitor 8 / WKWebView, with the same home-only content as the Android app. The website and `/android` project are not modified by this project.

## Included

- Home hero, shows/episodes, featured upcoming slideshow, upcoming and BTS galleries, promos and reels.
- **No top navigation menu**, About, Services, Contact or admin editor.
- In-app Back control on detail/player/gallery screens; modal close controls. There is no Android-style hardware-back listener or programmatic app exit on iOS.
- Dark appearance, branded opaque App Store icon, centered native launch artwork and animated web splash.
- Portrait/landscape layouts and safe-area padding for iPhone cutouts, the home indicator and iPad.
- Inline YouTube player with an **Open on YouTube** fallback using Safari View Controller on iOS; backgrounding sends a pause command. Embedding/region/referrer restrictions may still prevent particular videos playing inline.
- Bundled catalogue and local artwork available offline. YouTube videos and remote thumbnails require internet. Hero video does not autoplay/download in the feed.

## Layout

```text
iOS/
  package.json, package-lock.json  Independent dependencies and commands
  capacitor.config.json           Native iOS configuration
  web/                            iOS interface and lifecycle integration
  scripts/                        Content build, icons and simulator build
  tests/, playwright.config.js    Chromium and WebKit browser checks
  native/App/App.xcodeproj         Xcode project, shared App scheme
  native/App/CapApp-SPM/           Swift Package Manager integration
  www/                            Generated web bundle (ignored)
  build/                          Generated simulator output (ignored)
```

Clone the **whole repository**: the build reads the website's existing workbook, media, templates and interactions from the parent directory. It writes only inside `/iOS`. No dependency on `/android` is required. The only iOS-related file outside this folder is `.github/workflows/ios-build.yml`, where GitHub requires workflows to live.

## Browser preview

From the repository root:

```sh
cd iOS
npm ci
npm run preview
```

Preview port: **3002**. This is the app's web interface, not an iOS simulator. All remaining commands below are run from `iOS/` unless noted otherwise.

## Run in Xcode

Requirements: **Node 22+**, a Mac with **Xcode 26+** (and a compatible macOS version), the iOS SDK/simulator runtime, and network access for Swift packages. Deployment target: **iOS/iPadOS 15+**. Test the oldest supported OS as well as the latest before distributing.

```sh
npm ci
npm run sync
npm run open
```

Open `native/App/App.xcodeproj`, use the shared **App** scheme, select an iPhone or iPad simulator and press **Run**. This project uses **Swift Package Manager**, not CocoaPods. Allow Xcode to resolve Capacitor and plugin packages. Do not manually edit the generated `CapApp-SPM/Package.swift`; `npm run sync` updates it.

### Command-line simulator build

```sh
npm run simulator
# Output: build/simulator/Build/Products/Debug-iphonesimulator/App.app

# Boot a matching simulator in Xcode/Simulator first:
xcrun simctl install booted build/simulator/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted in.addabaaz.app
```

The unsigned simulator `.app` **cannot be installed on a physical iPhone** and is not an IPA. No Apple signing credentials are needed for simulator compilation. Linux/Windows can build and test the web interface but cannot compile the native iOS app.

### GitHub build

The **iOS simulator app** workflow runs on relevant pushes and uploads `addabaaz-ios-simulator`. Download the artifact and unzip `ADDABAAZ-simulator.zip` on a Mac, then install `App.app` in a compatible simulator. Manual **Run workflow** is available when the workflow exists on the repository's default branch.

It runs the web tests in WebKit and compiles an unsigned simulator app. It does not run physical-device tests, sign an IPA, upload to TestFlight or publish to the App Store. A workflow file is not proof of a successful native build; check the run result and artifact.

## Install on a device / TestFlight / App Store

1. In Xcode, select **App → Signing & Capabilities**, choose your Apple development team and enable automatic signing. Confirm or change bundle ID `in.addabaaz.app` to an identifier your team owns.
2. Connect a device, enable Developer Mode if requested, and select it as the run destination. A personal team can have limited local-development provisioning; App Store/TestFlight distribution requires Apple Developer Program membership.
3. Increase build/version numbers in the Xcode target for updates. Choose a physical/generic iOS destination and **Product → Archive**, then use Organizer to validate and distribute with your team's signing setup.
4. Complete your store listing, media rights, privacy policy and App Privacy declarations, including embedded YouTube/Safari behavior. Review SDK privacy manifests/required-reason APIs and Apple's current minimum-functionality guidelines before submission. Approval is not guaranteed for a website-based app.
5. **Never commit** certificates, private keys, provisioning profiles, API keys or passwords. These are ignored where applicable. No signing credentials are stored in this project and none are needed in chat.

## Content updates and security

The build validates `../data/website.xlsx`, exports only public home/detail display data, optimizes local images to WebP (max 1440px) and bundles the interface. The installed app is a **content snapshot**. A website-only workbook update will not update installed iOS apps: rerun `npm run sync`, rebuild and distribute a new version. Live catalogue updates are not configured.

The generated app excludes the workbook, ExcelJS, admin editor, form configuration and non-home sections. Public display data can still be extracted from an application bundle. **This does not secure the separate website's workbook/admin or a public repository.** Do not put secrets in the content.

The virtual origin `capacitor://app.addabaaz.in` serves packaged files inside WKWebView; it is not a backend or DNS requirement. No HTTP App Transport Security exception is enabled, and the interface only embeds HTTPS YouTube frames. The custom native origin can affect YouTube referrer/embedding checks; use the external playback fallback and verify real videos on a device.

Run `npm run icons` after changing the original logo, then rebuild. The App Store icon is deliberately opaque (no alpha channel); iOS supplies its rounded mask.

## Verification

```sh
npm test                      # Build + Chromium mobile browser tests
npx playwright install webkit
npm run test:webkit           # WebKit browser tests (still not WKWebView on a device)
```

Use `CHROMIUM_PATH=/path/to/chromium npm test` for an existing Chromium executable. Tests block external services; they verify local rendering, safe-area layout, navigation and embed URLs, **not actual YouTube streaming**.

This Linux development environment cannot run Xcode. WebKit installation was also blocked by its browser-download network connection. Chromium checks and Capacitor asset/plugin synchronization can be verified locally; native compilation and WKWebView behavior require the macOS workflow or Xcode. Before release test actual iPhone/iPad devices: portrait/landscape, safe areas, back/close controls, full-screen video, offline launch, background/resume, audio and external YouTube fallback.
