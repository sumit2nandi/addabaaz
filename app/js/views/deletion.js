import { pageBack } from '../ui/page-back.js';
// Public account-deletion instructions, also linked from Google Play and the privacy policy.
import { app } from '../app.js';
import { wireAccountDeletion } from './account-extra.js';
import { html } from '../util.js';
import { studioData } from './studio.js';
import { sectionHeader } from '../ui/components.js';

export default async function deletion(ctx) {
  const data = await studioData().catch(() => ({}));
  const studio = data?.studio || {};
  const name = studio.name || 'ADDABAAZ';
  const email = studio.email || 'office@addabaaz.in';
  const address = (studio.address || []).join(', ') || 'Kolkata, West Bengal, India';
  const subject = encodeURIComponent(`${name} account deletion request`);
  const body = encodeURIComponent(`Hello,\n\nPlease delete my ${name} account.\n\nRegistered email or phone number:\nFull name (optional):\n\nI understand that limited billing and security records may be retained as described in the Privacy Policy.\n`);
  ctx.setTitle(`Delete your ${name} account`);
  const backButton = pageBack(ctx);
  ctx.root.innerHTML = html`<article class="page page-narrow legal deletion-page">
    ${sectionHeader({ tag: 'Account & privacy', title: 'Delete your account', subtitle: name, back: backButton })}
    <p class="lead">You can permanently delete your ADDABAAZ account and request deletion even if you can no longer sign in.</p>

    <section class="card-panel"><h2>Delete From the App</h2>
      <p>Sign in, read the details below, then use <b>Delete Account</b> at the bottom of this page and confirm. This removes the account and linked profiles, library, viewing activity, ratings, device registrations and support conversations from our service.</p>
      <p>Account deletion is permanent and you will not be able to sign in again with that account.</p>
    </section>

    <section class="card-panel"><h2>Cannot Sign In?</h2>
      <p>Email <a href="mailto:${email}?subject=${subject}&amp;body=${body}">${email}</a> with the subject “${name} account deletion request”. Tell us the account’s registered email address or phone number so we can locate it. We may ask for reasonable information to verify that you own the account.</p>
      <p><b>Do not include your password, SMS/email one-time code, card number or UPI PIN.</b> If you do not have an email app, write to ${email} from another email service. We aim to acknowledge a verified request within 7 days.</p>
    </section>

    <section><h2>What is deleted, and what may remain</h2>
      <p>We remove the account and its sign-in identities, profiles, ratings, My List, reminders, progress, subscription, credits/referrals, linked push registrations, phone verification-code history, linked diagnostics, refund requests, playback/notification records, and support-ticket conversations/replies linked by account ID, account email or verified phone. Contact-form records in our database matching the account email or verified phone number are removed too.</p>
      <p>Payment, refund and invoice/credit-note records are detached from the account but may remain for accounting and compliance. Retained billing snapshots may contain the buyer name, email, GSTIN/state, amounts, provider references, tax details and credit-note reason. Completed broadcast delivery history keeps campaign counts/status, but the account link, name, email, destination and delivery error are cleared and the recipient key is replaced with a fresh random value; campaign history is removed after its retention period.</p>
      <p>Append-only administrator audit records (which may include an administrator email, target account email/ID, action details and IP), copies held by email, Google Forms or contact-webhook providers, provider/security logs, pre-deletion backups, and guest data or cached files stored only on your device are not all removed by the account button. Local backups are rotated to the newest 14 by default when the backup script runs; remote R2 and hosting/database snapshots follow their separately configured retention. See the <a href="#/privacy">Privacy Policy</a> for retention details; you can separately clear browser/app storage and ask us about provider-held copies.</p>
    </section>

    <p class="muted small">Privacy contact: <a href="mailto:${email}">${email}</a><br>${address}</p>
    ${app.user.account ? html`<div class="deletion-actions"><button type="button" class="btn btn-danger" id="delAcc">Delete Account</button></div>` : html`<p><a class="btn btn-primary" href="#/signin?next=/delete-account">Sign In to Delete Your Account</a></p>`}
  </article>`.s;
  wireAccountDeletion(ctx.root);
}
