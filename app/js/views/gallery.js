// Behind-the-scenes photo gallery (#/gallery); clicking a photo opens the lightbox.
import { app } from '../app.js';
import { html, $, $$ } from '../util.js';
import { galleryCard, sectionHeader } from '../ui/components.js';
import { openLightbox } from '../ui/lightbox.js';

export default async function gallery(ctx) {
  const cat = app.catalog;
  const groups = [...new Set(cat.gallery.map((g) => g.group))];
  let cur = '';
  ctx.setTitle('Behind the Scenes');
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'On set', title: 'Behind the Scenes', subtitle: 'Moments, faces and frames from the making of ADDABAAZ productions.' })}
    <div class="filters"><div class="filter-group" id="gf"></div></div>
    <div class="grid grid-gallery" id="gg"></div></div>`.s;
  const draw = () => {
    $('#gf', ctx.root).innerHTML = html`${['', ...groups].map((g) => html`<button class="chip-btn ${cur === g ? 'active' : ''}" data-g="${g}">${g || 'All'}</button>`)}`.s;
    const items = cat.gallery.filter((g) => !cur || g.group === cur);
    $('#gg', ctx.root).innerHTML = items.map((g, i) => galleryCard(g, i)).join('');
  };
  ctx.root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-g]'); if (g) { cur = g.dataset.g; draw(); return; }
    const b = e.target.closest('[data-lightbox]'); if (b) openLightbox(cat.gallery.filter((x) => !cur || x.group === cur), b.dataset.lightbox);
  });
  draw();
}
