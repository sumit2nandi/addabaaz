import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { ApiProgress } from '../../core/models/api';
import { youtubeThumbnail } from '../../core/utils/media';

/** Tile for the "Continue watching" rail — resumes an episode or a promo. */
@Component({
  selector: 'app-continue-card',
  template: `
    <div
      class="card catalog-card"
      tabindex="0"
      role="button"
      [attr.aria-label]="progress().title"
      (click)="play()"
      (keydown)="onKeydown($event)"
    >
      <div class="poster" [style.backgroundImage]="thumbnailStyle()">
        <div class="kind-badge">RESUME</div>
        <div class="play-overlay"><div class="play-btn">▶</div></div>
        @if (percent() > 0) {
          <div class="resume-bar"><span [style.width.%]="percent()"></span></div>
        }
      </div>
      <div class="meta">
        <div class="video-title">
          <strong>{{ progress().title }}</strong>
        </div>
        <div class="video-meta">{{ progress().showTitle ?? 'Promo' }}</div>
      </div>
    </div>
  `,
})
export class ContinueCard {
  readonly progress = input.required<ApiProgress>();

  private readonly router = inject(Router);

  readonly thumbnail = computed(
    () => this.progress().thumbnail || youtubeThumbnail(this.progress().youtubeId),
  );
  readonly thumbnailStyle = computed(() => `url('${this.thumbnail()}')`);

  readonly percent = computed(() => {
    const item = this.progress();
    if (!item.durationSeconds) return 0;
    return Math.min(100, Math.round((item.positionSeconds / item.durationSeconds) * 100));
  });

  play(): void {
    const item = this.progress();
    if (item.target === 'episode' && item.showKey && item.episodeId) {
      void this.router.navigate(['/watch', item.showKey, item.episodeId]);
      return;
    }
    if (item.promoId) {
      void this.router.navigate(['/watch/promo', item.promoId]);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.play();
  }
}
