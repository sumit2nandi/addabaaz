// The shared "app" object: one place where the running app keeps its catalog, signed-in user, API client and router.
// Every module imports it instead of passing these around. main.js fills it in during start-up.
import { CONFIG } from './config.js';
/** Shared singletons, filled in by main.js before any view renders.
 *  `softRefresh()` (main.js) is how pull-to-refresh reloads the page's data without reloading the
 *  document — see app/js/ui/ptr.js. */
export const app = { config: CONFIG, catalog: null, fullCatalog: null, user: null, api: null, studio: null, router: null, softRefresh: null };
