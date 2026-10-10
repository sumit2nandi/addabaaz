import { html } from '../util.js';
import { icon } from '../icons.js';
import { showCard, videoCard, soonCard } from './components.js';

// Only explicit saves belong here. Viewing progress must never populate My List.
export function savedEntries(user, catalog) {
  return user.listItems().map(({ type, id }) => {
    const item = type === 'show' ? catalog.show(id) : type === 'video' ? catalog.video(id) : type === 'upcoming' ? catalog.soon(id) : null;
    return item ? { type, item } : null;
  }).filter(Boolean);
}
export function savedCard({ type, item }) {
  return type === 'show' ? showCard(item) : type === 'video' ? videoCard(item, { progress: false }) : soonCard(item, { saved: true, fill: true });
}
export function savedListStrip(entries) {
  if (!entries.length) return html``;
  return html`<section class="account-saved" aria-labelledby="accountSavedTitle">
    <div class="profile-selector-head"><h2 id="accountSavedTitle">My List</h2><a class="icon-btn" href="#/list" aria-label="View all saved items" title="View all saved items">${icon('right', { size: 20 })}</a></div>
    <div class="account-saved-track" role="list" tabindex="0" aria-label="Saved shows and videos">${entries.slice(0, 12).map((entry) => html`<div class="account-saved-item ${entry.type === 'video' ? 'saved-video' : 'saved-poster'}" role="listitem">${savedCard(entry)}</div>`)}</div>
  </section>`;
}
