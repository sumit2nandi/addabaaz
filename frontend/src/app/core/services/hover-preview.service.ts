import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type CardPreviewType = 'show' | 'promo';

export interface CardPreviewRequest {
  youtubeId: string;
  title: string;
  meta: string;
  type: CardPreviewType;
  /** Card artwork used as the backdrop behind the iframe while it loads. */
  posterImage: string;
  showKey?: string;
  promoId?: string;
  anchor: HTMLElement;
}

export interface CardPreviewState extends Omit<CardPreviewRequest, 'anchor'> {
  left: number;
  top: number;
  /** Changes on every new preview so the iframe is recreated. */
  token: number;
}

export interface PosterPreviewRequest {
  src: string;
  title: string;
  anchor: HTMLElement;
}

export interface PosterPreviewState extends Omit<PosterPreviewRequest, 'anchor'> {
  left: number;
  top: number;
  token: number;
}

/** Roughly matches `.card-preview` / `.poster-preview` in the stylesheet. */
const CARD_PREVIEW_SIZE = { width: 420, height: 320 };
const POSTER_PREVIEW_SIZE = { width: 340, height: 480 };

function centerOver(anchor: HTMLElement, width: number, height: number, margin: number) {
  const rect = anchor.getBoundingClientRect();
  let left = rect.left + rect.width / 2;
  if (left - width / 2 < margin) left = margin + width / 2;
  if (left + width / 2 > window.innerWidth - margin) left = window.innerWidth - margin - width / 2;

  let top = rect.top + rect.height / 2;
  if (top - height / 2 < margin) top = margin + height / 2;
  if (top + height / 2 > window.innerHeight - margin)
    top = window.innerHeight - margin - height / 2;

  return { left, top };
}

/**
 * Owns the two desktop-only hover popups (the video card preview and the
 * full-size poster preview). Cards ask this service to open a popup over
 * themselves; the overlays live once, at the app root.
 */
@Injectable({ providedIn: 'root' })
export class HoverPreviewService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _cardPreview = signal<CardPreviewState | null>(null);
  private readonly _posterPreview = signal<PosterPreviewState | null>(null);

  readonly cardPreview = this._cardPreview.asReadonly();
  readonly posterPreview = this._posterPreview.asReadonly();

  private cardShowTimer: ReturnType<typeof setTimeout> | null = null;
  private cardHideTimer: ReturnType<typeof setTimeout> | null = null;
  private posterShowTimer: ReturnType<typeof setTimeout> | null = null;
  private posterHideTimer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;

  constructor() {
    const view = this.document.defaultView;
    const onWindowChange = () => this.hideAll();
    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('app-card-preview, app-poster-preview')) return;
      this.hideAll();
    };

    view?.addEventListener('scroll', onWindowChange, { passive: true });
    view?.addEventListener('resize', onWindowChange);
    this.document.addEventListener('click', onClick, true);

    this.destroyRef.onDestroy(() => {
      view?.removeEventListener('scroll', onWindowChange);
      view?.removeEventListener('resize', onWindowChange);
      this.document.removeEventListener('click', onClick, true);
      this.clearTimers();
    });
  }

  /** Hover previews are desktop-only (a real pointer and a wide viewport). */
  supportsHoverPreview(): boolean {
    const view = this.document.defaultView;
    if (!view) return false;
    if (view.innerWidth <= 820) return false;
    if (typeof view.matchMedia !== 'function') return true;
    try {
      return view.matchMedia('(hover: hover), (pointer: fine)').matches;
    } catch {
      return true;
    }
  }

  scheduleCardPreview(request: CardPreviewRequest, delay = 400): void {
    if (!request.youtubeId || !this.supportsHoverPreview()) return;
    this.clearTimeout('cardShowTimer');
    this.clearTimeout('cardHideTimer');
    this.cardShowTimer = setTimeout(() => {
      const { left, top } = centerOver(
        request.anchor,
        CARD_PREVIEW_SIZE.width,
        CARD_PREVIEW_SIZE.height,
        12,
      );
      const { anchor, ...rest } = request;
      this._cardPreview.set({ ...rest, left, top, token: ++this.token });
    }, delay);
  }

  hideCardPreview(delay = 180): void {
    this.clearTimeout('cardShowTimer');
    this.clearTimeout('cardHideTimer');
    this.cardHideTimer = setTimeout(() => this._cardPreview.set(null), delay);
  }

  cancelCardHide(): void {
    this.clearTimeout('cardHideTimer');
  }

  schedulePosterPreview(request: PosterPreviewRequest, delay = 350): void {
    if (!request.src || !this.supportsHoverPreview()) return;
    this.clearTimeout('posterShowTimer');
    this.clearTimeout('posterHideTimer');
    this.posterShowTimer = setTimeout(() => {
      const { left, top } = centerOver(
        request.anchor,
        POSTER_PREVIEW_SIZE.width,
        POSTER_PREVIEW_SIZE.height,
        14,
      );
      const { anchor, ...rest } = request;
      this._posterPreview.set({ ...rest, left, top, token: ++this.token });
    }, delay);
  }

  hidePosterPreview(delay = 160): void {
    this.clearTimeout('posterShowTimer');
    this.clearTimeout('posterHideTimer');
    this.posterHideTimer = setTimeout(() => this._posterPreview.set(null), delay);
  }

  cancelPosterHide(): void {
    this.clearTimeout('posterHideTimer');
  }

  hideAll(): void {
    this.hideCardPreview(0);
    this.hidePosterPreview(0);
  }

  private clearTimeout(
    key: 'cardShowTimer' | 'cardHideTimer' | 'posterShowTimer' | 'posterHideTimer',
  ) {
    const handle = this[key];
    if (handle) {
      clearTimeout(handle);
      this[key] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimeout('cardShowTimer');
    this.clearTimeout('cardHideTimer');
    this.clearTimeout('posterShowTimer');
    this.clearTimeout('posterHideTimer');
  }
}
