import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { CONTACT_DETAILS } from '../../core/data/site.data';
import { InquiryService } from '../../core/services/inquiry.service';
import { Captcha } from '../../shared/captcha/captcha';

type StatusKind = 'success' | 'error' | '';

@Component({
  selector: 'app-contact',
  imports: [ReactiveFormsModule, Captcha],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private readonly formBuilder = inject(FormBuilder);
  private readonly inquiries = inject(InquiryService);
  private readonly document = inject(DOCUMENT);

  private readonly captchaRef = viewChild.required(Captcha);

  readonly details = CONTACT_DETAILS;

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    message: ['', Validators.required],
    captcha: ['', Validators.required],
  });

  readonly submitting = signal(false);
  readonly status = signal('');
  readonly statusKind = signal<StatusKind>('');
  readonly captchaError = signal('');
  readonly submitted = signal(false);

  readonly statusClass = computed(() => 'form-status ' + this.statusKind());

  async submit(): Promise<void> {
    this.submitted.set(true);
    this.status.set('');
    this.statusKind.set('');
    this.captchaError.set('');

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.status.set('Please fill in your name, email and message.');
      this.statusKind.set('error');
      return;
    }

    const { name, email, phone, message, captcha } = this.form.getRawValue();
    const captchaComponent = this.captchaRef();

    if (!captchaComponent.matches(captcha)) {
      this.captchaError.set('Incorrect code. Here is a new one.');
      this.status.set('Verification failed — please try again.');
      this.statusKind.set('error');
      this.form.controls.captcha.reset();
      captchaComponent.refresh();
      return;
    }

    this.submitting.set(true);
    try {
      await this.inquiries.submit({
        name,
        email,
        phone,
        message,
        page: this.document.defaultView?.location.href ?? '',
        submittedAt: new Date().toISOString(),
      });

      this.status.set(
        '✓ Thank you! Your message has been received. We will get back to you shortly.',
      );
      this.statusKind.set('success');
      this.form.reset();
      this.submitted.set(false);
      captchaComponent.refresh();
    } catch {
      this.status.set('Something went wrong. Please email us directly at ' + this.details.email);
      this.statusKind.set('error');
      captchaComponent.refresh();
    } finally {
      this.submitting.set(false);
    }
  }

  refreshCaptcha(): void {
    this.captchaRef().refresh();
  }
}
