import { Component, computed, inject, signal } from '@angular/core';

import { HoverPreviewService } from '../../core/services/hover-preview.service';

/** Desktop hover popup showing a full-size poster (Upcoming / BTS tiles). */
@Component({
  selector: 'app-poster-preview',
  templateUrl: './poster-preview.html',
  styleUrl: './poster-preview.scss',
})
export class PosterPreview {
  private readonly preview = inject(HoverPreviewService);

  readonly state = this.preview.posterPreview;
  readonly visible = computed(() => this.state() !== null);
  readonly left = computed(() => this.state()?.left ?? 0);
  readonly top = computed(() => this.state()?.top ?? 0);
  readonly imageFailed = signal(false);

  /** Keyed by src so switching tiles re-requests the image. */
  readonly slots = computed(() => {
    const state = this.state();
    return state ? [state] : [];
  });

  onImageError(): void {
    this.imageFailed.set(true);
  }
}
