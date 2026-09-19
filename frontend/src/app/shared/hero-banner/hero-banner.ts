import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { ModalService } from '../../core/services/modal.service';

const HERO_SLIDE_DURATION = 12_000;
const HERO_VIDEO_START_DELAY = 2_500;
const HERO_VIDEO_DURATION = HERO_SLIDE_DURATION - 4_000;
const HERO_THUMB_COUNT = 3;

function youTubeCommand(iframe: HTMLIFrameElement, func: string, args = '') {
  try {
    iframe.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  } catch {
    /* the player may not be ready yet — nothing to do */
  }
}

/**
 * Homepage carousel: three top shows, a thumbnail backdrop that swaps into a
 * muted YouTube ambience clip, dots, swipe support and Play / Details actions.
 */
@Component({
  selector: 'app-hero-banner',
  templateUrl: './hero-banner.html',
  styleUrl: './hero-banner.scss',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
  },
})
export class HeroBanner {
  private readonly content = inject(ContentService);
  private readonly router = inject(Router);
  private readonly modal = inject(ModalService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private readonly heroIframe = viewChild<ElementRef<HTMLIFrameElement>>('heroIframe');

  readonly slides = this.content.heroSlides;
  readonly thumbs = Array.from({ length: HERO_THUMB_COUNT }, (_, index) => index);

  readonly currentIndex = signal(0);
  readonly videoActive = signal(false);
  readonly muted = signal(true);

  private slideTimer: ReturnType<typeof setTimeout> | null = null;
  private videoStartTimer: ReturnType<typeof setTimeout> | null = null;
  private videoStopTimer: ReturnType<typeof setTimeout> | null = null;

  private pointerStart: { x: number; y: number } | null = null;
  private readonly onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);

  readonly slide = computed(() => this.slides()[this.currentIndex()] ?? null);
  readonly videoTitle = computed(() => this.slide()?.show.title ?? 'ADDABAAZ background');
  readonly episodeCount = computed(() => this.slide()?.show.episodes.length ?? 0);

  readonly videoUrl = computed<SafeResourceUrl | null>(() => {
    const youtubeId = this.slide()?.youtubeId;
    if (!youtubeId) return null;
    const url =
      `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&mute=1` +
      `&enablejsapi=1&controls=0&loop=1&playlist=${encodeURIComponent(youtubeId)}` +
      `&modestbranding=1&playsinline=1`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    afterNextRender(() => this.start());

    // Keep the ambience clip in sync with the sound button.
    effect(() => {
      const iframe = this.heroIframe()?.nativeElement;
      if (!this.videoActive() || !iframe) return;
      if (this.muted()) {
        youTubeCommand(iframe, 'mute');
      } else {
        youTubeCommand(iframe, 'unMute');
        youTubeCommand(iframe, 'setVolume', '[100]');
      }
    });

    const view = this.document.defaultView;
    view?.addEventListener('pointerup', this.onPointerUp);
    view?.addEventListener('pointercancel', this.onPointerCancel);

    this.destroyRef.onDestroy(() => {
      view?.removeEventListener('pointerup', this.onPointerUp);
      view?.removeEventListener('pointercancel', this.onPointerCancel);
      this.clearTimers();
    });
  }

  private readonly onPointerCancel = () => {
    this.pointerStart = null;
  };

  thumbStyle(index: number): string {
    if (index !== this.currentIndex()) return 'none';
    const thumbnail = this.slide()?.thumbnail ?? '';
    return thumbnail ? `url('${thumbnail}')` : 'none';
  }

  play(): void {
    const slide = this.slide();
    if (slide) void this.router.navigate(['/watch', slide.key]);
  }

  openDetails(): void {
    const slide = this.slide();
    if (slide) this.modal.openShow(slide.show);
  }

  goToSlide(index: number): void {
    const total = this.slides().length;
    if (!total) return;
    this.startSlide(((index % total) + total) % total);
  }

  nextSlide(): void {
    this.goToSlide(this.currentIndex() + 1);
  }

  prevSlide(): void {
    this.goToSlide(this.currentIndex() - 1);
  }

  toggleMute(): void {
    this.muted.update((muted) => !muted);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  private handlePointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) this.nextSlide();
      else this.prevSlide();
    }
  }

  private start(): void {
    if (this.slides().length === 0) return;
    this.startSlide(0);
  }

  private startSlide(index: number): void {
    this.currentIndex.set(index);
    this.muted.set(true);
    this.videoActive.set(false);
    this.clearTimers();

    this.videoStartTimer = setTimeout(() => {
      this.videoActive.set(true);
      this.videoStopTimer = setTimeout(() => this.videoActive.set(false), HERO_VIDEO_DURATION);
    }, HERO_VIDEO_START_DELAY);

    this.slideTimer = setTimeout(() => this.goToSlide(index + 1), HERO_SLIDE_DURATION);
  }

  private clearTimers(): void {
    if (this.slideTimer) clearTimeout(this.slideTimer);
    if (this.videoStartTimer) clearTimeout(this.videoStartTimer);
    if (this.videoStopTimer) clearTimeout(this.videoStopTimer);
    this.slideTimer = null;
    this.videoStartTimer = null;
    this.videoStopTimer = null;
  }
}
