// Patches @capgo/capacitor-social-login (the 7.x line we depend on) so Google sign-in can finish.
//
// Why: GoogleProvider completes its authorization with activity.startIntentSenderForResult(...) using
// request codes 583892990..+128 (account picker -> consent screen), but the plugin never registers
// those codes with Capacitor (@CapacitorPlugin requestCodes defaults to {}) and its
// handleOnActivityResult only forwards Facebook/Twitter results. Capacitor therefore drops the
// Google consent result, the plugin's future never completes, and the JS call hangs forever —
// "nothing happens after picking an account". Two edits fix it:
//   1. declare the request codes on the @CapacitorPlugin annotation so Capacitor routes them here
//   2. forward them to GoogleProvider.handleAuthorizationIntent()
// Idempotent (skips when already patched); runs from `add:android` and `sync`, before every build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..',
  'node_modules', '@capgo', 'capacitor-social-login', 'android', 'src', 'main', 'java',
  'ee', 'forgr', 'capacitor', 'social', 'login', 'SocialLoginPlugin.java',
);
if (!fs.existsSync(file)) { console.log('[social-login:patch] plugin source not found (run `npm install` in mobile/) — nothing to do.'); process.exit(0); }

let src = fs.readFileSync(file, 'utf8');
if (src.includes('ADDABAAZ-PATCH')) { console.log('[social-login:patch] already applied.'); process.exit(0); }

// 1. Register Google's startIntentSenderForResult codes (REQUEST_AUTHORIZE_GOOGLE_MIN + 128 slots).
const ANNOTATION = '@CapacitorPlugin(name = "SocialLogin")';
const MIN = 583892990, N = 128;
const codes = Array.from({ length: N }, (_, i) => MIN + i);
const annotation = `@CapacitorPlugin(
    name = "SocialLogin",
    // ADDABAAZ-PATCH: route Google authorization results (startIntentSenderForResult codes) back
    // to this plugin — without them Capacitor drops the consent result and sign-in hangs.
    requestCodes = { ${codes.join(', ')} }
)`;

// 2. Forward those codes inside handleOnActivityResult (stock code only handles Facebook/Twitter).
const MARKER = "        // Handle other providers' activity results if needed";
const forwarded = `        // ADDABAAZ-PATCH: forward Google authorization results (account picker -> consent screen)
        // to GoogleProvider; stock 7.20.0 only handles Facebook/Twitter here.
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode <= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            SocialProvider googleProvider = socialProviderHashMap.get("google");
            if (googleProvider instanceof GoogleProvider) {
                ((GoogleProvider) googleProvider).handleAuthorizationIntent(requestCode, data);
                return;
            }
        }
${MARKER}`;

if (!src.includes(ANNOTATION)) throw new Error('[social-login:patch] @CapacitorPlugin annotation not found — the plugin changed; update this script.');
if (!src.includes(MARKER)) throw new Error('[social-login:patch] activity-result marker not found — the plugin changed; update this script.');
fs.writeFileSync(file, src.replace(ANNOTATION, annotation).replace(MARKER, forwarded));
console.log('[social-login:patch] Google activity-result routing added.');
