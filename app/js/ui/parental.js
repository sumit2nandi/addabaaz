import { pinPrompt } from './dialog.js';

/** Runs `fn`; if the server wants the parental PIN, asks for it (verifying it with the server) and tries once more. */
export async function withPin(u, fn) {
  try { return await fn(); }
  catch (e) {
    if (u.hasPin && (e.code === 'pin_required' || e.code === 'pin_invalid')) {
      const pin = await pinPrompt({ title: 'Parental PIN', text: 'Enter your PIN to change profiles.', check: (p) => u.verifyPin(p) });
      if (!pin) throw Object.assign(new Error('cancelled'), { cancelled: true });
      return fn();
    }
    throw e;
  }
}
/** Leaving a Kids profile for a grown-up one needs the PIN (when one is set). Resolves true if the switch may go ahead. */
export async function mayLeaveKids(u, target) {
  if (!u.isKids || target?.kids || !u.hasPin || u.pin) return true;
  return !!(await pinPrompt({ title: 'Parental PIN', text: 'Enter your PIN to leave the Kids profile.', check: (p) => u.verifyPin(p) }));
}
