// Admin console entry point (http://…/admin/).
//
// The Admin console is the *business* half of the management tools: customers, payments and refunds,
// coupons, the contact inbox, support tickets, comment moderation, analytics, broadcasts, errors and the
// audit log. The *content* half lives in its own console at /content/ (the Content studio) — see
// admin/js/console.js for why the two are separate pages.
//
// Sidebar menu. Grouped exactly as the pages are used day to day.
import { startConsole } from './console.js';

const NAV = [
  ['Overview', [['dashboard', 'Dashboard', 'dashboard']]],
  ['Customers', [['users', 'Users', 'users'], ['payments', 'Payments & refunds', 'card'], ['refunds', 'Refund requests', 'refund'], ['coupons', 'Coupons', 'ticket'], ['support', 'Support', 'chat'], ['messages', 'Messages', 'inbox'], ['comments', 'Comments', 'chat']]],
  ['Growth', [['analytics', 'Analytics', 'chart'], ['promos', 'Promotions', 'gift'], ['notifications', 'Broadcast', 'bell']]],
  ['System', [['cache', 'Client cache', 'refresh'], ['maintenance', 'Maintenance', 'power'], ['errors', 'Errors', 'bug'], ['audit', 'Audit log', 'log']]],
];
// URL pattern -> page module. Each module's default export is `render(root, params, ctx)`.
const ROUTES = [
  [/^dashboard$/, () => import('./views/dashboard.js')],
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
  switchTo: { href: '/content/', label: 'Content studio', icon: 'film', title: 'Shows, videos, coming soon, gallery and studio credits' },
});
