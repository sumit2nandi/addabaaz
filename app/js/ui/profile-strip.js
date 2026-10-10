import { html } from '../util.js';
import { icon } from '../icons.js';
import { avatar } from './components.js';
import { CONFIG } from '../config.js';

export function profileStrip(user) {
  return html`<section class="profile-selector" aria-labelledby="profileSelectorTitle">
    <div class="profile-selector-head"><h2 id="profileSelectorTitle">Profiles</h2><a class="profile-edit" href="#/profiles?manage=1">${icon('edit', { size: 16 })} Edit</a></div>
    <div class="profile-selector-list">
      ${user.profiles.map((p) => html`<button type="button" class="profile-choice" data-account-profile="${p.id}" aria-pressed="${p.id === user.activeId}" aria-label="${p.kids ? `${p.name}, Kids profile` : p.name}">
        ${avatar(p, { size: 64 })}<span class="profile-choice-name">${p.name}</span>${p.kids ? html`<small class="profile-kids-label">Kids</small>` : ''}
      </button>`)}
      ${user.profiles.length < CONFIG.maxProfiles ? html`<a class="profile-choice" href="#/profiles?manage=1&amp;add=1"><span class="profile-add-icon">${icon('plus', { size: 30 })}</span><span class="profile-choice-name">Add</span></a>` : ''}
    </div>
  </section>`;
}
