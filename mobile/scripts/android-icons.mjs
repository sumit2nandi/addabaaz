// Stamps the website logo (pre-rendered in mobile/android-icons/ by gen-launcher-icons.sh) over the
// stock Capacitor launcher icons of a generated Android project, so the APK installs with the brand
// mark - not the little Capacitor bot. Run by patch-android.mjs after every `cap add android`/sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ICON_SOURCE = path.join(HERE, '..', 'android-icons');
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

// Copies the legacy logo PNGs into <androidRoot>/app/src/main/res and replaces Capacitor's
// adaptive icon with the white tile + enlarged circular foreground. Returns what it did.
export function stampLauncherIcons(androidRoot) {
  const res = path.join(androidRoot, 'app', 'src', 'main', 'res');
  fs.mkdirSync(res, { recursive: true });   // a fresh `cap add android` always has one; create it if a minimal fixture doesn't
  const done = [];
  for (const d of DENSITIES) {
    const target = path.join(res, `mipmap-${d}`);
    fs.mkdirSync(target, { recursive: true });
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      fs.copyFileSync(path.join(ICON_SOURCE, d, f), path.join(target, f));
      done.push(`mipmap-${d}/${f}`);
    }
  }
  // Replace the stock Capacitor adaptive icon (the blue bot) instead of deleting it. A deliberate
  // white background reproduces the earlier tile; the larger foreground leaves only small corner gaps.
  const adaptive = path.join(res, 'mipmap-anydpi-v26');
  fs.rmSync(adaptive, { recursive: true, force: true });
  fs.mkdirSync(adaptive, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/addabaaz_icon_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n`;
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    fs.writeFileSync(path.join(adaptive, f), xml);
    done.push(`mipmap-anydpi-v26/${f}`);
  }
  const values = path.join(res, 'values');
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(path.join(values, 'addabaaz_icon_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="addabaaz_icon_background">#FFFFFF</color></resources>\n');
  done.push('values/addabaaz_icon_colors.xml');
  fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  fs.copyFileSync(path.join(ICON_SOURCE, 'ic_launcher_playstore.png'), path.join(res, 'drawable', 'ic_launcher_playstore.png'));
  done.push('drawable/ic_launcher_playstore.png');
  // The stock Capacitor splash (white tile + blue bot) flashes for a moment on every launch; the
  // branded red splash replaces it in every density bucket AND as the drawable/splash.png the
  // template's styles reference (system splash icon + the SplashScreen plugin both use it).
  for (const d of DENSITIES) {
    const target = path.join(res, `drawable-${d}`);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(path.join(ICON_SOURCE, 'splash', `${d}.png`), path.join(target, 'splash.png'));
    done.push(`drawable-${d}/splash.png`);
  }
  fs.copyFileSync(path.join(ICON_SOURCE, 'splash', 'mdpi.png'), path.join(res, 'drawable', 'splash.png'));
  done.push('drawable/splash.png');
  return done;
}
