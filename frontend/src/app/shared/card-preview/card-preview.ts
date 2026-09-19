import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { HoverPreviewService } from '../../core/services/hover-preview.service';
import { ModalService } from '../../core/services/modal.service';

/**
 * Desktop hover popup that opens over a catalogue tile and plays a muted
 * YouTube preview. Rendered once at the app root.
 */
@Component({
  selector: 'app-card-preview',
  templateUrl: './card-preview.html',
  styleUrl: './card-preview.scss',
})
export class CardPreview {
  private readonly preview = inject(HoverPreviewService);
  private readonly router = inject(Router);
  private readonly modal = inject(ModalService);
  private readonly content = inject(ContentService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);

  private readonly iframe = viewChild<ElementRef<HTMLIFrameElement>>('previewIframe');

  readonly state = this.preview.cardPreview;
  readonly muted = signal(true);
  readonly iframeReady = signal(false);

  readonly visible = computed(() => this.state() !== null);
  readonly left = computed(() => this.state()?.left ?? 0);
  readonly top = computed(() => this.state()?.top ?? 0);

  /** One-entry list keyed by video id so switching cards recreates the iframe. */
  readonly slots = computed(() => {
    const state = this.state();
    return state ? [state] : [];
  });

  constructor() {
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    effect(() => {
      const state = this.state();
      this.muted.set(true);
      this.iframeReady.set(false);
      if (readyTimer) clearTimeout(readyTimer);
      if (!state) return;
      readyTimer = setTimeout(() => this.iframeReady.set(true), 450);
    });

    effect(() => {
      const iframe = this.iframe()?.nativeElement;
      if (!iframe?.contentWindow) return;
      const payload = JSON.stringify({
        event: 'command',
        func: this.muted() ? 'mute' : 'unMute',
        args: '',
      });
      try {
        iframe.contentWindow.postMessage(payload, '*');
        if (!this.muted()) {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'setVolume', args: '[100]' }),
            '*',
          );
        }
      } catch {
        /* player not ready */
      }
    });
  }

  embedUrl(youtubeId: string): SafeResourceUrl {
    const pageOrigin = this.document.defaultView?.location.origin ?? '';
    const origin =
      pageOrigin && pageOrigin !== 'null' ? `&origin=${encodeURIComponent(pageOrigin)}` : '';
    const url =
      `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&mute=1&loop=1` +
      `&playlist=${encodeURIComponent(youtubeId)}&controls=0&modestbranding=1&playsinline=1` +
      `&rel=0&iv_load_policy=3&enablejsapi=1${origin}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  posterStyle(posterImage: string): string {
    return posterImage ? `url('${posterImage}')` : 'none';
  }

  toggleMute(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.muted.update((muted) => !muted);
  }

  cancelHide(): void {
    this.preview.cancelCardHide();
  }

  scheduleHide(): void {
    this.preview.hideCardPreview();
  }

  watch(): void {
    const state = this.state();
    if (!state) return;
    this.preview.hideCardPreview(0);
    if (state.type === 'show' && state.showKey) {
      void this.router.navigate(['/watch', state.showKey]);
    } else if (state.promoId) {
      void this.router.navigate(['/watch/promo', state.promoId]);
    }
  }

  details(): void {
    const state = this.state();
    if (!state) return;
    this.preview.hideCardPreview(0);
    if (state.type === 'show' && state.showKey) {
      const show = this.content.getShow(state.showKey);
      if (show) this.modal.openShow(show);
    } else if (state.promoId) {
      void this.router.navigate(['/watch/promo', state.promoId]);
    }
  }
}
