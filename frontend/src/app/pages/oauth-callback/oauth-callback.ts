import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Landing point for Google sign-in.
 *
 * Spring Security redirects here with the token pair in the query string; we
 * store it and hand the visitor back to the page they came from.
 */
@Component({
  selector: 'app-oauth-callback',
  template: `
    <section class="section-container page-enter">
      <div class="section-header">
        <h2 class="section-title">{{ message() }}</h2>
      </div>
    </section>
  `,
})
export class OAuthCallback {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly message = signal('Finishing sign-in…');

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const error = params.get('error');

    if (error || !accessToken || !refreshToken) {
      this.message.set('Google sign-in could not be completed. Please try again.');
      setTimeout(() => void this.router.navigate(['/']), 2500);
      return;
    }

    this.auth.acceptOAuthTokens(accessToken, refreshToken).subscribe({
      next: (user) => {
        this.message.set(`Welcome${user.fullName ? ', ' + user.fullName : ''}!`);
        void this.router.navigate(['/']);
      },
      error: () => {
        this.message.set('Google sign-in could not be completed. Please try again.');
        setTimeout(() => void this.router.navigate(['/']), 2500);
      },
    });
  }
}
