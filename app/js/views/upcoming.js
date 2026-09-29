import { app } from '../app.js';
import { html } from '../util.js';
import { remindBtn, img, sectionHeader } from '../ui/components.js';

export default async function upcoming(ctx) {
  const cat = app.catalog;
  ctx.setTitle('Coming Soon');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'Future releases', title: 'Coming Soon', subtitle: 'A first look at the stories ADDABAAZ is bringing to the screen next. Set a reminder and we’ll tell you when they launch.' })}
    <div class="grid grid-shows">${cat.upcoming.map((u) => html`
      <div class="show-tile">
        <a class="card card-poster" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title}"><div class="poster">${img(u.poster, u.title)}<span class="chip chip-soon">Coming soon</span></div></a>
        <div class="show-tile-info"><a class="bn" href="#/soon/${u.id}">${u.title}</a>${remindBtn(u.id, { cls: 'btn btn-ghost btn-sm' })}</div>
      </div>`)}</div></div>`.s;
}
