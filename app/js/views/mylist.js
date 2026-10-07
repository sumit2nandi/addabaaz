import { pageBack } from '../ui/page-back.js';
// My List contains only shows, videos and upcoming titles explicitly saved by this profile.
import { app } from '../app.js';
import { html } from '../util.js';
import { sectionHeader, emptyState } from '../ui/components.js';
import { savedEntries, savedCard } from '../ui/saved-list.js';

export default async function mylist(ctx) {
  const cat = app.catalog, u = app.user;
  ctx.setTitle('My List');
  const backButton = pageBack(ctx, '/account');
  const draw = () => {
    const entries = savedEntries(u, cat);
    const shows = entries.filter((x) => x.type !== 'video').map(savedCard);
    const videos = entries.filter((x) => x.type === 'video').map(savedCard);
    ctx.root.innerHTML = html`<div class="page">
    ${backButton}
      ${sectionHeader({ tag: u.profile ? `${u.profile.name}’s library` : 'Library', title: 'My List', subtitle: 'Shows and videos you’ve saved.' })}
      ${shows.length ? html`<h2 class="sub-h">Saved shows</h2><div class="grid grid-shows">${shows}</div>` : ''}
      ${videos.length ? html`<h2 class="sub-h">Saved videos</h2><div class="grid grid-videos">${videos}</div>` : ''}
      ${!entries.length ? emptyState({ iconName: 'list', title: 'Your list is empty', text: 'Tap the + on any show or video to save it here.', action: html`<a class="btn btn-primary" href="#/shows">Browse shows</a>` }) : ''}
    </div>`.s;
  };
  draw();
  ctx.onCleanup(u.on('library', draw));
}
