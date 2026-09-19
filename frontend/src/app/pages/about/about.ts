import { Component, inject, signal } from '@angular/core';

import { ContentService } from '../../core/services/content.service';

@Component({
  selector: 'app-about',
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class About {
  private readonly content = inject(ContentService);

  /** Mission statements and the team roster both come from the API. */
  readonly missionBengali = this.content.missionBengali;
  readonly missionEnglish = this.content.missionEnglish;
  readonly team = this.content.teamMembers;

  /** Avatar images are optional — hide the ones that fail to load. */
  readonly failedImages = signal<ReadonlySet<string>>(new Set());

  onAvatarError(name: string): void {
    this.failedImages.update((current) => new Set(current).add(name));
  }

  isHidden(name: string): boolean {
    return this.failedImages().has(name);
  }
}
