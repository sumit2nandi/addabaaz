# ADDABAAZ — Android & iOS (Capacitor)

The native apps are a thin [Capacitor](https://capacitorjs.com) shell around the **same web app** in `../` — one codebase, three platforms. Full guide: [`../docs/MOBILE.md`](../docs/MOBILE.md).

```bash
# from the repository root
npm run build:www                       # (or API_BASE=https://api.addabaaz.in npm run build:www)
cd mobile && npm install
npx cap add android && npx cap add ios  # once (generates native projects — git-ignored)
npm run assets                          # icons + splash from ../resources
npm run sync && npm run open:android    # Android Studio  (open:ios → Xcode, macOS only)
```
