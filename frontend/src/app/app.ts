import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ModalService } from './core/services/modal.service';
import { CardPreview } from './shared/card-preview/card-preview';
import { ModalHost } from './shared/modal-host/modal-host';
import { PosterPreview } from './shared/poster-preview/poster-preview';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CardPreview, PosterPreview, ModalHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly modal = inject(ModalService);
  protected readonly year = new Date().getFullYear();
}
