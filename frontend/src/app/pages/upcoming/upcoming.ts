import { Component, inject } from '@angular/core';

import { ContentService } from '../../core/services/content.service';
import { PosterCard } from '../../shared/poster-card/poster-card';

@Component({
  selector: 'app-upcoming',
  imports: [PosterCard],
  templateUrl: './upcoming.html',
  styleUrl: './upcoming.scss',
})
export class Upcoming {
  private readonly content = inject(ContentService);

  readonly posters = this.content.upcomingAll;
  readonly folder = this.content.upcomingFolder;
}
