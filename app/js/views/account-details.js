import { app } from '../app.js';
import { html, $ } from '../util.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { friendly } from '../errors.js';

export default async function accountDetails(ctx) {
  const u = app.user, account = u.account;
  if (!account) { go('/signin?next=/account/details', { replace: true }); return; }
  ctx.setTitle('Edit account details');
  ctx.root.innerHTML = html`<div class="page page-narrow account-page account-details-page">
    <p class="back-row"><a class="back-link" href="#/account">${icon('left', { size: 18 })}<span>Account</span></a></p>
    <h1>Edit account details</h1>
    <p class="muted">Manage your account name and contact information. Viewing profiles are managed separately.</p>
    <section class="card-panel"><form class="form" id="accountNameForm">
      <label>Account name<input name="name" autocomplete="name" maxlength="60" required value="${account.name}"></label>
      <p class="form-status" role="status"></p><button class="btn btn-primary" type="submit">Save name</button>
    </form></section>
    <section class="card-panel"><h2>Email address</h2><p class="muted">${account.emailIsPlaceholder ? 'No email address added.' : account.email}</p>
      <form class="form" id="accountEmailForm"><label>New email address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label>
        <p class="muted small">We’ll send a confirmation link. The address changes only after you confirm it. Verify your current email first if it is not yet verified.</p>
        <p class="form-status" role="status"></p><button class="btn btn-primary" type="submit">Send confirmation link</button>
      </form>
      ${account.emailVerified === false && !account.phoneVerified ? html`<button type="button" class="btn btn-ghost" id="verifyCurrentEmail">Verify current email</button>` : ''}
    </section>
    <section class="card-panel"><h2>Phone number</h2><p>${account.phone || 'No phone number added'}</p><p class="muted small">For your security, adding or changing a sign-in phone number currently requires help from support. Do not create another account to change your number.</p><a class="btn btn-ghost" href="#/support">Request a phone-number change</a></section>
    <section class="card-panel"><h2>Viewing profiles</h2><p class="muted">Edit profile names, colours and Kids settings.</p><a class="btn btn-ghost" href="#/profiles?manage=1">Manage profiles</a></section>
  </div>`.s;
  const wireForm = (selector, action) => {
    const form = $(selector, ctx.root);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button'), status = form.querySelector('[role=status]');
      button.disabled = true; status.textContent = '';
      try { status.textContent = await action(form); }
      catch (error) { status.textContent = friendly(error); }
      finally { button.disabled = false; }
    });
  };
  wireForm('#accountNameForm', async (form) => {
    const name = $('[name=name]', form).value.trim();
    if (!name) throw new Error('Please enter your name.');
    await u.remote.updateAccountName(name);
    await u.refreshAccount();
    return 'Account name saved.';
  });
  wireForm('#accountEmailForm', async (form) => {
    await u.remote.requestAccountEmail($('[name=email]', form).value.trim());
    return 'Confirmation link sent. Check the new email inbox and spam folder.';
  });
  $('#verifyCurrentEmail', ctx.root)?.addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    const status = $('#accountEmailForm [role=status]', ctx.root);
    try { await u.remote.resendVerification(); status.textContent = 'Verification link sent to your current email.'; }
    catch (error) { status.textContent = friendly(error); }
    finally { button.disabled = false; }
  });
}
