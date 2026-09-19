import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ContentService } from '../../core/services/content.service';
import { ModalService } from '../../core/services/modal.service';
import { AuthService } from '../../core/services/auth.service';
import { BillingService } from '../../core/services/billing.service';
import { videoLabel } from '../../core/utils/media';

/**
 * The one modal on the page: show details, full-size posters and the
 * sign-in / subscribe dialogs (now backed by the ADDABAAZ API).
 */
@Component({
  selector: 'app-modal-host',
  templateUrl: './modal-host.html',
  styleUrl: './modal-host.scss',
})
export class ModalHost {
  private readonly modal = inject(ModalService);
  private readonly content = inject(ContentService);
  private readonly auth = inject(AuthService);
  private readonly billing = inject(BillingService);
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

  /** Auth helpers used by the sign-in / subscribe dialogs. */
  readonly user = this.auth.user;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly plans = computed(() => this.billing.plans().filter((plan) => plan.code !== 'FREE'));

  readonly posterImageFailed = signal(false);
  readonly authBusy = signal(false);
  readonly authMessage = signal('');
  readonly authError = signal('');

  readonly label = videoLabel;

  constructor() {
    this.billing.loadPlans();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.modal.close();
  }

  close(): void {
    this.modal.close();
    this.resetAuthState();
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

  // --------------------------------------------------------------------- auth

  signIn(email: string, password: string): void {
    this.authBusy.set(true);
    this.authError.set('');
    this.authMessage.set('');

    this.auth.login({ email, password }).subscribe({
      next: (user) => {
        this.authBusy.set(false);
        this.authMessage.set(`Welcome back${user.fullName ? ', ' + user.fullName : ''}!`);
        this.billing.loadCurrent();
        this.modal.close();
      },
      error: (error: { error?: { message?: string } }) => {
        this.authBusy.set(false);
        this.authError.set(error?.error?.message ?? 'Those credentials did not match our records.');
      },
    });
  }

  /** Google sign-in is a full-page redirect handled by Spring Security. */
  socialSignIn(provider: string): void {
    if (provider === 'Google') {
      this.auth.signInWithGoogle();
      return;
    }
    this.authError.set(`${provider} sign-in is not enabled yet — use Google or your email.`);
  }

  /** Subscribe: pick a plan; sign-in is required first. */
  choosePlan(planCode: string): void {
    if (!this.isAuthenticated()) {
      this.authError.set('Sign in first, then pick a plan.');
      this.modal.openAuth('signIn');
      return;
    }
    this.authBusy.set(true);
    this.authError.set('');
    this.billing.subscribe(planCode).subscribe({
      next: (subscription) => {
        this.authBusy.set(false);
        this.authMessage.set(`${subscription.plan.name} is active until ${new Date(subscription.endsAt).toLocaleDateString()}.`);
        this.modal.close();
      },
      error: (error: { error?: { message?: string } }) => {
        this.authBusy.set(false);
        this.authError.set(error?.error?.message ?? 'Could not start that subscription.');
      },
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => this.modal.close());
  }

  private resetAuthState(): void {
    this.authBusy.set(false);
    this.authError.set('');
    this.authMessage.set('');
  }
}
