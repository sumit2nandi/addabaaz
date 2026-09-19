import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { TokenStore } from '../services/token-store.service';

/**
 * Adds `Authorization: Bearer <access-token>` to every /api call and, on a 401,
 * silently refreshes the token once before retrying.
 *
 * `AuthService` is resolved lazily through the `Injector` so the interceptor
 * does not pull HttpClient into a construction cycle (AuthService → ApiService
 * → HttpClient → this interceptor).
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const tokens = inject(TokenStore);
  const injector = inject(Injector);

  const token = tokens.accessToken();
  if (!token || !request.url.startsWith('/api')) {
    return next(request);
  }

  const authorized = request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // Never try to refresh the auth endpoints themselves.
      if (request.url.includes('/api/auth/')) {
        return throwError(() => error);
      }

      const auth = injector.get(AuthService);
      return auth.refresh().pipe(
        switchMap((accessToken) =>
          accessToken
            ? next(
                request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } }),
              )
            : throwError(() => error),
        ),
        catchError(() => throwError(() => error)),
      );
    }),
  );
};
