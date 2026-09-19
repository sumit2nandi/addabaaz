import { Injectable, signal } from '@angular/core';

import { Show } from '../models/content';

export type AuthModalMode = 'signIn' | 'subscribe';

export type ModalState =
  | { kind: 'show'; show: Show }
  | { kind: 'poster'; src: string; title: string }
  | { kind: 'auth'; mode: AuthModalMode };

/**
 * Drives the single, app-wide modal host rendered in the shell.
 * Replaces the old `openModal()` / `openPosterModal()` / `openAuthModal()` calls.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly _state = signal<ModalState | null>(null);

  readonly state = this._state.asReadonly();
  readonly isOpen = () => this._state() !== null;

  openShow(show: Show): void {
    this._state.set({ kind: 'show', show });
  }

  openPoster(src: string, title = ''): void {
    if (!src) return;
    this._state.set({ kind: 'poster', src, title });
  }

  openAuth(mode: AuthModalMode): void {
    this._state.set({ kind: 'auth', mode });
  }

  close(): void {
    this._state.set(null);
  }
}
