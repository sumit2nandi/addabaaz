import { Component, inject } from '@angular/core';

import { ContentService } from '../../core/services/content.service';
import { PosterCard } from '../../shared/poster-card/poster-card';

@Component({
  selector: 'app-bts',
  imports: [PosterCard],
  templateUrl: './bts.html',
  styleUrl: './bts.scss',
})
export class Bts {
  private readonly content = inject(ContentService);

  readonly photos = this.content.behindTheScenesAll;
  readonly folder = this.content.btsFolder;
}
