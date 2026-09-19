import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Rendering plan.
 *
 * Every page reads its content from the ADDABAAZ API, so pages are rendered on
 * demand (SSR) instead of being baked into static files at build time — the
 * catalogue stays live without a rebuild. `provideClientHydration()` caches the
 * SSR responses, so the browser does not re-request them on hydration.
 *
 * The API must be running for pages to render (see `backend/README.md`).
 */
export const serverRoutes: ServerRoute[] = [{ path: '**', renderMode: RenderMode.Server }];
