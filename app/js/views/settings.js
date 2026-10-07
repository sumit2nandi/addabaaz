// One profile settings group (#/account/<group>): the group table lives in account-extra.js, so this
// view only looks the group up, draws its section with a way back, and wires it.
import { accountNav } from '../ui/account-nav.js';
import { go } from '../router.js';
import { html } from '../util.js';
import { icon } from '../icons.js';
import { settingGroups, settingSection, wireSetting } from './account-extra.js';

export default async function settings(ctx) {
  if (ctx.params.group === 'danger') { go('/delete-account', { replace: true }); return; }
  const meta = settingGroups().find((g) => g.id === ctx.params.group);
  const body = meta ? settingSection(meta.id) : '';
  if (!meta || !body) { go('/account', { replace: true }); return; }   // unknown group, or not for this viewer
  ctx.setTitle(meta.title);
  ctx.root.innerHTML = html`<div class="page page-narrow account-page settings-page">
    <p class="back-row"><a class="back-link" href="#/account">${icon('left', { size: 18 })}<span>Account</span></a></p>
    <div class="account-layout">
      ${accountNav(settingGroups(), meta.id)}
      <div class="account-content">${body}</div>
    </div>
  </div>`.s;
  wireSetting(meta.id, ctx.root, ctx);
}
