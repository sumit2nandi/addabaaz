// Admin console entry point (http://…/admin/).
//
// The Admin console includes both business operations and the full content CMS. The same CMS pages are
// also available in a focused Content studio at /content/ for editors who prefer a shorter sidebar.
//
// Sidebar menu. Grouped exactly as the pages are used day to day.
import { startConsole } from './console.js';

const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'dashboard']]],
  ['Content', [['catalog', 'Content overview', 'dashboard'], ['shows', 'Shows & seasons', 'film'], ['videos', 'Videos & reels', 'tv'], ['upcoming', 'Coming soon', 'clock'], ['top', 'Top 10', 'crown'], ['studio', 'Studio & team', 'building']]],
  ['Customers', [['users', 'Users', 'users'], ['payments', 'Payments & refunds', 'card'], ['refunds', 'Refund requests', 'refund'], ['coupons', 'Coupons', 'ticket'], ['support', 'Support', 'chat'], ['messages', 'Messages', 'inbox'], ['comments', 'Comments', 'chat']]],
  ['Growth', [['analytics', 'Analytics', 'chart'], ['promos', 'Promotions', 'gift'], ['notifications', 'Broadcast', 'bell']]],
  ['System', [['cache', 'Client cache', 'refresh'], ['maintenance', 'Maintenance', 'power'], ['errors', 'Errors', 'bug'], ['audit', 'Audit log', 'log']]],
];
// URL pattern -> page module. Each module's default export is `render(root, params, ctx)`.
const ROUTES = [
  [/^dashboard$/, () => import('./views/dashboard.js')],
  [/^catalog$/, () => import('./views/content-overview.js')],
  [/^(shows|videos|upcoming|top)$/, () => import('./views/content.js')],
  [/^studio$/, () => import('./views/studio.js')],
  [/^users$/, () => import('./views/users.js')],
  [/^users\/([^/]+)$/, () => import('./views/user.js')],
  [/^payments$/, () => import('./views/payments.js')],
  [/^coupons$/, () => import('./views/coupons.js')],
  [/^support$/, () => import('./views/support.js')],
  [/^messages$/, () => import('./views/messages.js')],
  [/^audit$/, () => import('./views/audit.js')],
  [/^analytics$/, () => import('./views/analytics.js')],
  [/^comments$/, () => import('./views/comments.js')],
  [/^refunds$/, () => import('./views/refunds.js')],
  [/^notifications$/, () => import('./views/notifications.js')],
  [/^promos$/, () => import('./views/promos.js')],
  [/^cache$/, () => import('./views/cache.js')],
  [/^maintenance$/, () => import('./views/maintenance.js')],
  [/^errors$/, () => import('./views/errors.js')],
];

startConsole({
  nav: NAV,
  routes: ROUTES,
  name: 'Admin',
  title: 'ADDABAAZ Admin',
  switchTo: { href: '/content/', label: 'Content studio', icon: 'film', title: 'Shows, videos, coming soon, Top 10 and studio credits' },
});
