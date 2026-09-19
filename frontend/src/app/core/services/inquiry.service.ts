import { Injectable } from '@angular/core';

import { FORM_CONFIG } from '../data/site.data';

export interface InquiryPayload {
  name: string;
  email: string;
  phone: string;
  message: string;
  page: string;
  submittedAt: string;
}

/**
 * Sends the contact form to whichever transport is configured in
 * `FORM_CONFIG` (Apps Script first, Google Forms second, console otherwise).
 */
@Injectable({ providedIn: 'root' })
export class InquiryService {
  async submit(payload: InquiryPayload): Promise<void> {
    const config = FORM_CONFIG;

    if (config.appsScriptUrl) {
      await fetch(config.appsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      return;
    }

    if (config.googleFormAction && config.googleFormFields.name) {
      const fields = config.googleFormFields;
      const body = new URLSearchParams();
      body.append(fields.name, payload.name);
      body.append(fields.email, payload.email);
      if (fields.phone) body.append(fields.phone, payload.phone);
      body.append(fields.message, payload.message);

      await fetch(config.googleFormAction, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      return;
    }

    // No transport configured yet — keep the payload visible for developers.
    console.log('[ADDABAAZ] Inquiry (form not connected):', payload);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}
