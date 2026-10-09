// Parental-PIN helpers: actions that need the PIN (profile changes, leaving a Kids profile) go through here.
import { html, $ } from '../util.js';
import { friendly } from '../errors.js';
import { pinPrompt, openDialog } from './dialog.js';

/** Runs `fn`; if the server wants the parental PIN, asks for it (verifying it with the server) and tries once more. */
export async function withPin(u, fn) {
  try { return await fn(); }
  catch (e) {
    if (u.hasPin && (e.code === 'pin_required' || e.code === 'pin_invalid')) {
      const pin = await pinPrompt({ title: 'Parental PIN', text: 'Enter your PIN to change profiles.', check: (p) => u.verifyPin(p), onForgot: () => forgotParentalPin(u) });
      if (!pin) throw Object.assign(new Error('cancelled'), { cancelled: true });
      return fn();
    }
    throw e;
  }
}
/** Leaving a Kids profile for a grown-up one needs the PIN (when one is set). Resolves true if the switch may go ahead. */
export async function mayLeaveKids(u, target) {
  if (!u.isKids || target?.kids || !u.hasPin || u.pin) return true;
  return !!(await pinPrompt({ title: 'Parental PIN', text: 'Enter your PIN to leave the Kids profile.', check: (p) => u.verifyPin(p), onForgot: () => forgotParentalPin(u) }));
}

export function forgotParentalPin(u) {
  const { el } = openDialog(html`<h2>Forgot Parental PIN?</h2><p class="muted">We’ll send a single-use recovery link to your verified account email. It expires in 15 minutes. Your existing PIN stays active until you choose a new one.</p>
    <p class="muted">No access to that email? <a href="#/support" data-close>Contact Support</a>.</p>
    <div class="form-status" id="pinRecoveryStatus" role="status"></div><button type="button" class="btn btn-primary" id="sendPinRecovery">Email Recovery Link</button>`, { title: 'Recover parental PIN', cls: 'dialog-sm' });
  $('#sendPinRecovery', el).addEventListener('click', async (e) => {
    const button = e.currentTarget; button.disabled = true;
    try { await u.remote.forgotPin(); $('#pinRecoveryStatus', el).textContent = 'Recovery email sent. Check your inbox and spam folder.'; }
    catch (error) { $('#pinRecoveryStatus', el).textContent = friendly(error); button.disabled = false; }
  });
}
