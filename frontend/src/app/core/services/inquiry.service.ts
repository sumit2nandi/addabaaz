import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiInquiry } from '../models/api';
import { ApiService } from './api.service';

export interface InquiryPayload {
  name: string;
  email: string;
  phone?: string;
  message: string;
  page?: string;
  /** Server-issued CAPTCHA challenge id + the characters the visitor typed. */
  captchaId: string;
  captchaCode: string;
}

/**
 * Sends the contact form to the ADDABAAZ API, which validates the CAPTCHA and
 * stores the message in the `contact_inquiry` table.
 */
@Injectable({ providedIn: 'root' })
export class InquiryService {
  private readonly api = inject(ApiService);

  submit(payload: InquiryPayload): Observable<ApiInquiry> {
    return this.api.submitInquiry({
      name: payload.name,
      email: payload.email,
      phone: payload.phone || undefined,
      message: payload.message,
      page: payload.page,
      captchaId: payload.captchaId,
      captchaCode: payload.captchaCode,
    });
  }
}
