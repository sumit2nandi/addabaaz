# ADDABAAZ — Android & iOS (Capacitor)

The native apps are a thin [Capacitor](https://capacitorjs.com) shell around the **same web app** in `../` — one codebase, three platforms. Full guide: [`../docs/MOBILE.md`](../docs/MOBILE.md).

**No laptop?** Firebase config is injected by the GitHub Actions cloud builds from repository secrets; see [`../docs/MOBILE.md`](../docs/MOBILE.md#push-notifications-no-laptop-setup) for the exact secret names and how to download the APK artifact.

```bash
# from the repository root
npm run build:www                       # (or API_BASE=https://api.addabaaz.in npm run build:www)
cd mobile && npm install
npx cap add android && npx cap add ios  # once (generates native projects — git-ignored)
npm run assets                          # icons + splash from ../resources
npm run sync && npm run open:android    # Android Studio  (open:ios → Xcode, macOS only)
```

`npm run sync` also runs `scripts/patch-android.mjs`, which raises the generated Android project to Android Gradle Plugin 8.9.1 and compileSdk/targetSdk 36 (needed by current libraries and by Google Play). Already-generated project? Run `npm run android:patch`.
