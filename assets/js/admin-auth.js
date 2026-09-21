import { validateAuthConfig, verifyGoogleCredential } from './google-auth.js?v=9345c48ce964';

const ASSET_VERSION = '9345c48ce964';
const $ = id => document.getElementById(id);
let session = null, editorLoaded = false, busy = false, expiryTimer;
const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');

function status(text, isError = false) {
  $('authStatus').textContent = text;
  $('authStatus').classList.toggle('error', isError);
}
function lock(message) {
  clearTimeout(expiryTimer);
  session = null;
  $('editorShell').hidden = true;
  $('editorShell').inert = true;
  $('loginPanel').hidden = false;
  $('accountControls').hidden = true;
  $('headerState').hidden = true;
  status(message);
}

function loadGoogle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    const timer = setTimeout(() => reject(new Error('Google sign-in timed out. Check your connection or content blocker, then reload.')), 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Google sign-in could not load. Check your connection or content blocker, then reload.')); };
    document.head.append(script);
  });
}

async function start() {
  $('adminBuild').textContent = ASSET_VERSION;
  if (!window.isSecureContext) throw new Error('Google sign-in needs HTTPS (or localhost for development).');
  const response = await fetch(`config/admin-auth.json?v=${ASSET_VERSION}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load config/admin-auth.json. Check the deployment and reload.');
  const config = validateAuthConfig(await response.json());
  await loadGoogle();
  if (!window.google?.accounts?.id) throw new Error('Google sign-in is unavailable. Reload this page to try again.');
  google.accounts.id.initialize({
    client_id: config.clientId,
    nonce,
    auto_select: false,
    ux_mode: 'popup',
    callback: async result => {
      if (busy || session) return;
      busy = true;
      status('Verifying your Google account…');
      try {
        const identity = await verifyGoogleCredential(result.credential, config, nonce);
        if (!editorLoaded) {
          await import(`./admin.js?v=${ASSET_VERSION}`);
          editorLoaded = true;
        }
        session = identity;
        $('signedInEmail').textContent = identity.email;
        $('loginPanel').hidden = true;
        $('editorShell').hidden = false;
        $('editorShell').inert = false;
        $('accountControls').hidden = false;
        $('headerState').hidden = false;
        expiryTimer = setTimeout(() => lock('Your sign-in expired. Sign in again to continue; unsaved edits remain in this tab.'), identity.expiresAt - Date.now());
      } catch (error) {
        status(error.message || 'Unable to sign in. Please try again.', true);
      } finally { busy = false; }
    }
  });
  google.accounts.id.renderButton($('googleSignIn'), { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: Math.max(200, Math.min(280, $('googleSignIn').clientWidth)) });
  $('googleLoading').hidden = true;
  status('Sign in with an allowed Google account to open the content editor.');
}

$('signOutButton').addEventListener('click', () => {
  if (!confirm('Sign out and discard any unsaved edits? Download or save your workbook first.')) return;
  google.accounts.id.disableAutoSelect();
  try { localStorage.removeItem('addabaaz.content-preview.v1'); } catch { /* storage may be disabled */ }
  // beforeunload still protects edits; the UI locks even if navigation is cancelled.
  lock('Signed out. Sign in again to continue.');
  location.reload();
});
// Timers are throttled in background tabs. Recheck expiry before exposing the editor.
window.addEventListener('focus', checkExpiry);
document.addEventListener('visibilitychange', checkExpiry);
function checkExpiry() {
  if (session && session.expiresAt <= Date.now()) lock('Your sign-in expired. Sign in again to continue; unsaved edits remain in this tab.');
}
start().catch(error => status(error.message, true));
