import { RenderMode, ServerRoute } from '@angular/ssr';

import { SHOWS } from './core/data/shows.data';

/**
 * Build-time rendering plan (see `npm run build`):
 * - the six content pages are prerendered to static HTML for SEO and sharing
 * - every show gets a prerendered landing page
 * - individual episode / promo pages are client-rendered on demand
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: 'watch/:showKey',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () =>
      SHOWS.filter((show) => show.episodes.length > 0).map((show) => ({ showKey: show.key })),
  },
  {
    path: 'watch/:showKey/:episodeId',
    renderMode: RenderMode.Client,
  },
  {
    path: 'watch/promo/:promoId',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
