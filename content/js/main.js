// Focused Content studio entry point (http://…/content/).
//
// Everything that shapes what viewers see: shows and seasons, videos and reels, the "coming soon"
// calendar and the studio/team credits. These same CMS pages are also available inside Admin at /admin/;
// this standalone route remains a shorter workspace for editors.
//
// Both entry points share the shell (admin/js/console.js), API client (admin/js/api.js) and page modules
// (admin/js/views/*.js) — this file only decides which pages exist and what the sidebar shows.
import { startConsole } from '/admin/js/console.js';

const NAV = [
  ['Overview', [['dashboard', 'Content overview', 'dashboard']]],
  ['Content', [
    ['shows', 'Shows & seasons', 'film'],
    ['videos', 'Videos & reels', 'tv'],
    ['upcoming', 'Coming soon', 'clock'],
    ['top', 'Top 10', 'crown'],
    ['studio', 'Studio & team', 'building'],
  ]],
];
// URL pattern -> page module. Each module's default export is `render(root, params, ctx)`.
const ROUTES = [
  [/^dashboard$/, () => import('/admin/js/views/content-overview.js')],
  [/^(shows|videos|upcoming|top)$/, () => import('/admin/js/views/content.js')],
  [/^studio$/, () => import('/admin/js/views/studio.js')],
];

startConsole({
  nav: NAV,
  routes: ROUTES,
  name: 'Content',
  title: 'ADDABAAZ Content Studio',
  switchTo: { href: '/admin/', label: 'Admin console', icon: 'users', title: 'Customers, payments, support, broadcasts and system tools' },
  badges: false,
});
