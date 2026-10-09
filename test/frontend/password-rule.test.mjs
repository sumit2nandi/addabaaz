// Password policy shared by sign-up, reset and change-password (app/js/password-rule.js).
// Run: node --test test/frontend/password-rule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from '../../app/js/password-rule.js';

test('a password with upper, lower, digit and symbol at 8+ characters is accepted', () => {
  for (const p of ['Abcdef1!', 'Tr0ub4dor&3', 'MyLongPassphrase#2026', 'a'.repeat(120) + 'A1!']) {
    assert.equal(passwordProblem(p), null, p);
  }
});

test('8+ characters alone is no longer enough', () => {
  assert.match(passwordProblem('abcdefgh'), /uppercase.*number.*symbol|number.*symbol.*uppercase|uppercase.*symbol.*number/i);
  assert.match(passwordProblem('Abcdefgh'), /number/);
  assert.match(passwordProblem('Abcdefg1'), /symbol/);
  assert.match(passwordProblem('ABCDEF1!'), /lowercase/);
  assert.match(passwordProblem('abcdef1!'), /uppercase/);
});

test('length bounds are enforced', () => {
  assert.match(passwordProblem('Ab1!'), /8–128 characters/);
  assert.match(passwordProblem('A1!' + 'a'.repeat(126)), /8–128 characters/);
});

test('whitespace does not count as a symbol and non-strings are refused', () => {
  assert.match(passwordProblem('Abcdef1 x'), /symbol/);
  assert.notEqual(passwordProblem(undefined), null);
  assert.notEqual(passwordProblem(12345678), null);
});
