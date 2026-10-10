import { accountPlan } from '../ui/account-plan.js';
import { accountNav } from '../ui/account-nav.js';
import { settingGroups } from './account-extra.js';
import { addPhone } from '../ui/add-phone.js';
import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { friendly } from '../errors.js';
import { openDialog } from '../ui/dialog.js';

export default async function accountDetails(ctx) {
  const u = app.user, account = u.account;
  if (!account) { go('/signin?next=/account/details', { replace: true }); return; }
  ctx.setTitle('Edit Account');
  const parts = (account.name || '').trim().split(/\s+/);
  let savedName = parts.join(' '), busy = false;
  // Same sidebar shell as the other account pages on desktop; phones keep the stacked edit form.
  ctx.root.innerHTML = html`<div class="page page-narrow account-details-page">
    <div class="account-layout">${accountNav(settingGroups(), 'overview')}<div class="account-content">
    <header class="account-edit-header"><a class="page-back" href="#/account" aria-label="Back to Account">${icon('left', { size: 28 })}</a><h1>Edit Account</h1></header>
    <div id="accountPlanSummary">${accountPlan(u)}</div>
    <form class="account-edit-form" id="accountNameForm">
      <div class="account-name-fields">
        <label class="account-line-field">First Name<input name="firstName" autocomplete="given-name" maxlength="60" required value="${parts[0] || ''}"></label>
        <label class="account-line-field">Last Name<input name="lastName" autocomplete="family-name" maxlength="60" value="${parts.slice(1).join(' ')}"></label>
      </div>
      <div class="account-contact-field"><div><span class="account-field-label">Email ID</span><p>${account.emailIsPlaceholder ? 'Not added' : account.email}</p></div><button type="button" class="icon-btn" id="editEmail" aria-label="Edit email address">${icon('edit', { size: 20 })}</button></div>
      <div class="account-contact-field"><div><span class="account-field-label">Mobile Number</span><p id="accountPhoneValue">${account.phone ? `+${account.phone}` : 'Not added'}</p></div><span id="accountPhoneAction">${account.phone ? html`<a class="icon-btn" href="#/support" aria-label="Request a phone-number change" title="Contact support to change your number">${icon('edit', { size: 20 })}</a>` : html`<button type="button" class="icon-btn" id="addAccountPhone" aria-label="Add mobile number">${icon('plus', { size: 20 })}</button>`}</span></div>
      <p class="account-field-help" id="accountPhoneHelp">${account.phone ? 'Phone-number changes currently require support verification.' : 'Add a mobile number using SMS verification.'}</p>
      <p class="form-status" id="accountSaveStatus" role="status"></p>
      <button class="btn btn-primary account-save" type="submit" id="saveAccount" disabled>Save Changes</button>
      <a class="account-manage-link" href="#/profiles?manage=1">Manage Viewing Profiles</a>
    </form>
    </div></div>
  </div>`.s;
  ctx.onCleanup(u.on('subscription', () => {
    const summary = $('#accountPlanSummary', ctx.root);
    if (summary) summary.innerHTML = accountPlan(u).s;
  }));
  const form = $('#accountNameForm', ctx.root), save = $('#saveAccount', form), status = $('#accountSaveStatus', form);
  const nameValue = () => [$('[name=firstName]', form).value.trim(), $('[name=lastName]', form).value.trim()].filter(Boolean).join(' ');
  const sync = () => { const name = nameValue(); save.disabled = busy || !name || name.length > 60 || !($('[name=firstName]', form).value.trim()) || name === savedName; };
  form.addEventListener('input', sync);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return;
    const name = nameValue();
    if (!name || name.length > 60) { status.textContent = 'Enter a name of up to 60 characters.'; return; }
    busy = true; sync(); status.textContent = '';
    try { await u.remote.updateAccountName(name); savedName = name; await u.refreshAccount(); status.textContent = 'Account details saved.'; }
    catch (error) { status.textContent = friendly(error); }
    finally { busy = false; sync(); }
  });
  $('#addAccountPhone', ctx.root)?.addEventListener('click', () => addPhone(u, (phone) => {
    const value = $('#accountPhoneValue', ctx.root);
    if (!value) return;
    value.textContent = `+${phone}`;
    $('#accountPhoneHelp', ctx.root).textContent = 'Mobile number verified. Contact support if you need to change it.';
    $('#accountPhoneAction', ctx.root).innerHTML = html`<a class="icon-btn" href="#/support" aria-label="Request a phone-number change">${icon('edit', { size: 20 })}</a>`.s;
  }));
  $('#editEmail', ctx.root).addEventListener('click', () => {
    const { el } = openDialog(html`<h2>Edit Email Address</h2><form class="form" id="accountEmailForm">
      <label>New Email Address<input name="email" type="email" autocomplete="email" maxlength="254" required value="${account.emailIsPlaceholder ? '' : account.email}"></label>
      <p class="muted small">We’ll send a confirmation link. Your current address stays active until you confirm the new one.</p>
      <p class="form-status" role="status"></p><button class="btn btn-primary" type="submit">Send Confirmation Link</button>
      ${account.emailVerified === false && !account.phoneVerified ? html`<button type="button" class="btn btn-ghost" id="verifyCurrentEmail">Verify Current Email First</button>` : ''}
    </form>`, { title: 'Edit email address', cls: 'dialog-sm' });
    const emailForm = $('#accountEmailForm', el), emailStatus = $('[role=status]', emailForm);
    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault(); const button = $('button[type=submit]', emailForm); button.disabled = true;
      try { await u.remote.requestAccountEmail($('[name=email]', emailForm).value.trim()); emailStatus.textContent = 'Confirmation link sent. Check your new email inbox and spam folder.'; }
      catch (error) { emailStatus.textContent = friendly(error); }
      finally { button.disabled = false; }
    });
    $('#verifyCurrentEmail', el)?.addEventListener('click', async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await u.remote.resendVerification(); emailStatus.textContent = 'Verification link sent to your current email.'; }
      catch (error) { emailStatus.textContent = friendly(error); }
      finally { button.disabled = false; }
    });
  });
}
