import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { authInterceptor } from './core/interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      // Back/forward keeps the old scroll position (the old scrollMemory),
      // a fresh navigation starts at the top (the old resetScrollPosition).
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideClientHydration(withEventReplay()),
    // Every catalogue request goes to the Spring Boot API through /api.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
  ],
};
