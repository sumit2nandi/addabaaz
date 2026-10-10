// One address = one account: the normalizer every path (signup, sign-in, social sign-in, password reset,
// admin duplicate report, broadcast audience) agrees on. No database needed.
// Run: node --test server/test/email-address.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, emailKey, visibleEmail, plainEmail } from '../src/email-address.js';

test('normalizeEmail folds case, surrounding space and full-width look-alikes', () => {
  assert.equal(normalizeEmail('Rupa@Example.COM').email, 'rupa@example.com');
  assert.equal(normalizeEmail('  rupa@example.com  ').email, 'rupa@example.com');
  assert.equal(normalizeEmail('rupa@example.com\u00a0').email, 'rupa@example.com');       // non-breaking space
  assert.equal(normalizeEmail('rupa\u3000@example.com').email, 'rupa@example.com');       // ideographic space
  assert.equal(normalizeEmail('rupa＠example.com').email, 'rupa@example.com');            // full-width @
  assert.equal(normalizeEmail('ｒupa@example.com').email, 'rupa@example.com');            // full-width letters
});

test('invisible paste artefacts disappear instead of creating a second account', () => {
  const invisibles = ['\u200b', '\u200c', '\u200d', '\ufeff', '\u00ad', '\u2060', '\u180e', '\u2028', '\u2063'];
  for (const ch of invisibles) {
    assert.equal(normalizeEmail(`rupa${ch}@example.com`).email, 'rupa@example.com', `U+${ch.codePointAt(0).toString(16)}`);
    assert.equal(normalizeEmail(`rupa@example${ch}.com`).email, 'rupa@example.com');
    assert.equal(normalizeEmail(`rupa@exa${ch}mple.com`).email, 'rupa@example.com');
  }
  // Two addresses that differ only by an invisible character are the SAME address.
  assert.equal(emailKey('rupa@example.com'), emailKey('rupa\u200b@example.com'));
  // Trailing newlines/tabs from a paste are dropped too.
  assert.equal(normalizeEmail('rupa@example.com\n').email, 'rupa@example.com');
});

test('a pasted space is an artefact, not a second account', () => {
  assert.equal(normalizeEmail('rupa @example.com').email, 'rupa@example.com');
  assert.equal(normalizeEmail('rupa@exa mple.com').email, 'rupa@example.com');
  assert.equal(normalizeEmail('rupa @ example . com').email, 'rupa@example.com');
});

test('addresses that are not usable are reported as such (ok = false)', () => {
  for (const bad of ['', 'rupa', 'rupa@', '@example.com', 'a@b', 'rupa@@example.com', 'rupa\u200b', 'rupa@.com', null, undefined]) {
    assert.equal(normalizeEmail(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(normalizeEmail('rupa@example.com').ok, true);
  assert.equal(normalizeEmail('r@ex.co').ok, true);
  assert.equal(normalizeEmail('x'.repeat(250) + '@example.com').ok, false, 'longer than 254 characters');
});

test('visibleEmail marks the characters that make two identical-looking rows differ', () => {
  assert.equal(visibleEmail('rupa@example.com'), 'rupa@example.com');
  assert.equal(visibleEmail('rupa\u200b@example.com'), 'rupa⟨U+200B⟩@example.com');
  assert.equal(visibleEmail('rupa\u00a0@example.com'), 'rupa⟨U+00A0⟩@example.com');   // non-breaking space
  assert.equal(visibleEmail('rupa＠example.com'), 'rupa⟨U+FF20⟩example.com');           // full-width @
  assert.equal(visibleEmail('rupa @example.com'), 'rupa⟨space⟩@example.com');           // a pasted plain space
  assert.equal(visibleEmail('rupa\t@example.com'), 'rupa⟨tab⟩@example.com');
  assert.equal(plainEmail('rupa@example.com'), true);
  assert.equal(plainEmail('rupa\u200b@example.com'), false);
  assert.equal(plainEmail('rupa\u00a0@example.com'), false);
  assert.equal(plainEmail('rupa＠example.com'), false);
  assert.equal(plainEmail('rupa @example.com'), false, 'a stray space is worth showing');
});
