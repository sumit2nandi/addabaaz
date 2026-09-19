import { Component, afterNextRender, inject, signal } from '@angular/core';

import { ApiService } from '../../core/services/api.service';

/**
 * Image CAPTCHA rendered by the API.
 *
 * The code never reaches the browser — the server keeps only its hash and
 * validates the answer when the inquiry is submitted. Clicking the image (or
 * calling `refresh()`) fetches a new challenge.
 */
@Component({
  selector: 'app-captcha',
  template: `<img
    class="captcha-canvas"
    [src]="image()"
    alt="CAPTCHA image"
    title="Tap for a new code"
    role="img"
    (click)="refresh()"
  />`,
})
export class Captcha {
  private readonly api = inject(ApiService);

  /** Challenge id the contact form sends back with the typed answer. */
  readonly id = signal<string | null>(null);
  readonly image = signal('');
  readonly failed = signal(false);

  constructor() {
    // Browser only: the challenge is single use, so it must not be prerendered.
    afterNextRender(() => this.refresh());
  }

  refresh(): void {
    this.api.captcha().subscribe({
      next: (challenge) => {
        this.id.set(challenge.id);
        this.image.set(challenge.image);
        this.failed.set(false);
      },
      error: () => {
        this.id.set(null);
        this.image.set('');
        this.failed.set(true);
      },
    });
  }
}
