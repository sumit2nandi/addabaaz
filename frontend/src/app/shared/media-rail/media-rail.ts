import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { RevealDirective } from '../reveal.directive';

const CARD_GAP = 18;
const FALLBACK_STEP = 210;

/**
 * Horizontally scrollable row with arrow controls — the "rail" used by every
 * catalogue row on the site. Cards are projected in; the row owns scrolling,
 * arrow state and the scroll-in animation.
 */
@Component({
  selector: 'app-media-rail',
  imports: [RevealDirective],
  templateUrl: './media-rail.html',
  styleUrl: './media-rail.scss',
})
export class MediaRail {
  readonly heading = input<string>('');
  readonly ariaLabel = input<string | null>(null);
  /** Render without the `.row` chrome (used by the episode list on /watch). */
  readonly plain = input<boolean>(false);

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly destroyRef = inject(DestroyRef);

  readonly atStart = signal(true);
  readonly atEnd = signal(false);

  private observer?: ResizeObserver;

  constructor() {
    afterNextRender(() => {
      const element = this.viewport().nativeElement;
      this.updateArrows();

      // Projected cards can appear/disappear (route changes, lazy images),
      // so keep the arrow state in sync with the track size too.
      this.observer = new ResizeObserver(() => this.updateArrows());
      this.observer.observe(element);
      if (element.firstElementChild) this.observer.observe(element.firstElementChild);

      window.addEventListener('resize', this.onResize);
    });

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      window.removeEventListener('resize', this.onResize);
    });
  }

  private readonly onResize = () => this.updateArrows();

  onScroll(): void {
    this.updateArrows();
  }

  onArrowKey(event: KeyboardEvent, direction: -1 | 1): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.scroll(direction);
  }

  scroll(direction: -1 | 1): void {
    const element = this.viewport().nativeElement;
    const firstCard = element.querySelector('.card, .ep-card, .modal-ep-item, .upcoming-card');
    const step = ((firstCard as HTMLElement | null)?.offsetWidth ?? FALLBACK_STEP) + CARD_GAP;
    element.scrollBy({ left: direction * step * 2, behavior: 'smooth' });
  }

  private updateArrows(): void {
    const element = this.viewport().nativeElement;
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    this.atStart.set(element.scrollLeft <= 5);
    this.atEnd.set(element.scrollLeft >= maxScroll - 5);
  }
}
