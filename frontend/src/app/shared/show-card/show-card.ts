import { Component, ElementRef, computed, inject, input } from '@angular/core';

import { Show } from '../../core/models/content';
import { HoverPreviewService } from '../../core/services/hover-preview.service';
import { ModalService } from '../../core/services/modal.service';
import { showPoster } from '../../core/utils/media';

/** Catalogue tile for a web series / show — opens the details modal. */
@Component({
  selector: 'app-show-card',
  templateUrl: './show-card.html',
  styleUrl: './show-card.scss',
})
export class ShowCard {
  readonly show = input.required<Show>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly modal = inject(ModalService);
  private readonly preview = inject(HoverPreviewService);

  readonly poster = computed(() => showPoster(this.show()));
  readonly posterStyle = computed(() => `url('${this.poster()}')`);
  readonly tag = computed(() => this.show().subtitle.split('•')[0].trim());

  onEnter(): void {
    const show = this.show();
    this.preview.scheduleCardPreview({
      youtubeId: show.episodes[0]?.youtubeId ?? '',
      title: show.title,
      meta: show.subtitle,
      type: 'show',
      showKey: show.key,
      posterImage: this.poster(),
      anchor: this.host.nativeElement,
    });
  }

  onLeave(): void {
    this.preview.hideCardPreview();
  }

  open(): void {
    this.preview.hideCardPreview(0);
    this.modal.openShow(this.show());
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.open();
  }
}
