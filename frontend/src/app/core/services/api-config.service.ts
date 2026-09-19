import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';

import { environment } from '../../../environments/environment';

/**
 * Resolves the API base URL once per platform.
 *
 * - browser: same-origin `/api` (proxied to Spring Boot by `ng serve`, or by
 *   your reverse proxy in production) so there is no CORS to configure
 * - server (SSR): an absolute URL, because Node cannot fetch relative paths
 */
@Injectable({ providedIn: 'root' })
export class ApiConfig {
  private readonly platformId = inject(PLATFORM_ID);

  readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly baseUrl = this.isBrowser
    ? environment.apiBaseUrl
    : environment.apiOrigin + environment.apiBaseUrl;

  /** Absolute origin — empty in the browser, where relative URLs work. */
  readonly origin = this.isBrowser ? '' : environment.apiOrigin;
}
