import { NgClass } from '@angular/common';
import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';

import { PosterItem } from '../../core/models/content';
import { HoverPreviewService } from '../../core/services/hover-preview.service';
import { ModalService } from '../../core/services/modal.service';
import { mediaUrl } from '../../core/utils/media';

/**
 * Portrait 2:3 poster tile shared by Upcoming Releases and Behind the Scenes.
 * Hovering shows the large preview; clicking opens the full-size modal.
 */
@Component({
  selector: 'app-poster-card',
  imports: [NgClass],
  templateUrl: './poster-card.html',
  styleUrl: './poster-card.scss',
})
export class PosterCard {
  readonly item = input.required<PosterItem>();
  readonly folder = input.required<string>();
  readonly badge = input<string>('Coming Soon');
  readonly cardClass = input<string>('');
  readonly fallbackIcon = input<string>('fa-film');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly modal = inject(ModalService);
  private readonly preview = inject(HoverPreviewService);

  readonly src = computed(() => mediaUrl(this.folder(), this.item().file));
  readonly title = computed(() => this.item().title ?? '');
  readonly alt = computed(() => this.title() || 'ADDABAAZ image');
  readonly imageFailed = signal(false);

  onEnter(): void {
    this.preview.schedulePosterPreview({
      src: this.src(),
      title: this.title(),
      anchor: this.host.nativeElement,
    });
  }

  onLeave(): void {
    this.preview.hidePosterPreview();
  }

  open(): void {
    this.preview.hidePosterPreview(0);
    this.modal.openPoster(this.src(), this.title());
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.open();
  }

  onImageError(): void {
    this.imageFailed.set(true);
  }
}
