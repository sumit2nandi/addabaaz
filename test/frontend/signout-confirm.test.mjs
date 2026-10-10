// Signing out must ask first, in the app's confirmation popup: nothing signs out until the viewer
// presses the confirm button; Cancel (or the X, or Esc) keeps the session.
// Run: node --test test/frontend/signout-confirm.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

const { document, window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.window = window;
window.localStorage = { getItem: () => null, setItem() {} };
globalThis.localStorage = window.localStorage;

// linkedom has no <dialog> behaviour: give the element prototype the two methods openDialog uses.
const dialogProto = Object.getPrototypeOf(document.createElement('dialog'));
dialogProto.showModal = function () { this.setAttribute('open', ''); };
dialogProto.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };

const { confirmDialog } = await import('../../app/js/ui/dialog.js');

const tick = () => new Promise((r) => setTimeout(r, 0));

test('confirmDialog resolves true only after the confirm button', async () => {
  const shown = confirmDialog({ title: 'Sign out of ADDABAAZ?', text: 'You can sign back in anytime.', confirm: 'Sign out', danger: true, icon: 'logout' });
  await tick();
  const dlg = document.querySelector('dialog.dialog');
  assert.ok(dlg, 'the popup is a modal dialog');
  assert.ok(dlg.querySelector('.dlg-icon'), 'the confirmation shows the brand-tinted glyph circle');
  assert.ok(dlg.classList.contains('dlg-centered'), 'the icon variant centers the content');
  assert.match(dlg.textContent, /Sign out of ADDABAAZ\?/);
  const ok = dlg.querySelector('#ok');
  assert.match(ok.className, /btn-danger/, 'the destructive confirm button is the danger style');
  assert.equal(ok.textContent, 'Sign out');
  ok.onclick();
  assert.equal(await shown, true);
  assert.equal(document.querySelector('dialog'), null, 'the dialog is torn down on close');
});

test('Cancel keeps the session (resolves false), and so does the X', async () => {
  const p = confirmDialog({ title: 'Sign out of ADDABAAZ?', confirm: 'Sign out' });
  await tick();
  document.querySelector('dialog [data-close]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(await p, false, 'Cancel resolves false');

  const p2 = confirmDialog({ title: 'Sign out of ADDABAAZ?', confirm: 'Sign out' });
  await tick();
  document.querySelector('dialog.dialog').close();   // Esc/X path ends the same way
  assert.equal(await p2, false);
});

test('without an icon the dialog keeps the plain layout (existing confirms unchanged)', async () => {
  const p = confirmDialog({ title: 'Clear watch history?', confirm: 'Clear', danger: true });
  await tick();
  const dlg = document.querySelector('dialog.dialog');
  assert.equal(dlg.querySelector('.dlg-icon'), null);
  assert.equal(dlg.classList.contains('dlg-centered'), false);
  dlg.querySelector('#ok').onclick();
  assert.equal(await p, true);
});

test('account deletion opts the current installation out of push before removing the account', () => {
  const user = fs.readFileSync(new URL('../../app/js/data/user.js', import.meta.url), 'utf8');
  const start = user.indexOf('async deleteAccount()');
  const deletion = user.slice(start, user.indexOf('#localSnapshot()', start));
  assert.ok(deletion.indexOf('disablePush()') >= 0, 'clear local/account push registration first');
  assert.ok(deletion.indexOf('disablePush') < deletion.indexOf('this.remote.deleteAccount()'), 'push is detached before account deletion');
  assert.ok(deletion.indexOf('this.remote.deleteAccount()') < deletion.indexOf('this.signOut()'), 'local sign-out still follows server deletion');
});

test('both Sign out buttons open this confirmation before signing out', () => {
  const shell = fs.readFileSync(new URL('../../app/js/ui/shell.js', import.meta.url), 'utf8');
  const account = fs.readFileSync(new URL('../../app/js/views/account.js', import.meta.url), 'utf8');
  for (const [name, src] of [['shell.js (profile menu)', shell], ['account.js (Account page)', account]]) {
    assert.match(src, /confirmSignOut\(\)/, `${name} calls the shared sign-out confirmation`);
    const gated = src.match(/confirmSignOut\(\)[\s\S]{0,160}?signOut/);
    assert.ok(gated, `${name} signs out only after the confirmation resolves`);
    assert.ok(!/closest\('\[data-signout\]'\)\)\s*\{\s*closeAll\(\);\s*app\.user\.signOut/.test(src), `${name} no longer signs out on a bare click`);
  }
  const components = fs.readFileSync(new URL('../../app/js/ui/components.js', import.meta.url), 'utf8');
  assert.match(components, /export function confirmSignOut/, 'one shared popup definition (menu and Account say the same thing)');
  assert.match(components, /icon: 'logout'/, 'the popup carries the sign-out glyph');
});
