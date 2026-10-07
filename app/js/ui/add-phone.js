import { html, $ } from '../util.js';
import { openDialog } from './dialog.js';
import { friendly } from '../errors.js';

export function addPhone(user, onAdded) {
  const { el, close } = openDialog(html`<h2>Add mobile number</h2><p class="muted">Verify your number by SMS to add it to this account.</p>
    <form class="form" id="phoneLinkForm">
      <label>Mobile number<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="24" placeholder="+91 98123 45678"></label>
      <button type="button" class="btn btn-ghost" id="sendPhoneCode">Send OTP</button>
      <label id="phoneCodeLabel" hidden>SMS code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit OTP"></label>
      <p class="form-status" role="status" id="phoneLinkStatus"></p>
      <button type="submit" class="btn btn-primary" id="verifyPhoneCode" hidden>Verify &amp; add number</button>
    </form>`, { title: 'Add mobile number', cls: 'dialog-sm' });
  const form = $('#phoneLinkForm', el), phone = $('[name=phone]', el), code = $('[name=code]', el), send = $('#sendPhoneCode', el), verify = $('#verifyPhoneCode', el), status = $('#phoneLinkStatus', el);
  let requestedPhone = '', busy = false, nextSend = 0;
  phone.addEventListener('input', () => {
    requestedPhone = ''; code.value = ''; code.required = false;
    $('#phoneCodeLabel', el).hidden = true; verify.hidden = true; status.textContent = '';
  });
  send.addEventListener('click', async () => {
    if (busy) return;
    if (!phone.value.trim()) { status.textContent = 'Enter your mobile number.'; phone.focus(); return; }
    if (Date.now() < nextSend) { status.textContent = `Wait ${Math.ceil((nextSend - Date.now()) / 1000)} seconds before resending.`; return; }
    const target = phone.value.trim(); busy = true; send.disabled = true; phone.disabled = true; verify.disabled = true;
    try {
      await user.remote.requestPhoneLink(target); requestedPhone = target; nextSend = Date.now() + 60_000;
      $('#phoneCodeLabel', el).hidden = false; verify.hidden = false; code.required = true;
      send.textContent = 'Resend OTP'; status.textContent = 'Code sent. It expires in 10 minutes.'; code.focus();
    } catch (error) { status.textContent = friendly(error); }
    finally { busy = false; send.disabled = false; phone.disabled = false; verify.disabled = false; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return;
    if (!requestedPhone || phone.value.trim() !== requestedPhone) { status.textContent = 'Send a code to this number first.'; return; }
    if (!/^\d{6}$/.test(code.value)) { status.textContent = 'Enter the six-digit SMS code.'; return; }
    busy = true; verify.disabled = true; send.disabled = true; phone.disabled = true;
    try {
      const result = await user.remote.verifyPhoneLink(requestedPhone, code.value);
      user.account = { ...user.account, phone: result.phone, phoneVerified: true }; user.emit('account');
      close(); onAdded(result.phone);
    } catch (error) { status.textContent = friendly(error); }
    finally { busy = false; verify.disabled = false; send.disabled = false; phone.disabled = false; }
  });
}
