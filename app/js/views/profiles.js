// "Who's watching?" page (#/profiles): pick, add, edit or delete profiles (max 5; Kids profile option; PIN needed for changes if set).
import { app } from '../app.js';
import { CONFIG } from '../config.js';
import { html, $, $$ } from '../util.js';
import { icon } from '../icons.js';
import { avatar, toast } from '../ui/components.js';
import { avatarColor, AVATAR_COUNT } from '../data/user.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { go } from '../router.js';
import { withPin, mayLeaveKids } from '../ui/parental.js';
import { friendly } from '../errors.js';

export default async function profiles(ctx) {
  const u = app.user; const manage = ctx.query.manage === '1';
  const next = ctx.query.next ? decodeURIComponent(ctx.query.next) : '/';
  ctx.setTitle(manage ? 'Manage profiles' : 'Who’s watching?');
  document.body.classList.add('bare'); ctx.onCleanup(() => document.body.classList.remove('bare'));

  const draw = () => {
    ctx.root.innerHTML = html`<div class="profiles-page">
      <img class="profiles-logo" src="media/icons/icon-96.png" alt="ADDABAAZ" width="64" height="64">
      <h1>${manage ? 'Manage profiles' : 'Who’s watching?'}</h1>
      <div class="profile-grid">
        ${u.profiles.map((p) => html`<button type="button" class="profile-tile" data-pid="${p.id}">${avatar(p, { size: 116, cls: 'xl' })}${manage ? html`<span class="edit-badge">${icon('edit', { size: 18 })}</span>` : ''}<span>${p.name}${p.kids ? html` <em class="pill">Kids</em>` : ''}</span></button>`)}
        ${u.profiles.length < CONFIG.maxProfiles ? html`<button type="button" class="profile-tile add" data-add><span class="avatar xl add-av" style="width:116px;height:116px">${icon('plus', { size: 44 })}</span><span>Add profile</span></button>` : ''}
      </div>
      ${manage ? html`<a class="btn btn-ghost btn-lg" href="#/account">Done</a>` : html`<a class="btn btn-ghost" href="#/profiles?manage=1">Manage profiles</a>`}
    </div>`.s;
  };
  draw();
  const offProfile = u.on('profile', () => { if (ctx.root.isConnected) draw(); });
  ctx.onCleanup(offProfile);

  const form = (p) => {
    let color = p?.color ?? u.profiles.length;
    const { el, close } = openDialog(html`<h2>${p ? 'Edit profile' : 'Add profile'}</h2>
      <form id="pf" class="form" novalidate>
        <div class="avatar-preview" id="ap">${avatar({ name: p?.name || 'A', color }, { size: 84 })}</div>
        <label>Name<input name="name" maxlength="24" required value="${p?.name || ''}" autocomplete="off" placeholder="e.g. Rupa"></label>
        <label class="check"><input type="checkbox" name="kids" ${p?.kids ? 'checked' : ''}><span>Kids profile — shows only titles rated for children</span></label>
        <div class="swatches" role="radiogroup" aria-label="Colour">${Array.from({ length: AVATAR_COUNT }, (_, i) => html`<button type="button" role="radio" aria-checked="${i === color}" class="swatch ${i === color ? 'on' : ''}" data-c="${i}" style="background:${avatarColor(i)}" aria-label="Colour ${i + 1}"></button>`)}</div>
        <div class="form-status" id="pfs" role="alert"></div>
        <div class="row end">${p && u.profiles.length > 1 ? html`<button type="button" class="btn btn-danger" id="del">Delete</button>` : ''}<button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>`, { title: 'Profile', cls: 'dialog-sm' });
    const nameEl = $('[name=name]', el), preview = () => { $('#ap', el).innerHTML = avatar({ name: nameEl.value || 'A', color }, { size: 84 }).s; };
    nameEl.addEventListener('input', preview); nameEl.focus();
    el.addEventListener('click', (e) => { const s = e.target.closest('[data-c]'); if (s) { color = +s.dataset.c; $$('.swatch', el).forEach((x) => { x.classList.toggle('on', x === s); x.setAttribute('aria-checked', x === s); }); preview(); } });
    $('#pf', el).addEventListener('submit', async (e) => {
      e.preventDefault(); const name = nameEl.value.trim();
      if (!name) { $('#pfs', el).textContent = 'Please enter a name.'; return; }
      const kids = $('[name=kids]', el).checked;
      try { await withPin(u, () => (p ? u.updateProfile(p.id, { name, color, kids }) : u.createProfile({ name, color, kids }))); close(); toast(p ? 'Profile updated' : 'Profile added'); }
      catch (err) { if (!err.cancelled) $('#pfs', el).textContent = friendly(err); }
    });
    $('#del', el)?.addEventListener('click', async () => {
      close();
      if (await confirmDialog({ title: `Delete “${p.name}”?`, text: 'Their My List and watch history will be removed.', confirm: 'Delete', danger: true })) {
        try { await withPin(u, () => u.deleteProfile(p.id)); toast('Profile deleted'); } catch (err) { if (!err.cancelled) toast(friendly(err)); }
      }
    });
  };

  ctx.root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) return form(null);
    const t = e.target.closest('[data-pid]'); if (!t) return;
    const p = u.profiles.find((x) => x.id === t.dataset.pid);
    if (manage) return form(p);
    if (!(await mayLeaveKids(u, p))) return;
    await u.selectProfile(p.id);
    go(next.startsWith('/profiles') ? '/' : next, { replace: true });
  });
}
