import { Component, signal } from '@angular/core';

import { MISSION_BENGALI, MISSION_ENGLISH, TEAM } from '../../core/data/site.data';

@Component({
  selector: 'app-about',
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class About {
  readonly missionBengali = MISSION_BENGALI;
  readonly missionEnglish = MISSION_ENGLISH;
  readonly team = TEAM;

  /** Avatar images are optional — hide the ones that fail to load. */
  readonly failedImages = signal<ReadonlySet<string>>(new Set());

  onAvatarError(name: string): void {
    this.failedImages.update((current) => new Set(current).add(name));
  }

  isHidden(name: string): boolean {
    return this.failedImages().has(name);
  }
}
