import { CONFIG } from './config.js';
/** Shared singletons, filled in by main.js before any view renders. */
export const app = { config: CONFIG, catalog: null, fullCatalog: null, user: null, api: null, studio: null, router: null };
