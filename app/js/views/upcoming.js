// Coming-soon list (#/upcoming). Catalog order is newest first; each artwork stays uncropped.
import { app } from '../app.js';
import { html } from '../util.js';
import { remindBtn, img, sectionHeader } from '../ui/components.js';

export default async function upcoming(ctx) {
  const cat = app.catalog;
  ctx.setTitle('Coming Soon');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'Future releases', title: 'Coming Soon', subtitle: 'A first look at the stories ADDABAAZ is bringing to the screen next. Set a reminder and we’ll tell you when they launch.' })}
    ${cat.upcoming.length ? html`<div class="grid grid-upcoming">${cat.upcoming.map((u) => html`
      <div class="show-tile">
        <a class="card card-poster card-soon" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title} — coming soon">
          <div class="poster poster-adaptive upcoming-page-poster">${img(u.poster, 'Coming soon poster', { cls: 'poster-adaptive-image', lazy: false })}<span class="chip chip-soon">Coming soon</span></div>
        </a>
        <div class="show-tile-info">${remindBtn(u.id, { cls: 'btn btn-ghost btn-sm' })}</div>
      </div>`)}</div>` : html`<p class="empty small">No upcoming releases have been announced yet.</p>`}
  </div>`.s;
}
