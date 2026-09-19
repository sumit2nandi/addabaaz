/**
 * Runtime configuration for the ADDABAAZ frontend.
 *
 * The site is wired strictly to the Spring Boot API — there is no local copy of
 * the catalogue any more, so the backend must be running for pages to render.
 */
export const environment = {
  /**
   * Browser requests use a same-origin path. `ng serve` proxies it to the API
   * (see `proxy.conf.json`); in production put the same path behind your
   * reverse proxy (nginx/CloudFront/…).
   */
  apiBaseUrl: '/api',

  /**
   * Absolute origin of the API. Used when rendering on the server (SSR), where
   * relative URLs are not possible. Change this if the API is not on :8080.
   */
  apiOrigin: 'http://localhost:8080',

  /** Spring Security's Google sign-in entry point (proxied too). */
  oauth2AuthorizeUrl: '/oauth2/authorization/google',
};
