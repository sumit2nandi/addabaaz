import { Component, ElementRef, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { PromoVideo } from '../../core/models/content';
import { HoverPreviewService } from '../../core/services/hover-preview.service';
import { youtubeThumbnail } from '../../core/utils/media';

/** Short-form tile (promos, reels, specials) — plays straight away. */
@Component({
  selector: 'app-promo-card',
  templateUrl: './promo-card.html',
  styleUrl: './promo-card.scss',
})
export class PromoCard {
  readonly video = input.required<PromoVideo>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly preview = inject(HoverPreviewService);

  readonly thumbnail = computed(() => {
    const video = this.video();
    return video.thumbnail || youtubeThumbnail(video.youtubeId);
  });
  readonly thumbnailStyle = computed(() => `url('${this.thumbnail()}')`);
  readonly badge = computed(() => (this.video().kind === 'SPECIAL' ? 'SPECIAL' : 'PROMO'));

  onEnter(): void {
    const video = this.video();
    this.preview.scheduleCardPreview({
      youtubeId: video.youtubeId,
      title: video.title,
      meta: `${video.duration} • ${this.badge()}`,
      type: 'promo',
      promoId: video.id,
      posterImage: this.thumbnail(),
      anchor: this.host.nativeElement,
    });
  }

  onLeave(): void {
    this.preview.hideCardPreview();
  }

  play(): void {
    this.preview.hideCardPreview(0);
    void this.router.navigate(['/watch/promo', this.video().id]);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.play();
  }
}
