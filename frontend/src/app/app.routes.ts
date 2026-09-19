import { Routes } from '@angular/router';

/**
 * Every "tab" of the original single-page site is now a real, deep-linkable
 * route. Scrolling is handled by the router (`withInMemoryScrolling`), which
 * restores position on back/forward and jumps to the top on a new page.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'ADDABAAZ — Film & Ad Production House',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    // Spring Security redirects here after Google sign-in.
    path: 'oauth2/callback',
    title: 'Signing in — ADDABAAZ',
    loadComponent: () =>
      import('./pages/oauth-callback/oauth-callback').then((m) => m.OAuthCallback),
  },
  {
    path: 'about',
    title: 'About — ADDABAAZ',
    loadComponent: () => import('./pages/about/about').then((m) => m.About),
  },
  {
    path: 'services',
    title: 'Our Expertise — ADDABAAZ',
    loadComponent: () => import('./pages/services/services').then((m) => m.Services),
  },
  {
    path: 'contact',
    title: 'Contact — ADDABAAZ',
    loadComponent: () => import('./pages/contact/contact').then((m) => m.Contact),
  },
  {
    path: 'upcoming',
    title: 'Upcoming Releases — ADDABAAZ',
    loadComponent: () => import('./pages/upcoming/upcoming').then((m) => m.Upcoming),
  },
  {
    path: 'bts',
    title: 'Behind the Scenes — ADDABAAZ',
    loadComponent: () => import('./pages/bts/bts').then((m) => m.Bts),
  },
  {
    path: 'watch/promo/:promoId',
    title: 'Watch — ADDABAAZ',
    loadComponent: () => import('./pages/watch/watch').then((m) => m.Watch),
  },
  {
    path: 'watch/:showKey/:episodeId',
    title: 'Watch — ADDABAAZ',
    loadComponent: () => import('./pages/watch/watch').then((m) => m.Watch),
  },
  {
    path: 'watch/:showKey',
    title: 'Watch — ADDABAAZ',
    loadComponent: () => import('./pages/watch/watch').then((m) => m.Watch),
  },
  { path: '**', redirectTo: '' },
];
