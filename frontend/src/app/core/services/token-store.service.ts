import { isPlatformBrowser } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { PLATFORM_ID } from '@angular/core';

const ACCESS_KEY = 'addabaaz.accessToken';
const REFRESH_KEY = 'addabaaz.refreshToken';
const USER_KEY = 'addabaaz.user';

/**
 * Where the tokens live.
 *
 * Deliberately free of HttpClient so the auth interceptor can read the token
 * without pulling the whole HTTP stack into a dependency cycle.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly access = signal<string | null>(this.read(ACCESS_KEY));
  private readonly refresh = signal<string | null>(this.read(REFRESH_KEY));

  readonly accessToken = this.access.asReadonly();
  readonly refreshToken = this.refresh.asReadonly();
  readonly isAuthenticated = computed(() => this.access() !== null);

  set(accessToken: string, refreshToken: string): void {
    this.access.set(accessToken);
    this.refresh.set(refreshToken);
    this.write(ACCESS_KEY, accessToken);
    this.write(REFRESH_KEY, refreshToken);
  }

  clear(): void {
    this.access.set(null);
    this.refresh.set(null);
    this.remove(ACCESS_KEY);
    this.remove(REFRESH_KEY);
    this.remove(USER_KEY);
  }

  /** Cached identity, shown straight away on reload before /api/me answers. */
  cachedUser<T>(): T | null {
    const raw = this.read(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  cacheUser(user: unknown): void {
    this.write(USER_KEY, JSON.stringify(user));
  }

  private read(key: string): string | null {
    if (!this.isBrowser) return null;
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    if (!this.isBrowser) return;
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode / quota — the session simply will not survive a reload */
    }
  }

  private remove(key: string): void {
    if (!this.isBrowser) return;
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
