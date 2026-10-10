// E-mail address hygiene: one address = one account, whatever it looks like on screen.
//
// `users.email` has a UNIQUE index, but that index only refuses a string MySQL considers equal: the
// collation ignores characters such as a zero-width space, yet gives a NON-BREAKING space, an ideographic
// space or a full-width ＠ a weight of their own. Copy-pasting an address from a web page or a document
// therefore produces a DIFFERENT string that buys a second account for what a person — and the admin
// Users list — sees as one address. A database whose users table predates the unique key can even hold
// two identical addresses. That is how "two users with the same email" happen.
//
// `normalizeEmail` is the single definition of "the same address": signup, sign-in, social sign-in,
// password reset, the admin duplicate report and the broadcast audience all use it. Normalized addresses
// are stored in `users.email_norm`, which carries its own UNIQUE index, so the database refuses a second
// account even for two requests racing each other.

// Characters that render as nothing (or as a joining artefact) but are real characters in the string:
// soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul fillers, Mongolian vowel separator,
// zero-width space/non-joiner/joiner/LTR/RTL marks, bidi overrides, word joiner + invisible operators,
// bidi isolates, Hangul filler, variation selectors, BOM, halfwidth Hangul filler.
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

// `ok` = the address is something we can actually send mail to (after cleaning it up): exactly one @,
// a dot in the domain, and nothing else that a mail server would refuse. Spaces and invisible characters
// are removed rather than rejected — pasting "rupa @example.com" must land on the same account as
// "rupa@example.com", not on a second one.
const ADDRESS = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Cleans an address the way every part of the app must agree on.
 * @param {unknown} raw
 * @returns {{ email: string, ok: boolean }} `email` is the normalized form (lower-case, NFKC, invisibles
 *   removed, trimmed) — always safe to store/compare; `ok` says whether it is a usable address at all.
 */
export function normalizeEmail(raw) {
  const cleaned = String(raw ?? '')
    .normalize('NFKC')                 // full-width ＠ → @, full-width letters fold, exotic spaces → ' '
    .replace(INVISIBLE, '')            // zero-width & friends disappear entirely
    .replace(/\s+/g, '');              // no space of any kind can be part of an address: a pasted one is an artefact
  const email = cleaned.toLowerCase();
  const ok = email.length >= 5 && email.length <= 254 && ADDRESS.test(email);
  return { email, ok };
}

/** The comparison key for an address (used for grouping, de-duplication and the unique index). */
export const emailKey = (raw) => normalizeEmail(raw).email;

/**
 * The same address with invisible/look-alike characters made visible, for the admin duplicate report:
 * `rupa@example.com` stays as it is, while `rupa\u200b@example.com` reads `rupa⟨U+200B⟩@example.com` and
 * `rupa\u00a0@example.com` reads `rupa⟨U+00A0⟩@example.com`. That is the answer to "why do these two look
 * identical?".
 */
export function visibleEmail(raw) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const cp = ch.codePointAt(0);
    if (ch === ' ') out += '⟨space⟩';
    else if (ch === '\t') out += '⟨tab⟩';
    else out += cp < 0x20 || cp === 0x7F || cp > 0x7E ? `⟨U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟩` : ch;
  }
  return out;
}

/** True when an address is plain printable ASCII with no stray space (nothing to show markers for). */
export const plainEmail = (raw) => /^[\x21-\x7E]*$/.test(String(raw ?? ''));
