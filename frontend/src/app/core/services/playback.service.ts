import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiProgress } from '../models/api';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** `"MM:SS"` → seconds. */
export function parseDuration(duration: string | null | undefined): number {
  if (!duration) return 0;
  const parts = duration.split(':').map((part) => Number(part) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

/**
 * "Continue watching" for the signed-in profile.
 *
 * The player cannot read the YouTube clock (the site embeds a plain iframe), so
 * starting a video records it at position 0 — enough for the resume rail and the
 * watch history. Wiring the YouTube IFrame API would let this report real
 * positions without any other change.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly items = signal<ApiProgress[]>([]);

  readonly continueWatching = computed(() =>
    this.items()
      .filter((item) => !item.completed)
      .slice(0, 12),
  );

  load(): void {
    if (!this.auth.isAuthenticated()) {
      this.items.set([]);
      return;
    }
    this.api
      .continueWatching()
      .subscribe({ next: (items) => this.items.set(items ?? []), error: () => this.items.set([]) });
  }

  markWatching(input: {
    showKey?: string | null;
    episodeId?: string | null;
    promoId?: string | null;
    duration?: string | null;
  }): void {
    if (!this.auth.isAuthenticated()) return;
    if (!input.episodeId && !input.promoId) return;

    this.api
      .saveProgress({
        showKey: input.showKey ?? undefined,
        episodeId: input.episodeId ?? undefined,
        promoId: input.promoId ?? undefined,
        positionSeconds: 0,
        durationSeconds: parseDuration(input.duration),
      })
      .subscribe({ next: () => this.load(), error: () => undefined });
  }

  remove(id: string): void {
    this.api.deleteProgress(id).subscribe({ next: () => this.load(), error: () => undefined });
  }
}
