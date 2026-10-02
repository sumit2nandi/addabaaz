// Stable debug signing for CI APKs.
//
// Why: every GitHub runner generated its own throwaway debug keystore, so each new APK was
// signed by a "different developer" and Android refused to install it over the old one
// ("Something went wrong. App not installed."). With one shared key checked into the repo
// (mobile/keystores/ci-debug.p12 - a DEBUG key, it protects nothing and is meant to be public),
// every build signs identically and new APKs install as a normal UPDATE over old ones.
//
// `stableSigning()` adds a `ciDebug` signing config (PKCS12 keystore copied next to app/build.gradle
// by patch-android.mjs) and points the debug build type at it. Pure string surgery, idempotent.
export const hasStableSigning = (text) => text.includes('signingConfigs') && text.includes('ciDebug');

export function stableSigning(text) {
  if (hasStableSigning(text) || !/android\s*\{/.test(text)) return text;
  let out = text.replace(/android\s*\{/, `android {
    // Same key on every CI run => new APKs install as an update over older ones
    // (Android refuses to update an app that was signed with a different certificate).
    signingConfigs {
        ciDebug {
            storeFile file('ci-debug.p12')
            storePassword 'addabaaz'
            keyAlias 'addabaaz'
            keyPassword 'addabaaz'
            storeType 'PKCS12'
        }
    }`);
  out = out.replace(/buildTypes\s*\{/, `buildTypes {
        debug {
            signingConfig signingConfigs.ciDebug
        }`);
  return out;
}
