// Latest channel videos from the database-backed catalog. This page never polls YouTube.
import { app } from '../app.js';
import { html } from '../util.js';
import { sectionHeader, emptyState, videoCard } from '../ui/components.js';

const CHANNEL_URL = 'https://www.youtube.com/@ADDABAAZ01';

export default async function youtubeUploads(ctx) {
  const videos = app.catalog.videos
    .filter((v) => v.source?.type === 'youtube')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 15);
  ctx.setTitle('Latest from YouTube');
  const empty = app.user.isKids
    ? emptyState({ iconName: 'lock', title: 'Not available in Kids profiles', text: 'There are no age-rated channel videos available for this profile.' })
    : emptyState({
      iconName: 'film', title: 'No synced uploads yet',
      text: 'New YouTube videos will appear here after an administrator refreshes the catalog.',
      action: html`<a class="btn btn-ghost" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">Open ADDABAAZ on YouTube</a>`,
    });
  ctx.root.innerHTML = html`<div class="page">
    ${sectionHeader({ tag: 'The ADDABAAZ channel', title: 'Latest from YouTube', subtitle: 'The newest channel videos saved in the ADDABAAZ catalog. New uploads appear after an administrator manually refreshes the catalog.' })}
    ${videos.length ? html`<div class="grid grid-videos">${videos.map((v) => videoCard(v))}</div>` : empty}
  </div>`.s;
}
