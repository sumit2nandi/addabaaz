// Coming-soon list (#/upcoming).
import { app } from '../app.js';
import { html } from '../util.js';
import { remindBtn, img, sectionHeader, fitAdaptivePosters } from '../ui/components.js';

export default async function upcoming(ctx) {
  const cat = app.catalog;
  ctx.setTitle('Coming Soon');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'Future releases', title: 'Coming Soon', subtitle: 'A first look at the stories ADDABAAZ is bringing to the screen next. Set a reminder and we’ll tell you when they launch.' })}
    <div class="upcoming-poster-groups">
      <section class="upcoming-poster-group" id="upcomingLandscapeGroup" aria-label="Landscape posters" hidden>
        <h2>Landscape posters</h2><div class="grid grid-upcoming-landscape"></div>
      </section>
      <section class="upcoming-poster-group" id="upcomingPortraitGroup" aria-label="Portrait posters" hidden>
        <h2>Portrait posters</h2><div class="grid grid-upcoming-portrait"></div>
      </section>
      <div class="grid grid-upcoming-pending" id="upcomingPosterPending">${cat.upcoming.map((u, index) => html`
        <div class="show-tile" data-upcoming-tile data-upcoming-index="${index}">
          <a class="card card-poster card-soon" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title} — coming soon">
            <div class="poster poster-adaptive upcoming-page-poster">${img(u.poster, 'Coming soon poster', { cls: 'poster-adaptive-image', lazy: false })}<span class="chip chip-soon">Coming soon</span></div>
          </a>
          <div class="show-tile-info">${remindBtn(u.id, { cls: 'btn btn-ghost btn-sm' })}</div>
        </div>`)}</div>
    </div>
  </div>`.s;

  const pending = ctx.root.querySelector('#upcomingPosterPending');
  fitAdaptivePosters(ctx.root, (image, orientation) => {
    if (ctx.stale()) return;
    const tile = image.closest('[data-upcoming-tile]'); if (!tile) return;
    const section = ctx.root.querySelector(orientation === 'landscape' ? '#upcomingLandscapeGroup' : '#upcomingPortraitGroup');
    const grid = section.querySelector('.grid');
    const index = Number(tile.dataset.upcomingIndex);
    const before = [...grid.children].find((other) => Number(other.dataset.upcomingIndex) > index) || null;
    grid.insertBefore(tile, before);
    section.hidden = false;
    if (!pending.children.length) pending.hidden = true;
  });
}
