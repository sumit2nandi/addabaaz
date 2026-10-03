#!/usr/bin/env node
/*
 * Materializes Firebase's downloaded client config files from GitHub Actions secrets.
 * This lets the Android/iOS projects stay git-ignored and means a phone-only maintainer does not
 * need to run local build commands or commit Firebase config files.
 *
 * GitHub Actions secrets:
 *   FIREBASE_ANDROID_JSON  raw contents of google-services.json
 *   FIREBASE_IOS_PLIST    raw XML contents of GoogleService-Info.plist
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = JSON.parse(fs.readFileSync(path.join(MOBILE, 'capacitor.config.json'), 'utf8')).appId;

function requiredText(source, label) {
  const text = String(source || '').trim();
  if (!text) return '';
  return text;
}

/** Validates and writes the Android client config; returns false if the secret is not configured. */
export function configureAndroidFirebase(source, {
  appId = APP_ID,
  output = path.join(MOBILE, 'android', 'app', 'google-services.json'),
} = {}) {
  const text = requiredText(source, 'FIREBASE_ANDROID_JSON');
  if (!text) return false;
  let config;
  try { config = JSON.parse(text); }
  catch { throw new Error('FIREBASE_ANDROID_JSON must contain the complete, raw google-services.json file.'); }
  const projectId = config?.project_info?.project_id;
  const client = (config?.client || []).find((entry) => entry?.client_info?.android_client_info?.package_name === appId);
  if (!projectId || !client?.client_info?.mobilesdk_app_id) {
    const found = (config?.client || []).map((entry) => entry?.client_info?.android_client_info?.package_name).filter(Boolean);
    throw new Error(`google-services.json must include an Android client for ${appId}${found.length ? ` (found: ${found.join(', ')})` : ''}.`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return true;
}

function plistValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`<key>\\s*${escaped}\\s*<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`));
  return match?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() || '';
}

/** Validates/writes the iOS config; returns false if the secret is not configured. */
export function configureIosFirebase(source, {
  appId = APP_ID,
  output = path.join(MOBILE, 'ios', 'App', 'App', 'GoogleService-Info.plist'),
} = {}) {
  const text = requiredText(source, 'FIREBASE_IOS_PLIST');
  if (!text) return false;
  if (!/<plist\b/.test(text) || !/<key>/.test(text)) {
    throw new Error('FIREBASE_IOS_PLIST must contain the complete XML GoogleService-Info.plist file.');
  }
  const bundleId = plistValue(text, 'BUNDLE_ID');
  if (bundleId !== appId) throw new Error(`GoogleService-Info.plist BUNDLE_ID must be ${appId}${bundleId ? ` (found ${bundleId})` : ''}.`);
  if (!plistValue(text, 'GOOGLE_APP_ID') || !plistValue(text, 'PROJECT_ID')) {
    throw new Error('GoogleService-Info.plist is missing GOOGLE_APP_ID or PROJECT_ID.');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${text}\n`, { mode: 0o600 });
  return true;
}

function includeIosPlistInAppBundle() {
  const script = path.join(MOBILE, 'scripts', 'include-firebase-ios.rb');
  const result = spawnSync('ruby', [script], { cwd: MOBILE, stdio: 'inherit' });
  if (result.error) throw new Error(`Could not run the iOS Firebase project helper: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Could not add GoogleService-Info.plist to the iOS app project (exit ${result.status}).`);
}

function main() {
  const platform = process.argv[2];
  if (platform === 'android') {
    if (configureAndroidFirebase(process.env.FIREBASE_ANDROID_JSON)) console.log('[firebase] Android client config installed for this CI build.');
    else console.log('[firebase] FIREBASE_ANDROID_JSON is not set; native push will be disabled in this APK.');
    return;
  }
  if (platform === 'ios') {
    if (configureIosFirebase(process.env.FIREBASE_IOS_PLIST)) {
      includeIosPlistInAppBundle();
      console.log('[firebase] iOS client config installed for this CI build.');
    } else console.log('[firebase] FIREBASE_IOS_PLIST is not set; native push will be disabled in this iOS build.');
    return;
  }
  throw new Error('Usage: node mobile/scripts/configure-firebase.mjs <android|ios>');
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { main(); }
  catch (error) { console.error(`[firebase] ${error.message}`); process.exitCode = 1; }
}
