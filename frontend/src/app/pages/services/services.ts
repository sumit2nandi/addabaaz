import { Component, inject } from '@angular/core';

import { ContentService } from '../../core/services/content.service';

@Component({
  selector: 'app-services',
  templateUrl: './services.html',
  styleUrl: './services.scss',
})
export class Services {
  private readonly content = inject(ContentService);

  /** The six expertise cards, served from the `service` table. */
  readonly services = this.content.serviceItems;
}
