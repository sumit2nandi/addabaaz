import { isPlatformBrowser } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiProfile, ApiUser, AuthResponse, LoginPayload, RegisterPayload } from '../models/api';
import { ApiService } from './api.service';
import { TokenStore } from './token-store.service';

/**
 * Sign-in state for the whole app.
 *
 * Access tokens are short-lived JWTs; refresh tokens are opaque and rotated by
 * the API on every refresh. Both live in localStorage (browser only) so a
 * reload keeps you signed in.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenStore);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);

  private readonly userSignal = signal<ApiUser | null>(null);
  private readonly profilesSignal = signal<ApiProfile[]>([]);
  private readonly restoring = signal(false);

  readonly user = this.userSignal.asReadonly();
  readonly profiles = this.profilesSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => (this.user()?.roles ?? []).includes('ROLE_ADMIN'));

  readonly defaultProfileId = computed(
    () => this.profiles().find((profile) => profile.isDefault)?.id ?? this.profiles()[0]?.id ?? null,
  );

  constructor() {
    // Restore the session on startup (browser only — SSR has no localStorage).
    if (isPlatformBrowser(this.platformId) && this.tokens.accessToken()) {
      this.restore();
    }
  }

  // ------------------------------------------------------------------- actions

  register(payload: RegisterPayload): Observable<ApiUser> {
    return this.api.register(payload).pipe(map((response) => this.accept(response)));
  }

  login(payload: LoginPayload): Observable<ApiUser> {
    return this.api.login(payload).pipe(map((response) => this.accept(response)));
  }

  /** Google hands the tokens back through the query string; store and load. */
  acceptOAuthTokens(accessToken: string, refreshToken: string): Observable<ApiUser> {
    this.tokens.set(accessToken, refreshToken);
    return this.loadMe();
  }

  /**
   * Browser redirect to Spring Security's Google entry point. The path is
   * proxied like every other /oauth2 request, so no CORS is involved.
   */
  signInWithGoogle(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    globalThis.location.href = environment.oauth2AuthorizeUrl;
  }

  logout(): Observable<void> {
    const refreshToken = this.tokens.refreshToken();
    this.clearSession();
    return this.api.logout(refreshToken).pipe(
      catchError(() => of(undefined)),
      map(() => undefined),
    );
  }

  /** Used by the interceptor after a 401. */
  refresh(): Observable<string | null> {
    const refreshToken = this.tokens.refreshToken();
    if (!refreshToken || this.restoring()) {
      return of(null);
    }
    this.restoring.set(true);
    return this.api.refresh(refreshToken).pipe(
      tap((response) => {
        this.restoring.set(false);
        this.tokens.set(response.accessToken, response.refreshToken);
      }),
      map((response) => response.accessToken),
      catchError((error) => {
        this.restoring.set(false);
        this.clearSession();
        return throwError(() => error);
      }),
    );
  }

  loadMe(): Observable<ApiUser> {
    return this.api.me().pipe(
      tap((summary) => {
        this.userSignal.set(summary.user);
        this.profilesSignal.set(summary.profiles);
        this.tokens.cacheUser(summary.user);
      }),
      map((summary) => summary.user),
    );
  }

  // ------------------------------------------------------------------ helpers

  private restore(): void {
    this.userSignal.set(this.tokens.cachedUser<ApiUser>());
    this.loadMe()
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  private accept(response: AuthResponse): ApiUser {
    this.tokens.set(response.accessToken, response.refreshToken);
    this.userSignal.set(response.user);
    this.tokens.cacheUser(response.user);
    // Profiles are not part of the auth payload; fetch them lazily.
    this.loadMe()
      .pipe(catchError(() => of(response.user)))
      .subscribe();
    return response.user;
  }

  private clearSession(): void {
    this.tokens.clear();
    this.userSignal.set(null);
    this.profilesSignal.set([]);
  }

  /** Convenience for guards/components: sign out and go home. */
  logoutAndGoHome(): void {
    this.logout().subscribe(() => void this.router.navigate(['/']));
  }
}
