// One password policy for the whole app. Imported by the browser (sign-up, reset, change password)
// and by the server (routes/auth.js, features.js) so both sides always agree.
//
// Industry-baseline complexity: 8–128 characters, with at least one uppercase letter, one lowercase
// letter, one digit and one symbol (anything that is not a letter, digit or whitespace).
// Sign-in is NOT checked against this rule, so existing accounts can still log in.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const PASSWORD_RULES = [
  { test: (p) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX, msg: `be ${PASSWORD_MIN}–${PASSWORD_MAX} characters` },
  { test: (p) => /[a-z]/.test(p), msg: 'include a lowercase letter' },
  { test: (p) => /[A-Z]/.test(p), msg: 'include an uppercase letter' },
  { test: (p) => /[0-9]/.test(p), msg: 'include a number' },
  { test: (p) => /[^A-Za-z0-9\s]/.test(p), msg: 'include a symbol (e.g. ! @ # $ %)' },
];

// Returns null when the password is acceptable, otherwise a single human-readable sentence.
export function passwordProblem(password) {
  if (typeof password !== 'string') return `Password must ${PASSWORD_RULES[0].msg}.`;
  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.msg);
  if (!missing.length) return null;
  if (missing.length === 1 && missing[0] === PASSWORD_RULES[0].msg) return `Password must ${missing[0]}.`;
  return `Password must ${missing.join(', ')}.`;
}

export const PASSWORD_HINT = `${PASSWORD_MIN}+ characters with uppercase, lowercase, a number and a symbol`;
