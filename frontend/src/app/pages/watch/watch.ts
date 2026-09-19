import { Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { Episode } from '../../core/models/content';
import { MediaRail } from '../../shared/media-rail/media-rail';
import { episodeNumberLabel, isPlayable, videoLabel } from '../../core/utils/media';

/** Delays used to lift the initial mute YouTube enforces on autoplay. */
const UNMUTE_DELAYS = [600, 1500, 3000];

@Component({
  selector: 'app-watch',
  imports: [MediaRail],
  templateUrl: './watch.html',
  styleUrl: './watch.scss',
})
export class Watch {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly content = inject(ContentService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);

  private readonly playerIframe = viewChild<ElementRef<HTMLIFrameElement>>('playerIframe');
  private readonly params = toSignal(this.route.paramMap);

  readonly promoId = computed(() => this.params()?.get('promoId') ?? null);
  readonly showKey = computed(() => this.params()?.get('showKey') ?? null);
  readonly episodeId = computed(() => this.params()?.get('episodeId') ?? null);

  readonly show = computed(() => this.content.getShow(this.showKey()));
  readonly episode = computed(() => this.content.getEpisode(this.show(), this.episodeId()));
  readonly promo = computed(() => this.content.getPromo(this.promoId()));

  /** The item currently loaded in the player: a promo, or a show episode. */
  readonly video = computed(() => this.promo() ?? this.episode());

  readonly title = computed(() => this.video()?.title ?? 'Episode Title');
  readonly subtitle = computed(() => {
    const promo = this.promo();
    if (promo) return `PROMO • ${promo.duration}`;
    const show = this.show();
    const episode = this.episode();
    if (!show || !episode) return 'Show Name & Subtitle';
    return `${show.title} • Episode ${episodeNumberLabel(episode.episode)} • ${episode.duration}`;
  });
  readonly description = computed(() => {
    const promo = this.promo();
    if (promo) return 'ADDABAAZ short-form content.';
    return this.show()?.description ?? '';
  });
  readonly episodeListTitle = computed(() => {
    const show = this.show();
    return show ? `${show.title} — Episodes` : 'Episodes';
  });

  readonly playerUrl = computed<SafeResourceUrl | null>(() => {
    const video = this.video();
    if (!video || !isPlayable(video)) return null;
    const pageOrigin = this.document.defaultView?.location.origin ?? '';
    const origin =
      pageOrigin && pageOrigin !== 'null' ? `&origin=${encodeURIComponent(pageOrigin)}` : '';
    const url =
      `https://www.youtube.com/embed/${encodeURIComponent(video.youtubeId)}?autoplay=1&mute=1` +
      `&playsinline=1&rel=0&modestbranding=1&enablejsapi=1${origin}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  readonly activeEpisodeId = computed(() => this.episode()?.id ?? null);

  readonly label = videoLabel;

  constructor() {
    // Unknown / unpublished links fall back to the homepage.
    effect(() => {
      const requested = this.showKey() || this.promoId();
      if (!requested) return;
      if (!this.video()) void this.router.navigate(['/']);
    });

    // Lift the autoplay mute shortly after the player boots.
    effect((onCleanup) => {
      const url = this.playerUrl();
      const iframe = this.playerIframe()?.nativeElement;
      if (!url || !iframe) return;

      const timers = UNMUTE_DELAYS.map((delay) =>
        setTimeout(() => {
          try {
            iframe.contentWindow?.postMessage(
              JSON.stringify({ event: 'command', func: 'unMute', args: '' }),
              '*',
            );
            iframe.contentWindow?.postMessage(
              JSON.stringify({ event: 'command', func: 'setVolume', args: '[100]' }),
              '*',
            );
          } catch {
            /* player not ready */
          }
        }, delay),
      );

      onCleanup(() => timers.forEach((timer) => clearTimeout(timer)));
    });
  }

  thumbnail(episode: Episode): string {
    const show = this.show();
    if (!show) return episode.thumbnail;
    return this.content.episodeThumbnail(episode, show);
  }

  playEpisode(episodeId: string): void {
    const showKey = this.showKey();
    if (!showKey) return;
    void this.router.navigate(['/watch', showKey, episodeId]);
  }

  onEpisodeKeydown(event: KeyboardEvent, episodeId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.playEpisode(episodeId);
  }
}
