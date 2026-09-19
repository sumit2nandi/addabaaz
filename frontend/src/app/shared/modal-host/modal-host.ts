import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { ModalService } from '../../core/services/modal.service';
import { videoLabel } from '../../core/utils/media';

/**
 * The one modal on the page: show details, full-size posters and the
 * (currently hidden) sign-in / subscribe dialogs.
 */
@Component({
  selector: 'app-modal-host',
  templateUrl: './modal-host.html',
  styleUrl: './modal-host.scss',
})
export class ModalHost {
  private readonly modal = inject(ModalService);
  private readonly content = inject(ContentService);
  private readonly router = inject(Router);

  readonly state = this.modal.state;
  readonly open = computed(() => this.state() !== null);
  readonly showState = computed(() => {
    const state = this.state();
    return state?.kind === 'show' ? state : null;
  });
  readonly posterState = computed(() => {
    const state = this.state();
    return state?.kind === 'poster' ? state : null;
  });
  readonly authState = computed(() => {
    const state = this.state();
    return state?.kind === 'auth' ? state : null;
  });

  readonly posterImageFailed = signal(false);

  readonly label = videoLabel;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.modal.close();
  }

  close(): void {
    this.modal.close();
  }

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  playFirstEpisode(showKey: string): void {
    this.modal.close();
    void this.router.navigate(['/watch', showKey]);
  }

  playEpisode(showKey: string, episodeId: string): void {
    this.modal.close();
    void this.router.navigate(['/watch', showKey, episodeId]);
  }

  episodeThumbnail(showKey: string, youtubeId: string, fallback: string): string {
    const show = this.content.getShow(showKey);
    return youtubeId
      ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
      : (show?.image ?? fallback);
  }

  onPosterImageError(): void {
    this.posterImageFailed.set(true);
  }

  onEpisodeKeydown(event: KeyboardEvent, showKey: string, episodeId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.playEpisode(showKey, episodeId);
  }

  /** Reset per-open state when the modal switches content. */
  onAuthSubmit(mode: 'signIn' | 'subscribe'): void {
    window.alert(mode === 'signIn' ? 'Signed in successfully!' : 'Thank you for subscribing!');
    this.modal.close();
  }

  socialSignIn(provider: string): void {
    window.alert(`Signed in with ${provider}!`);
    this.modal.close();
  }
}
