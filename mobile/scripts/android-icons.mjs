// Stamps the website logo (pre-rendered in mobile/android-icons/ by gen-launcher-icons.sh) over the
// stock Capacitor launcher icons of a generated Android project, so the APK installs with the brand
// mark - not the little Capacitor bot. Run by patch-android.mjs after every `cap add android`/sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ICON_SOURCE = path.join(HERE, '..', 'android-icons');
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

// Copies the logo launcher icons into <androidRoot>/app/src/main/res and removes the adaptive-icon
// XML (mipmap-anydpi-v26) so launchers and the package installer use these PNGs. Returns what it did.
export function stampLauncherIcons(androidRoot) {
  const res = path.join(androidRoot, 'app', 'src', 'main', 'res');
  fs.mkdirSync(res, { recursive: true });   // a fresh `cap add android` always has one; create it if a minimal fixture doesn't
  const done = [];
  for (const d of DENSITIES) {
    const target = path.join(res, `mipmap-${d}`);
    fs.mkdirSync(target, { recursive: true });
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) {
      fs.copyFileSync(path.join(ICON_SOURCE, d, f), path.join(target, f));
      done.push(`mipmap-${d}/${f}`);
    }
  }
  fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  fs.copyFileSync(path.join(ICON_SOURCE, 'ic_launcher_playstore.png'), path.join(res, 'drawable', 'ic_launcher_playstore.png'));
  done.push('drawable/ic_launcher_playstore.png');
  const adaptive = path.join(res, 'mipmap-anydpi-v26');
  if (fs.existsSync(adaptive)) { fs.rmSync(adaptive, { recursive: true, force: true }); done.push('removed mipmap-anydpi-v26 (adaptive XML would override the logo)'); }
  return done;
}
