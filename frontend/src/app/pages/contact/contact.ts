import { DOCUMENT } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ApiContact, ApiSocialLink } from '../../core/models/api';
import { ContentService } from '../../core/services/content.service';
import { InquiryService } from '../../core/services/inquiry.service';
import { Captcha } from '../../shared/captcha/captcha';

type StatusKind = 'success' | 'error' | '';

/** Contact block with every field filled in, so the template needs no null checks. */
interface ContactDetails extends ApiContact {
  email: string;
  phones: string[];
  landline: string;
  whatsapp: { number: string; url: string };
  address: string[];
  mapsUrl: string;
  social: ApiSocialLink[];
}

const EMPTY_DETAILS: ContactDetails = {
  email: '',
  phones: [],
  landline: '',
  whatsapp: { number: '', url: '#' },
  address: [],
  mapsUrl: '#',
  social: [],
};

@Component({
  selector: 'app-contact',
  imports: [ReactiveFormsModule, Captcha],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private readonly formBuilder = inject(FormBuilder);
  private readonly inquiries = inject(InquiryService);
  private readonly content = inject(ContentService);
  private readonly document = inject(DOCUMENT);

  private readonly captchaRef = viewChild.required(Captcha);
  private readonly detailsSignal = this.content.contactDetails;
  private readonly socialLinks = this.content.socialLinks;

  /** Contact block, served by `site_setting.contact` with safe fallbacks. */
  get details(): ContactDetails {
    const value = this.detailsSignal() ?? {};
    return {
      ...EMPTY_DETAILS,
      ...value,
      phones: value.phones ?? [],
      address: value.address ?? [],
      // Social links are their own setting row in the database.
      social: this.socialLinks(),
      whatsapp: { ...EMPTY_DETAILS.whatsapp, ...(value.whatsapp ?? {}) },
    };
  }

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

  submit(): void {
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
    const captchaId = captchaComponent.id();

    if (!captchaId) {
      this.captchaError.set('The verification image is still loading — please try again.');
      this.statusKind.set('error');
      return;
    }

    this.submitting.set(true);
    this.inquiries
      .submit({
        name,
        email,
        phone,
        message,
        page: this.document.defaultView?.location.href ?? '',
        captchaId,
        captchaCode: captcha,
      })
      .subscribe({
        next: () => {
          this.status.set(
            '✓ Thank you! Your message has been received. We will get back to you shortly.',
          );
          this.statusKind.set('success');
          this.form.reset();
          this.submitted.set(false);
          captchaComponent.refresh();
        },
        error: (error: { error?: { message?: string } }) => {
          // The API rejects a wrong or expired CAPTCHA with a 400 and a message.
          const message = error?.error?.message;
          this.captchaError.set(message ?? 'Verification failed — please try again.');
          this.status.set(
            message ?? 'Something went wrong. Please try again in a moment.',
          );
          this.statusKind.set('error');
          this.form.controls.captcha.reset();
          captchaComponent.refresh();
        },
        complete: () => this.submitting.set(false),
      });
  }

  refreshCaptcha(): void {
    this.captchaRef().refresh();
  }
}
