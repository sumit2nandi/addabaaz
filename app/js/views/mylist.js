// My List page (#/mylist): saved shows and videos, plus Continue Watching for this profile.
import { app } from '../app.js';
import { html } from '../util.js';
import { icon } from '../icons.js';
import { showCard, videoCard, soonCard, sectionHeader, emptyState } from '../ui/components.js';

export default async function mylist(ctx) {
  const cat = app.catalog, u = app.user;
  ctx.setTitle('My List');
  const items = u.listItems();
  const cards = items.map((x) => (x.type === 'show' ? cat.show(x.id) && showCard(cat.show(x.id)) : x.type === 'video' ? cat.video(x.id) && videoCard(cat.video(x.id)) : cat.soon(x.id) && soonCard(cat.soon(x.id)))).filter(Boolean);
  const shows = items.filter((x) => x.type !== 'video').map((x) => (x.type === 'show' ? cat.show(x.id) && showCard(cat.show(x.id)) : cat.soon(x.id) && soonCard(cat.soon(x.id)))).filter(Boolean);
  const vids = items.filter((x) => x.type === 'video').map((x) => cat.video(x.id) && videoCard(cat.video(x.id))).filter(Boolean);
  const cw = u.continueWatching(cat);
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: u.profile ? `${u.profile.name}’s library` : 'Library', title: 'My List', subtitle: 'Shows and videos you’ve saved, plus where you left off.' })}
    ${cw.length ? html`<h2 class="sub-h">Continue watching</h2><div class="grid grid-videos">${cw.map(({ video }) => videoCard(video))}</div>` : ''}
    ${shows.length ? html`<h2 class="sub-h">Saved shows</h2><div class="grid grid-shows">${shows}</div>` : ''}
    ${vids.length ? html`<h2 class="sub-h">Saved videos</h2><div class="grid grid-videos">${vids}</div>` : ''}
    ${!cards.length && !cw.length ? emptyState({ iconName: 'list', title: 'Your list is empty', text: 'Tap the + on any show or video to save it here.', action: html`<a class="btn btn-primary" href="#/shows">Browse shows</a>` }) : ''}
  </div>`.s;
}
