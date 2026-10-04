// Details for an upcoming title (#/soon/:id) with a "Remind me" button.
import { app } from '../app.js';
import { html } from '../util.js';
import { icon } from '../icons.js';
import { remindBtn, listBtn, img, rail, enhanceRails, reelCard, videoCard, toast, fitPoster } from '../ui/components.js';
import { openArtwork, tapArtwork } from '../ui/lightbox.js';
import { shareOrCopy } from '../util.js';
import { shareUrl } from '../platform.js';

export default async function soon(ctx) {
  const cat = app.catalog;
  const u = cat.soon(ctx.params.id);
  if (!u) throw new Error('This title does not exist.');
  const extras = cat.extras(u.id);
  ctx.setTitle(`${u.titleEn || u.title} — Coming soon`);
  ctx.root.innerHTML = html`
    <section class="detail-hero" id="detailHero">
      <div class="hero-bg">${img(u.backdrop || u.posterLg || u.poster, '', { lazy: false })}</div><div class="hero-shade"></div>
      <div class="hero-inner">
        <button type="button" class="detail-poster" id="detailPoster" aria-label="Open the full poster">${img(u.posterLg || u.poster, u.title, { lazy: false })}</button>
        <div class="hero-copy soon-hero-copy">
          <div class="eyebrow">${icon('clock', { size: 12 })} Coming soon</div>
          <h1 class="hero-title bn">${u.title}</h1>
          ${u.titleEn && u.titleEn !== u.title ? html`<div class="hero-title-en">${u.titleEn}</div>` : ''}
          <p class="hero-desc">${u.note || 'An upcoming ADDABAAZ original. Release date to be announced.'}</p>
          <div class="hero-actions soon-hero-actions">
            ${remindBtn(u.id, { cls: 'btn btn-primary btn-lg' })}
            ${listBtn('upcoming', u.id, { cls: 'btn btn-glass btn-lg' })}
            <button type="button" class="btn btn-glass btn-lg icon-only" id="artBtn" aria-label="View the full artwork" title="View the full artwork">${icon('expand', { size: 20 })}</button>
            <button type="button" class="btn btn-glass btn-lg icon-only" id="shareBtn" aria-label="Share">${icon('share', { size: 20 })}</button>
          </div>
        </div>
      </div>
    </section>
    <div class="page page-tight">
      ${rail({ title: 'Teasers & reels', items: extras.map((v) => (v.kind === 'reel' ? reelCard(v) : videoCard(v, { showName: false }))), cls: 'r-reel' })}
      ${rail({ title: 'More coming soon', items: cat.upcoming.filter((x) => x.id !== u.id).map((x) => html`<a class="card card-poster card-soon" href="#/soon/${x.id}"><div class="poster">${img(x.poster, x.title)}<span class="chip chip-soon">Coming soon</span></div></a>`), cls: 'r-poster' })}
    </div>`.s;
  enhanceRails(ctx.root);
  fitPoster(ctx.root);                                   // the poster keeps its own shape (tiny crop at most)
  // The full artwork popup, from whichever surface the viewer reached for: the poster box, the expand
  // button, or the banner itself (on a phone the poster box is hidden; the other two stay available).
  const art = { title: u.titleEn || u.title, poster: u.posterLg || u.poster, backdrop: u.backdrop || u.posterLg || u.poster };
  ctx.root.querySelector('#detailPoster')?.addEventListener('click', () => openArtwork(art, 'poster'));
  ctx.root.querySelector('#artBtn')?.addEventListener('click', () => openArtwork(art, 'poster'));
  tapArtwork(ctx.root.querySelector('#detailHero'), art);
  ctx.root.querySelector('#shareBtn').addEventListener('click', async () => {
    const r = await shareOrCopy({ title: u.titleEn || u.title, text: 'Coming soon on ADDABAAZ', url: shareUrl('/soon/' + u.id) });
    if (r === 'copied') toast('Link copied');
  });
}
