// Coming-soon list (#/upcoming). Portrait artwork tiles two per row; landscape (or square) artwork takes a
// full-width row. Tiles crop their image to fill, so mixed shapes always line up cleanly.
import { app } from '../app.js';
import { html, $$ } from '../util.js';
import { remindBtn, img, sectionHeader } from '../ui/components.js';
import { pageBack } from '../ui/page-back.js';

// Adds .is-wide to a tile once its artwork's true orientation is known (landscape/square spans the row).
// Artwork that is still loading keeps the two-per-row portrait layout until its load event arrives.
function fitTiles(root) {
  $$('.grid-upcoming .show-tile', root).forEach((tile) => {
    const image = tile.querySelector('img');
    if (!image) return;
    const classify = () => { if (image.naturalHeight > 0) tile.classList.toggle('is-wide', image.naturalWidth >= image.naturalHeight); };
    if (image.complete && image.naturalHeight > 0) classify();
    else image.addEventListener('load', classify, { once: true });
  });
}

export default async function upcoming(ctx) {
  const cat = app.catalog;
  ctx.setTitle('Coming Soon');
  // Arrived from a home banner or the top menu: Back returns to whichever page the viewer came from.
  const backButton = pageBack(ctx);
  ctx.root.innerHTML = html`<div class="page">
    ${backButton}
    ${sectionHeader({ tag: 'Future releases', title: 'Coming Soon', subtitle: 'A first look at the stories ADDABAAZ is bringing to the screen next. Set a reminder and we’ll tell you when they launch.' })}
    ${cat.upcoming.length ? html`<div class="grid grid-upcoming">${cat.upcoming.map((u) => html`
      <div class="show-tile">
        <a class="card card-poster card-soon" href="#/soon/${u.id}" aria-label="${u.titleEn || u.title} — coming soon">
          <div class="poster upcoming-page-poster">${img(u.poster, 'Coming soon poster', { cls: 'upcoming-page-image', lazy: false })}<span class="chip chip-soon">Coming Soon</span></div>
        </a>
        <div class="show-tile-info">${remindBtn(u.id, { cls: 'btn btn-ghost btn-sm' })}</div>
      </div>`)}</div>` : html`<p class="empty small">No upcoming releases have been announced yet.</p>`}
  </div>`.s;
  fitTiles(ctx.root);
}
